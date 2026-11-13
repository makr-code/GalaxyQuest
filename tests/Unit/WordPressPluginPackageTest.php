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
        self::assertTrue(copy(
            dirname(__DIR__, 2) . '/wordpress-integration/gq-deployment-status.php',
            $this->root . '/wordpress-integration/gq-deployment-status.php'
        ));
    }

    protected function tearDown(): void
    {
        foreach (new DirectoryIterator($this->output) as $entry) {
            if ($entry->isFile()) {
                unlink($entry->getPathname());
            }
        }
        unlink($this->root . '/wordpress-integration/gq-deployment-status.php');
        rmdir($this->root . '/wordpress-integration');
        rmdir($this->output);
        rmdir($this->root);
    }

    public function testPackagesOnlyCanonicalPluginEntrypointWithMatchingChecksumAndProvenance(): void
    {
        $manifest = $this->package();
        $archive = $this->output . '/gq-deployment-status-0.2.0.zip';
        $zip = new ZipArchive();
        self::assertTrue($zip->open($archive));
        try {
            self::assertSame(1, $zip->numFiles);
            self::assertSame('gq-deployment-status/gq-deployment-status.php', $zip->getNameIndex(0));
            self::assertSame(
                file_get_contents($this->root . '/wordpress-integration/gq-deployment-status.php'),
                $zip->getFromIndex(0)
            );
        } finally {
            $zip->close();
        }
        $digest = hash_file('sha256', $archive);
        self::assertSame([
            'schema_version' => 1, 'repository' => 'makr-code/GalaxyQuest',
            'plugin' => 'gq-deployment-status', 'version' => '0.2.0',
            'tag' => 'gq-deployment-status-v0.2.0', 'commit' => str_repeat('a', 40),
            'package' => [
                'name' => 'gq-deployment-status-0.2.0.zip',
                'digest' => 'sha256:' . $digest, 'size_in_bytes' => filesize($archive),
            ],
        ], $manifest);
        self::assertSame(
            $digest . "  gq-deployment-status-0.2.0.zip\n",
            file_get_contents($this->output . '/gq-deployment-status-0.2.0.sha256')
        );
        self::assertSame($manifest, json_decode(
            (string)file_get_contents($this->output . '/gq-deployment-status-0.2.0.release.json'),
            true,
            512,
            JSON_THROW_ON_ERROR
        ));
    }

    public function testRejectsGameTagsAndVersionMismatch(): void
    {
        foreach (['v0.2.0', 'gq-deployment-status-v0.3.0'] as $tag) {
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
        $checksum = $this->output . '/gq-deployment-status-0.2.0.sha256';
        file_put_contents($checksum, 'operator file');
        try {
            $this->package();
            self::fail('Existing output was overwritten.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('overwrite', $error->getMessage());
        }
        self::assertSame('operator file', file_get_contents($checksum));
        self::assertSame(
            ['gq-deployment-status-0.2.0.sha256'],
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

    private function package(string $tag = 'gq-deployment-status-v0.2.0'): array
    {
        return package_wordpress_plugin($this->root, $tag, str_repeat('a', 40), $this->output);
    }
}
