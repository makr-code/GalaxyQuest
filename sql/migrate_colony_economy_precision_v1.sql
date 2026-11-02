-- Preserve fractional amounts across on-demand updates, including sub-minute requests.
ALTER TABLE planets
    MODIFY deposit_metal DECIMAL(20,6) NOT NULL DEFAULT 5000000,
    MODIFY deposit_crystal DECIMAL(20,6) NOT NULL DEFAULT 2000000,
    MODIFY deposit_deuterium DECIMAL(20,6) NOT NULL DEFAULT 1000000,
    MODIFY deposit_rare_earth DECIMAL(20,6) NOT NULL DEFAULT 200000;

CREATE TABLE IF NOT EXISTS colony_economy_precision (
    colony_id INT NOT NULL PRIMARY KEY,
    population_remainder DECIMAL(12,9) NOT NULL DEFAULT 0,
    dark_matter_remainder DECIMAL(12,9) NOT NULL DEFAULT 0,
    stock_remainders_json TEXT NOT NULL,
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
    CONSTRAINT ck_population_remainder CHECK (population_remainder > -1 AND population_remainder < 1),
    CONSTRAINT ck_dark_matter_remainder CHECK (dark_matter_remainder >= 0 AND dark_matter_remainder < 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
