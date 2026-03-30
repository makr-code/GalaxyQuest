-- GalaxyQuest migration v11: FTL Phase 4 — stealth & hull-damage columns
-- See FTL_DRIVE_DESIGN.md §7 (Phase 4) for design rationale.

USE galaxyquest;

-- ─── Vel'Ar stealth window ────────────────────────────────────────────────────
-- When a Vel'Ar blind-jump fleet arrives at a hostile target it remains
-- invisible to non-owners for 60 seconds (stealth_until timestamp).
ALTER TABLE fleets
    ADD COLUMN IF NOT EXISTS stealth_until DATETIME DEFAULT NULL
        COMMENT 'Vel''Ar FTL: fleet hidden from enemies until this timestamp';

-- ─── Kryl'Tha hull damage ─────────────────────────────────────────────────────
-- After a Swarm Tunnel jump the fleet hull is partially degraded.
-- Stored as a percentage (0-100). Used in combat to reduce attacker attack.
ALTER TABLE fleets
    ADD COLUMN IF NOT EXISTS hull_damage_pct TINYINT UNSIGNED NOT NULL DEFAULT 0
        COMMENT 'Kryl''Tha FTL: hull degradation after swarm-tunnel jump (0-100 %)';
