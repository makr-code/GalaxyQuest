<?php

/**
 * Admin API: Update Status
 * GET /api/v1/admin/update-status
 *
 * Returns current update status and available releases.
 * Requires admin authentication.
 */

declare(strict_types=1);

$root = dirname(__DIR__, 3);
require_once $root . '/api/helpers.php';

header('Content-Type: application/json');
only_method('GET');

try {
    require_admin();
    require_once $root . '/lib/app_version.php';
    require_once $root . '/lib/GithubReleaseChecker.php';
    require_once $root . '/lib/UpdateManager.php';

    $db = get_db();
    $currentVersion = gq_read_app_version($root);

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
    error_log('[update-status] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Unable to read update status',
    ]);
}
