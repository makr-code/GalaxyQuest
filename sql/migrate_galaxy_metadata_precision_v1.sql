-- Preserve the intended precision of the Milky Way SMBH tidal radius.
ALTER TABLE galaxies
    MODIFY COLUMN smbh_tidal_radius_ly DECIMAL(8, 2) NOT NULL DEFAULT 0.15
    COMMENT 'SMBH tidal disruption radius (ly), visual warning zone';

UPDATE galaxies
SET smbh_tidal_radius_ly = 0.15
WHERE id = 1 AND smbh_tidal_radius_ly = 0.20;
