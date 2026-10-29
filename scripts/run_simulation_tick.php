#!/usr/bin/env php
<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This script must be run from the CLI.\n");
    exit(1);
}

$repoRoot = dirname(__DIR__);
require_once $repoRoot . '/config/config.php';
require_once $repoRoot . '/config/db.php';
require_once $repoRoot . '/api/simulation_runtime.php';

/**
 * @param array<int, string> $argv
 * @return array{scope:string,user_id:int,force:bool}
 */
function parse_simulation_tick_args(array $argv): array
{
    $out = [
        'scope' => 'global',
        'user_id' => 0,
        'force' => false,
    ];

    foreach ($argv as $arg) {
        if ($arg === '--force') {
            $out['force'] = true;
            continue;
        }
        if (str_starts_with($arg, '--scope=')) {
            $scope = strtolower(trim(substr($arg, 8)));
            if (in_array($scope, ['global', 'user'], true)) {
                $out['scope'] = $scope;
            }
            continue;
        }
        if (str_starts_with($arg, '--user=')) {
            $out['user_id'] = max(0, (int)substr($arg, 7));
            continue;
        }
    }

    return $out;
}

try {
    $db = get_db();
} catch (Throwable $e) {
    fwrite(STDERR, '[simulation] DB connection failed: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}

$opts = parse_simulation_tick_args($argv ?? []);
$scope = $opts['scope'];
$force = $opts['force'];

try {
    if ($scope === 'user') {
        if ($opts['user_id'] <= 0) {
            fwrite(STDERR, "[simulation] --scope=user requires --user=<id>\n");
            exit(1);
        }
        $result = simulation_tick_user($db, $opts['user_id'], $force);
    } else {
        $result = simulation_tick_global($db, $force);
    }
} catch (Throwable $e) {
    fwrite(STDERR, '[simulation] tick failed: ' . $e->getMessage() . PHP_EOL);
    exit(2);
}

echo json_encode(
    [
        'success' => true,
        'simulation' => $result,
    ],
    JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
) . PHP_EOL;

exit(0);

