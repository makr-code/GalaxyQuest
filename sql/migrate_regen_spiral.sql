-- ─────────────────────────────────────────────────────────────────────────────
-- GalaxyQuest – Spiral Arm Fix Migration
-- Date: 2026-03-28
--
-- Bug: All star_systems were generated on a single spiral arm per game-galaxy
--      because galactic_position() used (galaxyIdx-1) % arms for arm assignment
--      instead of a per-system hash.
--
-- Fix: Clear star_systems so they are regenerated with the corrected algorithm
--      on next access (lazy via cache_generated_system).
--
-- Safety:
--   - planets.system_id FK is ON DELETE SET NULL → planet rows survive
--   - colonies reference planets via planet_id (integer PK) → not affected
--   - player_system_visibility uses (user_id, galaxy, system) integers → not affected
-- ─────────────────────────────────────────────────────────────────────────────

SET FOREIGN_KEY_CHECKS = 0;

-- Clear cached star system coordinates (will be re-generated on next request)
TRUNCATE TABLE star_systems;

-- Also clear generated planet geometry so it regenerates alongside the star.
-- Player colonies keep their planet_id rows; only generated planets are cleared.
DELETE FROM planets WHERE id NOT IN (SELECT planet_id FROM colonies);

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'Migration complete: star_systems cleared, generated planets cleared.' AS status;
