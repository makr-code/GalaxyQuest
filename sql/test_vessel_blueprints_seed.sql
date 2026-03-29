-- GalaxyQuest - Vessel blueprint seed data
-- Minimal starter hull + modules for exercising the blueprint runtime scaffold.

USE galaxyquest;

INSERT INTO module_groups (code, label, max_per_hull_default, is_required)
VALUES
    ('propulsion', 'Propulsion', 1, 1),
    ('weapon', 'Weapon', 2, 1),
    ('shield', 'Shield', 1, 0),
    ('utility', 'Utility', 1, 0)
ON DUPLICATE KEY UPDATE
    label = VALUES(label),
    max_per_hull_default = VALUES(max_per_hull_default),
    is_required = VALUES(is_required);

INSERT INTO vessel_hulls (
    code, label, role, ship_class, tier, base_mass, base_attack, base_shield, base_hull, base_cargo, base_speed,
    base_energy_output, base_energy_capacity, base_energy_upkeep, base_weapon_efficiency, base_shield_efficiency, base_attack_energy_share,
    slot_profile_json, slot_variation_json, research_req_json, build_req_json, build_cost_json, build_time_secs, faction_tag, is_active
)
VALUES
(
    'starter_corvette',
    'Starter Corvette',
    'combat',
    'corvette',
    1,
    90,
    8,
    10,
    85,
    35,
    12500,
    28,
    16,
    9,
    0.98,
    1.02,
    0.62,
    JSON_OBJECT('propulsion', 1, 'weapon', 2, 'shield', 1, 'utility', 1),
    JSON_OBJECT(
        'interceptor', JSON_OBJECT('label', 'Interceptor', 'slot_adjustments', JSON_OBJECT('weapon', 1, 'utility', -1)),
        'runner', JSON_OBJECT('label', 'Runner', 'slot_adjustments', JSON_OBJECT('propulsion', 1, 'weapon', -1))
    ),
    JSON_OBJECT(),
    JSON_OBJECT('shipyard_level', 1),
    JSON_OBJECT('metal', 1800, 'crystal', 700, 'deuterium', 120),
    120,
    NULL,
    1
),
(
    'starter_frigate',
    'Starter Frigate',
    'combat',
    'frigate',
    1,
    180,
    18,
    18,
    150,
    70,
    9800,
    46,
    24,
    14,
    1.03,
    1.06,
    0.48,
    JSON_OBJECT('propulsion', 1, 'weapon', 3, 'shield', 1, 'utility', 1),
    JSON_OBJECT(
        'brawler', JSON_OBJECT('label', 'Brawler', 'slot_adjustments', JSON_OBJECT('weapon', 1, 'utility', -1)),
        'escort', JSON_OBJECT('label', 'Escort', 'slot_adjustments', JSON_OBJECT('shield', 1, 'weapon', -1))
    ),
    JSON_OBJECT('energy_tech', 1, 'weapons_tech', 1),
    JSON_OBJECT('shipyard_level', 1),
    JSON_OBJECT('metal', 3200, 'crystal', 1450, 'deuterium', 260),
    180,
    NULL,
    1
),
(
    'starter_destroyer',
    'Starter Destroyer',
    'combat',
    'destroyer',
    2,
    360,
    34,
    32,
    280,
    120,
    7600,
    74,
    40,
    24,
    1.08,
    1.1,
    0.42,
    JSON_OBJECT('propulsion', 1, 'weapon', 4, 'shield', 2, 'utility', 1),
    JSON_OBJECT(
        'siege', JSON_OBJECT('label', 'Siege', 'slot_adjustments', JSON_OBJECT('weapon', 1, 'shield', -1)),
        'bulwark', JSON_OBJECT('label', 'Bulwark', 'slot_adjustments', JSON_OBJECT('shield', 1, 'weapon', -1))
    ),
    JSON_OBJECT('impulse_drive', 2, 'armor_tech', 1),
    JSON_OBJECT('shipyard_level', 2, 'min_standing', 10),
    JSON_OBJECT('metal', 5400, 'crystal', 2600, 'deuterium', 620),
    260,
    'guild',
    1
)
ON DUPLICATE KEY UPDATE
    label = VALUES(label),
    role = VALUES(role),
    ship_class = VALUES(ship_class),
    tier = VALUES(tier),
    base_mass = VALUES(base_mass),
    base_attack = VALUES(base_attack),
    base_shield = VALUES(base_shield),
    base_hull = VALUES(base_hull),
    base_cargo = VALUES(base_cargo),
    base_speed = VALUES(base_speed),
    base_energy_output = VALUES(base_energy_output),
    base_energy_capacity = VALUES(base_energy_capacity),
    base_energy_upkeep = VALUES(base_energy_upkeep),
    base_weapon_efficiency = VALUES(base_weapon_efficiency),
    base_shield_efficiency = VALUES(base_shield_efficiency),
    base_attack_energy_share = VALUES(base_attack_energy_share),
    slot_profile_json = VALUES(slot_profile_json),
    slot_variation_json = VALUES(slot_variation_json),
    research_req_json = VALUES(research_req_json),
    build_req_json = VALUES(build_req_json),
    build_cost_json = VALUES(build_cost_json),
    build_time_secs = VALUES(build_time_secs),
    faction_tag = VALUES(faction_tag),
    is_active = VALUES(is_active);

SET @corvette_hull_id := (SELECT id FROM vessel_hulls WHERE code = 'starter_corvette' LIMIT 1);
SET @frigate_hull_id := (SELECT id FROM vessel_hulls WHERE code = 'starter_frigate' LIMIT 1);
SET @destroyer_hull_id := (SELECT id FROM vessel_hulls WHERE code = 'starter_destroyer' LIMIT 1);
SET @propulsion_id := (SELECT id FROM module_groups WHERE code = 'propulsion' LIMIT 1);
SET @weapon_id := (SELECT id FROM module_groups WHERE code = 'weapon' LIMIT 1);
SET @shield_id := (SELECT id FROM module_groups WHERE code = 'shield' LIMIT 1);
SET @utility_id := (SELECT id FROM module_groups WHERE code = 'utility' LIMIT 1);

INSERT INTO hull_module_compatibility (hull_id, group_id, slot_count, allowed_module_tags_json, max_module_tier)
VALUES
    (@corvette_hull_id, @propulsion_id, 1, JSON_ARRAY('starter'), 2),
    (@corvette_hull_id, @weapon_id, 2, JSON_ARRAY('starter'), 2),
    (@corvette_hull_id, @shield_id, 1, JSON_ARRAY('starter'), 2),
    (@corvette_hull_id, @utility_id, 1, JSON_ARRAY('starter'), 2),
    (@frigate_hull_id, @propulsion_id, 1, JSON_ARRAY('starter'), 2),
    (@frigate_hull_id, @weapon_id, 3, JSON_ARRAY('starter'), 2),
    (@frigate_hull_id, @shield_id, 1, JSON_ARRAY('starter'), 2),
    (@frigate_hull_id, @utility_id, 1, JSON_ARRAY('starter'), 2),
    (@destroyer_hull_id, @propulsion_id, 1, JSON_ARRAY('starter'), 3),
    (@destroyer_hull_id, @weapon_id, 4, JSON_ARRAY('starter'), 3),
    (@destroyer_hull_id, @shield_id, 2, JSON_ARRAY('starter'), 3),
    (@destroyer_hull_id, @utility_id, 1, JSON_ARRAY('starter'), 2)
ON DUPLICATE KEY UPDATE
    slot_count = VALUES(slot_count),
    allowed_module_tags_json = VALUES(allowed_module_tags_json),
    max_module_tier = VALUES(max_module_tier);

INSERT INTO modules (code, group_id, label, tier, rarity, stats_delta_json, build_cost_json, build_time_secs, research_req_json, shipyard_req_json, faction_tag, is_active)
VALUES
    ('starter_impulse_drive', @propulsion_id, 'Starter Impulse Drive', 1, 'common', JSON_OBJECT('speed', 1500, 'energy_output', 6, 'energy_capacity', 3, 'energy_upkeep', 1), JSON_OBJECT('metal', 250, 'crystal', 120, 'deuterium', 40), 35, JSON_OBJECT(), JSON_OBJECT('shipyard_level', 1), NULL, 1),
    ('starter_laser_array', @weapon_id, 'Starter Laser Array', 1, 'common', JSON_OBJECT('attack', 10, 'energy_upkeep', 2, 'weapon_efficiency_delta', 0.05, 'attack_energy_share_delta', 0.18), JSON_OBJECT('metal', 340, 'crystal', 90, 'deuterium', 20), 30, JSON_OBJECT(), JSON_OBJECT('shipyard_level', 1), NULL, 1),
    ('starter_deflector', @shield_id, 'Starter Deflector', 1, 'common', JSON_OBJECT('shield', 18, 'energy_upkeep', 2, 'shield_efficiency_delta', 0.07), JSON_OBJECT('metal', 220, 'crystal', 180, 'deuterium', 30), 25, JSON_OBJECT('shielding_tech', 1), JSON_OBJECT('shipyard_level', 1), NULL, 1),
    ('starter_cargo_pod', @utility_id, 'Starter Cargo Pod', 1, 'common', JSON_OBJECT('cargo', 40, 'hull', 8, 'energy_capacity', 2), JSON_OBJECT('metal', 160, 'crystal', 60, 'deuterium', 15), 20, JSON_OBJECT(), JSON_OBJECT('shipyard_level', 1), NULL, 1),
    ('advanced_gauss_array', @weapon_id, 'Advanced Gauss Array', 2, 'rare', JSON_OBJECT('attack', 24, 'energy_upkeep', 4, 'weapon_efficiency_delta', 0.09, 'attack_energy_share_delta', -0.22), JSON_OBJECT('metal', 780, 'crystal', 380, 'deuterium', 120), 55, JSON_OBJECT('weapons_tech', 2, 'energy_tech', 2), JSON_OBJECT('shipyard_level', 2, 'min_standing', 10), 'guild', 1),
    ('fortress_projector', @shield_id, 'Fortress Projector', 2, 'rare', JSON_OBJECT('shield', 32, 'hull', 10, 'energy_upkeep', 3, 'shield_efficiency_delta', 0.12), JSON_OBJECT('metal', 520, 'crystal', 460, 'deuterium', 140), 50, JSON_OBJECT('shielding_tech', 2), JSON_OBJECT('shipyard_level', 2), NULL, 1)
ON DUPLICATE KEY UPDATE
    group_id = VALUES(group_id),
    label = VALUES(label),
    tier = VALUES(tier),
    rarity = VALUES(rarity),
    stats_delta_json = VALUES(stats_delta_json),
    build_cost_json = VALUES(build_cost_json),
    build_time_secs = VALUES(build_time_secs),
    research_req_json = VALUES(research_req_json),
    shipyard_req_json = VALUES(shipyard_req_json),
    faction_tag = VALUES(faction_tag),
    is_active = VALUES(is_active);
