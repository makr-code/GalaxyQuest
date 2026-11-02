-- Add generated white-dwarf classifications without rewriting historical migrations.
-- Widening is intentionally irreversible: removing WD can truncate deployed star data.
ALTER TABLE star_systems
    MODIFY COLUMN spectral_class ENUM('O','B','A','F','G','K','M','WD') NOT NULL DEFAULT 'G';
