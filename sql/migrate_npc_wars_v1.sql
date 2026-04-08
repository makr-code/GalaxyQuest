-- ── NPC Wars v1 ──────────────────────────────────────────────────────────────
-- Allows NPC factions to appear as the aggressor in wars without requiring an
-- NPC user record.
--
-- Changes:
--   1.  Make attacker_user_id nullable so NPC-initiated wars can store NULL.
--   2.  Add npc_aggressor_faction_id to reference npc_factions (no FK, nullable).
--
-- Safe to apply to an existing DB.

-- Step 1: drop the NOT-NULL+FK constraint, make nullable
ALTER TABLE wars
    DROP FOREIGN KEY fk_wars_attacker;

ALTER TABLE wars
    MODIFY COLUMN attacker_user_id INT NULL DEFAULT NULL;

ALTER TABLE wars
    ADD CONSTRAINT fk_wars_attacker
        FOREIGN KEY (attacker_user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Step 2: add nullable faction reference for NPC-initiated wars (idempotent via COLUMN check)
SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'wars'
      AND COLUMN_NAME  = 'npc_aggressor_faction_id'
);
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE wars ADD COLUMN npc_aggressor_faction_id INT DEFAULT NULL COMMENT \'NPC faction acting as war aggressor (references npc_factions.id). NULL for PvP wars.\'',
    'SELECT 1'
);
PREPARE _s FROM @sql; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @idx_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'wars'
      AND INDEX_NAME   = 'idx_wars_npc_aggressor'
);
SET @sql2 = IF(@idx_exists = 0,
    'ALTER TABLE wars ADD INDEX idx_wars_npc_aggressor (npc_aggressor_faction_id)',
    'SELECT 1'
);
PREPARE _s2 FROM @sql2; EXECUTE _s2; DEALLOCATE PREPARE _s2;
