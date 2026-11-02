-- Preserve existing queued/running work and table definitions.
-- No down companion: dropping storage would lose paid ship construction.
CREATE TABLE IF NOT EXISTS ship_build_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    colony_id INT NOT NULL,
    ship_type VARCHAR(64) NOT NULL,
    blueprint_id INT DEFAULT NULL,
    quantity INT NOT NULL DEFAULT 1,
    cost_metal INT NOT NULL DEFAULT 0,
    cost_crystal INT NOT NULL DEFAULT 0,
    cost_deuterium INT NOT NULL DEFAULT 0,
    duration_secs INT NOT NULL,
    queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME DEFAULT NULL,
    eta DATETIME DEFAULT NULL,
    status ENUM('queued','running','done','cancelled') NOT NULL DEFAULT 'queued',
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
    INDEX idx_sbq_colony_status (colony_id, status),
    INDEX idx_sbq_eta (eta)
) ENGINE=InnoDB;
