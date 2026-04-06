-- Create test supply/demand records for two systems
INSERT INTO market_supply_demand (galaxy_index, system_index, resource_type, production_per_hour, consumption_per_hour, available_supply, desired_demand, net_balance)
SELECT 1, 1, 'metal', 100, 50, 1000, 200, 950 UNION
SELECT 1, 1, 'crystal', 80, 100, 500, 300, -100 UNION  
SELECT 1, 2, 'metal', 30, 80, 200, 500, -680 UNION
SELECT 1, 2, 'crystal', 120, 40, 2000, 100, 1860
ON DUPLICATE KEY UPDATE available_supply = VALUES(available_supply), net_balance = VALUES(net_balance);

-- Create trade opportunity (buy metal cheap @ system 1, sell dear @ system 2)
INSERT INTO trade_opportunities (source_system, target_system, resource_type, source_price, target_price, profit_margin, available_qty, demand_qty, actual_qty, net_profit_per_unit, confidence, transport_cost, expires_at)
VALUES (1, 2, 'metal', 50.0000, 100.0000, 95.00, 100.00, 300.00, 80.00, 45.0000, 0.850, 5.0000, DATE_ADD(NOW(), INTERVAL 1 HOUR));

-- Check what we created
SELECT 'Opportunities:' as label; 
SELECT id, resource_type, profit_margin, actual_qty FROM trade_opportunities LIMIT 5;
SELECT 'Supply/Demand:' as label; 
SELECT resource_type, net_balance FROM market_supply_demand WHERE galaxy_index=1 ORDER BY system_index;
