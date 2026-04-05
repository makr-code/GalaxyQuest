-- Seed test traders for lifecycle verification
USE galaxyquest;

-- Create test NPC bot users for traders
INSERT INTO users (username, control_type, faction_id, created_at)
SELECT 'trader_bot_1', 'npc_engine', 1, NOW() UNION
SELECT 'trader_bot_2', 'npc_engine', 2, NOW() UNION
SELECT 'trader_bot_3', 'npc_engine', 3, NOW()
ON DUPLICATE KEY UPDATE username = username;

-- Get the user IDs
SET @uid1 = (SELECT id FROM users WHERE username = 'trader_bot_1' LIMIT 1);
SET @uid2 = (SELECT id FROM users WHERE username = 'trader_bot_2' LIMIT 1);
SET @uid3 = (SELECT id FROM users WHERE username = 'trader_bot_3' LIMIT 1);

-- Get a sample colony for each user
SET @col1 = (SELECT id FROM colonies LIMIT 1);
IF @col1 IS NULL THEN
    -- Insert test colonies if none exist
    INSERT INTO colonies (user_id, body_id, name, level, metal, crystal, deuterium, rare_earth, food)
    SELECT @uid1, 1, 'Trade Base 1', 1, 5000, 3000, 1000, 500, 2000;
    SET @col1 = LAST_INSERT_ID();
END IF;

SET @col2 = (SELECT id FROM colonies WHERE id != @col1 LIMIT 1);
IF @col2 IS NULL THEN
    INSERT INTO colonies (user_id, body_id, name, level, metal, crystal, deuterium, rare_earth, food)
    SELECT @uid2, 2, 'Trade Base 2', 1, 4000, 4000, 1500, 800, 3000;
    SET @col2 = LAST_INSERT_ID();
END IF;

SET @col3 = (SELECT id FROM colonies WHERE id NOT IN (@col1, @col2) LIMIT 1);
IF @col3 IS NULL THEN
    INSERT INTO colonies (user_id, body_id, name, level, metal, crystal, deuterium, rare_earth, food)
    SELECT @uid3, 3, 'Trade Base 3', 1, 6000, 2000, 800, 600, 1500;
    SET @col3 = LAST_INSERT_ID();
END IF;

-- Create traders
INSERT INTO npc_traders (faction_id, name, user_id, base_colony_id, capital_credits, strategy, specialization)
VALUES 
    (1, 'Helion Trader Alpha', @uid1, @col1, 100000, 'profit_max', 'metal'),
    (2, 'Vor Trader Beta', @uid2, @col2, 75000, 'volume', 'crystal'),
    (3, 'Myrkonian Trader Gamma', @uid3, @col3, 50000, 'stabilize', 'deuterium');

-- Create sample trade opportunities
INSERT INTO trade_opportunities 
(source_system, target_system, resource_type, source_price, target_price, profit_margin, available_qty, demand_qty, actual_qty, transport_cost, net_profit_per_unit, confidence, expires_at)
VALUES
    (1, 2, 'metal', 10, 15, 40.0, 500, 300, 300, 5, 2.5, 0.85, DATE_ADD(NOW(), INTERVAL 1 HOUR)),
    (2, 3, 'crystal', 15, 18, 15.0, 400, 250, 250, 4, 0.6, 0.75, DATE_ADD(NOW(), INTERVAL 1 HOUR)),
    (3, 1, 'deuterium', 12, 14, 12.5, 600, 400, 400, 6, 0.4, 0.65, DATE_ADD(NOW(), INTERVAL 1 HOUR)),
    (1, 3, 'food', 5, 7, 25.0, 1000, 800, 800, 3, 1.4, 0.80, DATE_ADD(NOW(), INTERVAL 1 HOUR)),
    (2, 1, 'metal', 10, 12, 12.0, 300, 200, 200, 5, 0.4, 0.70, DATE_ADD(NOW(), INTERVAL 1 HOUR));

-- Verify
SELECT 'Traders created:' as status, COUNT(*) as count FROM npc_traders;
SELECT 'Opportunities seeded:' as status, COUNT(*) as count FROM trade_opportunities WHERE expires_at > NOW();
