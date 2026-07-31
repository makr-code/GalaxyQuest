#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Prepare Release
 * 
 * Helper script to prepare a release artifact for GitHub Releases.
 * Creates a tarball and SHA256 checksum file ready for upload.
 * 
 * Usage:
 *   php scripts/prepare_release.php <version> [--output-dir=/path/to/output]
 * 
 * Example:
 *   php scripts/prepare_release.php 1.2.0 --output-dir=/tmp/releases
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This script must be run from CLI.\n");
    exit(1);
}

$version = $argv[1] ?? null;
if (!$version) {
    fwrite(STDERR, "Usage: php scripts/prepare_release.php <version> [--output-dir=/path]\n");
    exit(1);
}

// Parse options
$outputDir = null;
foreach (array_slice($argv, 2) as $arg) {
    if (preg_match('/^--output-dir=(.+)$/', $arg, $m)) {
        $outputDir = $m[1];
    }
}

$outputDir = $outputDir ?? getcwd();
if (!is_dir($outputDir)) {
    fwrite(STDERR, "Output directory does not exist: {$outputDir}\n");
    exit(1);
}

$root = dirname(__DIR__);
$filename = "galaxyquest-{$version}.tar.gz";
$filepath = $outputDir . '/' . $filename;

echo "[prepare-release] Creating release archive for version {$version}\n";
echo "[prepare-release] Output: {$filepath}\n";

// Create tarball excluding unnecessary files
$excludePatterns = [
    '.git',
    '.github/workflows',
    '.env*',
    '.vscode',
    'node_modules',
    'updates/',
    'cache/',
    '.build/',
    '*.log',
    'tests/',
    'themisdb/',
    'Screenshot*',
    '.DS_Store',
    '__pycache__',
];

// Build tar command
$exclude = '';
foreach ($excludePatterns as $pattern) {
    $exclude .= " --exclude='{$pattern}'";
}

$cmd = "cd " . dirname($root) . " && tar -czf '{$filepath}'{$exclude} " . basename($root) . " 2>&1";

echo "[prepare-release] Running: tar -czf {$filename} ...\n";
$output = [];
$returnCode = 0;
exec($cmd, $output, $returnCode);

if ($returnCode !== 0) {
    fwrite(STDERR, "[prepare-release] Error creating archive:\n");
    fwrite(STDERR, implode("\n", $output) . "\n");
    exit(1);
}

if (!file_exists($filepath)) {
    fwrite(STDERR, "[prepare-release] Archive file not created\n");
    exit(1);
}

$fileSize = filesize($filepath);
$checksum = hash_file('sha256', $filepath);

echo "[prepare-release] ✓ Archive created successfully\n";
echo "  File: {$filename}\n";
echo "  Size: " . format_bytes($fileSize) . "\n";
echo "  SHA256: {$checksum}\n";

// Create checksum file
$checksumFile = $outputDir . '/galaxyquest-' . $version . '.sha256';
file_put_contents($checksumFile, "{$checksum}  {$filename}\n");

echo "[prepare-release] ✓ Checksum file created\n";
echo "  File: galaxyquest-{$version}.sha256\n";
echo "\nNext steps:\n";
echo "  1. Create a GitHub Release with tag: v{$version}\n";
echo "  2. Upload artifacts:\n";
echo "     - {$filename}\n";
echo "     - galaxyquest-{$version}.sha256\n";
echo "  3. Verify: php bin/update.php check\n";

exit(0);

// ──────────────────────────────────────────────────────────────────────────

function format_bytes(int $bytes): string
{
    $units = ['B', 'KB', 'MB', 'GB'];
    $bytes = max($bytes, 0);
    $pow = floor(($bytes ? log($bytes) : 0) / log(1024));
    $pow = min($pow, count($units) - 1);
    $bytes /= (1 << (10 * $pow));

    return round($bytes, 2) . ' ' . $units[$pow];
}
