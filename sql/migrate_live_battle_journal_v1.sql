-- Isolated live rules journal; not connected to fleet arrivals or gameplay.
USE galaxyquest;

CREATE TABLE IF NOT EXISTS live_battle_journals (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    rule_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    tick INT UNSIGNED NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    initial_state_json JSON NOT NULL,
    state_json JSON NOT NULL,
    next_tick_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_live_battle_due (status, next_tick_at, id),
    CONSTRAINT chk_live_battle_clock CHECK (
        (status = 'active' AND next_tick_at IS NOT NULL)
        OR (status = 'resolved' AND next_tick_at IS NULL)
    )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS live_battle_journal_ticks (
    journal_id BIGINT UNSIGNED NOT NULL,
    tick INT UNSIGNED NOT NULL,
    state_json JSON NOT NULL,
    events_json JSON NOT NULL,
    processed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (journal_id, tick),
    CONSTRAINT fk_live_battle_journal_tick FOREIGN KEY (journal_id)
        REFERENCES live_battle_journals (id),
    CONSTRAINT chk_live_battle_tick_positive CHECK (tick > 0)
) ENGINE=InnoDB;
