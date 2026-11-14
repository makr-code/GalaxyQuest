<?php

declare(strict_types=1);

namespace GalaxyQuest\Economy;

use GalaxyQuest\Simulation\HourlyWindow;
use JsonException;
use PDO;
use PDOException;

require_once __DIR__ . '/../Simulation/DeterministicRandom.php';
require_once __DIR__ . '/../Simulation/HourlyWindow.php';
require_once __DIR__ . '/ColonyEconomySimulation.php';

/**
 * Time-bounded economic world events ("Sachentscheidungen") generated once per
 * hourly window. Events never mutate colony stock directly: OnDemandEconomy
 * reads them as price modifiers and, intersected with each settle step, as
 * production modifiers, so settlement stays deterministic whenever it runs.
 */
final class WorldEvents
{
    public const SYSTEM_SCOPE_STRIDE = 100000;

    /**
     * Data-driven catalog. Modifier ranges are [min, max]; '' as good means all goods.
     *
     * @var array<string, array{
     *   label: string, scope: 'galaxy'|'system', goods: list<string>, probability: float,
     *   min_hours: int, max_hours: int, modifiers: array<string, array{float, float}>
     * }>
     */
    public const CATALOG = [
        'supply_shock' => [
            'label' => 'Versorgungsschock', 'scope' => 'system',
            'goods' => ['metal', 'crystal', 'deuterium', 'rare_earth', 'food'],
            'probability' => 0.2, 'min_hours' => 6, 'max_hours' => 24,
            'modifiers' => ['production' => [0.5, 0.8], 'price' => [1.15, 1.4]],
        ],
        'demand_boom' => [
            'label' => 'Nachfrageboom', 'scope' => 'galaxy',
            'goods' => [
                'consumer_goods', 'luxury_goods', 'military_equipment', 'research_kits', 'electronics_components',
            ],
            'probability' => 0.15, 'min_hours' => 12, 'max_hours' => 48,
            'modifiers' => ['demand' => [1.1, 1.35]],
        ],
        'trade_disruption' => [
            'label' => 'Handelsstörung', 'scope' => 'system',
            'goods' => [''],
            'probability' => 0.15, 'min_hours' => 6, 'max_hours' => 18,
            'modifiers' => ['price' => [1.1, 1.3]],
        ],
        'windfall_discovery' => [
            'label' => 'Rohstofffund', 'scope' => 'system',
            'goods' => ['metal', 'crystal', 'deuterium', 'rare_earth'],
            'probability' => 0.1, 'min_hours' => 12, 'max_hours' => 48,
            'modifiers' => ['production' => [1.2, 1.6], 'price' => [0.75, 0.9]],
        ],
    ];

    public function __construct(private PDO $db)
    {
    }

    /**
     * Rolls the catalog for the window containing $now and inserts the outcome.
     * Re-running inside the same window reproduces identical rows (INSERT IGNORE).
     *
     * @return list<array<string, mixed>> all events belonging to the current window
     */
    public function generate(int $now, int $maxActive): array
    {
        $window = HourlyWindow::id($now);
        $active = (int)$this->scalar(
            'SELECT COUNT(*) FROM world_events WHERE ends_at > ? AND window_id <> ?',
            [$now, $window]
        );
        $slots = $maxActive - $active;
        $insert = $this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
        foreach (self::CATALOG as $type => $definition) {
            if ($slots <= 0) {
                break;
            }
            $rng = HourlyWindow::random($window, 'world', 'global', $type);
            if (!$rng->chance($definition['probability'])) {
                continue;
            }
            $scope = $this->pickScope($definition['scope'], $rng->float());
            if ($scope === null) {
                continue;
            }
            $modifiers = [];
            foreach ($definition['modifiers'] as $key => [$min, $max]) {
                $modifiers[$key] = round($rng->between($min, $max), 3);
            }
            $hours = $rng->int($definition['min_hours'], $definition['max_hours']);
            // One settle step of lead time: no concurrently settling colony can already
            // have advanced its cursor past the start, so step overlap stays exact.
            $startsAt = $now + ColonyEconomySimulation::STEP_SECONDS;
            $this->db->prepare(
                "$insert INTO world_events (window_id, event_type, scope_type, scope_id, galaxy_index, "
                    . 'system_index, good_key, modifier_json, starts_at, ends_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
            )->execute([
                $window, $type, $definition['scope'], $scope['scope_id'], $scope['galaxy'], $scope['system'],
                $rng->pick($definition['goods']), json_encode($modifiers, JSON_THROW_ON_ERROR),
                $startsAt, $startsAt + $hours * 3600,
            ]);
            $slots--;
        }
        $statement = $this->db->prepare('SELECT * FROM world_events WHERE window_id = ? ORDER BY id');
        return $this->hydrate($statement, [$window]);
    }

    /**
     * Events affecting a colony market scope. Galaxy scope sees galaxy-wide
     * events, system scope sees both; the global market has no regional events.
     *
     * @return list<array<string, mixed>>
     */
    public function forScope(?int $galaxy, ?int $system, int $endsAfter, ?int $startsBefore = null): array
    {
        if ($galaxy === null) {
            return [];
        }
        $sql = 'SELECT * FROM world_events WHERE galaxy_index = ? AND ends_at > ? AND '
            . ($system === null ? "scope_type = 'galaxy'" : "(scope_type = 'galaxy' OR system_index = ?)");
        $params = $system === null ? [$galaxy, $endsAfter] : [$galaxy, $endsAfter, $system];
        if ($startsBefore !== null) {
            $sql .= ' AND starts_at <= ?';
            $params[] = $startsBefore;
        }
        try {
            return $this->hydrate($this->db->prepare($sql . ' ORDER BY id'), $params);
        } catch (PDOException $error) {
            if (self::missingTable($error)) {
                return [];
            }
            throw $error;
        }
    }

    /**
     * Multiplicative price/demand modifiers per good for active events
     * (accepts stored rows or describe() output).
     *
     * @param list<array<string, mixed>> $events
     * @return array{price: float, demand: float}
     */
    public static function priceModifiers(array $events, string $good): array
    {
        $result = ['price' => 1.0, 'demand' => 1.0];
        foreach ($events as $event) {
            $target = (string)($event['good_key'] ?? $event['good_type'] ?? '');
            if ($target !== '' && $target !== $good) {
                continue;
            }
            $result['price'] *= (float)($event['modifiers']['price'] ?? 1.0);
            $result['demand'] *= (float)($event['modifiers']['demand'] ?? 1.0);
        }
        return $result;
    }

    /**
     * Production windows consumed by ColonyEconomySimulation::step().
     *
     * @param list<array<string, mixed>> $events
     * @return list<array{good: string, factor: float, starts_at: int, ends_at: int}>
     */
    public static function productionWindows(array $events): array
    {
        $windows = [];
        foreach ($events as $event) {
            $factor = (float)($event['modifiers']['production'] ?? 1.0);
            if ($factor !== 1.0) {
                $windows[] = [
                    'good' => (string)$event['good_key'], 'factor' => $factor,
                    'starts_at' => (int)$event['starts_at'], 'ends_at' => (int)$event['ends_at'],
                ];
            }
        }
        return $windows;
    }

    /** @return array<string, mixed> */
    public static function describe(array $event): array
    {
        return [
            'id' => (int)$event['id'], 'event_type' => $event['event_type'],
            'label' => self::CATALOG[$event['event_type']]['label'] ?? $event['event_type'],
            'scope_type' => $event['scope_type'], 'galaxy' => (int)$event['galaxy_index'],
            'system' => $event['scope_type'] === 'system' ? (int)$event['system_index'] : null,
            'good_type' => $event['good_key'] === '' ? null : $event['good_key'],
            'modifiers' => $event['modifiers'], 'starts_at' => (int)$event['starts_at'],
            'ends_at' => (int)$event['ends_at'],
        ];
    }

    public static function missingTable(PDOException $error): bool
    {
        return $error->getCode() === '42S02' || str_contains($error->getMessage(), 'no such table');
    }

    /** @return array{scope_id: int, galaxy: int, system: int}|null */
    private function pickScope(string $scope, float $roll): ?array
    {
        $columns = $scope === 'galaxy' ? 'galaxy_index, 0 AS system_index' : 'galaxy_index, system_index';
        $group = $scope === 'galaxy' ? 'galaxy_index' : 'galaxy_index, system_index';
        $count = (int)$this->scalar(
            "SELECT COUNT(*) FROM (SELECT $group FROM economy_colony_market GROUP BY $group) t"
        );
        if ($count === 0) {
            return null;
        }
        $offset = min($count - 1, (int)floor($roll * $count));
        $row = $this->db->query(
            "SELECT $columns FROM economy_colony_market GROUP BY $group ORDER BY $group LIMIT 1 OFFSET $offset"
        )->fetch(PDO::FETCH_ASSOC);
        $galaxy = (int)$row['galaxy_index'];
        $system = (int)$row['system_index'];
        return [
            'scope_id' => $scope === 'galaxy' ? $galaxy : $galaxy * self::SYSTEM_SCOPE_STRIDE + $system,
            'galaxy' => $galaxy, 'system' => $system,
        ];
    }

    private function scalar(string $sql, array $params = []): mixed
    {
        $statement = $this->db->prepare($sql);
        $statement->execute($params);
        return $statement->fetchColumn();
    }

    /** @return list<array<string, mixed>> */
    private function hydrate(\PDOStatement $statement, array $params): array
    {
        $statement->execute($params);
        $events = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            try {
                $row['modifiers'] = json_decode((string)$row['modifier_json'], true, 4, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                $row['modifiers'] = [];
            }
            $events[] = $row;
        }
        return $events;
    }
}
