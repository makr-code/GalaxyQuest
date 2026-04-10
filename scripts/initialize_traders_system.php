<?php
/**
 * scripts/initialize_traders_system.php
 * 
 * One-time initialization script to:
 * 1. Create initial NPC traders for fractions
 * 2. Seed them with starting capital
 * 3. Scan current systems and populate supply/demand data
 * 4. Identify first set of profitable trade opportunities
 * 
 * Usage:
 *   php scripts/initialize_traders_system.php [--reset]
 * 
 * --reset : Clear existing traders and start fresh
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/market_analysis.php';

$reset = in_array('--reset', $argv);

$db = get_db();

try {
    echo "🤝 Initializing Traders System...\n";
    
    if ($reset) {
        echo "⚠️  [Reset] Clearing existing traders...\n";
        $db->prepare('DELETE FROM trader_transactions')->execute();
        $db->prepare('DELETE FROM trader_routes')->execute();
        $db->prepare('DELETE FROM trade_opportunities')->execute();
        $db->prepare('DELETE FROM npc_traders')->execute();
        echo "✓ Cleared.\n\n";
    }
    
    // 1. Create traders per faction
    echo "1️⃣  Creating NPC traders per faction...\n";
    $facStmt = $db->prepare(<<<SQL
        SELECT id, code, name FROM npc_factions 
        WHERE faction_type IN ('trade', 'military', 'science')
        ORDER BY id
    SQL);
    $facStmt->execute();
    $factions = $facStmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Pre-load NPC colonies as base fallback (round-robin across factions)
    $npcColStmt = $db->query(
        'SELECT c.id FROM colonies c JOIN users u ON u.id = c.user_id WHERE u.control_type = \'npc_engine\' ORDER BY c.id ASC'
    );
    $npcColIds = $npcColStmt ? array_column($npcColStmt->fetchAll(PDO::FETCH_ASSOC), 'id') : [];
    $npcColOffset = 0;

    $traders_created = 0;
    foreach ($factions as $fac) {
        $fac_id = (int)$fac['id'];
        $fac_name = (string)$fac['name'];

        // Pick a base colony for this faction: round-robin over available NPC colonies
        if (empty($npcColIds)) {
            // Last resort: any colony in the DB
            $anyCol = $db->query('SELECT id FROM colonies ORDER BY id LIMIT 1');
            $colId = $anyCol ? (int)$anyCol->fetchColumn() : 0;
        } else {
            $colId = (int)$npcColIds[$npcColOffset % count($npcColIds)];
            $npcColOffset++;
        }

        if (!$colId) {
            echo "  ⚠️  No colony available for $fac_name, skipping.\n";
            continue;
        }
        
        // Create traders (1-3 per faction depending on type)
        $num_traders = match ((string)$fac['code']) {
            'helion'   => 3,  // Helion is commerce-heavy
            'myrk'     => 2,  // Myr'Keth: extractive
            'vor'      => 2,  // Vor'Tak: military focus
            default    => 1,
        };
        
        for ($i = 0; $i < $num_traders; $i++) {
            // Create bot user for trader
            // Keep username within VARCHAR(32): prefix + 8-char hash of faction code + index
            $codeHash = substr(md5((string)$fac_id . $fac['code']), 0, 8);
            $username = 'tb_' . $codeHash . '_' . $i;   // max 14 chars, always unique
            $email = $username . '@bots.local';
            $password = password_hash(bin2hex(random_bytes(32)), PASSWORD_BCRYPT);
            
            $userStmt = $db->prepare(
                'SELECT id FROM users WHERE username = ?'
            );
            $userStmt->execute([$username]);
            $trader_uid = $userStmt->fetchColumn();
            
            if (!$trader_uid) {
                $uidStmt = $db->prepare(<<<SQL
                    INSERT INTO users 
                    (username, email, password_hash, control_type, auth_enabled)
                    VALUES (?, ?, ?, 'npc_engine', 0)
                SQL);
                $uidStmt->execute([$username, $email, $password]);
                $trader_uid = (int)$db->lastInsertId();
            }
            
            // Create trader entity
            $trader_name = "{$fac_name} Trading Co. #{$i}";
            $strategy = match ((string)$fac['code']) {
                'helion' => 'profit_max',
                'vor'    => 'volume',
                'myrk'   => 'stabilize',
                default  => 'profit_max',
            };
            
            $spl = $db->prepare(<<<SQL
                INSERT INTO npc_traders 
                (faction_id, name, user_id, base_colony_id, capital_credits, strategy, max_fleets)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE capital_credits = capital_credits
            SQL);
            
            $capital = match ((string)$fac['code']) {
                'helion' => 75000,
                'vor'    => 50000,
                'myrk'   => 40000,
                default  => 25000,
            };
            
            $max_fleets = match ((string)$fac['code']) {
                'helion' => 5,
                'vor'    => 3,
                'myrk'   => 3,
                default  => 2,
            };
            
            $spl->execute([
                $fac_id, $trader_name, $trader_uid, $colId,
                $capital, $strategy, $max_fleets
            ]);
            
            $traders_created += 1;
            echo "  ✓ Created: $trader_name (capital: $capital Cr)\n";
        }
    }
    
    echo "✓ $traders_created traders created.\n\n";
    
    // 2. Update supply/demand data
    echo "2️⃣  Calculating system supply/demand...\n";
    $sd_updated = update_supply_demand_table($db);
    echo "✓ Updated $sd_updated supply/demand records.\n\n";
    
    // 3. Find trade opportunities
    echo "3️⃣  Discovering trade opportunities...\n";
    $opp_count = find_and_rank_trade_opportunities($db, 15.0);  // 15% min margin
    echo "✓ Found $opp_count profitable opportunities.\n\n";
    
    echo "🎉 Traders System Initialized!\n";
    echo "═══════════════════════════════════════════════════\n";
    echo "Next steps:\n";
    echo "1. Run /api/traders.php?action=process_trader_tick periodically\n";
    echo "2. Monitor traders via /api/traders.php?action=list_traders\n";
    echo "3. Adjust balancing in scripts based on market behavior\n";
    
} catch (Throwable $e) {
    echo "❌ ERROR: " . $e->getMessage() . "\n";
    error_log($e);
    exit(1);
}
