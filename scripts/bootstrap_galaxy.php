<?php

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/galaxy_seed.php';

$db = get_db();
$result = ensure_galaxy_bootstrap_progress($db, true);

echo 'Galaxy bootstrap complete.' . PHP_EOL;
echo 'Galaxy: ' . $result['galaxy'] . PHP_EOL;
echo 'Target systems: ' . $result['target'] . PHP_EOL;
echo 'Last seeded system: ' . ($result['last_seeded_system'] ?? $result['target']) . PHP_EOL;
echo 'Seeded in this run: ' . $result['seeded'] . PHP_EOL;