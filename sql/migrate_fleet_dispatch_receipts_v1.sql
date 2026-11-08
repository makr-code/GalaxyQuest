-- Retain accepted dispatch acknowledgements after fleets have returned/deleted.
-- Apply before deploying clients that send request_id. No gameplay DDL at runtime.
USE galaxyquest;

CREATE TABLE IF NOT EXISTS fleet_dispatch_receipts (
    user_id INT NOT NULL,
    request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    fleet_id INT NOT NULL,
    arrival_time DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, request_id),
    KEY idx_dispatch_receipt_fleet (fleet_id),
    CONSTRAINT fk_dispatch_receipt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
