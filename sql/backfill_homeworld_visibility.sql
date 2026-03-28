-- Backfill: Homeworld-Systeme für alle bestehenden Accounts als 'own' sichtbar setzen.
-- Einmalig ausführen für Accounts, die vor dem automatischen touch_system_visibility-Call
-- beim Registrieren angelegt wurden.

INSERT INTO player_system_visibility (user_id, galaxy, `system`, level, scouted_at, expires_at, intel_json)
SELECT
    c.user_id,
    p.galaxy,
    p.`system`,
    'own',
    NOW(),
    NULL,
    NULL
FROM colonies c
JOIN planets p ON p.id = c.planet_id
WHERE c.is_homeworld = 1
ON DUPLICATE KEY UPDATE
    level      = IF(VALUES(level) = 'own' OR level = 'own', 'own', VALUES(level)),
    scouted_at = NOW(),
    expires_at = NULL,
    intel_json = COALESCE(VALUES(intel_json), intel_json);
