<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use InvalidArgumentException;
use GalaxyQuest\Health\HealthProbe;
use PDO;
use PDOException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

require_once dirname(__DIR__, 2) . '/lib/HealthProbe.php';

final class HealthProbeTest extends TestCase
{
    private string $directory;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir() . '/gq-health-' . bin2hex(random_bytes(8));
        self::assertTrue(mkdir($this->directory));
        file_put_contents($this->directory . '/manifest.php', "<?php return ['first.sql', 'second.sql'];");
        self::assertTrue(mkdir($this->directory . '/scripts'));
    }

    protected function tearDown(): void
    {
        unlink($this->directory . '/manifest.php');
        if (is_file($this->directory . '/scripts/check_health.php')) {
            unlink($this->directory . '/scripts/check_health.php');
        }
        rmdir($this->directory . '/scripts');
        rmdir($this->directory);
    }

    public static function nonReadinessRequests(): iterable
    {
        yield 'live get' => ['/health/live', 'GET', 200, 'alive'];
        yield 'live head' => ['/health/live', 'HEAD', 200, 'alive'];
        yield 'live post' => ['/health/live', 'POST', 405, 'method_not_allowed'];
        yield 'ready post' => ['/health/ready', 'POST', 405, 'method_not_allowed'];
        yield 'unknown' => ['/health/other', 'GET', 404, 'not_found'];
        yield 'missing' => ['/health', 'GET', 404, 'not_found'];
        yield 'trailing slash' => ['/health/ready/', 'GET', 404, 'not_found'];
        yield 'direct handler' => ['/health.php', 'GET', 404, 'not_found'];
    }

    #[DataProvider('nonReadinessRequests')]
    public function testNonReadinessDoesNotConnect(string $path, string $method, int $code, string $status): void
    {
        $called = false;
        $result = HealthProbe::response($path, $method, static function () use (&$called): void {
            $called = true;
        });
        self::assertFalse($called);
        self::assertSame(['code' => $code, 'status' => $status], $result);
    }

    public function testReadyAndHeadInvokeReadOnlyCheck(): void
    {
        foreach (['GET', 'HEAD'] as $method) {
            $called = false;
            self::assertSame(
                ['code' => 200, 'status' => 'ready'],
                HealthProbe::response('/health/ready', $method, static function () use (&$called): void {
                    $called = true;
                })
            );
            self::assertTrue($called);
        }
    }

    public static function readinessErrors(): iterable
    {
        yield 'connection' => [new PDOException('password=synthetic-do-not-leak host=private')];
        yield 'pending' => [new RuntimeException('internal manifest path')];
        yield 'invalid manifest' => [new InvalidArgumentException('internal manifest contents')];
    }

    #[DataProvider('readinessErrors')]
    public function testFailuresAreUnavailableWithoutExceptionDetails(\Exception $error): void
    {
        self::assertSame(
            ['code' => 503, 'status' => 'unavailable'],
            HealthProbe::response('/health/ready', 'GET', static function () use ($error): void {
                throw $error;
            })
        );
    }

    private function database(bool $tracking = true): PDO
    {
        $db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        if ($tracking) {
            $db->exec('CREATE TABLE schema_migrations (
                migration_name TEXT PRIMARY KEY, applied_at TEXT, checksum TEXT, environment TEXT
            )');
        }
        return $db;
    }

    public function testFreshProbeDoesNotCreateTrackingTable(): void
    {
        $db = $this->database(false);
        try {
            HealthProbe::assertReady($db, $this->directory, $this->directory . '/manifest.php');
            self::fail('Missing tracking must not be ready.');
        } catch (PDOException $error) {
            self::assertStringContainsString('schema_migrations', $error->getMessage());
        }
        self::assertSame(0, (int) $db->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")->fetchColumn());
    }

    public function testPendingMigrationRejectsEvenWithWorkingDatabase(): void
    {
        $db = $this->database();
        $db->exec("INSERT INTO schema_migrations VALUES ('first.sql', 'now', 'checksum', 'TEST')");
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Pending migrations.');
        HealthProbe::assertReady($db, $this->directory, $this->directory . '/manifest.php');
    }

    public function testCompleteManifestIsReadyWithoutChangingRowsOrSchema(): void
    {
        $db = $this->database();
        $db->exec("INSERT INTO schema_migrations VALUES
            ('first.sql', 'now', 'checksum', 'TEST'), ('second.sql', 'now', 'checksum', 'TEST')");
        $before = $db->query("SELECT * FROM schema_migrations")->fetchAll(PDO::FETCH_ASSOC);
        HealthProbe::assertReady($db, $this->directory, $this->directory . '/manifest.php');
        self::assertSame($before, $db->query("SELECT * FROM schema_migrations")->fetchAll(PDO::FETCH_ASSOC));
        self::assertSame(1, (int) $db->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")->fetchColumn());
    }

    public function testConnectionHasExplicitShortTimeoutsWithoutChangingGameConnector(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2) . '/lib/HealthProbe.php');
        self::assertStringContainsString("ini_set('mysqlnd.net_read_timeout', '2')", $source);
        self::assertStringContainsString('PDO::ATTR_TIMEOUT => 2', $source);
        self::assertStringNotContainsString('get_db()', $source);
    }

    public function testSuccessfulSubprocessIsReady(): void
    {
        file_put_contents($this->directory . '/scripts/check_health.php', '<?php exit(0);');
        HealthProbe::assertReadyWithinDeadline($this->directory);
        self::assertTrue(true);
    }

    public function testUnsuccessfulSubprocessFailsClosed(): void
    {
        file_put_contents($this->directory . '/scripts/check_health.php', '<?php exit(7);');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Readiness check failed.');
        HealthProbe::assertReadyWithinDeadline($this->directory);
    }

    public function testMissingSubprocessScriptFailsClosed(): void
    {
        $this->expectException(RuntimeException::class);
        HealthProbe::assertReadyWithinDeadline($this->directory);
    }

    public function testBlockingChildIsTerminatedWithinDeadline(): void
    {
        file_put_contents($this->directory . '/scripts/check_health.php', '<?php sleep(30);');
        $start = hrtime(true);
        try {
            HealthProbe::assertReadyWithinDeadline($this->directory, 0.1);
            self::fail('Blocking child must fail.');
        } catch (RuntimeException $error) {
            self::assertSame('Readiness deadline exceeded.', $error->getMessage());
        }
        self::assertLessThan(1.5, (hrtime(true) - $start) / 1_000_000_000);
    }

    public function testChattyChildCannotBlockPipeDrainOrDeadline(): void
    {
        file_put_contents($this->directory . '/scripts/check_health.php', <<<'PHP'
<?php
while (true) {
    fwrite(STDOUT, str_repeat('x', 65536));
    fwrite(STDERR, str_repeat('x', 65536));
}
PHP);
        $start = hrtime(true);
        try {
            HealthProbe::assertReadyWithinDeadline($this->directory, 0.1);
            self::fail('Chatty child must fail.');
        } catch (RuntimeException $error) {
            self::assertSame('Readiness deadline exceeded.', $error->getMessage());
        }
        self::assertLessThan(1.5, (hrtime(true) - $start) / 1_000_000_000);
    }

    public function testInvalidDeadlineDoesNotLaunchChild(): void
    {
        foreach ([0.0, -1.0, INF, NAN] as $deadline) {
            try {
                HealthProbe::assertReadyWithinDeadline($this->directory, $deadline);
                self::fail('Invalid deadline accepted.');
            } catch (InvalidArgumentException $error) {
                self::assertSame('Readiness deadline must be positive and finite.', $error->getMessage());
            }
        }
    }
}
