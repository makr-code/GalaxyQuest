<?php
/**
 * GameGuide API Test Endpoint
 * Simplified for quick debugging
 */

header('Content-Type: application/json');

try {
    // Load dependencies
    if (file_exists(__DIR__ . '/../lib/MiniYamlParser.php')) {
        require_once __DIR__ . '/../lib/MiniYamlParser.php';
    }
    
    // Test database connection
    $host = $_ENV['DB_HOST'] ?? 'db';
    $name = $_ENV['DB_NAME'] ?? 'galaxyquest';
    $user = $_ENV['DB_USER'] ?? 'galaxyquest_user';
    $pass = $_ENV['DB_PASS'] ?? 'galaxyquest_dev';
    
    $dsn = "mysql:host=$host;dbname=$name;charset=utf8mb4";
    $db = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    
    echo json_encode([
        'ok' => true,
        'message' => 'Database connected',
        'action' => $_GET['action'] ?? 'default',
        'tables_check' => checkGameGuideTables($db),
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine(),
    ]);
}

function checkGameGuideTables($db) {
    try {
        $result = $db->query("SHOW TABLES LIKE 'game_guide%'")->fetchAll();
        return [
            'count' => count($result),
            'tables' => array_map(fn($r) => $r['Tables_in_galaxyquest (game_guide%)'] ?? key($r), $result),
        ];
    } catch (Exception $e) {
        return ['error' => $e->getMessage()];
    }
}
