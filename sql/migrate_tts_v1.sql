-- ── TTS v1 migration ──────────────────────────────────────────────────────────
-- Adds per-faction TTS voice hint to npc_factions.
-- The tts_voice column stores a Piper voice name (or XTTS language code).
-- NULL / empty string = fall back to TTS_DEFAULT_VOICE configured on the server.

-- MySQL 8.4 does not support ADD COLUMN IF NOT EXISTS; use information_schema guard
SET @col_exists = (
    SELECT COUNT(1) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'npc_factions'
      AND COLUMN_NAME  = 'tts_voice'
);
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE npc_factions ADD COLUMN tts_voice VARCHAR(80) NULL DEFAULT NULL COMMENT \'Piper voice name for TTS (NULL = server default)\'',
    'SELECT 1 /* migrate_tts_v1: tts_voice already present */'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Assign character-appropriate voices to the seeded factions.
-- German voices used because the game UI is primarily in German.
UPDATE npc_factions SET tts_voice = 'de_DE-thorsten-high'   WHERE code = 'empire'     AND tts_voice IS NULL;
UPDATE npc_factions SET tts_voice = 'de_DE-thorsten-medium' WHERE code = 'guild'      AND tts_voice IS NULL;
UPDATE npc_factions SET tts_voice = 'de_DE-thorsten-high'   WHERE code = 'science'    AND tts_voice IS NULL;
UPDATE npc_factions SET tts_voice = 'de_DE-thorsten-medium' WHERE code = 'pirates'    AND tts_voice IS NULL;
UPDATE npc_factions SET tts_voice = 'de_DE-thorsten-high'   WHERE code = 'precursors' AND tts_voice IS NULL;
