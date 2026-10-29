<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/../lib/ServerAnnouncementRepository.php';

header('Cache-Control: no-store');
$action = $_GET['action'] ?? 'list';

if ($action === 'list') {
    only_method('GET');
    json_ok(['announcements' => (new ServerAnnouncementRepository(get_db()))->active()]);
}

if (!in_array($action, ['publish', 'withdraw'], true)) {
    json_error('Unknown action', 400);
}
only_method('POST');
$uid = require_auth();
$db = get_db();
if (!is_admin_user($db, $uid)) {
    json_error('Admin access required.', 403);
}
verify_csrf();
$body = get_json_body();

$repository = new ServerAnnouncementRepository($db);
try {
    if ($action === 'publish') {
        json_ok(['id' => $repository->publish($body)]);
    }
    if (!$repository->withdraw(positive_int($body['id'] ?? null))) {
        json_error('Active announcement not found.', 404);
    }
    json_ok();
} catch (InvalidArgumentException $error) {
    json_error($error->getMessage(), 422);
}
