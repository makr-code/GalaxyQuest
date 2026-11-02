CREATE TABLE IF NOT EXISTS body_terrain_manifests (
    body_id BIGINT UNSIGNED NOT NULL,
    manifest_json JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (body_id),
    CONSTRAINT fk_terrain_manifest_body FOREIGN KEY (body_id)
        REFERENCES celestial_bodies(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS body_terrain_tiles (
    body_id BIGINT UNSIGNED NOT NULL,
    generator_version SMALLINT UNSIGNED NOT NULL,
    face TINYINT UNSIGNED NOT NULL,
    lod TINYINT UNSIGNED NOT NULL,
    tile_x INT UNSIGNED NOT NULL,
    tile_y INT UNSIGNED NOT NULL,
    tile_json JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (body_id, generator_version, face, lod, tile_x, tile_y),
    CONSTRAINT fk_terrain_tile_manifest FOREIGN KEY (body_id)
        REFERENCES body_terrain_manifests(body_id) ON DELETE CASCADE
) ENGINE=InnoDB;
