-- Colony Buildings Migration v1
-- Referenz: docs/gamedesign/COLONY_BUILDING_SYSTEM_DESIGN.md
--           docs/technical/COLONY_BUILDING_WEBGPU_DESIGN.md
--           docs/github-issues/09-colony-buildings-backend.md

-- Isometric grid slots for colony buildings
CREATE TABLE IF NOT EXISTS colony_building_slots (
    id               INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    colony_id        INT UNSIGNED    NOT NULL,
    slot_x           INT             NOT NULL,
    slot_y           INT             NOT NULL,
    building_type    VARCHAR(64)     NULL,
    level            TINYINT UNSIGNED NOT NULL DEFAULT 1,
    built_at         TIMESTAMP       NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_colony_slot (colony_id, slot_x, slot_y),
    CONSTRAINT fk_cbs_colony
        FOREIGN KEY (colony_id) REFERENCES colonies (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Upgrade queue per slot
CREATE TABLE IF NOT EXISTS colony_building_upgrades (
    id           INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    slot_id      INT UNSIGNED    NOT NULL,
    from_level   TINYINT UNSIGNED NOT NULL DEFAULT 1,
    to_level     TINYINT UNSIGNED NOT NULL DEFAULT 2,
    started_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completes_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status       ENUM('pending','done','cancelled') NOT NULL DEFAULT 'pending',
    PRIMARY KEY (id),
    CONSTRAINT fk_cbu_slot
        FOREIGN KEY (slot_id) REFERENCES colony_building_slots (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
