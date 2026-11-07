#!/usr/bin/env php
<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This script must be run from the CLI.\n");
    exit(1);
}

$repoRoot = dirname(__DIR__);
require_once $repoRoot . '/lib/simulation_tick_cli.php';

try {
    $opts = parse_simulation_tick_args(array_slice($argv ?? [], 1));
} catch (InvalidArgumentException $error) {
    fwrite(STDERR, '[simulation] invalid arguments: ' . $error->getMessage() . PHP_EOL);
    fwrite(STDERR, simulation_tick_usage());
    exit(1);
}
if ($opts['help']) {
    fwrite(STDOUT, simulation_tick_usage());
    exit(0);
}

require_once $repoRoot . '/config/config.php';
require_once $repoRoot . '/config/db.php';
require_once $repoRoot . '/api/simulation_runtime.php';

try {
    $db = get_db();
} catch (Throwable $e) {
    fwrite(STDERR, '[simulation] DB connection failed: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}

$scope = $opts['scope'];
$force = $opts['force'];

try {
    if ($scope === 'user') {
        $result = simulation_tick_user($db, $opts['user_id'], $force);
    } else {
        $result = simulation_tick_global($db, $force);
    }
} catch (Throwable $e) {
    fwrite(STDERR, '[simulation] tick failed: ' . $e->getMessage() . PHP_EOL);
    exit(2);
}

$response = simulation_runtime_public_response($result);
echo json_encode(
    $response,
    JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
) . PHP_EOL;

exit($response['success'] ? 0 : 2);
