<?php

declare(strict_types=1);

require_once __DIR__ . '/game_engine.php';

// Keep runtime calculations resilient when economy_flush.php is not part of the
// current include chain (e.g. overview read path).
if (!defined('ECONOMY_POP_CONSUMPTION_RATES')) {
    define('ECONOMY_POP_CONSUMPTION_RATES', [
        'consumer_goods'        => 0.20,
        'biocompost'            => 0.05,
        'research_kits'         => 0.02,
        'military_equipment'    => 0.01,
        'luxury_goods'          => 0.03,
        'neural_implants'       => 0.005,
    ]);
}

if (!function_exists('fetch_colony_runtime_row')) {
    function fetch_colony_runtime_row(PDO $db, int $colonyId): ?array {
        $stmt = $db->prepare(<<<SQL
            SELECT c.id, c.user_id, c.name, c.colony_type, c.metal, c.crystal, c.deuterium,
                   c.rare_earth, c.food, c.energy, c.population, c.max_population,
                   c.happiness, c.public_services,
                   cb.galaxy_index, cb.system_index, cb.position,
                   p.temp_max, p.richness_metal, p.richness_crystal,
                   p.richness_deuterium, p.richness_rare_earth,
                   b_mm.level  AS metal_mine_level,
                   b_cm.level  AS crystal_mine_level,
                   b_ds.level  AS deuterium_synth_level,
                   b_sp.level  AS solar_plant_level,
                   b_fr.level  AS fusion_reactor_level,
                   b_ms.level  AS metal_storage_level,
                   b_cs.level  AS crystal_storage_level,
                   b_dt.level  AS deuterium_tank_level,
                   b_re.level  AS rare_earth_drill_level,
                   b_hf.level  AS hydroponic_farm_level,
                   b_fs.level  AS food_silo_level,
                   b_ha.level  AS habitat_level,
                   b_ho.level  AS hospital_level,
                   b_sc.level  AS school_level,
                   b_se.level  AS security_post_level
            FROM colonies c
            JOIN celestial_bodies cb ON cb.id = c.body_id
            LEFT JOIN planets p ON p.id = c.planet_id
            LEFT JOIN buildings b_mm ON b_mm.colony_id = c.id AND b_mm.type = 'metal_mine'
            LEFT JOIN buildings b_cm ON b_cm.colony_id = c.id AND b_cm.type = 'crystal_mine'
            LEFT JOIN buildings b_ds ON b_ds.colony_id = c.id AND b_ds.type = 'deuterium_synth'
            LEFT JOIN buildings b_sp ON b_sp.colony_id = c.id AND b_sp.type = 'solar_plant'
            LEFT JOIN buildings b_fr ON b_fr.colony_id = c.id AND b_fr.type = 'fusion_reactor'
            LEFT JOIN buildings b_ms ON b_ms.colony_id = c.id AND b_ms.type = 'metal_storage'
            LEFT JOIN buildings b_cs ON b_cs.colony_id = c.id AND b_cs.type = 'crystal_storage'
            LEFT JOIN buildings b_dt ON b_dt.colony_id = c.id AND b_dt.type = 'deuterium_tank'
            LEFT JOIN buildings b_re ON b_re.colony_id = c.id AND b_re.type = 'rare_earth_drill'
            LEFT JOIN buildings b_hf ON b_hf.colony_id = c.id AND b_hf.type = 'hydroponic_farm'
            LEFT JOIN buildings b_fs ON b_fs.colony_id = c.id AND b_fs.type = 'food_silo'
            LEFT JOIN buildings b_ha ON b_ha.colony_id = c.id AND b_ha.type = 'habitat'
            LEFT JOIN buildings b_ho ON b_ho.colony_id = c.id AND b_ho.type = 'hospital'
            LEFT JOIN buildings b_sc ON b_sc.colony_id = c.id AND b_sc.type = 'school'
            LEFT JOIN buildings b_se ON b_se.colony_id = c.id AND b_se.type = 'security_post'
            WHERE c.id = ?
            LIMIT 1
        SQL);
        $stmt->execute([$colonyId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }
}

if (!function_exists('build_colony_consumption_snapshot')) {
    function build_colony_consumption_snapshot(PDO $db, array $row): array {
        $userId = (int)($row['user_id'] ?? 0);
        $population = max(1, (int)($row['population'] ?? 1));
        $happiness = (int)($row['happiness'] ?? 70);

        $metalMineLevel = (int)($row['metal_mine_level'] ?? 0);
        $crystalMineLevel = (int)($row['crystal_mine_level'] ?? 0);
        $deuteriumSynthLevel = (int)($row['deuterium_synth_level'] ?? 0);
        $solarPlantLevel = (int)($row['solar_plant_level'] ?? 0);
        $fusionReactorLevel = (int)($row['fusion_reactor_level'] ?? 0);
        $metalStorageLevel = (int)($row['metal_storage_level'] ?? 0);
        $crystalStorageLevel = (int)($row['crystal_storage_level'] ?? 0);
        $deuteriumTankLevel = (int)($row['deuterium_tank_level'] ?? 0);
        $rareEarthDrillLevel = (int)($row['rare_earth_drill_level'] ?? 0);
        $hydroponicFarmLevel = (int)($row['hydroponic_farm_level'] ?? 0);
        $foodSiloLevel = (int)($row['food_silo_level'] ?? 0);
        $habitatLevel = (int)($row['habitat_level'] ?? 0);
        $hospitalLevel = (int)($row['hospital_level'] ?? 0);
        $schoolLevel = (int)($row['school_level'] ?? 0);
        $securityLevel = (int)($row['security_post_level'] ?? 0);

        $dynamicEffects = $userId > 0 ? empire_dynamic_effects($db, $userId) : [
            'resource_output_mult' => 0.0,
            'food_output_mult' => 0.0,
            'pop_growth_mult' => 0.0,
            'happiness_flat' => 0.0,
            'public_services_flat' => 0.0,
        ];

        $energyProduction = solar_energy($solarPlantLevel) + fusion_energy($fusionReactorLevel);
        $energyRequired = metal_production_energy($metalMineLevel)
            + crystal_production_energy($crystalMineLevel)
            + deuterium_production_energy($deuteriumSynthLevel)
            + ($rareEarthDrillLevel > 0 ? $rareEarthDrillLevel * 15 : 0)
            + ($hydroponicFarmLevel > 0 ? $hydroponicFarmLevel * 10 : 0);
        $energyBalance = (int)round($energyProduction - $energyRequired);
        $efficiency = $energyRequired > 0.0 ? min(1.0, $energyProduction / $energyRequired) : 1.0;

        $colonyType = (string)($row['colony_type'] ?? 'balanced');
        $foodProduction = food_production($hydroponicFarmLevel);
        if ($colonyType === 'agricultural') {
            $foodProduction *= 1.5;
        }
        $foodProduction *= (1.0 + (float)($dynamicEffects['food_output_mult'] ?? 0.0));
        $foodProduction = max(0.0, $foodProduction);
        $foodConsumed = $population / 100.0;
        $foodCoverage = $foodConsumed > 0.0 ? min(2.0, $foodProduction / $foodConsumed) : 1.0;

        $resourceOutputMult = (float)($dynamicEffects['resource_output_mult'] ?? 0.0);
        $prodMultiplier = happiness_productivity($happiness) * $efficiency * (1.0 + $resourceOutputMult);
        $metalProduction = metal_production($metalMineLevel) * max(0.1, (float)($row['richness_metal'] ?? 1.0)) * $prodMultiplier;
        $crystalProduction = crystal_production($crystalMineLevel) * max(0.1, (float)($row['richness_crystal'] ?? 1.0)) * $prodMultiplier;
        $deuteriumProduction = deuterium_production($deuteriumSynthLevel, (int)($row['temp_max'] ?? 20))
            * max(0.1, (float)($row['richness_deuterium'] ?? 1.0)) * $prodMultiplier;
        $rareEarthProduction = rare_earth_production($rareEarthDrillLevel)
            * max(0.1, (float)($row['richness_rare_earth'] ?? 0.5)) * $prodMultiplier;

        $manager = get_colony_leader($db, (int)$row['id'], 'colony_manager');
        if ($manager) {
            $skill = (int)($manager['skill_production'] ?? 0);
            $metalProduction = leader_production_bonus($metalProduction, $skill);
            $crystalProduction = leader_production_bonus($crystalProduction, $skill);
            $deuteriumProduction = leader_production_bonus($deuteriumProduction, $skill);
            $rareEarthProduction = leader_production_bonus($rareEarthProduction, $skill);
            $foodProduction = leader_production_bonus($foodProduction, $skill);
        }

        if ($colonyType === 'mining') {
            $metalProduction *= 1.2;
            $crystalProduction *= 1.2;
            $deuteriumProduction *= 1.2;
            $rareEarthProduction *= 1.2;
        }

        $publicServices = compute_public_services($hospitalLevel, $schoolLevel, $securityLevel, $population);
        $publicServices = clamp_int_range(
            $publicServices + (int)round((float)($dynamicEffects['public_services_flat'] ?? 0.0)),
            0,
            100
        );

        $welfareHappiness = compute_happiness($foodCoverage, $energyBalance, $publicServices);
        $welfareHappiness = clamp_int_range(
            $welfareHappiness + (int)round((float)($dynamicEffects['happiness_flat'] ?? 0.0)),
            0,
            100
        );
        if ($colonyType === 'agricultural') {
            $welfareHappiness = clamp_int_range($welfareHappiness + 15, 0, 100);
        }

        $maxPopulation = 500 + habitat_capacity($habitatLevel);
        $populationGrowth = population_growth($population, $maxPopulation, $welfareHappiness, $foodCoverage);
        $populationGrowth = (int)round($populationGrowth * (1.0 + (float)($dynamicEffects['pop_growth_mult'] ?? 0.0)));

        $processedConsumption = [];
        foreach (ECONOMY_POP_CONSUMPTION_RATES as $good => $ratePerK) {
            $processedConsumption[$good] = round($ratePerK * ($population / 1000.0), 4);
        }

        return [
            'resources' => [
                'metal' => (float)($row['metal'] ?? 0.0),
                'crystal' => (float)($row['crystal'] ?? 0.0),
                'deuterium' => (float)($row['deuterium'] ?? 0.0),
                'rare_earth' => (float)($row['rare_earth'] ?? 0.0),
                'food' => (float)($row['food'] ?? 0.0),
                'energy' => (float)($row['energy'] ?? 0.0),
            ],
            'storage' => [
                'metal' => storage_cap($metalStorageLevel),
                'crystal' => storage_cap($crystalStorageLevel),
                'deuterium' => storage_cap($deuteriumTankLevel),
                'food' => food_storage_cap($foodSiloLevel),
                'rare_earth' => 50000.0,
            ],
            'production' => [
                'metal_per_hour' => round($metalProduction, 4),
                'crystal_per_hour' => round($crystalProduction, 4),
                'deuterium_per_hour' => round($deuteriumProduction, 4),
                'rare_earth_per_hour' => round($rareEarthProduction, 4),
                'food_per_hour' => round($foodProduction, 4),
                'energy_per_hour' => round($energyProduction, 4),
            ],
            'consumption' => [
                'food_per_hour' => round($foodConsumed, 4),
                'energy_required_per_hour' => round($energyRequired, 4),
                'processed_goods_per_hour' => $processedConsumption,
            ],
            'welfare' => [
                'food_coverage' => round($foodCoverage, 4),
                'energy_balance' => $energyBalance,
                'public_services' => $publicServices,
                'happiness' => $welfareHappiness,
                'productivity_multiplier' => round(happiness_productivity($welfareHappiness) * $efficiency, 4),
                'population_growth_per_hour' => $populationGrowth,
                'population_capacity' => $maxPopulation,
            ],
            'building_levels' => [
                'metal_mine' => $metalMineLevel,
                'crystal_mine' => $crystalMineLevel,
                'deuterium_synth' => $deuteriumSynthLevel,
                'solar_plant' => $solarPlantLevel,
                'fusion_reactor' => $fusionReactorLevel,
                'rare_earth_drill' => $rareEarthDrillLevel,
                'hydroponic_farm' => $hydroponicFarmLevel,
                'food_silo' => $foodSiloLevel,
                'habitat' => $habitatLevel,
                'hospital' => $hospitalLevel,
                'school' => $schoolLevel,
                'security_post' => $securityLevel,
            ],
        ];
    }
}