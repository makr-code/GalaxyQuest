<?php

declare(strict_types=1);

/* phpcs:disable PSR1.Files.SideEffects.FoundWithSymbols, PSR1.Classes.ClassDeclaration -- Standalone global test entrypoint. */

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/scripts/package_wordpress_plugin.php';

final class WordPressPluginPackageTest extends TestCase
{
    private string $root;
    private string $output;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir() . '/gq-plugin-package-' . bin2hex(random_bytes(8));
        $this->output = $this->root . '/output';
        self::assertTrue(mkdir($this->root . '/wordpress-integration', 0700, true));
        self::assertTrue(mkdir($this->output, 0700));
        foreach (
            ['gq-deployment-status.php', 'gq-game-admin.php',
            'gq-github-plugin-updater.php', 'gq-admin-tables.php'] as $name
        ) {
            self::assertTrue(copy(
                dirname(__DIR__, 2) . '/wordpress-integration/' . $name,
                $this->root . '/wordpress-integration/' . $name
            ));
        }
    }

    protected function tearDown(): void
    {
        foreach (new DirectoryIterator($this->output) as $entry) {
            if ($entry->isFile()) {
                unlink($entry->getPathname());
            }
        }
        foreach (
            ['gq-deployment-status.php', 'gq-game-admin.php',
            'gq-github-plugin-updater.php', 'gq-admin-tables.php'] as $name
        ) {
            unlink($this->root . '/wordpress-integration/' . $name);
        }
        rmdir($this->root . '/wordpress-integration');
        rmdir($this->output);
        rmdir($this->root);
    }

    public function testPackagesOnlyCanonicalPluginEntrypointWithMatchingChecksumAndProvenance(): void
    {
        foreach ([['gq-deployment-status', '0.2.1'], ['gq-game-admin', '0.1.0']] as [$slug, $version]) {
            $this->assertCanonicalPackage($slug, $version);
        }
    }

    private function assertCanonicalPackage(string $slug, string $version): void
    {
        $manifest = $this->package($slug . '-v' . $version);
        $prefix = $slug . '-' . $version;
        $archive = $this->output . '/' . $prefix . '.zip';
        $zip = new ZipArchive();
        self::assertTrue($zip->open($archive));
        try {
            self::assertSame(3, $zip->numFiles);
            self::assertSame($slug . '/' . $slug . '.php', $zip->getNameIndex(0));
            self::assertSame(
                file_get_contents($this->root . '/wordpress-integration/' . $slug . '.php'),
                $zip->getFromIndex(0)
            );
            self::assertSame(
                file_get_contents($this->root . '/wordpress-integration/gq-github-plugin-updater.php'),
                $zip->getFromName($slug . '/gq-github-plugin-updater.php')
            );
            self::assertSame(
                file_get_contents($this->root . '/wordpress-integration/gq-admin-tables.php'),
                $zip->getFromName($slug . '/gq-admin-tables.php')
            );
        } finally {
            $zip->close();
        }
        $digest = hash_file('sha256', $archive);
        self::assertSame([
            'schema_version' => 1, 'repository' => 'makr-code/GalaxyQuest',
            'plugin' => $slug, 'version' => $version,
            'tag' => $slug . '-v' . $version, 'commit' => str_repeat('a', 40),
            'package' => [
                'name' => $prefix . '.zip',
                'digest' => 'sha256:' . $digest, 'size_in_bytes' => filesize($archive),
            ],
        ], $manifest);
        self::assertSame(
            $digest . '  ' . $prefix . ".zip\n",
            file_get_contents($this->output . '/' . $prefix . '.sha256')
        );
        self::assertSame($manifest, json_decode(
            (string)file_get_contents($this->output . '/' . $prefix . '.release.json'),
            true,
            512,
            JSON_THROW_ON_ERROR
        ));
    }

    public function testRejectsGameTagsAndVersionMismatch(): void
    {
        foreach (['v0.2.1', 'gq-deployment-status-v0.3.0', 'gq-game-admin-v0.2.1'] as $tag) {
            try {
                $this->package($tag);
                self::fail('Mismatching tag was accepted.');
            } catch (InvalidArgumentException | RuntimeException $error) {
                self::assertNotSame('', $error->getMessage());
            }
            self::assertSame([], array_values(array_diff(scandir($this->output), ['.', '..'])));
        }
    }

    public function testNeverOverwritesExistingAssetsAndCleansOnlyItsOwnPartialOutputs(): void
    {
        $checksum = $this->output . '/gq-deployment-status-0.2.1.sha256';
        file_put_contents($checksum, 'operator file');
        try {
            $this->package();
            self::fail('Existing output was overwritten.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('overwrite', $error->getMessage());
        }
        self::assertSame('operator file', file_get_contents($checksum));
        self::assertSame(
            ['gq-deployment-status-0.2.1.sha256'],
            array_values(array_diff(scandir($this->output), ['.', '..']))
        );
    }

    public function testArchivesAreReproducibleForIdenticalPluginSource(): void
    {
        $first = $this->package();
        foreach (new DirectoryIterator($this->output) as $entry) {
            if ($entry->isFile()) {
                unlink($entry->getPathname());
            }
        }
        self::assertSame($first, $this->package());
    }

    public function testBothPluginsLoadIndependentlyAndTogetherInEitherOrderFromTheirZips(): void
    {
        $installed = $this->root . '/installed';
        self::assertTrue(mkdir($installed));
        $paths = [];
        try {
            foreach ([['gq-deployment-status', '0.2.1'], ['gq-game-admin', '0.1.0']] as [$slug, $version]) {
                $manifest = $this->package($slug . '-v' . $version);
                $zip = new ZipArchive();
                self::assertTrue($zip->open($this->output . '/' . $manifest['package']['name']));
                try {
                    self::assertTrue($zip->extractTo($installed));
                } finally {
                    $zip->close();
                }
                $paths[] = $installed . '/' . $slug . '/' . $slug . '.php';
            }
            foreach ([[$paths[0]], [$paths[1]], $paths, array_reverse($paths)] as $load) {
                $this->assertPluginsLoad($load);
            }
            $nextEngineFiles = [$paths[1], dirname($paths[1]) . '/gq-github-plugin-updater.php'];
            foreach ($nextEngineFiles as $file) {
                file_put_contents($file, str_replace(
                    'GitHubPluginUpdaterV1',
                    'GitHubPluginUpdaterV2',
                    file_get_contents($file)
                ));
            }
            foreach ([$paths, array_reverse($paths)] as $load) {
                $this->assertPluginsLoad($load);
            }
        } finally {
            foreach (['gq-deployment-status', 'gq-game-admin'] as $slug) {
                foreach ([$slug . '.php', 'gq-github-plugin-updater.php', 'gq-admin-tables.php'] as $name) {
                    $file = $installed . '/' . $slug . '/' . $name;
                    if (is_file($file)) {
                        unlink($file);
                    }
                }
                if (is_dir($installed . '/' . $slug)) {
                    rmdir($installed . '/' . $slug);
                }
            }
            rmdir($installed);
        }
    }

    private function assertPluginsLoad(array $load): void
    {
        $code = 'define("ABSPATH", "/fixture/");'
            . 'function add_action(...$args): void {} function add_filter(...$args): void {}'
            . 'foreach (' . var_export($load, true) . ' as $file) { require $file; }'
            . 'foreach (["gq_deployment_status_updater" => "gq-deployment-status-v1.2.3",'
            . '"gq_game_admin_updater" => "gq-game-admin-v1.2.3"] as $factory => $tag) {'
            . 'if (function_exists($factory) && $factory()->tagVersion($tag) !== "1.2.3") {'
            . 'throw new RuntimeException("Wrong updater context"); }}';
        $process = proc_open([PHP_BINARY, '-r', $code], [
            0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w'],
        ], $pipes);
        self::assertIsResource($process);
        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        self::assertSame(0, proc_close($process), $stdout . $stderr);
    }

    private function package(string $tag = 'gq-deployment-status-v0.2.1'): array
    {
        return package_wordpress_plugin($this->root, $tag, str_repeat('a', 40), $this->output);
    }
}
