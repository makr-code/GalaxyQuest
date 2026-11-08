-- Legacy-v1 encounter journal. Apply before enabling BATTLE_ENCOUNTERS_ENABLED.
USE galaxyquest;

CREATE TABLE IF NOT EXISTS battle_encounters (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source_fleet_id INT NOT NULL,
    target_colony_id INT NOT NULL,
    target_body_id INT NOT NULL,
    rule_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    seed CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status VARCHAR(16) NOT NULL,
    revision INT UNSIGNED NOT NULL,
    battle_report_id INT NULL,
    outcome_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_encounter_source_fleet (source_fleet_id),
    UNIQUE KEY uq_encounter_report (battle_report_id),
    CONSTRAINT chk_encounter_status CHECK (status IN ('resolving', 'resolved')),
    CONSTRAINT chk_encounter_completion CHECK (
        (status = 'resolving' AND revision = 1 AND battle_report_id IS NULL AND outcome_json IS NULL AND resolved_at IS NULL)
        OR (status = 'resolved' AND revision = 2 AND battle_report_id IS NOT NULL AND outcome_json IS NOT NULL AND resolved_at IS NOT NULL)
    )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS battle_encounter_participants (
    encounter_id BIGINT UNSIGNED NOT NULL,
    side VARCHAR(16) NOT NULL,
    user_id INT NOT NULL,
    controller_kind VARCHAR(32) NOT NULL,
    initial_ships_json JSON NOT NULL,
    PRIMARY KEY (encounter_id, side),
    KEY idx_encounter_participant_user (user_id, encounter_id),
    CONSTRAINT fk_encounter_participant FOREIGN KEY (encounter_id) REFERENCES battle_encounters(id),
    CONSTRAINT chk_encounter_side CHECK (side IN ('attacker', 'defender')),
    CONSTRAINT chk_encounter_controller CHECK (controller_kind IN ('human', 'npc_engine'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS battle_encounter_events (
    encounter_id BIGINT UNSIGNED NOT NULL,
    sequence INT UNSIGNED NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    payload_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (encounter_id, sequence),
    CONSTRAINT fk_encounter_event FOREIGN KEY (encounter_id) REFERENCES battle_encounters(id)
) ENGINE=InnoDB;
