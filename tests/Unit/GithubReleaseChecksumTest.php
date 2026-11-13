<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/lib/GithubReleaseChecker.php';
require_once dirname(__DIR__, 2) . '/lib/UpdateManager.php';

final class GithubReleaseChecksumTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir() . '/gq-release-checksum-' . bin2hex(random_bytes(8));
        if (!mkdir($this->root)) {
            throw new RuntimeException('Cannot create checksum fixture directory.');
        }
    }

    protected function tearDown(): void
    {
        foreach ([
            '/updates/downloads/galaxyquest-1.2.3.tar.gz',
            '/updates/downloads',
            '/updates',
            '/galaxyquest-1.2.3.tar.gz',
            '/galaxyquest-1.2.3.tar',
            '/galaxyquest-1.2.3.sha256',
        ] as $path) {
            $target = $this->root . $path;
            if (is_file($target)) {
                unlink($target);
            } elseif (is_dir($target)) {
                rmdir($target);
            }
        }
        rmdir($this->root);
    }

    public function testReleaseChecksumMustMatchArchiveSidecarNameAndContents(): void
    {
        $checksum = str_repeat('a', 64);
        $sidecar = $this->root . '/galaxyquest-1.2.3.sha256';
        self::assertSame(
            strlen($checksum . "  galaxyquest-1.2.3.tar.gz\n"),
            file_put_contents($sidecar, $checksum . "  galaxyquest-1.2.3.tar.gz\n")
        );

        $checker = new GithubReleaseChecker('makr-code', 'GalaxyQuest');
        $normalize = new ReflectionMethod(GithubReleaseChecker::class, 'normalizeRelease');
        $release = $normalize->invoke($checker, [
            'tag_name' => 'v1.2.3',
            'html_url' => 'https://github.com/makr-code/GalaxyQuest/releases/tag/v1.2.3',
            'published_at' => '2026-11-13T00:00:00Z',
            'assets' => [
                [
                    'name' => 'galaxyquest-1.2.3.sha256',
                    'browser_download_url' => 'file://' . $sidecar,
                ],
                [
                    'name' => 'galaxyquest-1.2.3.tar.gz',
                    'browser_download_url' => 'https://github.com/makr-code/GalaxyQuest/releases/download/v1.2.3/galaxyquest-1.2.3.tar.gz',
                ],
            ],
        ]);

        self::assertSame($checksum, $release['checksum_sha256']);
        self::assertSame(
            'https://github.com/makr-code/GalaxyQuest/releases/download/v1.2.3/galaxyquest-1.2.3.tar.gz',
            $release['download_url']
        );
    }

    public function testMismatchedSidecarFilenameLeavesChecksumUnavailable(): void
    {
        $checksum = str_repeat('a', 64);
        $sidecar = $this->root . '/galaxyquest-1.2.3.sha256';
        self::assertIsInt(file_put_contents($sidecar, $checksum . "  other-release.tar.gz\n"));

        $checker = new GithubReleaseChecker('makr-code', 'GalaxyQuest');
        $normalize = new ReflectionMethod(GithubReleaseChecker::class, 'normalizeRelease');
        $release = $normalize->invoke($checker, [
            'tag_name' => 'v1.2.3',
            'html_url' => 'https://github.com/makr-code/GalaxyQuest/releases/tag/v1.2.3',
            'published_at' => '2026-11-13T00:00:00Z',
            'assets' => [
                [
                    'name' => 'galaxyquest-1.2.3.tar.gz',
                    'browser_download_url' => 'https://github.com/makr-code/GalaxyQuest/releases/download/v1.2.3/galaxyquest-1.2.3.tar.gz',
                ],
                [
                    'name' => 'galaxyquest-1.2.3.sha256',
                    'browser_download_url' => 'file://' . $sidecar,
                ],
            ],
        ]);

        self::assertNull($release['checksum_sha256']);
        self::assertNull($release['download_url']);
    }

    public static function invalidChecksums(): iterable
    {
        yield 'missing checksum' => [null];
        yield 'malformed checksum' => ['not-a-sha256'];
    }

    #[DataProvider('invalidChecksums')]
    public function testMissingOrMalformedChecksumBlocksDownloadBeforeNetworkAndFilesystem(
        ?string $checksum
    ): void {
        $downloader = new GithubReleaseDownloadFixture($this->root . '/missing-source.tar.gz');
        $manager = $this->createManager($checksum, $downloader);

        self::assertNull($manager->downloadRelease('1.2.3'));
        self::assertSame(0, $downloader->attempts);
        self::assertDirectoryDoesNotExist($this->root . '/updates');
    }

    public function testChecksumMismatchDeletesDownloadedArchive(): void
    {
        $source = $this->root . '/galaxyquest-1.2.3.tar.gz';
        self::assertIsInt(file_put_contents($source, 'not-an-archive'));
        $downloader = new GithubReleaseDownloadFixture($source);
        $manager = $this->createManager(str_repeat('0', 64), $downloader);

        self::assertNull($manager->downloadRelease('1.2.3'));
        self::assertSame(1, $downloader->attempts);
        self::assertFileDoesNotExist($this->root . '/updates/downloads/galaxyquest-1.2.3.tar.gz');
    }

    public function testMatchingChecksumAllowsValidArchiveDownload(): void
    {
        $tarPath = $this->root . '/galaxyquest-1.2.3.tar';
        $archive = new PharData($tarPath);
        $archive->addFromString('version.txt', '1.2.3');
        $archive->compress(Phar::GZ);
        unset($archive);

        $source = $tarPath . '.gz';
        $checksum = hash_file('sha256', $source);
        self::assertIsString($checksum);
        $downloader = new GithubReleaseDownloadFixture($source);
        $manager = $this->createManager($checksum, $downloader);

        $result = $manager->downloadRelease('1.2.3');

        self::assertIsArray($result);
        self::assertTrue($result['success']);
        self::assertSame($checksum, $result['checksum']);
        self::assertFileExists($result['path']);
    }

    private function createManager(?string $checksum, GithubReleaseDownloadFixture $downloader): UpdateManager
    {
        $db = new PDO('sqlite::memory:');
        $db->exec('CREATE TABLE update_releases (version TEXT, download_url TEXT, checksum_sha256 TEXT)');
        $stmt = $db->prepare('INSERT INTO update_releases VALUES (?, ?, ?)');
        $stmt->execute([
            '1.2.3',
            'https://github.com/makr-code/GalaxyQuest/releases/download/v1.2.3/galaxyquest-1.2.3.tar.gz',
            $checksum,
        ]);

        $manager = (new ReflectionClass(UpdateManager::class))->newInstanceWithoutConstructor();
        foreach ([
            'db' => $db,
            'checker' => $downloader,
            'updatesDir' => $this->root . '/updates',
        ] as $property => $value) {
            (new ReflectionProperty(UpdateManager::class, $property))->setValue($manager, $value);
        }

        return $manager;
    }
}

final class GithubReleaseDownloadFixture extends GithubReleaseChecker
{
    public int $attempts = 0;

    public function __construct(private string $sourcePath)
    {
    }

    public function downloadAsset(string $assetUrl, string $targetPath): bool
    {
        $this->attempts++;
        return copy($this->sourcePath, $targetPath);
    }
}
