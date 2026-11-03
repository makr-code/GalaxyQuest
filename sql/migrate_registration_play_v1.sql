CREATE TABLE IF NOT EXISTS registration_play (
    draft_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    state_json JSON NOT NULL,
    email VARCHAR(255) DEFAULT NULL,
    password_hash VARCHAR(255) DEFAULT NULL,
    verification_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    verification_expires_at DATETIME DEFAULT NULL,
    verification_sent_at DATETIME DEFAULT NULL,
    verification_attempts INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (draft_token) REFERENCES registration_drafts(token) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_draft_progress (
    user_id INT NOT NULL PRIMARY KEY,
    state_json JSON NOT NULL,
    email_verified_at DATETIME NOT NULL,
    portrait MEDIUMBLOB DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
