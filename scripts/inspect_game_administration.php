<?php

declare(strict_types=1);

/* phpcs:disable PSR1.Files.SideEffects.FoundWithSymbols -- CLI entrypoint and testable report collector. */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Game administration inspection must be run from CLI.');
}

require_once dirname(__DIR__) . '/lib/MigrationRunner.php';

function gq_admin_snapshot_absolute_path(string $path): bool
{
    return str_starts_with($path, '/') || preg_match('/\A[A-Za-z]:[\\\\\/]/', $path) === 1;
}

/** @return array<string,mixed> */
function gq_admin_snapshot_collect(PDO $db, string $environment, string $releaseDir, string $expectedDatabase): array
{
    if (
        !in_array($environment, ['staging', 'production'], true)
        || !gq_admin_snapshot_absolute_path($releaseDir)
        || $db->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'mysql'
    ) {
        throw new InvalidArgumentException('Inspection requires a fixed environment, release path and MySQL/MariaDB.');
    }
    // Defense in depth; the separate inspection account must also have SELECT-only grants.
    $db->exec('SET SESSION TRANSACTION READ ONLY');
    $identity = $db->query('SELECT DATABASE() AS name, VERSION() AS server_version')->fetch(PDO::FETCH_ASSOC);
    if (!is_array($identity) || $identity['name'] !== $expectedDatabase) {
        throw new RuntimeException('Connected database does not match the configured target identity.');
    }
    $count = $db->query(
        'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
    )->fetchColumn();
    $native = json_decode(
        (string)file_get_contents($releaseDir . '/native-release.json'),
        true,
        32,
        JSON_THROW_ON_ERROR
    );
    $version = trim((string)file_get_contents($releaseDir . '/VERSION.txt'));
    if (
        !is_array($native) || !is_string($native['commit'] ?? null)
        || preg_match('/\A[a-f0-9]{40}\z/D', $native['commit']) !== 1
        || ($native['status'] ?? null) !== 'not-deployable'
        || !is_string($native['web_image_id'] ?? null)
        || preg_match('/\Asha256:[a-f0-9]{64}\z/D', $native['web_image_id']) !== 1
        || preg_match('/\A[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\z/D', $version) !== 1
    ) {
        throw new RuntimeException('Native candidate identity or version is invalid; no deployment approval inferred.');
    }
    $runner = new MigrationRunner(
        $db,
        $releaseDir . '/sql',
        strtoupper($environment),
        $releaseDir . '/config/migrations_manifest.php'
    );
    $migrations = $runner->inspectReadOnly();
    if (!$migrations['tracking_present'] && (int)$count > 0) {
        $migrations['blockers'][] = 'Existing database has no migration history; audited reconciliation is required.';
    }
    $baseline = hash_file('sha256', $releaseDir . '/sql/schema.sql');
    $manifest = hash_file('sha256', $releaseDir . '/config/migrations_manifest.php');
    if (!is_string($baseline) || !is_string($manifest)) {
        throw new RuntimeException('Could not hash the release baseline or migration manifest.');
    }
    $plan = [
        'environment' => $environment,
        'database' => [
            'name' => $identity['name'], 'server_version' => $identity['server_version'],
            'table_count' => (int)$count,
            'state' => $migrations['tracking_present'] ? 'tracked' : ((int)$count === 0 ? 'empty' : 'untracked'),
        ],
        'release' => [
            'commit' => $native['commit'], 'version' => $version, 'status' => 'not-deployable',
            'manifest_sha256' => $manifest, 'baseline_sha256' => $baseline,
        ],
        'migrations' => $migrations,
    ];
    return [
        'schema_version' => 1, 'read_only' => true, 'generated_at' => time(),
        'plan' => $plan,
        'plan_sha256' => hash('sha256', json_encode($plan, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)),
    ];
}

/** @param array<string,mixed> $report */
function gq_admin_snapshot_write(string $output, string $releaseDir, array $report): void
{
    $directory = realpath(dirname($output));
    $release = realpath($releaseDir);
    if (
        !gq_admin_snapshot_absolute_path($output) || !str_ends_with($output, '.json')
        || $directory === false || $release === false || !is_writable($directory) || is_link($output)
        || str_starts_with(str_replace('\\', '/', $directory) . '/', str_replace('\\', '/', $release) . '/')
    ) {
        throw new RuntimeException('Report must be a fixed writable JSON path outside the release directory.');
    }
    $temporary = tempnam($directory, '.gq-admin-');
    if ($temporary === false) {
        throw new RuntimeException('Could not create private report temporary file.');
    }
    try {
        $body = json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
        if (!chmod($temporary, 0600) || file_put_contents($temporary, $body) !== strlen($body)) {
            throw new RuntimeException('Could not write complete private report.');
        }
        if (!rename($temporary, $output)) {
            throw new RuntimeException('Could not atomically publish administration report.');
        }
    } finally {
        if (is_file($temporary)) {
            unlink($temporary);
        }
    }
}

/** @param list<string> $arguments */
function gq_admin_snapshot_main(array $arguments): void
{
    $options = [];
    foreach ($arguments as $argument) {
        if (
            preg_match('/\A--(environment|db-config|release-dir|output)=(.+)\z/D', $argument, $match) !== 1
            || isset($options[$match[1]])
        ) {
            throw new InvalidArgumentException('Unknown, empty or duplicate inspection option.');
        }
        $options[$match[1]] = $match[2];
    }
    if (
        count($options) !== 4 || !in_array($options['environment'] ?? '', ['staging', 'production'], true)
        || !gq_admin_snapshot_absolute_path($options['db-config'])
        || !gq_admin_snapshot_absolute_path($options['release-dir'])
        || !gq_admin_snapshot_absolute_path($options['output'])
    ) {
        throw new InvalidArgumentException(
            'Usage: inspect_game_administration.php --environment=staging|production'
            . ' --db-config=ABSOLUTE_JSON --release-dir=ABSOLUTE_RELEASE --output=ABSOLUTE_JSON'
        );
    }
    $configFile = realpath($options['db-config']);
    $release = realpath($options['release-dir']);
    if (
        $configFile === false || $release === false || !is_file($configFile) || filesize($configFile) > 65536
        || str_starts_with(str_replace('\\', '/', $configFile), str_replace('\\', '/', $release) . '/')
        || realpath($options['output']) === $configFile
    ) {
        throw new RuntimeException('Use a private database configuration outside the release and report files.');
    }
    $config = json_decode((string)file_get_contents($configFile), true, 16, JSON_THROW_ON_ERROR);
    if (
        !is_array($config) || ($config['environment'] ?? null) !== $options['environment']
        || !is_string($config['host'] ?? null) || preg_match('/\A[A-Za-z0-9.:-]+\z/D', $config['host']) !== 1
        || !is_int($config['port'] ?? null) || $config['port'] < 1 || $config['port'] > 65535
        || !is_string($config['database'] ?? null) || preg_match('/\A[A-Za-z0-9_-]+\z/D', $config['database']) !== 1
        || !is_string($config['username'] ?? null) || $config['username'] === ''
        || !is_string($config['password'] ?? null)
    ) {
        throw new RuntimeException('Invalid environment-bound database configuration; credentials were not printed.');
    }
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $config['host'],
        $config['port'],
        $config['database']
    );
    $db = new PDO($dsn, $config['username'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_TIMEOUT => 10,
    ]);
    $report = gq_admin_snapshot_collect($db, $options['environment'], $release, $config['database']);
    gq_admin_snapshot_write($options['output'], $release, $report);
}

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    try {
        gq_admin_snapshot_main(array_slice($argv, 1));
        fwrite(STDOUT, "Read-only administration report written; no schema, history or game data changed.\n");
    } catch (PDOException $error) {
        fwrite(STDERR, 'ADMIN INSPECTION: database inspection failed (SQLSTATE ' . $error->getCode() . ").\n");
        exit(1);
    } catch (InvalidArgumentException | RuntimeException | JsonException $error) {
        fwrite(STDERR, 'ADMIN INSPECTION: ' . $error->getMessage() . "\n");
        exit(1);
    }
}
