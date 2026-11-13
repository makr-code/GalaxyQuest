<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/lib/GithubReleaseChecker.php';

final class GithubReleaseDiscoveryTest extends TestCase
{
    private string $directory = '';
    private string $fixture = '';
    private string $baseUrl = '';
    private mixed $server = null;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir() . '/gq-release-discovery-' . bin2hex(random_bytes(8));
        self::assertTrue(mkdir($this->directory, 0700));
        $this->fixture = $this->directory . '/state.json';
        self::assertNotFalse(file_put_contents($this->directory . '/router.php', <<<'PHP'
<?php
$fixture = getenv('GQ_GITHUB_RELEASE_FIXTURE');
$state = $fixture === false ? false : file_get_contents($fixture);
$data = $state === false ? null : json_decode($state, true);
$page = filter_var($_GET['page'] ?? null, FILTER_VALIDATE_INT);
if (!is_array($data) || $page === false || $page === null) {
    http_response_code(500);
    echo '{}';
    return;
}
file_put_contents($fixture . '.requests', $page . "\n", FILE_APPEND | LOCK_EX);
http_response_code($data['statuses'][$page] ?? 200);
header('Content-Type: application/json');
echo json_encode($data['pages'][$page] ?? []);
PHP));
        $this->writeFixture([]);

        $socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        self::assertIsResource($socket, $error);
        $address = stream_socket_get_name($socket, false);
        fclose($socket);
        self::assertIsString($address);
        $this->baseUrl = 'http://' . $address;
        $this->server = proc_open([
            PHP_BINARY, '-d', 'display_errors=0', '-d', 'log_errors=1',
            '-S', $address, '-t', $this->directory, $this->directory . '/router.php',
        ], [
            0 => ['pipe', 'r'],
            1 => ['file', $this->directory . '/stdout.log', 'a'],
            2 => ['file', $this->directory . '/stderr.log', 'a'],
        ], $pipes, dirname(__DIR__, 2), array_merge(getenv(), [
            'GQ_GITHUB_RELEASE_FIXTURE' => $this->fixture,
            'XDEBUG_MODE' => 'off',
        ]));
        self::assertIsResource($this->server);
        fclose($pipes[0]);

        $deadline = microtime(true) + 10;
        do {
            $probe = @stream_socket_client('tcp://' . $address, $errno, $error, 0.1);
            if (is_resource($probe)) {
                fclose($probe);
                return;
            }
            self::assertTrue(proc_get_status($this->server)['running'], $this->serverLog());
            usleep(20000);
        } while (microtime(true) < $deadline);
        self::fail('GitHub release fixture server did not start: ' . $this->serverLog());
    }

    protected function tearDown(): void
    {
        if (is_resource($this->server)) {
            proc_terminate($this->server);
            proc_close($this->server);
        }
        foreach ([
            'state.json',
            'state.json.requests',
            'router.php',
            'stdout.log',
            'stderr.log',
            'galaxyquest-0.9.0-alpha.10.sha256',
        ] as $name) {
            $file = $this->directory . '/' . $name;
            if ($this->directory !== '' && is_file($file)) {
                unlink($file);
            }
        }
        if ($this->directory !== '' && is_dir($this->directory)) {
            rmdir($this->directory);
        }
    }

    public function testSelectsHighestSemverPrereleaseAcrossPagesAndIgnoresStableAndDrafts(): void
    {
        $archiveName = 'galaxyquest-0.9.0-alpha.10.tar.gz';
        $checksum = hash('sha256', 'fixture-archive');
        $checksumPath = $this->directory . '/galaxyquest-0.9.0-alpha.10.sha256';
        self::assertNotFalse(file_put_contents($checksumPath, $checksum . '  ' . $archiveName . "\n"));

        $firstPage = array_fill(0, 100, $this->release('v1.0.0', false));
        $firstPage[0] = $this->release('v0.9.0-alpha.9', true);
        $this->writeFixture([
            1 => $firstPage,
            2 => [
                $this->release('v9.0.0', false),
                $this->release('v99.0.0-alpha.1', true, [], true),
                $this->release('v0.9.0-alpha.01', true),
                $this->release('v0.9.0-alpha.10', true, [
                    [
                        'name' => $archiveName,
                        'browser_download_url' => 'https://github.com/makr-code/GalaxyQuest/releases/download/v0.9.0-alpha.10/' . $archiveName,
                    ],
                    [
                        'name' => 'galaxyquest-0.9.0-alpha.10.sha256',
                        'browser_download_url' => 'file://' . $checksumPath,
                    ],
                ]),
            ],
        ]);
        $checker = $this->checker();

        $release = $checker->fetchLatestRelease(true);

        self::assertIsArray($release);
        self::assertSame('0.9.0-alpha.10', $release['version']);
        self::assertTrue($release['is_prerelease']);
        self::assertSame($checksum, $release['checksum_sha256']);
        self::assertStringEndsWith($archiveName, $release['download_url']);
        self::assertSame("1\n2\n", file_get_contents($this->fixture . '.requests'));
    }

    public function testApiFailureDoesNotReturnAReleaseFromAnIncompleteSearch(): void
    {
        $this->writeFixture([
            1 => [$this->release('v1.2.0-beta.1', true)],
        ], [1 => 503]);

        try {
            $this->checker()->fetchLatestRelease(true);
            self::fail('An API failure was reported as an empty release list.');
        } catch (RuntimeException $error) {
            self::assertSame('Unable to read complete GitHub release history.', $error->getMessage());
        }
        self::assertSame("1\n", file_get_contents($this->fixture . '.requests'));
    }

    public function testNoValidPrereleaseReturnsNull(): void
    {
        $this->writeFixture([
            1 => [
                $this->release('v1.2.0', false),
                $this->release('v1.3.0-beta.1', true, [], true),
                $this->release('v1.3.0-beta.01', true),
                ['prerelease' => true, 'draft' => false, 'tag_name' => 'invalid-tag'],
            ],
        ]);

        self::assertNull($this->checker()->fetchLatestRelease(true));
    }

    public function testIncompleteHistoryAtPageLimitFailsClosed(): void
    {
        $pages = [];
        for ($page = 1; $page <= 11; $page++) {
            $pages[$page] = array_fill(0, 100, $this->release('v1.0.0', false));
        }
        $pages[1][0] = $this->release('v0.9.0-alpha.1', true);
        $this->writeFixture($pages);

        try {
            $this->checker()->fetchLatestRelease(true);
            self::fail('An incomplete release history was accepted.');
        } catch (RuntimeException $error) {
            self::assertSame('GitHub release history exceeds the 1,000-release search limit.', $error->getMessage());
        }
        self::assertCount(11, file($this->fixture . '.requests', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES));
    }

    public function testSemanticVersionPrecedenceUsesNumericIdentifiersAndIgnoresBuildMetadata(): void
    {
        self::assertLessThan(0, GithubReleaseChecker::compareVersions('1.2.3-alpha.9', '1.2.3-alpha.10'));
        self::assertLessThan(0, GithubReleaseChecker::compareVersions('1.2.3-1', '1.2.3-alpha'));
        self::assertGreaterThan(0, GithubReleaseChecker::compareVersions('1.2.3', '1.2.3-rc.1'));
        self::assertSame(0, GithubReleaseChecker::compareVersions('1.2.3+build.1', '1.2.3+build.2'));
        self::assertNull(GithubReleaseChecker::parseVersion('1.2.3')['prerelease']);
        self::assertNull(GithubReleaseChecker::parseVersion('1.2.3-alpha.01'));
    }

    private function checker(): GithubReleaseChecker
    {
        $checker = new GithubReleaseChecker('owner', 'repo');
        (new ReflectionProperty(GithubReleaseChecker::class, 'githubApiUrl'))->setValue($checker, $this->baseUrl);
        return $checker;
    }

    private function release(string $tag, bool $prerelease, array $assets = [], bool $draft = false): array
    {
        return [
            'tag_name' => $tag,
            'name' => $tag,
            'body' => '',
            'html_url' => 'https://github.com/makr-code/GalaxyQuest/releases/tag/' . $tag,
            'published_at' => '2026-11-13T00:00:00Z',
            'prerelease' => $prerelease,
            'draft' => $draft,
            'assets' => $assets,
        ];
    }

    private function writeFixture(array $pages, array $statuses = []): void
    {
        self::assertNotFalse(file_put_contents(
            $this->fixture,
            json_encode(['pages' => $pages, 'statuses' => $statuses], JSON_THROW_ON_ERROR),
            LOCK_EX
        ));
        $requests = $this->fixture . '.requests';
        if (is_file($requests)) {
            unlink($requests);
        }
    }

    private function serverLog(): string
    {
        $file = $this->directory . '/stderr.log';
        return is_file($file) ? (string)file_get_contents($file) : 'No server log.';
    }
}
