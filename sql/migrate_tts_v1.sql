-- ── TTS v1 migration ──────────────────────────────────────────────────────────
-- Adds per-faction TTS voice hint to npc_factions.
-- The tts_voice column stores a Piper voice name (or XTTS language code).
-- NULL / empty string = fall back to TTS_DEFAULT_VOICE configured on the server.

ALTER TABLE npc_factions
    ADD COLUMN IF NOT EXISTS tts_voice VARCHAR(80) NULL DEFAULT NULL
        COMMENT 'Piper voice name for TTS (NULL = server default)';

-- Assign character-appropriate voices to the seeded factions.
-- German voices used because the game UI is primarily in German.
UPDATE npc_factions SET tts_voice = 'de_DE-thorsten-high'   WHERE code = 'empire'     AND tts_voice IS NULL;
UPDATE npc_factions SET tts_voice = 'de_DE-thorsten-medium' WHERE code = 'guild'      AND tts_voice IS NULL;
UPDATE npc_factions SET tts_voice = 'de_DE-thorsten-high'   WHERE code = 'science'    AND tts_voice IS NULL;
UPDATE npc_factions SET tts_voice = 'de_DE-thorsten-medium' WHERE code = 'pirates'    AND tts_voice IS NULL;
UPDATE npc_factions SET tts_voice = 'de_DE-thorsten-high'   WHERE code = 'precursors' AND tts_voice IS NULL;
