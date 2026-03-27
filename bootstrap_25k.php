<?php
require './api/helpers.php';
require './api/galaxy_seed.php';

$db = get_db();

// Delete bootstrap flag to force regeneration
$db->exec("DELETE FROM app_state WHERE state_key = 'galaxy_bootstrap:1:last_seeded_system'");

echo 'Starting 25k system generation...' . PHP_EOL;
$start = time();

// Run bootstrap - will create all 25000 systems
$progress = ensure_galaxy_bootstrap_progress($db, true);

$elapsed = time() - $start;
echo '✓ Bootstrap complete!' . PHP_EOL;
echo 'Elapsed time: ' . $elapsed . 's' . PHP_EOL;
echo 'Status: ' . json_encode($progress, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;

// Verify counts
$systems = $db->query('SELECT COUNT(*) FROM star_systems')->fetchColumn();
echo 'Total systems: ' . $systems . PHP_EOL;
