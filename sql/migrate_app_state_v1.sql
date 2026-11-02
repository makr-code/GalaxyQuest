-- Existing state values and definitions are preserved.
-- No down companion: dropping storage would destroy seed/tick coordination state.
CREATE TABLE IF NOT EXISTS app_state (
    state_key VARCHAR(64) PRIMARY KEY,
    state_value VARCHAR(255) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
