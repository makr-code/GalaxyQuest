-- Participant identities are supplied by trusted server logic, not clients.
USE galaxyquest;

CREATE TABLE IF NOT EXISTS live_battle_journal_participants (
    journal_id BIGINT UNSIGNED NOT NULL,
    side VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id INT NOT NULL,
    PRIMARY KEY (journal_id, side),
    KEY idx_live_journal_participant_user (user_id, journal_id),
    CONSTRAINT fk_live_journal_participant FOREIGN KEY (journal_id) REFERENCES live_battle_journals (id),
    CONSTRAINT chk_live_journal_participant_side CHECK (side IN ('attacker', 'defender')),
    CONSTRAINT chk_live_journal_participant_user CHECK (user_id > 0)
) ENGINE=InnoDB;
