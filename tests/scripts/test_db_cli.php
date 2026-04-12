<?php
ob_start();
define('IS_CLI', true);
define('SKIP_AUTH', true);

try {
    require_once __DIR__ . '/../../config/config.php';
    require_once __DIR__ . '/../../config/db.php';
    
    $db = get_db();
    echo "✓ Database connected successfully\n";
    
    // Test query
    $count = $db->query('SELECT COUNT(*) FROM users')->fetchColumn();
    echo "✓ Users in database: $count\n";
    
} catch (Throwable $e) {
    echo "✗ Error: " . $e->getMessage() . "\n";
    exit(1);
}
