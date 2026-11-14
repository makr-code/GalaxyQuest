-- Explicit opt-in only: no provisioning, currency, goods or faction seeds.
CREATE TABLE economy_npc_profiles (
    user_id INT PRIMARY KEY,
    colony_id INT NOT NULL UNIQUE,
    profile VARCHAR(24) NOT NULL,
    window_budget_cents BIGINT NOT NULL,
    last_window BIGINT NULL,
    summary_json LONGTEXT NULL,
    CONSTRAINT npc_economy_profile CHECK (profile IN ('subsistence','agriculture','industry','trade')),
    CONSTRAINT npc_economy_budget CHECK (window_budget_cents BETWEEN 1 AND 10000000),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (colony_id) REFERENCES colonies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE economy_npc_orders (
    order_id BIGINT UNSIGNED PRIMARY KEY,
    user_id INT NOT NULL,
    created_window BIGINT NOT NULL,
    expires_window BIGINT NOT NULL,
    INDEX npc_order_owner (user_id,expires_window,order_id),
    FOREIGN KEY (order_id) REFERENCES economy_standing_orders(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
