CREATE TABLE IF NOT EXISTS ship_physics_specs (
    ship_type VARCHAR(64) NOT NULL,
    mass_kg DOUBLE NOT NULL,
    thrust_newtons DOUBLE NOT NULL,
    max_sublight_speed_m_s DOUBLE NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (ship_type),
    CONSTRAINT chk_ship_physics_mass_positive CHECK (mass_kg > 0),
    CONSTRAINT chk_ship_physics_thrust_nonnegative CHECK (thrust_newtons >= 0),
    CONSTRAINT chk_ship_physics_speed_positive CHECK (max_sublight_speed_m_s > 0)
) ENGINE=InnoDB;
