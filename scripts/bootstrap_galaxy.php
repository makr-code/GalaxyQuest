<?php

if (PHP_SAPI !== 'cli') {
	exit(1);
}

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/galaxy_seed.php';
require_once __DIR__ . '/ensure_default_admin.php';

$db = get_db();
$adminLookup = $db->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
$adminLookup->execute(['administrator']);
$adminId = $adminLookup->fetchColumn();
if ($adminId === false) {
	$adminPassword = getenv('DEFAULT_ADMIN_PASSWORD');
	if ($adminPassword === false || strlen($adminPassword) < 16) {
		fwrite(STDERR, "Set DEFAULT_ADMIN_PASSWORD to a unique password of at least 16 characters.\n");
		exit(1);
	}
	$adminId = ensure_default_admin($db, $adminPassword);
} else {
	$adminId = (int)$adminId;
}
$result = ensure_galaxy_bootstrap_progress($db, true);

echo 'Galaxy bootstrap complete.' . PHP_EOL;
echo 'Administrator ensured: ' . $adminId . PHP_EOL;
echo 'Galaxy: ' . $result['galaxy'] . PHP_EOL;
echo 'Target systems: ' . $result['target'] . PHP_EOL;
echo 'Last seeded system: ' . ($result['last_seeded_system'] ?? $result['target']) . PHP_EOL;
echo 'Seeded in this run: ' . $result['seeded'] . PHP_EOL;