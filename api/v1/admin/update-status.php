<?php

declare(strict_types=1);

/**
 * Admin API: Update Status
 * GET /api/v1/admin/update-status
 * 
 * Returns current update status and available releases.
 * Requires admin authentication.
 */

header('Content-Type: application/json');

try {
    // This would need to be integrated with your auth system
    // For now, just load the update manager

    $root = dirname(__DIR__, 4);
    require_once $root . '/config/config.php';
    require_once $root . '/lib/UpdateManager.php';
    require_once $root . '/lib/GithubReleaseChecker.php';

    $db = get_db();
    
    $currentVersion = file_get_contents($root . '/VERSION.txt');
    if ($currentVersion === false) {
        $currentVersion = '1.0.0';
    }
    $currentVersion = trim($currentVersion);

    $manager = new UpdateManager($db, $root, $currentVersion);
    $status = $manager->getStatus();

    // Fetch recent history
    $stmt = $db->prepare("
        SELECT operation_type, from_version, to_version, status, started_at, error_message
        FROM update_history
        ORDER BY started_at DESC
        LIMIT 10
    ");
    $stmt->execute();
    $history = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'status' => $status,
        'history' => $history,
        'timestamp' => date('c'),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
    ]);
}
