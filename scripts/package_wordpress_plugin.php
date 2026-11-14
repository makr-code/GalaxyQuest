<?php

declare(strict_types=1);

/* phpcs:disable PSR1.Files.SideEffects.FoundWithSymbols -- The CLI entrypoint uses the same packager as tests. */

/**
 * @return array<string, mixed>
 */
function package_wordpress_plugin(string $root, string $tag, string $commit, string $output): array
{
    $number = '(?:0|[1-9][0-9]*)';
    if (
        preg_match(
            '/\A(gq-deployment-status|gq-game-admin)-v(' . $number . '\.' . $number . '\.' . $number . ')\z/D',
            $tag,
            $match
        ) !== 1
        || preg_match('/\A[a-f0-9]{40}\z/D', $commit) !== 1
    ) {
        throw new InvalidArgumentException(
            'Expected gq-deployment-status-vX.Y.Z or gq-game-admin-vX.Y.Z and a full SHA.'
        );
    }
    $slug = $match[1];
    $version = $match[2];
    $constant = $slug === 'gq-game-admin' ? 'GQ_GAME_ADMIN_PLUGIN_VERSION' : 'GQ_DEPLOYMENT_STATUS_PLUGIN_VERSION';
    $main = file_get_contents($root . '/wordpress-integration/' . $slug . '.php');
    $updater = file_get_contents($root . '/wordpress-integration/gq-github-plugin-updater.php');
    $tables = file_get_contents($root . '/wordpress-integration/gq-admin-tables.php');
    if (
        !is_string($main)
        || preg_match('/^[ \t*]*Version:[ \t]*([^\r\n]+)/m', $main, $header) !== 1
        || trim($header[1]) !== $version
        || !str_contains($main, 'const ' . $constant . " = '" . $version . "';")
        || !is_string($updater) || !str_contains($updater, 'class GitHubPluginUpdater')
        || !is_string($tables) || !str_contains($tables, 'class AdminTablesV1')
    ) {
        throw new RuntimeException('Plugin tag, header and runtime version must match.');
    }
    if (!is_dir($output) || is_link($output) || !is_writable($output)) {
        throw new RuntimeException('Output must be an existing writable directory, not a symlink.');
    }
    if (!class_exists(ZipArchive::class)) {
        throw new RuntimeException('PHP ext-zip is required.');
    }
    $temporary = tempnam($output, '.gq-plugin-');
    if ($temporary === false) {
        throw new RuntimeException('Could not create temporary plugin archive.');
    }
    $created = [];
    try {
        $zip = new ZipArchive();
        if ($zip->open($temporary, ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Could not open plugin archive.');
        }
        try {
            $sources = [
                $slug . '.php' => $main, 'gq-github-plugin-updater.php' => $updater, 'gq-admin-tables.php' => $tables,
            ];
            foreach ($sources as $filename => $contents) {
                $entry = $slug . '/' . $filename;
                if (
                    !$zip->addFromString($entry, $contents)
                    || !$zip->setMtimeName($entry, 315532800)
                    || !$zip->setExternalAttributesName($entry, ZipArchive::OPSYS_UNIX, 0100644 << 16)
                    || !$zip->setCompressionName($entry, ZipArchive::CM_DEFLATE, 9)
                ) {
                    throw new RuntimeException('Could not prepare canonical plugin ZIP entry.');
                }
            }
        } finally {
            if (!$zip->close()) {
                throw new RuntimeException('Could not finish plugin archive.');
            }
        }
        $name = $slug . '-' . $version . '.zip';
        $digest = hash_file('sha256', $temporary);
        $size = filesize($temporary);
        if (!is_string($digest) || !is_int($size) || $size < 1 || $size > 5242880) {
            throw new RuntimeException('Plugin ZIP size or checksum is invalid.');
        }
        $manifest = [
            'schema_version' => 1, 'repository' => 'makr-code/GalaxyQuest',
            'plugin' => $slug, 'version' => $version, 'tag' => $tag, 'commit' => $commit,
            'package' => ['name' => $name, 'digest' => 'sha256:' . $digest, 'size_in_bytes' => $size],
        ];
        $files = [
            $name => file_get_contents($temporary),
            $slug . '-' . $version . '.sha256' => $digest . '  ' . $name . "\n",
            $slug . '-' . $version . '.release.json' =>
                json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n",
        ];
        foreach ($files as $name => $contents) {
            if (!is_string($contents)) {
                throw new RuntimeException('Could not read prepared plugin package.');
            }
            $destination = $output . '/' . $name;
            if (file_exists($destination) || is_link($destination)) {
                throw new RuntimeException('Refusing to overwrite an existing plugin release asset.');
            }
            $file = fopen($destination, 'xb');
            if ($file === false) {
                throw new RuntimeException('Refusing to overwrite an existing plugin release asset.');
            }
            $created[] = $destination;
            try {
                if (fwrite($file, $contents) !== strlen($contents)) {
                    throw new RuntimeException('Could not write complete plugin release asset.');
                }
            } finally {
                fclose($file);
            }
        }
        return $manifest;
    } catch (Throwable $error) {
        foreach ($created as $file) {
            unlink($file);
        }
        throw $error;
    } finally {
        unlink($temporary);
    }
}

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    try {
        if ($argc !== 4) {
            throw new InvalidArgumentException('Usage: package_wordpress_plugin.php TAG FULL_COMMIT_SHA OUTPUT_DIR');
        }
        echo json_encode(package_wordpress_plugin(getcwd(), $argv[1], $argv[2], $argv[3]), JSON_THROW_ON_ERROR) . "\n";
    } catch (InvalidArgumentException | RuntimeException | JsonException $error) {
        fwrite(STDERR, 'PLUGIN PACKAGE: ' . $error->getMessage() . "\n");
        exit(1);
    }
}
