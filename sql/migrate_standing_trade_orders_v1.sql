-- Finite, explicitly backed offers. No orders or resources are seeded.
CREATE TABLE economy_standing_orders (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    colony_id INT NOT NULL,
    good_type VARCHAR(64) NOT NULL,
    side ENUM('buy','sell') NOT NULL,
    quantity_initial BIGINT NOT NULL,
    quantity_remaining BIGINT NOT NULL,
    limit_price_cents BIGINT NOT NULL,
    escrow_cents BIGINT NOT NULL DEFAULT 0,
    status ENUM('active','cancelled','filled') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX standing_owner (user_id,colony_id,id),
    INDEX standing_match (status,side,good_type),
    CONSTRAINT standing_quantity CHECK (
        quantity_initial BETWEEN 1 AND 1000000
        AND quantity_remaining BETWEEN 0 AND quantity_initial
    ),
    CONSTRAINT standing_budget CHECK (
        limit_price_cents BETWEEN 1 AND 100000000
        AND quantity_initial * limit_price_cents <= 1000000000000
        AND escrow_cents = CASE WHEN side='buy' THEN quantity_remaining * limit_price_cents ELSE 0 END
    ),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (colony_id) REFERENCES colonies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE trader_routes
    DROP FOREIGN KEY trader_routes_ibfk_1,
    ADD CONSTRAINT standing_route_trader FOREIGN KEY (trader_id) REFERENCES npc_traders(id),
    ADD UNIQUE INDEX standing_route_fleet (fleet_id),
    ADD COLUMN source_order_id BIGINT UNSIGNED NULL,
    ADD COLUMN target_order_id BIGINT UNSIGNED NULL,
    ADD COLUMN buyer_escrow_cents BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN funding_status ENUM('legacy','backed','settled','quarantined') NOT NULL DEFAULT 'legacy',
    ADD CONSTRAINT standing_route_escrow CHECK (buyer_escrow_cents >= 0),
    ADD CONSTRAINT route_source_order FOREIGN KEY (source_order_id) REFERENCES economy_standing_orders(id),
    ADD CONSTRAINT route_target_order FOREIGN KEY (target_order_id) REFERENCES economy_standing_orders(id);
