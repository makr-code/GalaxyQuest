-- Invitations reserve nothing. Acceptance splits existing NPC backing into
-- an exact private pair of ordinary finite standing orders.
ALTER TABLE economy_standing_orders
    ADD COLUMN paired_order_id BIGINT UNSIGNED NULL,
    ADD UNIQUE INDEX standing_private_pair (paired_order_id),
    ADD CONSTRAINT standing_pair_order FOREIGN KEY (paired_order_id) REFERENCES economy_standing_orders(id);

CREATE TABLE economy_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    npc_user_id INT NOT NULL,
    npc_order_id BIGINT UNSIGNED NOT NULL,
    player_user_id INT NOT NULL,
    player_colony_id INT NOT NULL,
    window_id BIGINT NOT NULL,
    good_type VARCHAR(64) NOT NULL,
    quantity BIGINT NOT NULL,
    price_cents BIGINT NOT NULL,
    npc_price_cents BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    status ENUM('pending','accepted','declined','expired','unavailable') NOT NULL DEFAULT 'pending',
    player_order_id BIGINT UNSIGNED NULL,
    committed_npc_order_id BIGINT UNSIGNED NULL,
    created_at BIGINT NOT NULL,
    resolved_at BIGINT NULL,
    UNIQUE KEY request_actor_window (npc_user_id,window_id),
    UNIQUE KEY request_order_player (npc_order_id,player_user_id),
    INDEX request_inbox (player_user_id,player_colony_id,status,expires_at),
    INDEX request_expiry (status,expires_at),
    CONSTRAINT request_terms CHECK (
        quantity BETWEEN 1 AND 100 AND price_cents BETWEEN 1 AND 100000000
        AND npc_price_cents = price_cents + 1 AND expires_at > created_at
    ),
    FOREIGN KEY (npc_user_id) REFERENCES users(id),
    FOREIGN KEY (npc_order_id) REFERENCES economy_standing_orders(id),
    FOREIGN KEY (player_user_id) REFERENCES users(id),
    FOREIGN KEY (player_colony_id) REFERENCES colonies(id),
    FOREIGN KEY (player_order_id) REFERENCES economy_standing_orders(id),
    FOREIGN KEY (committed_npc_order_id) REFERENCES economy_standing_orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
