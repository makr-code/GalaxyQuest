<?php
/**
 * Initialize database schema for ship designer
 */
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

try {
    $db = get_db();
    
    // Drop old tables (with constraints)
    $db->exec('SET FOREIGN_KEY_CHECKS=0');
    $db->exec('DROP TABLE IF EXISTS asset_generations');
    $db->exec('DROP TABLE IF EXISTS generation_queue');
    $db->exec('DROP TABLE IF EXISTS vessel_designs');
    $db->exec('SET FOREIGN_KEY_CHECKS=1');
    
    // Create new tables
    $db->exec(<<<'SQL'
        CREATE TABLE vessel_designs (
            design_id VARCHAR(16) PRIMARY KEY,
            user_id VARCHAR(64),
            faction_code VARCHAR(50),
            design_name VARCHAR(255),
            customizations JSON,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    SQL);
    
    $db->exec(<<<'SQL'
        CREATE TABLE generation_queue (
            queue_id VARCHAR(16) PRIMARY KEY,
            design_id VARCHAR(16),
            user_id VARCHAR(64),
            prompt_text LONGTEXT,
            status VARCHAR(20) DEFAULT 'pending',
            generation_id VARCHAR(16),
            priority INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    SQL);
    
    $db->exec(<<<'SQL'
        CREATE TABLE asset_generations (
            generation_id VARCHAR(16) PRIMARY KEY,
            user_id VARCHAR(64),
            design_id VARCHAR(16),
            queue_id VARCHAR(16),
            model_path VARCHAR(500),
            status VARCHAR(20) DEFAULT 'pending',
            metadata JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    SQL);
    
    json_ok(['status' => 'initialized', 'tables' => 3]);
    
} catch (\Exception $e) {
    error_log("Init error: " . $e->getMessage());
    json_error($e->getMessage(), 500);
}
?>
