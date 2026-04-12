-- Sprint 3.3: Trust/Threat-Achsen
-- Adds separate trust_level, threat_level, and trust_decay_rate columns to the
-- diplomacy table so that trust and threat are tracked independently from the
-- overall standing score.

ALTER TABLE diplomacy
    ADD COLUMN IF NOT EXISTS trust_level       DECIMAL(5,2) NOT NULL DEFAULT 0.0
        COMMENT 'Bilateral trust score 0..100; grows via trade/cooperation',
    ADD COLUMN IF NOT EXISTS threat_level      DECIMAL(5,2) NOT NULL DEFAULT 0.0
        COMMENT 'Bilateral threat score 0..100; rises with aggression/fleet size',
    ADD COLUMN IF NOT EXISTS trust_decay_rate  DECIMAL(4,3) NOT NULL DEFAULT 0.500
        COMMENT 'Trust decay per hour without interaction';

-- Seed initial trust from existing positive standing and threat from negative standing
UPDATE diplomacy
SET trust_level  = LEAST(100, GREATEST(0, standing))   -- positive standing → trust seed
  , threat_level = LEAST(100, GREATEST(0, -standing))  -- negative standing → threat seed
WHERE trust_level = 0 AND threat_level = 0;
