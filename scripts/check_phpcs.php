<?php

declare(strict_types=1);

namespace GalaxyQuest\Quality\PhpStyle;

use JsonException;
use RuntimeException;

/** @return array<string, array<string, int|string>> */
function collectFindings(array $report, string $root): array
{
    if (
        !isset($report['files'], $report['totals']) || !is_array($report['files'])
        || $report['files'] === [] || !is_array($report['totals'])
    ) {
        throw new RuntimeException('Invalid or empty PHPCS report.');
    }
    $root = str_replace('\\', '/', $root) . '/';
    $findings = [];
    $counts = ['ERROR' => 0, 'WARNING' => 0];
    foreach ($report['files'] as $file => $result) {
        $path = str_replace('\\', '/', $file);
        if (
            !str_starts_with($path, $root) || !is_array($result)
            || !isset($result['messages']) || !is_array($result['messages'])
        ) {
            throw new RuntimeException('Invalid PHPCS file entry.');
        }
        $relative = substr($path, strlen($root));
        if (!preg_match('~^(api|lib|config)/.+\.php$~', $relative) || str_contains($relative, '/../')) {
            throw new RuntimeException('PHPCS reported a file outside the configured scope.');
        }
        $contents = file_get_contents($file);
        if ($contents === false) {
            throw new RuntimeException('Cannot read PHPCS source: ' . $relative);
        }
        $lines = explode("\n", str_replace("\r\n", "\n", $contents));
        foreach ($result['messages'] as $message) {
            if (
                !is_array($message) || !is_string($message['source'] ?? null)
                || !is_string($message['message'] ?? null)
                || !in_array($message['type'] ?? null, ['ERROR', 'WARNING'], true)
                || !is_int($message['line'] ?? null) || $message['line'] < 1
                || !is_int($message['column'] ?? null) || $message['column'] < 1
            ) {
                throw new RuntimeException('Invalid PHPCS finding.');
            }
            if (str_contains($message['source'], 'Internal.')) {
                throw new RuntimeException('PHPCS processing failure: ' . $message['message']);
            }
            $entry = [
                'path' => $relative,
                'source' => $message['source'],
                'type' => $message['type'],
                'message' => $message['message'],
                'column' => $message['column'],
                'lineHash' => hash('sha256', $lines[$message['line'] - 1] ?? ''),
            ];
            $key = hash('sha256', json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
            if (!isset($findings[$key])) {
                $findings[$key] = $entry + ['count' => 0];
            }
            $findings[$key]['count']++;
            $counts[$message['type']]++;
        }
    }
    if (
        ($report['totals']['errors'] ?? null) !== $counts['ERROR']
        || ($report['totals']['warnings'] ?? null) !== $counts['WARNING']
    ) {
        throw new RuntimeException('PHPCS report totals do not match its findings.');
    }
    ksort($findings, SORT_STRING);
    return $findings;
}

/** @return array<string, array<string, int|string>> */
function loadBaseline(string $path): array
{
    $contents = file_get_contents($path);
    if ($contents === false) {
        throw new RuntimeException('Cannot read PHPCS baseline.');
    }
    $baseline = json_decode($contents, true, flags: JSON_THROW_ON_ERROR);
    if (
        !is_array($baseline) || ($baseline['version'] ?? null) !== 1
        || ($baseline['standard'] ?? null) !== 'PSR12' || !is_array($baseline['findings'] ?? null)
    ) {
        throw new RuntimeException('Invalid PHPCS baseline format.');
    }
    foreach ($baseline['findings'] as $key => $entry) {
        if (
            !is_array($entry) || array_keys($entry) !== ['path', 'source', 'type', 'message', 'column', 'lineHash', 'count']
            || !is_string($entry['path']) || !is_string($entry['source']) || !is_string($entry['message'])
            || !is_string($entry['lineHash']) || !preg_match('/^[a-f0-9]{64}$/', $entry['lineHash'])
            || !is_int($entry['column']) || $entry['column'] < 1
            || !in_array($entry['type'], ['ERROR', 'WARNING'], true)
            || !is_int($entry['count']) || $entry['count'] < 1
        ) {
            throw new RuntimeException('Invalid PHPCS baseline entry.');
        }
        unset($entry['count']);
        $fingerprint = hash('sha256', json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        if ($key !== $fingerprint) {
            throw new RuntimeException('PHPCS baseline fingerprint mismatch.');
        }
    }
    return $baseline['findings'];
}

/** @return list<string> */
function compareFindings(array $actual, array $baseline): array
{
    $differences = [];
    foreach (array_unique([...array_keys($actual), ...array_keys($baseline)]) as $key) {
        $current = $actual[$key]['count'] ?? 0;
        $allowed = $baseline[$key]['count'] ?? 0;
        if ($current !== $allowed) {
            $entry = $actual[$key] ?? $baseline[$key];
            $differences[] = sprintf(
                '%s: %s [%s] %s (current %d, baseline %d)',
                $current > $allowed ? 'NEW' : 'STALE',
                $entry['path'],
                $entry['source'],
                $entry['message'],
                $current,
                $allowed
            );
        }
    }
    return $differences;
}

/** @return array<string, mixed> */
function runPhpcs(string $root): array
{
    $output = tmpfile();
    $errors = tmpfile();
    if ($output === false || $errors === false) {
        if (is_resource($output)) {
            fclose($output);
        }
        if (is_resource($errors)) {
            fclose($errors);
        }
        throw new RuntimeException('Cannot create PHPCS output streams.');
    }
    try {
        $process = proc_open(
            [PHP_BINARY, $root . '/vendor/bin/phpcs', '--standard=' . $root . '/phpcs.xml',
                '--report=json', '--no-cache', '--ignore-annotations', '-q'],
            [0 => ['pipe', 'r'], 1 => $output, 2 => $errors],
            $pipes,
            $root
        );
        if ($process === false) {
            throw new RuntimeException('Cannot start PHPCS.');
        }
        fclose($pipes[0]);
        $exit = proc_close($process);
        rewind($output);
        rewind($errors);
        $json = stream_get_contents($output);
        $diagnostics = stream_get_contents($errors);
        if ($diagnostics !== false && $diagnostics !== '') {
            fwrite(STDERR, $diagnostics);
        }
        if (!in_array($exit, [0, 1, 2, 3], true) || $json === false) {
            throw new RuntimeException('PHPCS failed with exit code ' . $exit . '.');
        }
        $report = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        if (!is_array($report)) {
            throw new RuntimeException('PHPCS returned an invalid report.');
        }
        return $report;
    } finally {
        fclose($output);
        fclose($errors);
    }
}

function main(array $arguments): int
{
    if ($arguments !== [] && $arguments !== ['--write-baseline']) {
        throw new RuntimeException('Usage: php scripts/check_phpcs.php [--write-baseline]');
    }
    $root = dirname(__DIR__);
    $path = $root . '/phpcs-baseline.json';
    $findings = collectFindings(runPhpcs($root), $root);
    if ($arguments === ['--write-baseline']) {
        $json = json_encode(
            ['version' => 1, 'standard' => 'PSR12', 'findings' => $findings],
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        ) . "\n";
        if (file_put_contents($path, $json) !== strlen($json)) {
            throw new RuntimeException('Cannot write PHPCS baseline.');
        }
        fwrite(STDOUT, 'Baseline written; review every change before accepting it.' . PHP_EOL);
        return 0;
    }
    $differences = compareFindings($findings, loadBaseline($path));
    if ($differences !== []) {
        fwrite(STDERR, implode(PHP_EOL, array_slice($differences, 0, 20)) . PHP_EOL);
        fwrite(STDERR, count($differences) . ' changed fingerprints. '
            . 'Fix new violations; remove resolved baseline entries.' . PHP_EOL);
        return 1;
    }
    fwrite(STDOUT, sprintf(
        "PHPCS PSR12: no new or stale findings (%d existing violations, %d fingerprints).\n",
        array_sum(array_column($findings, 'count')),
        count($findings)
    ));
    return 0;
}

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    try {
        exit(main(array_slice($argv, 1)));
    } catch (JsonException | RuntimeException $error) {
        fwrite(STDERR, 'PHPCS gate error: ' . $error->getMessage() . PHP_EOL);
        exit(1);
    }
}
