-- GalaxyQuest migration v12: NPC faction FTL drive type assignment (OD-3)
-- Assigns faction-specific FTL drives to NPC accounts based on their
-- npc_faction affiliation (empire→vor_tak, guild→syl_nar, science→zhareen,
-- pirates→kryl_tha, precursors→vel_ar, including pve_* aliases).
--
-- NPC users are identified by control_type = 'npc_engine'.
-- NPC users are matched through the canonical user-to-faction membership.

USE galaxyquest;

-- Required here before FTL assignment; the later homeworld migration uses
-- the same table definition and keeps its existing manifest position.
CREATE TABLE IF NOT EXISTS npc_faction_memberships (
    user_id INT NOT NULL PRIMARY KEY,
    faction_id INT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE,
    KEY idx_npc_membership_faction (faction_id)
) ENGINE=InnoDB;

-- ── Empire faction → Vor'Tak (disciplined jump drives, strategic planning) ──
UPDATE users u
   SET u.ftl_drive_type = 'vor_tak'
 WHERE u.control_type = 'npc_engine'
   AND u.ftl_drive_type = 'aereth'
   AND EXISTS (
       SELECT 1 FROM npc_faction_memberships fm
         JOIN npc_factions nf ON nf.id = fm.faction_id
        WHERE fm.user_id = u.id
          AND nf.code IN ('empire', 'pve_empire')
       LIMIT 1
   );

-- ── Science faction → Zhareen (resonance nodes, survey-based network) ──────
UPDATE users u
   SET u.ftl_drive_type = 'zhareen'
 WHERE u.control_type = 'npc_engine'
   AND u.ftl_drive_type = 'aereth'
   AND EXISTS (
       SELECT 1 FROM npc_faction_memberships fm
         JOIN npc_factions nf ON nf.id = fm.faction_id
        WHERE fm.user_id = u.id
          AND nf.code IN ('science', 'pve_science')
       LIMIT 1
   );

-- ── Pirates faction → Kryl'Tha (swarm tactics, fast small raids) ────────────
UPDATE users u
   SET u.ftl_drive_type = 'kryl_tha'
 WHERE u.control_type = 'npc_engine'
   AND u.ftl_drive_type = 'aereth'
   AND EXISTS (
       SELECT 1 FROM npc_faction_memberships fm
         JOIN npc_factions nf ON nf.id = fm.faction_id
        WHERE fm.user_id = u.id
          AND nf.code IN ('pirates', 'pve_pirates')
       LIMIT 1
   );

-- ── Precursors faction → Vel'Ar (ancient stealth tech, blind jumps) ─────────
UPDATE users u
   SET u.ftl_drive_type = 'vel_ar'
 WHERE u.control_type = 'npc_engine'
   AND u.ftl_drive_type = 'aereth'
   AND EXISTS (
       SELECT 1 FROM npc_faction_memberships fm
         JOIN npc_factions nf ON nf.id = fm.faction_id
        WHERE fm.user_id = u.id
          AND nf.code IN ('precursors', 'pve_precursors')
       LIMIT 1
   );

-- ── Guild faction → Syl'Nar (trade-route gate network) ──────────────────────
UPDATE users u
   SET u.ftl_drive_type = 'syl_nar'
 WHERE u.control_type = 'npc_engine'
   AND u.ftl_drive_type = 'aereth'
   AND EXISTS (
       SELECT 1 FROM npc_faction_memberships fm
         JOIN npc_factions nf ON nf.id = fm.faction_id
        WHERE fm.user_id = u.id
          AND nf.code IN ('guild', 'pve_guild')
       LIMIT 1
   );

-- All remaining NPC users (no faction affiliation, or collective/misc)
-- retain the default 'aereth' drive.
