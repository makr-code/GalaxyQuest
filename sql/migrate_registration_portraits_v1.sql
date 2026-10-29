CREATE TABLE IF NOT EXISTS registration_portraits (
    draft_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    attempt_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status ENUM('pending', 'generated', 'failed') NOT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 1,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error VARCHAR(255) NOT NULL DEFAULT '',
    image MEDIUMBLOB DEFAULT NULL,
    FOREIGN KEY (draft_token) REFERENCES registration_drafts(token) ON DELETE CASCADE
) ENGINE=InnoDB;
