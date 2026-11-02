<?php

declare(strict_types=1);

namespace GalaxyQuest\Economy;

use InvalidArgumentException;

/**
 * Authoritative, fixed-step catch-up. No I/O and no wall-clock reads.
 */
final class ColonyEconomySimulation
{
    public const STEP_SECONDS = 300;
    public const MAX_STEPS = 288;
    public const PRIMARY = ['metal', 'crystal', 'deuterium', 'rare_earth', 'food'];
    public const CLASSES = ['colonist', 'citizen', 'specialist', 'elite', 'transcendent'];
    public const PRICES = [
        'metal' => 10, 'crystal' => 15, 'deuterium' => 20, 'rare_earth' => 50, 'food' => 8,
        'steel_alloy' => 35, 'focus_crystals' => 60, 'reactor_fuel' => 55,
        'biocompost' => 25, 'electronics_components' => 70, 'consumer_goods' => 80,
        'luxury_goods' => 200, 'military_equipment' => 150, 'research_kits' => 130,
        'colonization_packs' => 250, 'neural_implants' => 400, 'quantum_circuits' => 550,
        'bio_supplements' => 350, 'stellar_art' => 600, 'advanced_propulsion' => 800,
        'void_crystals' => 2500, 'synthetic_consciousness' => 4000, 'temporal_luxuries' => 5000,
    ];
    public const RECIPES = [
        'metallurgy' => ['steel_alloy', 10, 2, ['metal' => 2]],
        'crystal_grinder' => ['focus_crystals', 8, 2, ['crystal' => 3, 'rare_earth' => 1]],
        'refinery' => ['reactor_fuel', 8, 2, ['deuterium' => 2, 'rare_earth' => 1]],
        'bioreactor' => ['biocompost', 12, 2, ['food' => 2]],
        'electronics_fab' => ['electronics_components', 6, 2, ['crystal' => 1, 'rare_earth' => 1]],
        'consumer_factory' => ['consumer_goods', 5, 3, ['steel_alloy' => 1, 'electronics_components' => 1]],
        'luxury_workshop' => ['luxury_goods', 2, 3, ['focus_crystals' => 1, 'biocompost' => 1]],
        'arms_factory' => ['military_equipment', 3, 3, ['steel_alloy' => 2, 'focus_crystals' => 1]],
        'research_lab_adv' => ['research_kits', 2, 3, ['focus_crystals' => 1, 'electronics_components' => 1]],
        'colony_supplies' => [
            'colonization_packs', 1, 3, ['steel_alloy' => 1, 'biocompost' => 1, 'reactor_fuel' => 1],
        ],
        'neural_fabricator' => ['neural_implants', 0.5, 4, ['focus_crystals' => 1, 'electronics_components' => 1]],
        'quantum_lab' => ['quantum_circuits', 0.3, 4, ['electronics_components' => 1, 'reactor_fuel' => 1]],
        'bio_pharma' => ['bio_supplements', 0.5, 4, ['biocompost' => 1, 'focus_crystals' => 0.5]],
        'cultural_center' => ['stellar_art', 0.2, 4, ['luxury_goods' => 1, 'focus_crystals' => 1]],
        'propulsion_works' => ['advanced_propulsion', 0.2, 4, ['reactor_fuel' => 1, 'steel_alloy' => 1]],
        'void_refinery' => ['void_crystals', 0.05, 5, ['quantum_circuits' => 1, 'focus_crystals' => 1]],
        'consciousness_institute' => [
            'synthetic_consciousness', 0.02, 5, ['neural_implants' => 1, 'quantum_circuits' => 1],
        ],
        'temporal_atelier' => ['temporal_luxuries', 0.01, 5, ['stellar_art' => 1, 'void_crystals' => 1]],
    ];
    public const NEEDS = [
        'colonist' => ['food' => 0.01, 'consumer_goods' => 0.0001],
        'citizen' => ['food' => 0.01, 'consumer_goods' => 0.0002, 'biocompost' => 0.00005],
        'specialist' => ['food' => 0.01, 'luxury_goods' => 0.0001, 'neural_implants' => 0.00005],
        'elite' => ['food' => 0.01, 'luxury_goods' => 0.0001, 'stellar_art' => 0.00004],
        'transcendent' => ['food' => 0.01, 'void_crystals' => 0.00002, 'synthetic_consciousness' => 0.00001],
    ];

    public static function researchForTier(int $tier): string
    {
        return [2 => 'energy_tech', 3 => 'computer_tech', 4 => 'quantum_computing', 5 => 'dark_energy_tap'][$tier];
    }

    /**
     * Reads process full steps only; mutations additionally settle the sub-step
     * before changing rates. Unprocessed offline time stays in the cursor.
     */
    public static function advance(array $state, array $context, int $now, bool $mutation = false): array
    {
        $cursor = (int)$state['settled_at'];
        if ($now < $cursor) {
            throw new InvalidArgumentException('Economy clock cannot move backwards.');
        }
        $steps = min(self::MAX_STEPS, intdiv($now - $cursor, self::STEP_SECONDS));
        for ($i = 0; $i < $steps; $i++) {
            $state = self::step($state, $context, self::STEP_SECONDS);
        }
        $remaining = $now - (int)$state['settled_at'];
        if ($mutation && $remaining < self::STEP_SECONDS && $remaining > 0) {
            $state = self::step($state, $context, $remaining);
        }
        $state['pending_seconds'] = $now - (int)$state['settled_at'];
        return $state;
    }

    private static function step(array $state, array $context, int $seconds): array
    {
        $hours = $seconds / 3600;
        $stock = $state['stock'];
        $buildings = $context['buildings'];
        $classes = $state['classes'];
        $population = array_sum($classes);
        $production = [];
        $consumption = [];
        $shortages = [];
        $caps = $context['capacity'];
        $energy = max(0.0, (float)$context['energy_available']);
        $jobs = 0;
        foreach (self::RECIPES as $building => $recipe) {
            $jobs += ($buildings[$building] ?? 0) * 10;
        }
        $employment = $jobs > 0 ? min(1.0, $population * 0.6 / $jobs) : 1.0;
        foreach ($context['raw_production'] as $good => $rate) {
            $rate *= $context['good_multipliers'][$good] ?? 1.0;
            if ($good !== 'food') {
                $happiness = $state['satisfaction'];
                $rate *= $happiness >= 70 ? 1 + ($happiness - 70) / 120 : max(0.5, 0.5 + $happiness / 140);
            }
            $amount = $rate * $hours;
            if (isset($state['deposits'][$good]) && $state['deposits'][$good] >= 0) {
                $amount = min($amount, $state['deposits'][$good]);
            }
            $accepted = min($amount, max(0.0, ($caps[$good] ?? 5000) - ($stock[$good] ?? 0)));
            if (isset($state['deposits'][$good]) && $state['deposits'][$good] >= 0) {
                $state['deposits'][$good] -= $accepted;
            }
            $tax = $accepted * ($context['production_tax'] ?? 0);
            $state['credit_delta'] = ($state['credit_delta'] ?? 0) + $tax * self::PRICES[$good];
            $accepted -= $tax;
            $stock[$good] = ($stock[$good] ?? 0) + $accepted;
            $production[$good] = $accepted / $hours;
        }

        // Life support has priority over industrial food inputs.
        $foodRequired = $population * 0.01 * $hours;
        $foodCoverage = $foodRequired > 0 ? min(1.0, ($stock['food'] ?? 0) / $foodRequired) : 1.0;
        $foodUsed = min($foodRequired, $stock['food'] ?? 0);
        $stock['food'] = ($stock['food'] ?? 0) - $foodUsed;
        $consumption['food'] = $population * 0.01;
        if ($foodCoverage < 1) {
            $shortages['food'] = $population * 0.01 - $foodUsed / $hours;
        }

        foreach (self::RECIPES as $building => [$good, $rate, $tier, $inputs]) {
            $level = (int)($buildings[$building] ?? 0);
            if ($level < 1) {
                continue;
            }
            if (($context['research'][self::researchForTier($tier)] ?? 0) < 1) {
                continue;
            }
            $method = $context['methods'][$building] ?? 'standard';
            $methodMultiplier = ['standard' => 1.0, 'efficient' => 1.5, 'premium' => 2.0][$method];
            $policyMultiplier = ($context['policy'] ?? 'free_market') === 'autarky' ? 1.1 : 1.0;
            if (($context['policy'] ?? '') === 'war_economy') {
                $policyMultiplier *= $good === 'military_equipment' ? 1.3 : ($good === 'consumer_goods' ? 0.8 : 1);
            }
            $policyMultiplier = $context['good_multipliers'][$good] ?? $policyMultiplier;
            $wanted = $rate * $level * $employment * $methodMultiplier * $policyMultiplier * $hours;
            $wanted *= 0.5 + $state['satisfaction'] / 100;
            $amount = min($wanted, max(0.0, ($caps[$good] ?? 5000) - ($stock[$good] ?? 0)));
            // Efficient production uses less input per output; premium uses more
            // energy and rare earths instead of being a free output multiplier.
            $inputMultiplier = $method === 'efficient' ? 0.85 : 1.0;
            if ($method === 'premium') {
                $inputs['rare_earth'] = ($inputs['rare_earth'] ?? 0) + 0.1;
            }
            foreach ($inputs as $input => $ratio) {
                $amount = min($amount, ($stock[$input] ?? 0) / ($ratio * $inputMultiplier));
            }
            $energyCost = $tier * ($method === 'premium' ? 1.5 : 1.0);
            $amount = min($amount, $energy * $hours / $energyCost);
            foreach ($inputs as $input => $ratio) {
                $used = $amount * $ratio * $inputMultiplier;
                $stock[$input] -= $used;
                $consumption[$input] = ($consumption[$input] ?? 0)
                    + $wanted * $ratio * $inputMultiplier / $hours;
            }
            $energy -= $amount * $energyCost / $hours;
            $tax = $amount * ($context['production_tax'] ?? 0);
            $state['credit_delta'] = ($state['credit_delta'] ?? 0) + $tax * self::PRICES[$good];
            $stock[$good] = ($stock[$good] ?? 0) + $amount - $tax;
            $production[$good] = ($amount - $tax) / $hours;
            if ($amount + 1e-8 < $wanted && ($stock[$good] ?? 0) < ($caps[$good] ?? 5000)) {
                $shortages[$good] = ($wanted - $amount) / $hours;
            }
        }

        $covered = [];
        foreach (self::NEEDS as $class => $needs) {
            $coverage = $foodCoverage;
            foreach ($needs as $good => $rate) {
                if ($good === 'food') {
                    continue;
                }
                $demand = ($classes[$class] ?? 0) * $rate;
                $required = $demand * $hours;
                $available = $stock[$good] ?? 0.0;
                $used = min($available, $required);
                $stock[$good] = $available - $used;
                $consumption[$good] = ($consumption[$good] ?? 0) + $demand;
                if ($required > 0) {
                    $coverage = min($coverage, $used / $required);
                }
                if ($used + 1e-8 < $required) {
                    $shortages[$good] = ($shortages[$good] ?? 0) + ($required - $used) / $hours;
                }
            }
            $covered[$class] = $coverage;
            $state['progress'][$class] = $coverage >= 0.99
                ? max(0, $state['progress'][$class] ?? 0) + $seconds
                : min(0, $state['progress'][$class] ?? 0) - $seconds;
        }
        $services = min(100, ($context['service_levels'] ?? 0) * 200 / max(1, $population) * 100);
        $needsCoverage = 0.0;
        foreach ($classes as $class => $count) {
            $needsCoverage += ($covered[$class] ?? 1) * $count / max(1, $population);
        }
        $target = max(0, min(100, $services * 0.3 + $foodCoverage * 35 + $needsCoverage * 15 + $employment * 20));
        $state['satisfaction'] += ($target - $state['satisfaction']) * (1 - exp(-$hours / 6));
        $capacity = $context['population_capacity'];
        $growth = $foodCoverage < 0.3
            ? -$population * 0.005
            : $population * 0.002 * max(0, 1 - $population / max(1, $capacity))
                * max(0, ($state['satisfaction'] - 40) / 60) * $foodCoverage;
        $state['growth_remainder'] = ($state['growth_remainder'] ?? 0) + $growth * $hours;
        $change = (int)$state['growth_remainder'];
        if ($change > 0) {
            $change = min($change, max(0, $capacity - $population));
            $classes['colonist'] += $change;
        } elseif ($change < 0) {
            $loss = min(-$change, max(0, $population - 1));
            $change = -$loss;
            foreach (self::CLASSES as $class) {
                $take = min($loss, $classes[$class]);
                $classes[$class] -= $take;
                $loss -= $take;
            }
        }
        $state['growth_remainder'] -= $change;
        if (
            (array_sum($classes) <= 1 && $state['growth_remainder'] < 0)
            || (array_sum($classes) >= $capacity && $state['growth_remainder'] > 0)
        ) {
            $state['growth_remainder'] = 0.0;
        }
        $fractions = [1.0, 0.8, 0.5, 0.2, 0.05];
        foreach (array_reverse(self::CLASSES, true) as $index => $class) {
            if ($classes[$class] < 1) {
                $state['progress'][$class] = 0;
                continue;
            }
            if ($index > 0 && $state['progress'][$class] <= -5 * 3600) {
                $classes[$class]--;
                $classes[self::CLASSES[$index - 1]]++;
                $state['progress'][$class] = 0;
            } elseif ($index < 4 && $state['progress'][$class] >= 10 * 3600) {
                $next = self::CLASSES[$index + 1];
                $cap = (int)floor(array_sum($classes) * $fractions[$index + 1]);
                if ($classes[$next] < $cap) {
                    $classes[$class]--;
                    $classes[$next]++;
                    $state['progress'][$class] = 0;
                }
            }
        }
        $income = 0.0;
        foreach ($classes as $index => $count) {
            $income += $count * ([1, 1.2, 1.8, 2.5, 4][array_search($index, self::CLASSES, true)]) * 0.01;
        }
        $state['credit_delta'] = ($state['credit_delta'] ?? 0) + $income * $context['income_tax'] * $hours;
        foreach ($stock as $good => $quantity) {
            $stock[$good] = max(0.0, $quantity);
        }
        $state['stock'] = $stock;
        $state['classes'] = $classes;
        $state['settled_at'] += $seconds;
        $state['production'] = $production;
        $state['consumption'] = $consumption;
        $state['shortages'] = $shortages;
        $state['employment'] = $employment;
        $state['population_growth_per_hour'] = $growth;
        return $state;
    }
}
