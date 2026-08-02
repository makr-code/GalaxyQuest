<?php
/**
 * Debug database connection
 */
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

try {
    $db = get_db();
    
    // Show current tables
    $stmt = $db->query("SHOW TABLES FROM galaxyquest LIKE '%vessel%'");
    $tables = $stmt->fetchAll(PDO::FETCH_NUM);
    
    $result = ['tables' => $tables];
    
    // Try to show constraints
    $stmt = $db->query("
        SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = 'galaxyquest'
        AND (TABLE_NAME LIKE '%vessel%' OR REFERENCED_TABLE_NAME LIKE '%vessel%')
        LIMIT 20
    ");
    $constraints = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $result['constraints'] = $constraints;
    
    // Try to show table info
    $stmt = $db->query("SHOW CREATE TABLE vessel_designs");
    $create = $stmt->fetch(PDO::FETCH_ASSOC);
    $result['create_table'] = $create;
    
    json_ok($result);
    
} catch (\Exception $e) {
    json_error($e->getMessage() . " - " . $e->getFile() . ":" . $e->getLine(), 500);
}
?>
