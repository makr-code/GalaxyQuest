<?php

declare(strict_types=1);

/**
 * @param array<int, string> $argv
 * @return array{scope:string,user_id:int,force:bool,help:bool}
 */
function parse_simulation_tick_args(array $argv): array
{
    $out = [
        'scope' => 'global',
        'user_id' => 0,
        'force' => false,
        'help' => false,
    ];
    $seen = [];

    foreach ($argv as $arg) {
        if ($arg === '--help') {
            if ($argv !== ['--help']) {
                throw new InvalidArgumentException('--help cannot be combined with other options.');
            }
            $out['help'] = true;
            continue;
        }
        if ($arg === '--force') {
            if (isset($seen['force'])) {
                throw new InvalidArgumentException('--force may only be specified once.');
            }
            $seen['force'] = true;
            $out['force'] = true;
            continue;
        }
        if (str_starts_with($arg, '--scope=')) {
            if (isset($seen['scope'])) {
                throw new InvalidArgumentException('--scope may only be specified once.');
            }
            $seen['scope'] = true;
            $scope = substr($arg, 8);
            if (!in_array($scope, ['global', 'user'], true)) {
                throw new InvalidArgumentException('--scope must be either "global" or "user".');
            }
            $out['scope'] = $scope;
            continue;
        }
        if (str_starts_with($arg, '--user=')) {
            if (isset($seen['user'])) {
                throw new InvalidArgumentException('--user may only be specified once.');
            }
            $seen['user'] = true;
            $userId = substr($arg, 7);
            if (!preg_match('/^[0-9]+$/D', $userId)) {
                throw new InvalidArgumentException('--user must be a positive integer.');
            }
            $normalizedUserId = ltrim($userId, '0');
            $normalizedUserId = $normalizedUserId === '' ? '0' : $normalizedUserId;
            $maximumUserId = (string) PHP_INT_MAX;
            if (
                strlen($normalizedUserId) > strlen($maximumUserId)
                || (strlen($normalizedUserId) === strlen($maximumUserId)
                    && strcmp($normalizedUserId, $maximumUserId) > 0)
                || $normalizedUserId === '0'
            ) {
                throw new InvalidArgumentException('--user must be a positive integer within the supported range.');
            }
            $out['user_id'] = (int) $normalizedUserId;
            continue;
        }

        throw new InvalidArgumentException("Unknown simulation tick option '{$arg}'.");
    }

    if ($out['scope'] === 'user' && $out['user_id'] <= 0) {
        throw new InvalidArgumentException('--scope=user requires --user=<positive-id>.');
    }
    if ($out['scope'] === 'global' && isset($seen['user'])) {
        throw new InvalidArgumentException('--user may only be used with --scope=user.');
    }

    return $out;
}

function simulation_tick_usage(): string
{
    return "Usage: php scripts/run_simulation_tick.php [--scope=global|user] [--user=<id>] [--force]\n"
        . "       php scripts/run_simulation_tick.php --help\n";
}
