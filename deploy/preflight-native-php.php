<?php

declare(strict_types=1);

namespace GalaxyQuest\Deployment;

// phpcs:disable PSR1.Files.SideEffects.FoundWithSymbols -- CLI guard and direct invocation are intentional.

// Reject web execution before reading arguments or loading application code.
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo '{"status":"failed","scope":"cli-only","candidate_status":"not-deployable","errors":["cli-required"]}' . "\n";
    exit(1);
}

/**
 * Evaluate a runtime snapshot without I/O, configuration access or application boot.
 *
 * @param list<string> $loadedExtensions
 * @param list<string> $arguments Script arguments only, excluding argv[0].
 * @return array<string, mixed>
 */
function inspectNativePhpRuntime(string $version, string $sapi, array $loadedExtensions, array $arguments): array
{
    $errors = [];
    if ($arguments !== []) {
        $errors[] = 'arguments-not-allowed';
    }
    if ($sapi !== 'cli') {
        $errors[] = 'cli-required';
    }
    $testedLine = preg_match('/^8\.4\.\d+(?:[-+].*)?$/D', $version) === 1;
    if (!$testedLine) {
        $errors[] = 'php-8.4-required';
    }
    $extensions = [];
    $loadedExtensions = array_map('strtolower', $loadedExtensions);
    foreach (['pdo', 'pdo_mysql', 'mysqli', 'curl', 'mbstring', 'gd', 'json', 'session', 'hash'] as $name) {
        $extensions[$name] = in_array($name, $loadedExtensions, true);
        if (!$extensions[$name]) {
            $errors[] = 'missing-extension:' . $name;
        }
    }

    return [
        'status' => $errors === [] ? 'passed' : 'failed',
        'scope' => 'cli-only',
        'candidate_status' => 'not-deployable',
        'php_version' => $version,
        'tested_php_line' => '8.4',
        'tested_php_line_matches' => $testedLine,
        'sapi' => $sapi,
        'extensions' => $extensions,
        'errors' => $errors,
        'does_not_verify' => [
            'php-fpm', 'opcache', 'apache', 'nginx', 'plesk', 'wordpress',
            'database-connectivity', 'backup', 'rollback', 'deployment-approval',
        ],
        'activated' => false,
    ];
}

if (debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS) === []) {
    $report = inspectNativePhpRuntime(PHP_VERSION, PHP_SAPI, get_loaded_extensions(), array_slice($argv, 1));
    echo json_encode($report, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    exit($report['status'] === 'passed' ? 0 : 1);
}
