-- GalaxyQuest migration v8: wormhole network baseline

CREATE TABLE IF NOT EXISTS wormholes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    endpoint_a_galaxy INT NOT NULL,
    endpoint_a_system INT NOT NULL,
    endpoint_b_galaxy INT NOT NULL,
    endpoint_b_system INT NOT NULL,
    stability INT NOT NULL DEFAULT 100,
    cooldown_until DATETIME DEFAULT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    label VARCHAR(80) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_wormholes_a (endpoint_a_galaxy, endpoint_a_system),
    INDEX idx_wormholes_b (endpoint_b_galaxy, endpoint_b_system)
) ENGINE=InnoDB;

-- Seed one starter route if table is empty
INSERT INTO wormholes
    (endpoint_a_galaxy, endpoint_a_system, endpoint_b_galaxy, endpoint_b_system, stability, cooldown_until, is_active, label)
SELECT 1, 1, 1, 120, 100, NULL, 1, 'Sol Transit Gate'
WHERE NOT EXISTS (SELECT 1 FROM wormholes LIMIT 1);
