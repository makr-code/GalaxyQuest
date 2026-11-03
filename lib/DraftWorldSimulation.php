<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/game_engine.php';

use GalaxyQuest\Economy\ColonyEconomySimulation;

final class DraftWorldSimulation {
    public const BUILDINGS = [
        'metal_mine', 'crystal_mine', 'deuterium_synth', 'solar_plant', 'hydroponic_farm',
        'habitat', 'hospital', 'school', 'security_post', 'robotics_factory', 'shipyard',
        'metal_storage', 'crystal_storage', 'deuterium_tank', 'research_lab',
    ];

    public static function create(array $draft, int $now): array {
        $starter = $draft['starter'];
        return [
            'buildings' => $starter['buildings'], 'research' => array_fill_keys(array_keys(RESEARCH_BASE_COST), 0),
            'ships' => $starter['ships'], 'queues' => [], 'surveyed' => [],
            'economy' => [
                'settled_at' => $now, 'stock' => array_intersect_key($starter['resources'], array_flip(ColonyEconomySimulation::PRIMARY)),
                'classes' => array_replace(array_fill_keys(ColonyEconomySimulation::CLASSES, 0),
                    ['colonist' => $starter['population']['population']]),
                'satisfaction' => (float)$starter['population']['happiness'],
                'progress' => [], 'growth_remainder' => 0.0, 'deposits' => [], 'credit_delta' => 0.0,
            ],
        ];
    }

    public static function advance(array $state, array $draft, int $now): array {
        $target = min($now, (int)$state['economy']['settled_at'] + 86400);
        uasort($state['queues'], static fn(array $a, array $b): int => $a['end'] <=> $b['end']);
        foreach ($state['queues'] as $kind => $queue) {
            if ($queue['end'] > $target) continue;
            $state['economy'] = ColonyEconomySimulation::advance(
                $state['economy'], self::context($state, $draft), max($queue['end'], $state['economy']['settled_at']), true
            );
            if ($kind === 'building') $state['buildings'][$queue['type']] = $queue['level'];
            elseif ($kind === 'research') $state['research'][$queue['type']] = $queue['level'];
            elseif ($kind === 'ship') $state['ships'][$queue['type']] = ($state['ships'][$queue['type']] ?? 0) + $queue['count'];
            elseif ($kind === 'fleet') $state['surveyed'] = array_values(array_unique([...$state['surveyed'], $queue['position']]));
            unset($state['queues'][$kind]);
        }
        $state['economy'] = ColonyEconomySimulation::advance($state['economy'], self::context($state, $draft), $target, true);
        $state['economy']['pending_seconds'] = max(0, $now - $state['economy']['settled_at']);
        return $state;
    }

    public static function context(array $state, array $draft): array {
        $b = $state['buildings'];
        $caps = [
            'metal' => storage_cap($b['metal_storage'] ?? 0), 'crystal' => storage_cap($b['crystal_storage'] ?? 0),
            'deuterium' => storage_cap($b['deuterium_tank'] ?? 0), 'rare_earth' => 5000, 'food' => 5000,
        ];
        $produced = solar_energy($b['solar_plant'] ?? 0);
        $used = 10 * ($b['metal_mine'] ?? 0) * pow(1.1, $b['metal_mine'] ?? 0)
            + 10 * ($b['crystal_mine'] ?? 0) * pow(1.1, $b['crystal_mine'] ?? 0)
            + 20 * ($b['deuterium_synth'] ?? 0) * pow(1.1, $b['deuterium_synth'] ?? 0);
        $efficiency = $used > 0 ? min(1, $produced / $used) : 1;
        return [
            'buildings' => $b, 'research' => $state['research'], 'methods' => [],
            'raw_production' => [
                'metal' => metal_production($b['metal_mine'] ?? 0) * $efficiency,
                'crystal' => crystal_production($b['crystal_mine'] ?? 0) * $efficiency,
                'deuterium' => deuterium_production($b['deuterium_synth'] ?? 0, 40) * $efficiency,
                'food' => 50 * ($b['hydroponic_farm'] ?? 0) * GAME_SPEED,
            ],
            'energy_available' => max(0, $produced - $used), 'capacity' => $caps,
            'population_capacity' => $draft['starter']['population']['max_population'] + 500 * max(0, ($b['habitat'] ?? 0) - 1),
            'service_levels' => ($b['hospital'] ?? 0) + ($b['school'] ?? 0) + ($b['security_post'] ?? 0),
            'income_tax' => 0.15, 'production_tax' => 0, 'good_multipliers' => [],
        ];
    }

    public static function command(array $state, array $draft, array $input, int $now): array {
        if (($state['economy']['pending_seconds'] ?? 0) > 0) {
            throw new RuntimeException('Offline progress is still catching up. Refresh your draft before issuing orders.', 409);
        }
        $kind = $input['kind'] ?? '';
        $type = $input['type'] ?? '';
        if (!is_string($kind) || !is_string($type)) throw new InvalidArgumentException('Invalid draft order.');
        if (isset($state['queues'][$kind])) throw new RuntimeException('An order of this kind is already running.', 409);
        $b = $state['buildings'];
        if ($kind === 'building' && in_array($type, self::BUILDINGS, true)) {
            $level = ($b[$type] ?? 0) + 1;
            if ($level > 30) throw new InvalidArgumentException('Draft building level limit is 30.');
            $cost = building_cost($type, $level);
            $seconds = building_build_time($cost, $b['robotics_factory'] ?? 0, $b['nanite_factory'] ?? 0);
            $queue = ['type' => $type, 'level' => $level];
        } elseif ($kind === 'research' && isset(RESEARCH_BASE_COST[$type])) {
            if (($b['research_lab'] ?? 0) < 1) throw new InvalidArgumentException('A research lab is required.');
            foreach (RESEARCH_PREREQS[$type] ?? [] as [$required, $level]) {
                if (($state['research'][$required] ?? 0) < $level) throw new InvalidArgumentException("Required: $required level $level.");
            }
            if ($type === 'graviton_tech') throw new InvalidArgumentException('Graviton research is not available in the isolated draft.');
            $level = ($state['research'][$type] ?? 0) + 1;
            if ($level > 20) throw new InvalidArgumentException('Draft research level limit is 20.');
            $cost = research_cost($type, $level);
            $seconds = research_time($cost, $b['research_lab']);
            $queue = ['type' => $type, 'level' => $level];
        } elseif ($kind === 'ship' && in_array($type, ['small_cargo', 'light_fighter', 'espionage_probe'], true)) {
            if (($b['shipyard'] ?? 0) < 1) throw new InvalidArgumentException('A shipyard is required.');
            $count = $input['count'] ?? 1;
            if (!is_int($count) || $count < 1 || $count > 100) throw new InvalidArgumentException('Choose 1-100 ships.');
            $cost = array_map(static fn(int $value): int => $value * $count, SHIP_STATS[$type]['cost']);
            $seconds = building_build_time($cost, $b['shipyard'], $b['nanite_factory'] ?? 0);
            $queue = ['type' => $type, 'count' => $count];
        } elseif ($kind === 'fleet') {
            $position = $input['position'] ?? null;
            $planet = null;
            foreach ($draft['planets'] as $candidate) if ($candidate['position'] === $position) $planet = $candidate;
            if (!$planet || $position === $draft['position']['position']) throw new InvalidArgumentException('Choose another planet in your private system.');
            if (($state['ships']['espionage_probe'] ?? 0) < 1) throw new InvalidArgumentException('A survey probe is required.');
            $seconds = 2 * fleet_travel_time(1000 + abs($position - $draft['position']['position']) * 5, SHIP_STATS['espionage_probe']['speed']);
            $cost = ['deuterium' => 10];
            $queue = ['position' => $position, 'type' => 'espionage_probe', 'count' => 1];
        } else {
            throw new InvalidArgumentException('This order is not available in the isolated draft.');
        }
        foreach ($cost as $resource => $amount) {
            if (($state['economy']['stock'][$resource] ?? 0) + 1e-8 < $amount) throw new InvalidArgumentException("Not enough $resource.");
        }
        foreach ($cost as $resource => $amount) $state['economy']['stock'][$resource] -= $amount;
        $state['queues'][$kind] = $queue + ['start' => $now, 'end' => $now + $seconds, 'cost' => $cost];
        return $state;
    }
}
