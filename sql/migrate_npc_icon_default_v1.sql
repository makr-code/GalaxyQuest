-- Correct only the default for newly inserted NPC factions, not existing icon data.
ALTER TABLE npc_factions ALTER COLUMN icon SET DEFAULT _utf8mb4 0xF09F91BE;
