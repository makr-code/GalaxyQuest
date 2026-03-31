-- GalaxyQuest migration v12: NPC faction FTL drive type assignment (OD-3)
-- Assigns faction-specific FTL drives to NPC accounts based on their
-- npc_faction affiliation (empire→vor_tak, guild→aereth, science→zhareen,
-- pirates→kryl_tha, precursors→vel_ar, pve_*→aereth default).
--
-- NPC users are identified by control_type = 'npc_engine'.
-- This migration uses a best-effort approach: NPC users are matched via
-- the faction_colonies join (npc_factions → faction_colonies → colonies → users).

USE galaxyquest;

-- ── Empire faction → Vor'Tak (disciplined jump drives, strategic planning) ──
UPDATE users u
   SET u.ftl_drive_type = 'vor_tak'
 WHERE u.control_type = 'npc_engine'
   AND u.ftl_drive_type = 'aereth'
   AND EXISTS (
       SELECT 1 FROM faction_colonies fc
         JOIN npc_factions nf ON nf.id = fc.faction_id
         JOIN colonies c ON c.id = fc.colony_id
        WHERE c.user_id = u.id
          AND nf.code IN ('empire', 'pve_empire')
       LIMIT 1
   );

-- ── Science faction → Zhareen (resonance nodes, survey-based network) ──────
UPDATE users u
   SET u.ftl_drive_type = 'zhareen'
 WHERE u.control_type = 'npc_engine'
   AND u.ftl_drive_type = 'aereth'
   AND EXISTS (
       SELECT 1 FROM faction_colonies fc
         JOIN npc_factions nf ON nf.id = fc.faction_id
         JOIN colonies c ON c.id = fc.colony_id
        WHERE c.user_id = u.id
          AND nf.code IN ('science', 'pve_science')
       LIMIT 1
   );

-- ── Pirates faction → Kryl'Tha (swarm tactics, fast small raids) ────────────
UPDATE users u
   SET u.ftl_drive_type = 'kryl_tha'
 WHERE u.control_type = 'npc_engine'
   AND u.ftl_drive_type = 'aereth'
   AND EXISTS (
       SELECT 1 FROM faction_colonies fc
         JOIN npc_factions nf ON nf.id = fc.faction_id
         JOIN colonies c ON c.id = fc.colony_id
        WHERE c.user_id = u.id
          AND nf.code IN ('pirates', 'pve_pirates')
       LIMIT 1
   );

-- ── Precursors faction → Vel'Ar (ancient stealth tech, blind jumps) ─────────
UPDATE users u
   SET u.ftl_drive_type = 'vel_ar'
 WHERE u.control_type = 'npc_engine'
   AND u.ftl_drive_type = 'aereth'
   AND EXISTS (
       SELECT 1 FROM faction_colonies fc
         JOIN npc_factions nf ON nf.id = fc.faction_id
         JOIN colonies c ON c.id = fc.colony_id
        WHERE c.user_id = u.id
          AND nf.code IN ('precursors', 'pve_precursors')
       LIMIT 1
   );

-- ── Guild faction → Syl'Nar (trade-route gate network) ──────────────────────
UPDATE users u
   SET u.ftl_drive_type = 'syl_nar'
 WHERE u.control_type = 'npc_engine'
   AND u.ftl_drive_type = 'aereth'
   AND EXISTS (
       SELECT 1 FROM faction_colonies fc
         JOIN npc_factions nf ON nf.id = fc.faction_id
         JOIN colonies c ON c.id = fc.colony_id
        WHERE c.user_id = u.id
          AND nf.code IN ('guild', 'pve_guild')
       LIMIT 1
   );

-- All remaining NPC users (no faction affiliation, or collective/misc)
-- retain the default 'aereth' drive.
