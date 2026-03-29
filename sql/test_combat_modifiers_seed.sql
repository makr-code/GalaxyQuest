-- GalaxyQuest - Optional test seed for combat modifiers
-- Purpose: quick validation of combat_modifiers + user_combat_modifiers integration.
-- Safe to run multiple times.

USE galaxyquest;

INSERT INTO combat_modifiers (
    scope, source_type, source_ref, modifier_key, operation, value,
    condition_json, priority, starts_at, expires_at, active
)
SELECT 'fleet', 'race', 'test_race_aereth', 'combat.damage.all.add_pct', 'add_pct', 0.06,
       NULL, 40, NULL, NULL, 1
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM combat_modifiers
    WHERE source_type = 'race' AND source_ref = 'test_race_aereth' AND modifier_key = 'combat.damage.all.add_pct'
);

INSERT INTO combat_modifiers (
    scope, source_type, source_ref, modifier_key, operation, value,
    condition_json, priority, starts_at, expires_at, active
)
SELECT 'fleet', 'faction', 'test_faction_helion', 'combat.shield.capacity.add_pct', 'add_pct', 0.08,
       NULL, 45, NULL, NULL, 1
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM combat_modifiers
    WHERE source_type = 'faction' AND source_ref = 'test_faction_helion' AND modifier_key = 'combat.shield.capacity.add_pct'
);

INSERT INTO combat_modifiers (
    scope, source_type, source_ref, modifier_key, operation, value,
    condition_json, priority, starts_at, expires_at, active
)
SELECT 'fleet', 'commander', 'test_commander_vortak', 'combat.hull.integrity.add_pct', 'add_pct', 0.05,
       NULL, 50, NULL, NULL, 1
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM combat_modifiers
    WHERE source_type = 'commander' AND source_ref = 'test_commander_vortak' AND modifier_key = 'combat.hull.integrity.add_pct'
);

-- Attach these test modifiers to all users for quick smoke testing.
INSERT IGNORE INTO user_combat_modifiers (user_id, combat_modifier_id, granted_by)
SELECT u.id, cm.id, 'test_seed_v1'
FROM users u
JOIN combat_modifiers cm
  ON cm.source_ref IN ('test_race_aereth', 'test_faction_helion', 'test_commander_vortak');
