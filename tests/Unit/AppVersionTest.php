<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/app_version.php';

final class AppVersionTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'gq-version-' . bin2hex(random_bytes(8));
        self::assertTrue(mkdir($this->root));
    }

    protected function tearDown(): void
    {
        $versionPath = $this->root . DIRECTORY_SEPARATOR . 'VERSION.txt';
        if (is_file($versionPath)) {
            unlink($versionPath);
        }

        if (is_dir($this->root)) {
            rmdir($this->root);
        }
    }

    public function testReadsVersionFromCentralFile(): void
    {
        self::assertNotFalse(file_put_contents($this->root . DIRECTORY_SEPARATOR . 'VERSION.txt', "0.9.0-alpha.1\n"));

        self::assertSame('0.9.0-alpha.1', gq_read_app_version($this->root));
    }

    public function testRejectsMissingVersionFile(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Application version metadata is unavailable.');

        gq_read_app_version($this->root);
    }

    public function testRejectsInvalidOrMultipleVersions(): void
    {
        foreach (['v1.2.3', '01.2.3', "1.2.3\n1.2.4"] as $version) {
            self::assertNotFalse(file_put_contents($this->root . DIRECTORY_SEPARATOR . 'VERSION.txt', $version));

            try {
                gq_read_app_version($this->root);
                self::fail('Expected invalid version metadata to be rejected.');
            } catch (RuntimeException $exception) {
                self::assertSame(
                    'Application version metadata must contain one valid SemVer version.',
                    $exception->getMessage()
                );
            }
        }
    }
}
