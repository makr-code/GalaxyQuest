-- GalaxyQuest – Kolonisierungssystem Migration v2
-- Erweitert die bestehende colonies-Tabelle um Phase, Sektor-Zuordnung und Energie-Bilanz.
-- Referenz: docs/gamedesign/COLONIZATION_SYSTEM_DESIGN.md §5 (Wachstumsphasen), §14 (Backend)
-- Voraussetzung: migrate_colonization_v1.sql muss bereits ausgeführt sein.

USE galaxyquest;

-- ──────────────────────────────────────────────────────────────────────────────
-- colonies: Neue Spalten für das Kolonisierungssystem
--
--   phase         – Wachstumsphase 0–4:
--                   0 = Outpost       (<= 500 pop, keine Spezialgebäude)
--                   1 = Settlement    (<= 2 000 pop)
--                   2 = Colony        (<= 10 000 pop)
--                   3 = City          (<= 50 000 pop)
--                   4 = Metropolis    (> 50 000 pop)
--
--   sector_id     – Zugehöriger Sektor (NULL = keinem Sektor zugewiesen)
--
--   energy_balance – Nettoenergie = Produktion − Verbrauch;
--                    negativ = Defizit (Effizienz-Malus)
-- ──────────────────────────────────────────────────────────────────────────────
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'colonies'
       AND COLUMN_NAME = 'phase') = 0,
    'ALTER TABLE colonies ADD COLUMN phase          TINYINT NOT NULL DEFAULT 0
        COMMENT ''0=Outpost 1=Settlement 2=Colony 3=City 4=Metropolis''',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'colonies'
       AND COLUMN_NAME = 'sector_id') = 0,
    'ALTER TABLE colonies ADD COLUMN sector_id      INT DEFAULT NULL
        COMMENT ''FK to sectors.id – NULL means colony is not in any sector''',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'colonies'
       AND COLUMN_NAME = 'energy_balance') = 0,
    'ALTER TABLE colonies ADD COLUMN energy_balance INT NOT NULL DEFAULT 0
        COMMENT ''Net energy (production - consumption); negative triggers efficiency penalty''',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Index für Sektor-Lookups (häufige JOIN-Abfragen in Sprawl-Berechnung)
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'colonies'
       AND INDEX_NAME = 'idx_colonies_sector') = 0,
    'ALTER TABLE colonies ADD INDEX idx_colonies_sector (sector_id)',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Fremdschlüssel nach der Index-Erstellung hinzufügen
ALTER TABLE colonies
    ADD CONSTRAINT fk_colonies_sector
        FOREIGN KEY (sector_id) REFERENCES sectors(id) ON DELETE SET NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- Initiale Phasen-Zuweisung für bestehende Kolonien (basierend auf Bevölkerung)
-- ──────────────────────────────────────────────────────────────────────────────
UPDATE colonies SET phase =
    CASE
        WHEN population > 50000 THEN 4
        WHEN population > 10000 THEN 3
        WHEN population > 2000  THEN 2
        WHEN population > 500   THEN 1
        ELSE 0
    END
WHERE phase = 0;
