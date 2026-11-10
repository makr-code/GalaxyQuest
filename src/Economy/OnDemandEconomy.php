<?php

declare(strict_types=1);

namespace GalaxyQuest\Economy;

use GalaxyQuest\Terrain\BodyDevelopment;
use DomainException;
use PDO;
use PDOStatement;
use RuntimeException;
use Throwable;

require_once __DIR__ . '/../../lib/BodyDevelopment.php';

/**
 * One ledger for primary resources, manufactured goods, population and market
 * projections. The user lock always precedes the colony lock.
 */
final class OnDemandEconomy
{
    private bool $mysql;
    private ?array $policyColumnTypes = null;
    private static int $transactionSequence = 0;

    public function __construct(private PDO $db)
    {
        $this->mysql = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    }

    public function transaction(callable $operation): mixed
    {
        $outer = $this->db->inTransaction();
        $savepoint = 'colony_economy_' . ++self::$transactionSequence;
        if ($outer) {
            $this->db->exec('SAVEPOINT ' . $savepoint);
        } else {
            $this->db->beginTransaction();
        }
        try {
            $result = $operation();
            if ($outer) {
                $this->db->exec('RELEASE SAVEPOINT ' . $savepoint);
            } else {
                $this->db->commit();
            }
            return $result;
        } catch (Throwable $error) {
            if ($outer) {
                $this->db->exec('ROLLBACK TO SAVEPOINT ' . $savepoint);
                $this->db->exec('RELEASE SAVEPOINT ' . $savepoint);
            } elseif ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
    }

    public function settle(int $colonyId, ?int $owner = null, ?int $now = null, bool $mutation = false): array
    {
        $now ??= time();
        return $this->transaction(function () use ($colonyId, $owner, $now, $mutation): array {
            $lookup = $this->query('SELECT user_id FROM colonies WHERE id = ?', [$colonyId])->fetch();
            if (!$lookup || ($owner !== null && (int)$lookup['user_id'] !== $owner)) {
                throw new DomainException('Colony not found.', 404);
            }
            $this->query('SELECT id FROM users WHERE id = ?' . $this->lock(), [$lookup['user_id']]);
            $colony = $this->query('SELECT * FROM colonies WHERE id = ?' . $this->lock(), [$colonyId])->fetch();
            $developmentPeak = (int)$colony['population'];
            $saved = $this->query('SELECT * FROM colony_economy_state WHERE colony_id = ?', [$colonyId])->fetch();
            $state = $saved ? json_decode($saved['state_json'], true, 512, JSON_THROW_ON_ERROR) : [
                'settled_at' => $now,
                'growth_remainder' => 0.0,
                'satisfaction' => (float)$colony['happiness'],
                'progress' => [],
            ];
            $state['credit_delta'] = 0.0;
            $state['stock'] = [];
            foreach (ColonyEconomySimulation::PRIMARY as $good) {
                $state['stock'][$good] = (float)$colony[$good];
            }
            $goods = $this->query(
                'SELECT * FROM economy_processed_goods WHERE colony_id = ?',
                [$colonyId]
            )->fetchAll();
            foreach ($goods as $row) {
                if (!in_array($row['good_type'], ColonyEconomySimulation::PRIMARY, true)) {
                    $state['stock'][$row['good_type']] = (float)$row['quantity'];
                } elseif (!$saved) {
                    // Reconcile legacy market purchases into the real raw ledger once.
                    $state['stock'][$row['good_type']] += (float)$row['quantity'];
                }
            }
            $state['classes'] = array_fill_keys(ColonyEconomySimulation::CLASSES, 0);
            foreach ($this->query('SELECT * FROM economy_pop_classes WHERE colony_id = ?', [$colonyId]) as $row) {
                if (array_key_exists($row['pop_class'], $state['classes'])) {
                    $state['classes'][$row['pop_class']] = (int)$row['count'];
                }
            }
            $difference = (int)$colony['population'] - array_sum($state['classes']);
            if ($difference >= 0) {
                $state['classes']['colonist'] += $difference;
            } else {
                foreach (array_reverse(ColonyEconomySimulation::CLASSES) as $class) {
                    $take = min(-$difference, $state['classes'][$class]);
                    $state['classes'][$class] -= $take;
                    $difference += $take;
                }
            }
            $context = $this->context($colony, $goods, !$saved);
            $state['deposits'] = $context['deposits'];
            $previousCursor = (int)$state['settled_at'];
            // A request catches up at most one simulated day, regardless of queue size.
            $target = min($now, (int)$state['settled_at'] + 86400);
            for ($events = 0; $events < 32; $events++) {
                $running = $this->query(
                    "SELECT * FROM building_upgrade_queue WHERE colony_id = ? AND status = 'running' "
                        . 'ORDER BY id LIMIT 1',
                    [$colonyId]
                )->fetch();
                if (!$running) {
                    $running = $this->startNext($colonyId, (int)$state['settled_at']);
                }
                $end = $running ? strtotime($running['eta'] . ' UTC') : false;
                if ($end === false || $end > $target) {
                    break;
                }
                $state = ColonyEconomySimulation::advance(
                    $state, $context, max($end, (int)$state['settled_at']), true, $developmentPeak
                );
                $this->query(
                    'UPDATE buildings SET level = ?, upgrade_end = NULL WHERE colony_id = ? AND type = ?',
                    [$running['target_level'], $colonyId, $running['building_type']]
                );
                $this->query("UPDATE building_upgrade_queue SET status = 'done' WHERE id = ?", [$running['id']]);
                $placement = $this->query(
                    'SELECT * FROM economy_construction_slots WHERE queue_id = ?',
                    [$running['id']]
                )->fetch();
                if ($placement) {
                    $this->query(
                        'UPDATE colony_building_slots SET level=? WHERE id=?',
                        [$placement['target_level'], $placement['slot_id']]
                    );
                }
                $context = $this->context($colony, $goods);
            }
            if ($events === 32) {
                // Never skip an unprocessed construction event when catching up.
                $target = (int)$state['settled_at'];
            }
            $state = ColonyEconomySimulation::advance($state, $context, $target, $mutation, $developmentPeak);
            $state['pending_seconds'] = $now - (int)$state['settled_at'];
            if (!$saved || $previousCursor !== (int)$state['settled_at']) {
                $this->persist($colony, $state, $context);
            }
            $colony = array_merge($colony, [
                'population' => array_sum($state['classes']),
                'max_population' => $context['population_capacity'],
                'happiness' => $state['satisfaction'],
                'energy' => $context['energy_available'],
            ], array_intersect_key($state['stock'], array_flip(ColonyEconomySimulation::PRIMARY)));
            return [
                'body_development' => BodyDevelopment::enabled()
                    ? BodyDevelopment::observe($this->db, $colony, $developmentPeak, $now) : null,
                'colony' => $colony,
                'economy' => $state,
                'buildings' => array_map(
                    static fn(string $type, int $level): array => ['type' => $type, 'level' => $level],
                    array_keys($context['buildings']),
                    array_values($context['buildings'])
                ),
                'slots' => $this->query(
                    'SELECT slot_x, slot_y, building_type, level FROM colony_building_slots WHERE colony_id = ?',
                    [$colonyId]
                )->fetchAll(),
                'pop_classes' => $state['classes'],
                'catalog' => self::catalog(),
                'methods' => array_replace(
                    array_fill_keys(array_keys(self::catalog()), 'standard'),
                    $context['methods']
                ),
                'storage' => $context['capacity'],
                'layout' => $context['layout'],
            ];
        });
    }

    private function context(array $colony, array $goods, bool $seed = false): array
    {
        require_once __DIR__ . '/../../api/economy_runtime.php';
        require_once __DIR__ . '/../../api/economy_flush.php';
        $cid = (int)$colony['id'];
        $buildings = [];
        $insert = $this->mysql ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
        if ($seed) {
            foreach (array_keys(ColonyEconomySimulation::RECIPES) as $type) {
                $this->query("$insert INTO buildings (colony_id, type, level) VALUES (?, ?, 0)", [$cid, $type]);
            }
            foreach (
                $this->query(
                    'SELECT building_type,SUM(level) AS levels FROM colony_building_slots WHERE colony_id=? '
                    . 'GROUP BY building_type',
                    [$cid]
                ) as $slot
            ) {
                $maximum = $this->mysql ? 'GREATEST' : 'MAX';
                $this->query(
                    "UPDATE buildings SET level=$maximum(level,?) WHERE colony_id=? AND type=?",
                    [$slot['levels'], $cid, $slot['building_type']]
                );
            }
        }
        foreach ($this->query('SELECT type, level FROM buildings WHERE colony_id = ?', [$cid]) as $building) {
            $buildings[$building['type']] = (int)$building['level'];
        }
        $runtime = fetch_colony_runtime_row($this->db, $cid);
        if (!$runtime) {
            throw new RuntimeException('Colony has no celestial body.');
        }
        $snapshot = build_colony_consumption_snapshot($this->db, $runtime);
        $raw = [];
        foreach (ColonyEconomySimulation::PRIMARY as $good) {
            $raw[$good] = (float)$snapshot['production'][$good . '_per_hour'];
            if ($good !== 'food') {
                $raw[$good] /= happiness_productivity((int)$runtime['happiness']);
            }
        }
        $policy = $this->query('SELECT * FROM economy_policies WHERE user_id = ?', [$colony['user_id']])->fetch() ?: [];
        $research = [];
        foreach ($this->query('SELECT type, level FROM research WHERE user_id = ?', [$colony['user_id']]) as $row) {
            $research[$row['type']] = (int)$row['level'];
        }
        $methods = [];
        foreach ($this->query('SELECT * FROM economy_production_methods WHERE colony_id = ?', [$cid]) as $row) {
            if (!in_array($row['method'], ['standard', 'efficient', 'premium'], true)) {
                throw new RuntimeException('Invalid persisted production method: ' . $row['method']);
            }
            $methods[$row['building_type']] = $row['method'];
        }
        $deposits = [];
        if ($colony['planet_id'] !== null) {
            $planet = $this->query('SELECT * FROM planets WHERE id = ?', [$colony['planet_id']])->fetch();
            foreach (['metal', 'crystal', 'deuterium', 'rare_earth'] as $good) {
                $deposits[$good] = (float)($planet['deposit_' . $good] ?? -1);
            }
        }
        $capacity = $snapshot['storage'];
        foreach ($goods as $row) {
            if (!in_array($row['good_type'], ColonyEconomySimulation::PRIMARY, true)) {
                $capacity[$row['good_type']] = (float)$row['capacity'];
            }
        }
        $tax = $this->taxRate($policy, 'tax_income', 0.15);
        $productionTax = $this->taxRate(
            $policy,
            array_key_exists('tax_production', $policy) ? 'tax_production' : 'tax_resources',
            0.0
        );
        $policyKey = $policy['global_policy'] ?? 'free_market';
        if (is_numeric($policyKey)) {
            $policyKey = ['free_market', 'subsidies', 'mercantilism', 'autarky', 'war_economy'][(int)$policyKey]
                ?? 'free_market';
        }
        return [
            'buildings' => $buildings, 'raw_production' => $raw,
            'energy_available' => max(0, $snapshot['welfare']['energy_balance']),
            'population_capacity' => $snapshot['welfare']['population_capacity'],
            'services' => $snapshot['welfare']['public_services'],
            'service_levels' => ($buildings['hospital'] ?? 0) + ($buildings['school'] ?? 0)
                + ($buildings['security_post'] ?? 0),
            'capacity' => $capacity, 'research' => $research, 'methods' => $methods,
            'policy' => $policyKey, 'income_tax' => min(0.4, max(0, $tax)),
            'production_tax' => min(0.3, max(0, $productionTax)),
            'good_multipliers' => array_replace(
                array_fill_keys(array_keys(ColonyEconomySimulation::PRICES), 1.0),
                get_policy_good_multipliers($this->db, (int)$colony['user_id'])
            ),
            'deposits' => $deposits,
            'galaxy_index' => (int)$runtime['galaxy_index'],
            'system_index' => (int)$runtime['system_index'],
            'layout' => colony_layout_profile($planet ?? []),
        ];
    }

    private function persist(array $colony, array $state, array $context): void
    {
        $cid = (int)$colony['id'];
        $this->query(
            'UPDATE colonies SET metal=?, crystal=?, deuterium=?, rare_earth=?, food=?, population=?, '
                . 'max_population=?, happiness=?, public_services=?, energy=?, last_update=? WHERE id=?',
            [
                ...array_map(
                    static fn(string $key): float => (float)$state['stock'][$key],
                    ColonyEconomySimulation::PRIMARY
                ),
                array_sum($state['classes']), $context['population_capacity'], (int)round($state['satisfaction']),
                $context['services'], (int)$context['energy_available'],
                gmdate('Y-m-d H:i:s', $state['settled_at']), $cid,
            ]
        );
        if ($colony['planet_id'] !== null) {
            foreach ($state['deposits'] as $good => $quantity) {
                $this->query(
                    'UPDATE planets SET deposit_' . $good . '=? WHERE id=?',
                    [$quantity, $colony['planet_id']]
                );
            }
        }
        if (($state['credit_delta'] ?? 0) != 0) {
            $this->query(
                'UPDATE users SET credits = credits + ? WHERE id = ?',
                [$state['credit_delta'], $colony['user_id']]
            );
        }
        $this->upsert('colony_economy_state', ['colony_id'], [
            'colony_id' => $cid, 'settled_at' => $state['settled_at'],
            'state_json' => json_encode($state, JSON_THROW_ON_ERROR),
        ]);
        foreach ($state['classes'] as $class => $count) {
            $progress = $state['progress'][$class] ?? 0;
            $this->upsert('economy_pop_classes', ['colony_id', 'pop_class'], [
                'colony_id' => $cid, 'pop_class' => $class, 'count' => $count,
                'satisfaction_index' => $state['satisfaction'],
                'employment_level' => 100 * ($state['employment'] ?? 1),
                'satisfaction_ticks' => (int)floor(max(0, $progress) / 3600),
                'shortage_ticks' => (int)floor(max(0, -$progress) / 3600),
            ]);
        }
        foreach (ColonyEconomySimulation::PRICES as $good => $price) {
            $quantity = $state['stock'][$good] ?? 0;
            $production = $state['production'][$good] ?? 0;
            $consumption = $state['consumption'][$good] ?? 0;
            if (!in_array($good, ColonyEconomySimulation::PRIMARY, true)) {
                $this->upsert('economy_processed_goods', ['colony_id', 'good_type'], [
                    'colony_id' => $cid, 'good_type' => $good, 'quantity' => $quantity,
                    'capacity' => $context['capacity'][$good] ?? 5000,
                    'production_rate_per_hour' => $production, 'consumption_rate_per_hour' => $consumption,
                    'last_calculated_at' => gmdate('Y-m-d H:i:s', $state['settled_at']),
                ]);
            }
            $this->upsert('economy_colony_market', ['colony_id', 'good_type'], [
                'colony_id' => $cid, 'good_type' => $good,
                'galaxy_index' => $context['galaxy_index'], 'system_index' => $context['system_index'],
                'quantity' => $quantity, 'production' => $production, 'consumption' => $consumption,
                'settled_at' => $state['settled_at'],
            ]);
        }
        $marks = implode(',', array_fill(0, count(ColonyEconomySimulation::PRIMARY), '?'));
        $this->query("DELETE FROM economy_processed_goods WHERE colony_id = ? AND good_type IN ($marks)", [
            $cid, ...ColonyEconomySimulation::PRIMARY,
        ]);
    }

    public static function processingCost(string $type, int $nextLevel): array
    {
        $tier = ColonyEconomySimulation::RECIPES[$type][2];
        $factor = 1.6 ** max(0, $nextLevel - 1);
        return [
            'metal' => (int)round(400 * $tier * $factor),
            'crystal' => (int)round(200 * $tier * $factor),
            'deuterium' => (int)round(50 * $tier * $factor),
        ];
    }

    public static function catalog(): array
    {
        $catalog = [];
        foreach (ColonyEconomySimulation::RECIPES as $type => [$good, $rate, $tier, $inputs]) {
            $catalog[$type] = [
                'good' => $good, 'rate_per_hour' => $rate, 'tier' => $tier, 'inputs' => $inputs,
                'research' => ColonyEconomySimulation::researchForTier($tier),
                'category' => 'industry', 'label' => ucwords(str_replace('_', ' ', $type)),
                'icon' => 'IND', 'zone' => 'surface', 'footprint' => 2, 'class_key' => 'industrial',
            ];
        }
        return $catalog;
    }

    public function queue(int $cid, int $uid, string $type, ?array $slot = null): array
    {
        return $this->transaction(function () use ($cid, $uid, $type, $slot): array {
            $snapshot = $this->settle($cid, $uid, null, true);
            $this->assertCaughtUp($snapshot);
            $catalog = building_definitions() + self::catalog();
            if (!isset($catalog[$type])) {
                throw new DomainException('Unknown building type.', 400);
            }
            if (isset(self::catalog()[$type])) {
                $tech = self::catalog()[$type]['research'];
                $row = $this->query('SELECT level FROM research WHERE user_id=? AND type=?', [$uid, $tech])->fetch();
                if (!$row || (int)$row['level'] < 1) {
                    throw new DomainException('Required research: ' . $tech . ' level 1.', 409);
                }
            }
            $building = $this->query(
                'SELECT level FROM buildings WHERE colony_id=? AND type=?',
                [$cid, $type]
            )->fetch();
            if (!$building) {
                throw new DomainException('Building not available on this colony.', 409);
            }
            $pending = $this->query(
                "SELECT * FROM building_upgrade_queue WHERE colony_id=? AND status IN ('queued','running')",
                [$cid]
            )->fetchAll();
            if (count($pending) >= 32) {
                throw new DomainException('Construction queue is full.', 409);
            }
            $next = (int)$building['level'] + 1;
            foreach ($pending as $entry) {
                if ($entry['building_type'] === $type) {
                    $next++;
                }
            }
            $cost = isset(ColonyEconomySimulation::RECIPES[$type])
                ? self::processingCost($type, $next) : building_cost($type, $next);
            if (
                $type === 'terraformer' && (int)$this->query(
                    "SELECT level FROM research WHERE user_id=? AND type='terraforming_tech'",
                    [$uid]
                )->fetchColumn() < 1
            ) {
                throw new DomainException('Terraformer requires Terraforming Tech level 1.', 409);
            }
            if (
                (int)$this->query(
                    "SELECT level FROM research WHERE user_id=? AND type='nano_materials'",
                    [$uid]
                )->fetchColumn() >= 1
            ) {
                $cost = array_map(static fn(int $amount): int => (int)round($amount * 0.85), $cost);
            }
            foreach (['metal', 'crystal', 'deuterium'] as $good) {
                if ($snapshot['colony'][$good] < $cost[$good]) {
                    throw new DomainException('Insufficient ' . $good . '.', 409);
                }
            }
            if ($slot !== null) {
                [$x, $y] = $slot;
                $layout = $snapshot['layout'];
                if (($catalog[$type]['zone'] ?? 'surface') !== 'surface') {
                    throw new DomainException('This building cannot be placed on the surface.', 400);
                }
                if ($x < 0 || $y < 0 || $x >= $layout['grid']['cols'] || $y >= $layout['grid']['rows']) {
                    throw new DomainException('Slot outside colony surface.', 400);
                }
                $occupied = $this->query(
                    'SELECT * FROM colony_building_slots WHERE colony_id=? AND slot_x=? AND slot_y=?',
                    [$cid, $x, $y]
                )->fetch();
                if ($occupied && $occupied['building_type'] !== $type) {
                    throw new DomainException('Slot already occupied.', 409);
                }
                if ($occupied && (int)$occupied['level'] === 0) {
                    throw new DomainException('Slot construction already pending.', 409);
                }
                if ($occupied && (int)$occupied['level'] >= 255) {
                    throw new DomainException('Slot level limit reached.', 409);
                }
                if (
                    $occupied && $this->query(
                        'SELECT q.id FROM building_upgrade_queue q '
                            . 'JOIN economy_construction_slots s ON s.queue_id=q.id '
                        . "WHERE s.slot_id=? AND q.status IN ('queued','running')",
                        [$occupied['id']]
                    )->fetch()
                ) {
                    throw new DomainException('Slot upgrade already pending.', 409);
                }
                if (!$occupied) {
                    $counts = [];
                    foreach ($snapshot['slots'] as $placed) {
                        $class = $catalog[$placed['building_type']]['class_key'] ?? 'industrial';
                        $counts[$class] = ($counts[$class] ?? 0) + 1;
                    }
                    $class = $catalog[$type]['class_key'] ?? 'industrial';
                    $counts[$class] = ($counts[$class] ?? 0) + 1;
                    $overflow = 0;
                    foreach ($counts as $class => $count) {
                        $overflow += max(0, $count - ($layout['class_caps'][$class] ?? 0));
                    }
                    if ($overflow > $layout['class_caps']['flex']) {
                        throw new DomainException('Building class capacity reached.', 409);
                    }
                }
                $this->upsert('colony_building_slots', ['colony_id', 'slot_x', 'slot_y'], [
                    'colony_id' => $cid, 'slot_x' => $x, 'slot_y' => $y, 'building_type' => $type,
                    'level' => $occupied ? (int)$occupied['level'] : 0,
                ]);
            }
            $duration = building_build_time(
                $cost,
                $this->level($snapshot, 'robotics_factory'),
                $this->level($snapshot, 'nanite_factory')
            );
            $manager = get_colony_leader($this->db, $cid, 'colony_manager');
            if ($manager) {
                $duration = leader_build_time($duration, (int)$manager['skill_construction']);
            }
            if ($snapshot['colony']['colony_type'] === 'industrial') {
                $duration = max(1, (int)round($duration * 0.9));
            }
            $this->spend($cid, $uid, $cost, static fn(): null => null);
            $this->query(
                'INSERT INTO building_upgrade_queue '
                    . '(colony_id,building_type,target_level,cost_metal,cost_crystal,cost_deuterium,'
                    . 'duration_secs,queued_at,status) '
                    . "VALUES (?,?,?,?,?,?,?,?,'queued')",
                [
                    $cid, $type, $next, $cost['metal'], $cost['crystal'], $cost['deuterium'],
                    $duration, gmdate('Y-m-d H:i:s'),
                ]
            );
            $id = (int)$this->db->lastInsertId();
            if ($slot !== null) {
                $placement = $this->query(
                    'SELECT id,level FROM colony_building_slots WHERE colony_id=? AND slot_x=? AND slot_y=?',
                    [$cid, ...$slot]
                )->fetch();
                $this->query(
                    'INSERT INTO economy_construction_slots (queue_id,slot_id,target_level) VALUES (?,?,?)',
                    [$id, $placement['id'], (int)$placement['level'] + 1]
                );
            }
            $this->startNext($cid, time());
            $active = $this->query(
                "SELECT building_type,eta FROM building_upgrade_queue WHERE colony_id=? AND status='running'",
                [$cid]
            )->fetch();
            return [
                'queued' => true, 'queue_id' => $id, 'queue_position' => count($pending) + 1,
                'type' => $type, 'target_level' => $next, 'duration_secs' => $duration, 'cost' => $cost,
                'upgrade_end' => $active['eta'] ?? null, 'active_type' => $active['building_type'] ?? null,
            ];
        });
    }

    private function level(array $snapshot, string $type): int
    {
        foreach ($snapshot['buildings'] as $building) {
            if ($building['type'] === $type) {
                return $building['level'];
            }
        }
        return 0;
    }

    public function remove(int $cid, int $uid, int $x, int $y): void
    {
        $this->transaction(function () use ($cid, $uid, $x, $y): void {
            $snapshot = $this->settle($cid, $uid, null, true);
            $this->assertCaughtUp($snapshot);
            $slot = $this->query(
                'SELECT * FROM colony_building_slots WHERE colony_id=? AND slot_x=? AND slot_y=?',
                [$cid, $x, $y]
            )->fetch();
            if (!$slot) {
                throw new DomainException('Slot not found.', 404);
            }
            if (
                $this->query(
                    'SELECT id FROM building_upgrade_queue WHERE colony_id=? AND building_type=? '
                        . "AND status IN ('queued','running')",
                    [$cid, $slot['building_type']]
                )->fetch()
            ) {
                throw new DomainException('Finish pending construction before demolition.', 409);
            }
            $this->query('UPDATE buildings SET level=level-? WHERE colony_id=? AND type=? AND level>=?', [
                $slot['level'], $cid, $slot['building_type'], $slot['level'],
            ]);
            $this->query('DELETE FROM colony_building_slots WHERE id=?', [$slot['id']]);
        });
    }

    public function assertCaughtUp(array $snapshot): void
    {
        if ($snapshot['economy']['pending_seconds'] >= ColonyEconomySimulation::STEP_SECONDS) {
            throw new DomainException('Economy is catching up. Refresh before changing production.', 409);
        }
    }

    public function exchange(int $cid, int $uid, string $good, float $quantity, bool $buy): array
    {
        if (!isset(ColonyEconomySimulation::PRICES[$good]) || !is_finite($quantity) || $quantity <= 0) {
            throw new DomainException('Invalid good or quantity.', 400);
        }
        return $this->transaction(function () use ($cid, $uid, $good, $quantity, $buy): array {
            $snapshot = $this->settle($cid, $uid, null, true);
            $this->assertCaughtUp($snapshot);
            $context = $this->context($snapshot['colony'], $this->query(
                'SELECT * FROM economy_processed_goods WHERE colony_id=?',
                [$cid]
            )->fetchAll());
            if ($buy && $context['policy'] === 'autarky') {
                throw new DomainException('Autarky blocks imports.', 409);
            }
            $state = $snapshot['economy'];
            $market = $this->market($context['galaxy_index'], $context['system_index']);
            $price = $market['goods'][$good]['price'] ?? (float)ColonyEconomySimulation::PRICES[$good];
            $policy = $this->query('SELECT tax_trade FROM economy_policies WHERE user_id=?', [$uid])->fetch();
            $tax = min(0.25, max(0, $this->taxRate($policy ?: [], 'tax_trade', 0.05)));
            $credits = (float)$this->query('SELECT credits FROM users WHERE id=?', [$uid])->fetchColumn();
            $total = round($quantity * $price * ($buy ? 1 + $tax : 1 - $tax), 4);
            $available = $state['stock'][$good] ?? 0;
            if ($buy && ($credits < $total || $available + $quantity > ($context['capacity'][$good] ?? 5000))) {
                throw new DomainException('Insufficient credits or storage capacity.', 409);
            }
            if (!$buy && $available < $quantity) {
                throw new DomainException('Insufficient stock.', 409);
            }
            $state['stock'][$good] = $available + ($buy ? $quantity : -$quantity);
            $state['credit_delta'] = $buy ? -$total : $total;
            $this->persist($snapshot['colony'], $state, $context);
            $this->query(
                'INSERT INTO economy_market_transactions '
                    . '(user_id,colony_id,good_type,direction,quantity,price_per_unit,'
                    . 'total_credits,trade_tax_rate,net_credits) '
                    . 'VALUES (?,?,?,?,?,?,?,?,?)',
                [$uid, $cid, $good, $buy ? 'buy' : 'sell', $quantity, $price, $total, $tax, $total]
            );
            return [
                'good_type' => $good, 'quantity' => $quantity, 'price_per_unit' => $price, 'total_credits' => $total,
            ];
        });
    }

    public function method(int $cid, int $uid, string $building, string $method): void
    {
        if (
            !isset(ColonyEconomySimulation::RECIPES[$building])
            || !in_array($method, ['standard', 'efficient', 'premium'], true)
        ) {
            throw new DomainException('Invalid production method.', 400);
        }
        $this->transaction(function () use ($cid, $uid, $building, $method): void {
            $snapshot = $this->settle($cid, $uid, null, true);
            $this->assertCaughtUp($snapshot);
            $tech = $method === 'premium' ? 'quantum_computing' : self::catalog()[$building]['research'];
            $level = $this->query(
                'SELECT level FROM research WHERE user_id=? AND type=?',
                [$uid, $tech]
            )->fetchColumn();
            if ((int)$level < 1) {
                throw new DomainException('Production method requires ' . $tech . ' level 1.', 409);
            }
            $this->upsert('economy_production_methods', ['colony_id', 'building_type'], [
                'colony_id' => $cid, 'building_type' => $building, 'method' => $method,
            ]);
        });
    }

    public function configure(int $uid, string $setting, string|float|bool $value): void
    {
        $policies = ['free_market', 'subsidies', 'mercantilism', 'autarky', 'war_economy'];
        $taxes = ['tax_income' => 0.4, 'tax_production' => 0.3, 'tax_trade' => 0.25];
        $subsidies = ['subsidy_agriculture', 'subsidy_research', 'subsidy_military'];
        if ($setting === 'global_policy' && !in_array($value, $policies, true)) {
            throw new DomainException('Invalid economic policy.', 400);
        }

        if (
            isset($taxes[$setting]) && (!is_float($value) || !is_finite($value)
            || $value < 0 || $value > $taxes[$setting])
        ) {
            throw new DomainException('Invalid tax rate.', 400);
        }
        if ($setting !== 'global_policy' && !isset($taxes[$setting]) && !in_array($setting, $subsidies, true)) {
            throw new DomainException('Invalid economic setting.', 400);
        }
        $this->empireMutation($uid, function () use ($uid, $setting, $value, $policies): void {
            $insert = $this->mysql ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
            $created = $this->query("$insert INTO economy_policies (user_id) VALUES (?)", [$uid])->rowCount() > 0;
            $row = $this->query('SELECT * FROM economy_policies WHERE user_id=?', [$uid])->fetch();
            if ($created) {
                $productionColumn = array_key_exists('tax_production', $row) ? 'tax_production' : 'tax_resources';
                $this->query(
                    "UPDATE economy_policies SET global_policy=?, tax_income=?, `$productionColumn`=0, tax_trade=?, "
                        . 'subsidy_agriculture=0, subsidy_research=0, subsidy_military=0 WHERE user_id=?',
                    [
                        is_numeric($row['global_policy']) ? 0 : 'free_market',
                        $this->wholePercentTax('tax_income') ? 15 : 0.15,
                        $this->wholePercentTax('tax_trade') ? 5 : 0.05,
                        $uid,
                    ]
                );
                $row = $this->query('SELECT * FROM economy_policies WHERE user_id=?', [$uid])->fetch();
            }
            if ($setting === 'tax_production' && !array_key_exists($setting, $row)) {
                $setting = 'tax_resources';
            }
            if ($setting === 'global_policy' && is_numeric($row[$setting])) {
                $value = array_search($value, $policies, true);
            } elseif (str_starts_with($setting, 'subsidy_')) {
                $value = (int)$value;
            } elseif (str_starts_with($setting, 'tax_')) {
                if ($this->wholePercentTax($setting) || (float)$row[$setting] > 1) {
                    $value = round((float)$value * 100);
                }
            }
            $this->query("UPDATE economy_policies SET `$setting`=? WHERE user_id=?", [$value, $uid]);
        });
    }

    public function policy(int $uid): array
    {
        $row = $this->query('SELECT * FROM economy_policies WHERE user_id=?', [$uid])->fetch() ?: [];
        $policy = $row['global_policy'] ?? 'free_market';
        if (is_numeric($policy)) {
            $policy = ['free_market', 'subsidies', 'mercantilism', 'autarky', 'war_economy'][(int)$policy] ?? 'free_market';
        }
        $production = array_key_exists('tax_production', $this->policyColumnTypes()) ? 'tax_production' : 'tax_resources';
        return [
            'global_policy' => $policy,
            'taxes' => [
                'income' => $this->taxRate($row, 'tax_income', 0.15),
                'production' => $this->taxRate($row, $production, 0.0),
                'trade' => $this->taxRate($row, 'tax_trade', 0.05),
            ],
            'tax_steps' => [
                'income' => $this->wholePercentTax('tax_income') ? 0.01 : 0.0001,
                'production' => $this->wholePercentTax($production) ? 0.01 : 0.0001,
                'trade' => $this->wholePercentTax('tax_trade') ? 0.01 : 0.0001,
            ],
            'subsidies' => [
                'agriculture' => (bool)($row['subsidy_agriculture'] ?? false),
                'research' => (bool)($row['subsidy_research'] ?? false),
                'military' => (bool)($row['subsidy_military'] ?? false),
            ],
        ];
    }

    private function taxRate(array $row, string $column, float $default): float
    {
        if (!array_key_exists($column, $row)) {
            return $default;
        }
        $value = (float)$row[$column];
        return $this->wholePercentTax($column) || $value > 1 ? $value / 100 : $value;
    }

    private function wholePercentTax(string $name): bool
    {
        $types = $this->policyColumnTypes();
        if (!array_key_exists($name, $types)) {
            throw new RuntimeException('Missing economy tax column: ' . $name);
        }
        return str_contains(strtolower($types[$name]), 'int');
    }

    private function policyColumnTypes(): array
    {
        if ($this->policyColumnTypes === null) {
            if ($this->mysql) {
                $this->policyColumnTypes = $this->query(
                    'SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() '
                        . "AND TABLE_NAME='economy_policies'"
                )->fetchAll(PDO::FETCH_KEY_PAIR);
            } else {
                $this->policyColumnTypes = [];
                foreach ($this->query('PRAGMA table_info(economy_policies)')->fetchAll() as $column) {
                    $this->policyColumnTypes[$column['name']] = $column['type'];
                }
            }
        }
        return $this->policyColumnTypes;
    }

    public function spend(int $cid, int $uid, array $cost, callable $commit): mixed
    {
        return $this->transaction(function () use ($cid, $uid, $cost, $commit): mixed {
            $snapshot = $this->settle($cid, $uid, null, true);
            $this->assertCaughtUp($snapshot);
            $state = $snapshot['economy'];
            foreach ($cost as $good => $quantity) {
                if (
                    !isset(ColonyEconomySimulation::PRICES[$good]) || !is_numeric($quantity)
                    || !is_finite((float)$quantity) || $quantity < 0
                ) {
                    throw new DomainException('Invalid resource cost.', 400);
                }
                if (($state['stock'][$good] ?? 0) < $quantity) {
                    throw new DomainException('Insufficient ' . $good . '.', 409);
                }
                $state['stock'][$good] = ($state['stock'][$good] ?? 0) - $quantity;
            }
            $state['credit_delta'] = 0;
            $context = $this->context($snapshot['colony'], $this->query(
                'SELECT * FROM economy_processed_goods WHERE colony_id=?',
                [$cid]
            )->fetchAll());
            $this->persist($snapshot['colony'], $state, $context);
            return $commit();
        });
    }

    public function empireMutation(int $uid, callable $commit): mixed
    {
        return $this->transaction(function () use ($uid, $commit): mixed {
            $this->query('SELECT id FROM users WHERE id=?' . $this->lock(), [$uid]);
            $colonies = $this->query('SELECT id FROM colonies WHERE user_id=? ORDER BY id', [$uid])->fetchAll();
            $now = time();
            foreach ($colonies as $colony) {
                $this->assertCaughtUp($this->settle((int)$colony['id'], $uid, $now, true));
            }
            return $commit();
        });
    }

    public function receive(int $cid, array $payload): void
    {
        $this->transaction(function () use ($cid, $payload): void {
            $snapshot = $this->settle($cid, null, null, true);
            $this->assertCaughtUp($snapshot);
            $state = $snapshot['economy'];
            foreach ($payload as $good => $quantity) {
                if (
                    !isset(ColonyEconomySimulation::PRICES[$good]) || !is_numeric($quantity)
                    || !is_finite((float)$quantity) || $quantity < 0
                ) {
                    throw new DomainException('Invalid cargo.', 400);
                }
                // Delivery overflow is retained; factories pause at the storage cap.
                $state['stock'][$good] = ($state['stock'][$good] ?? 0) + $quantity;
            }
            $state['credit_delta'] = 0;
            $context = $this->context($snapshot['colony'], $this->query(
                'SELECT * FROM economy_processed_goods WHERE colony_id=?',
                [$cid]
            )->fetchAll());
            $this->persist($snapshot['colony'], $state, $context);
        });
    }

    private function startNext(int $cid, int $at): ?array
    {
        if (
            $this->query(
                "SELECT id FROM building_upgrade_queue WHERE colony_id=? AND status='running' LIMIT 1",
                [$cid]
            )->fetch()
        ) {
            return null;
        }
        $row = $this->query(
            "SELECT * FROM building_upgrade_queue WHERE colony_id=? AND status='queued' ORDER BY id LIMIT 1",
            [$cid]
        )->fetch();
        if (!$row) {
            return null;
        }
        $row['eta'] = gmdate('Y-m-d H:i:s', $at + max(1, (int)$row['duration_secs']));
        $this->query(
            "UPDATE building_upgrade_queue SET status='running', started_at=?, eta=? WHERE id=?",
            [gmdate('Y-m-d H:i:s', $at), $row['eta'], $row['id']]
        );
        $this->query('UPDATE buildings SET upgrade_end=? WHERE colony_id=? AND type=?', [
            $row['eta'], $cid, $row['building_type'],
        ]);
        return $row;
    }

    public function market(?int $galaxy = null, ?int $system = null): array
    {
        if ($system !== null && $galaxy === null) {
            throw new DomainException('A system requires a galaxy.', 400);
        }
        $where = $galaxy === null ? '' : ' WHERE galaxy_index = ?';
        $params = $galaxy === null ? [] : [$galaxy];
        if ($system !== null) {
            $where .= ' AND system_index = ?';
            $params[] = $system;
        }
        $rows = $this->query(
            'SELECT good_type, SUM(quantity) AS quantity, SUM(production) AS production, '
                . 'SUM(consumption) AS consumption, MIN(settled_at) AS oldest, MAX(settled_at) AS newest, '
                . 'COUNT(*) AS colonies FROM economy_colony_market' . $where . ' GROUP BY good_type',
            $params
        )->fetchAll();
        $goods = [];
        foreach ($rows as $row) {
            $price = self::price(
                $row['good_type'],
                (float)$row['quantity'],
                (float)$row['production'],
                (float)$row['consumption']
            );
            $goods[$row['good_type']] = [
                'quantity' => (float)$row['quantity'], 'production_per_hour' => (float)$row['production'],
                'consumption_per_hour' => (float)$row['consumption'], 'price' => $price,
                'oldest_settled_at' => (int)$row['oldest'], 'newest_settled_at' => (int)$row['newest'],
                'represented_colonies' => (int)$row['colonies'],
            ];
        }
        return ['galaxy' => $galaxy, 'system' => $system, 'goods' => $goods, 'mode' => 'last_settled_projection'];
    }

    public static function price(string $good, float $stock, float $production, float $consumption): float
    {
        $supply = max(1.0, $stock / 24 + $production);
        $demand = max(1.0, $consumption);
        return round(ColonyEconomySimulation::PRICES[$good] * max(0.3, min(3.5, ($demand / $supply) ** 0.4)), 2);
    }

    private function lock(): string
    {
        return $this->mysql ? ' FOR UPDATE' : '';
    }

    private function query(string $sql, array $params = []): PDOStatement
    {
        $statement = $this->db->prepare($sql);
        $statement->execute($params);
        return $statement;
    }

    private function upsert(string $table, array $keys, array $data): void
    {
        $columns = array_keys($data);
        $updates = array_diff($columns, $keys);
        $assignments = array_map(
            fn(string $column): string => "`$column` = " . ($this->mysql ? "VALUES(`$column`)" : "excluded.`$column`"),
            $updates
        );
        $conflict = $this->mysql ? ' ON DUPLICATE KEY UPDATE '
            : ' ON CONFLICT (' . implode(',', $keys) . ') DO UPDATE SET ';
        $sql = 'INSERT INTO ' . $table . ' (`' . implode('`,`', $columns) . '`) VALUES ('
            . implode(',', array_fill(0, count($columns), '?')) . ')' . $conflict . implode(',', $assignments);
        $this->query($sql, array_values($data));
    }
}
