-- Migration: Add galaxies metadata table with rotation, pitch angle, escape velocity
-- Stores procedural galaxy generation parameters + physical properties for shader rendering

USE galaxyquest;

-- Galaxies metadata (generation parameters + physical properties)
CREATE TABLE IF NOT EXISTS galaxies (
    id TINYINT UNSIGNED PRIMARY KEY,
    name VARCHAR(64) NOT NULL DEFAULT 'Milky Way Core',
    
    -- Spiral geometry (matching api/galaxy_gen.php constants)
    arm_count TINYINT UNSIGNED NOT NULL DEFAULT 4
        COMMENT '# of spiral arms',
    pitch_angle_deg DECIMAL(5, 2) NOT NULL DEFAULT 14.00
        COMMENT 'Logarithmic spiral pitch angle in degrees (Milky Way ≈ 12–14°)',
    pitch_tangent DECIMAL(8, 6) NOT NULL DEFAULT 0.249328
        COMMENT 'tan(pitch_angle_deg), used in spiral: b = tan(pitch)',
    
    -- Disk geometry
    radius_ly DECIMAL(10, 1) NOT NULL DEFAULT 50000.0
        COMMENT 'Galactic disk radius in light-years',
    arm_start_ly DECIMAL(10, 1) NOT NULL DEFAULT 3500.0
        COMMENT 'Inner arm emergence radius (ly)',
    arm_end_ly DECIMAL(10, 1) NOT NULL DEFAULT 45000.0
        COMMENT 'Outer arm edge (ly)',
    arm_width_ly DECIMAL(8, 1) NOT NULL DEFAULT 1500.0
        COMMENT '1-sigma Gaussian arm width perpendicular to centerline (ly)',
    disk_height_ly DECIMAL(8, 1) NOT NULL DEFAULT 300.0
        COMMENT 'Thin-disk scale height (1-sigma, ly)',
    bulge_radius_ly DECIMAL(8, 1) NOT NULL DEFAULT 4500.0
        COMMENT 'Galactic bulge effective half-radius (ly)',
    bulge_fraction DECIMAL(4, 3) NOT NULL DEFAULT 0.080
        COMMENT 'Fraction of stars (0.0-1.0) in bulge component',
    
    -- Rotation dynamics (physical properties for visualization)
    rotation_direction_ccw TINYINT(1) NOT NULL DEFAULT 1
        COMMENT 'Counter-clockwise rotation when viewed from north pole? (1=yes, 0=clockwise)',
    rotation_period_myr DECIMAL(8, 2) NOT NULL DEFAULT 230.0
        COMMENT 'Galactic rotation period at galactic radius (Milky Way ≈ 230 Myr)',
    galactic_radius_ly DECIMAL(10, 1) NOT NULL DEFAULT 26000.0
        COMMENT 'Distance of Sun from galactic center (ly), used to calc. rotation',
    
    -- Orbital velocity at galactic radius (affects visualization speed)
    orbital_velocity_kms DECIMAL(8, 1) NOT NULL DEFAULT 220.0
        COMMENT 'Orbital velocity at galactic_radius (km/s) — Milky Way ≈ 220 km/s',
    
    -- Escape velocity at various radii (for UI display, ship dynamics hints)
    escape_velocity_center_kms DECIMAL(8, 1) NOT NULL DEFAULT 8000.0
        COMMENT 'Escape velocity at galactic center (km/s) — ~8000 due to SMBH',
    escape_velocity_sun_kms DECIMAL(8, 1) NOT NULL DEFAULT 500.0
        COMMENT 'Escape velocity at galactic_radius (km/s) — ~500 at solar neighborhood',
    
    -- Supermassive black hole (for visualization hints)
    smbh_mass_solar DECIMAL(10, 1) NOT NULL DEFAULT 4100000.0
        COMMENT 'SMBH mass in solar masses (Milky Way Sgr A* ≈ 4.1M☉)',
    smbh_tidal_radius_ly DECIMAL(8, 1) NOT NULL DEFAULT 0.15
        COMMENT 'SMBH tidal disruption radius (ly), visual warning zone',
    
    -- Metadata
    seed INT UNSIGNED NOT NULL DEFAULT 42
        COMMENT 'PRNG seed for deterministic generation',
    systems_per_galaxy INT UNSIGNED NOT NULL DEFAULT 499
        COMMENT 'Total star systems in this galaxy',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_name (name)
) ENGINE=InnoDB
COMMENT='Procedural galaxy metadata: geometry + physics parameters for shader + game mechanics';

-- Insert default Milky Way-like galaxy (id=1)
INSERT IGNORE INTO galaxies (
    id, name, arm_count, pitch_angle_deg, pitch_tangent,
    radius_ly, arm_start_ly, arm_end_ly, arm_width_ly, disk_height_ly, bulge_radius_ly, bulge_fraction,
    rotation_direction_ccw, rotation_period_myr, galactic_radius_ly,
    orbital_velocity_kms, escape_velocity_center_kms, escape_velocity_sun_kms,
    smbh_mass_solar, smbh_tidal_radius_ly, seed, systems_per_galaxy
) VALUES (
    1, 'Milky Way Core', 4, 14.00, 0.249328,
    50000.0, 3500.0, 45000.0, 1500.0, 300.0, 4500.0, 0.080,
    1, 230.0, 26000.0,
    220.0, 8000.0, 500.0,
    4100000.0, 0.15, 42, 499
);
