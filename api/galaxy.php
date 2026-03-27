<?php
/**
 * Galaxy map API
 * GET /api/galaxy.php?galaxy=1&system=1
 */
require_once __DIR__ . '/helpers.php';

only_method('GET');
require_auth();

$g = max(1, min(GALAXY_MAX, (int)($_GET['galaxy'] ?? 1)));
$s = max(1, min(SYSTEM_MAX, (int)($_GET['system'] ?? 1)));

$db   = get_db();
$stmt = $db->prepare(
    'SELECT p.id, p.position, p.name, p.type, p.diameter,
            u.username AS owner, p.user_id
     FROM planets p
     JOIN users u ON u.id = p.user_id
     WHERE p.galaxy = ? AND p.system = ?
     ORDER BY p.position ASC'
);
$stmt->execute([$g, $s]);
$rows = $stmt->fetchAll();

// Build a slot map
$slots = [];
for ($pos = 1; $pos <= POSITION_MAX; $pos++) {
    $slots[$pos] = null;
}
foreach ($rows as $row) {
    $slots[(int)$row['position']] = $row;
}

json_ok([
    'galaxy'  => $g,
    'system'  => $s,
    'planets' => array_values($slots),
]);
