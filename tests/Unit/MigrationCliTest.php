<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use DirectoryIterator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class MigrationCliTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir() . '/gq-migrate-cli-' . bin2hex(random_bytes(8));
        foreach (['', '/scripts', '/config', '/lib', '/sql'] as $suffix) {
            if (!mkdir($this->root . $suffix)) {
                throw new RuntimeException('Cannot create CLI fixture.');
            }
        }
        copy(dirname(__DIR__, 2) . '/scripts/migrate.php', $this->root . '/scripts/migrate.php');
        file_put_contents($this->root . '/config/config.php', '<?php');
        file_put_contents($this->root . '/config/db.php', <<<'PHP'
<?php
function get_db(): PDO {
    fwrite(STDERR, "DB_CONNECT\n");
    if (getenv('GQ_CLI_FIXTURE_MODE') === 'connection') {
        throw new PDOException('Fixture connection failure.');
    }
    return new PDO('sqlite::memory:');
}
PHP);
        file_put_contents($this->root . '/lib/MigrationRunner.php', <<<'PHP'
<?php
class MigrationRunner {
    public function __construct(PDO $db, string $dir, string $env) {
        fwrite(STDERR, "ENV:" . $env . "\n");
        if (getenv('GQ_CLI_FIXTURE_MODE') === 'constructor') {
            throw new InvalidArgumentException('Fixture invalid manifest.');
        }
    }
    public function bootstrap(): void {}
    public function adoptActorHistory(bool $dryRun): array {
        $this->checkFailure();
        fwrite(STDERR, "ADOPT:" . (int)$dryRun . "\n");
        return ['adopted' => ['actor.sql'], 'evidence' => ['contract' => 'fixture'], 'dry_run' => $dryRun];
    }
    public function adoptBodyHistory(bool $dryRun): array {
        $this->checkFailure();
        fwrite(STDERR, "ADOPT_BODIES:" . (int)$dryRun . "\n");
        return ['adopted' => ['body.sql'], 'evidence' => ['contract' => 'fixture'], 'dry_run' => $dryRun];
    }
    public function adoptLegacyV2History(bool $dryRun): array {
        $this->checkFailure();
        fwrite(STDERR, "ADOPT_V2:" . (int)$dryRun . "\n");
        return ['adopted' => ['migrate_v2.sql'], 'evidence' => ['contract' => 'fixture'], 'dry_run' => $dryRun];
    }
    public function adoptEconomyHistory(bool $dryRun): array {
        $this->checkFailure();
        fwrite(STDERR, "ADOPT_ECONOMY:" . (int)$dryRun . "\n");
        return ['adopted' => ['economy.sql'], 'evidence' => ['contract' => 'fixture'], 'dry_run' => $dryRun];
    }
    public function adoptAuthHistory(bool $dryRun): array {
        $this->checkFailure();
        fwrite(STDERR, "ADOPT_AUTH:" . (int)$dryRun . "\n");
        return ['adopted' => ['auth.sql'], 'evidence' => ['contract' => 'fixture'], 'dry_run' => $dryRun];
    }
    public function adoptVesselBlueprintHistory(bool $dryRun): array {
        $this->checkFailure();
        fwrite(STDERR, "ADOPT_VESSEL_BLUEPRINTS:" . (int)$dryRun . "\n");
        return ['adopted' => ['vessel.sql'], 'evidence' => ['contract' => 'fixture'], 'dry_run' => $dryRun];
    }
    public function adoptWarHistory(bool $dryRun): array {
        $this->checkFailure();
        fwrite(STDERR, "ADOPT_WARS:" . (int)$dryRun . "\n");
        return ['adopted' => ['wars.sql'], 'evidence' => ['contract' => 'fixture'], 'dry_run' => $dryRun];
    }
    public function getStatus(): array { return []; }
    public function verifyDeployment(): int {
        $this->checkFailure();
        fwrite(STDERR, "VERIFY\n");
        return 64;
    }
    public function runUp(?int $steps, bool $dryRun): array {
        $this->checkFailure();
        fwrite(STDERR, "UP:" . ($steps ?? 'all') . ":" . (int)$dryRun . "\n");
        return [];
    }
    public function runRollback(int $steps, bool $dryRun): array {
        $this->checkFailure();
        if (getenv('GQ_CLI_FIXTURE_MODE') === 'barrier') {
            return [['name' => 'irreversible.sql', 'status' => 'no_down_file', 'statements' => 0, 'execution_ms' => 0]];
        }
        if (getenv('GQ_CLI_FIXTURE_MODE') === 'unknown_result') {
            return [['name' => 'unknown.sql', 'status' => 'unexpected', 'statements' => 0, 'execution_ms' => 0]];
        }
        fwrite(STDERR, "ROLLBACK:" . $steps . ":" . (int)$dryRun . "\n");
        return [];
    }
    private function checkFailure(): void {
        $mode = getenv('GQ_CLI_FIXTURE_MODE');
        if ($mode === 'lock') throw new RuntimeException('Another migration process holds the lock.');
        if ($mode === 'checksum') throw new RuntimeException('Applied migration checksum mismatch.');
        if ($mode === 'sql') throw new PDOException('Fixture SQL error.');
    }
}
PHP);
    }

    protected function tearDown(): void
    {
        foreach (['/scripts', '/config', '/lib', '/sql', ''] as $suffix) {
            $directory = $this->root . $suffix;
            foreach (new DirectoryIterator($directory) as $entry) {
                if ($entry->isFile()) {
                    unlink($entry->getPathname());
                }
            }
            rmdir($directory);
        }
    }

    /** @return array{int, string, string} */
    private function request(array $arguments, string $mode = '', string $environment = 'TEST'): array
    {
        $process = proc_open(
            [PHP_BINARY, $this->root . '/scripts/migrate.php', ...$arguments],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
            $this->root,
            ['GQ_ENV' => $environment, 'GQ_CLI_FIXTURE_MODE' => $mode]
        );
        if ($process === false) {
            throw new RuntimeException('Cannot start migration CLI.');
        }
        fclose($pipes[0]);
        $output = stream_get_contents($pipes[1]);
        $errors = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        return [proc_close($process), (string)$output, (string)$errors];
    }

    /** @return iterable<array{list<string>}> */
    public static function invalidArguments(): iterable
    {
        yield 'missing command' => [[]];
        yield 'unknown command' => [['destroy']];
        yield 'misspelled preview' => [['up', '--dryrun']];
        yield 'second command' => [['up', 'rollback']];
        yield 'unknown flag' => [['up', '--force']];
        yield 'zero' => [['up', '--step=0']];
        yield 'negative' => [['rollback', '--step=-1']];
        yield 'decimal' => [['up', '--step=1.5']];
        yield 'overflow' => [['up', '--step=99999999999999999999999999']];
        yield 'empty step' => [['up', '--step=']];
        yield 'duplicate step' => [['up', '--step=1', '--step=2']];
        yield 'duplicate preview' => [['up', '--dry-run', '--dry-run']];
        yield 'duplicate env' => [['up', '--env=TEST', '--env=PROD']];
        yield 'duplicate directory' => [['up', '--sql-dir=sql', '--sql-dir=sql']];
        yield 'status step' => [['status', '--step=1']];
        yield 'status preview' => [['status', '--dry-run']];
        yield 'verify step' => [['verify', '--step=1']];
        yield 'verify preview' => [['verify', '--dry-run']];
        yield 'adoption step' => [['adopt-actors', '--step=1']];
        yield 'body adoption step' => [['adopt-bodies', '--step=1']];
        yield 'V2 adoption step' => [['adopt-v2', '--step=1']];
        yield 'economy adoption step' => [['adopt-economy', '--step=1']];
        yield 'auth adoption step' => [['adopt-auth', '--step=1']];
        yield 'vessel adoption step' => [['adopt-vessel-blueprints', '--step=1']];
        yield 'war adoption step' => [['adopt-wars', '--step=1']];
        yield 'reserved adoption environment' => [['up', '--env=ADOPTED']];
        yield 'long env' => [['up', '--env=' . str_repeat('a', 21)]];
        yield 'invalid env' => [['up', '--env=TEST!']];
        yield 'empty env' => [['up', '--env=']];
        yield 'missing directory' => [['up', '--sql-dir=missing']];
    }

    #[DataProvider('invalidArguments')]
    public function testInvalidArgumentsFailBeforeDatabaseConnection(array $arguments): void
    {
        [$exit, $output, $errors] = $this->request($arguments);
        $this->assertSame(1, $exit);
        $this->assertStringContainsString('Error:', $errors);
        $this->assertStringNotContainsString('DB_CONNECT', $errors);
        $this->assertStringContainsString('Usage:', $output);
    }

    /** @return iterable<array{list<string>, string}> */
    public static function validArguments(): iterable
    {
        yield 'up defaults' => [['up'], 'UP:all:0'];
        yield 'verify defaults' => [['verify'], 'VERIFY'];
        yield 'adopt preview' => [['adopt-actors', '--dry-run'], 'ADOPT:1'];
        yield 'adopt execution' => [['adopt-actors'], 'ADOPT:0'];
        yield 'body adoption preview' => [['adopt-bodies', '--dry-run'], 'ADOPT_BODIES:1'];
        yield 'body adoption execution' => [['adopt-bodies'], 'ADOPT_BODIES:0'];
        yield 'V2 adoption preview' => [['adopt-v2', '--dry-run'], 'ADOPT_V2:1'];
        yield 'V2 adoption execution' => [['adopt-v2'], 'ADOPT_V2:0'];
        yield 'economy adoption preview' => [['adopt-economy', '--dry-run'], 'ADOPT_ECONOMY:1'];
        yield 'economy adoption execution' => [['adopt-economy'], 'ADOPT_ECONOMY:0'];
        yield 'auth adoption preview' => [['adopt-auth', '--dry-run'], 'ADOPT_AUTH:1'];
        yield 'auth adoption execution' => [['adopt-auth'], 'ADOPT_AUTH:0'];
        yield 'vessel adoption preview' => [['adopt-vessel-blueprints', '--dry-run'], 'ADOPT_VESSEL_BLUEPRINTS:1'];
        yield 'vessel adoption execution' => [['adopt-vessel-blueprints'], 'ADOPT_VESSEL_BLUEPRINTS:0'];
        yield 'war adoption preview' => [['adopt-wars', '--dry-run'], 'ADOPT_WARS:1'];
        yield 'war adoption execution' => [['adopt-wars'], 'ADOPT_WARS:0'];
        yield 'verify directory and env' => [['verify', '--sql-dir=sql', '--env=PROD'], 'ENV:PROD'];
        yield 'rollback default' => [['rollback'], 'ROLLBACK:1:0'];
        yield 'preview' => [['up', '--step=2', '--dry-run'], 'UP:2:1'];
        yield 'rollback preview' => [['rollback', '--step=3', '--dry-run'], 'ROLLBACK:3:1'];
        yield 'options first' => [['--env=prod', '--step=2', 'up'], 'ENV:PROD'];
        yield 'directory' => [['up', '--sql-dir=sql'], 'UP:all:0'];
        yield 'max integer' => [['up', '--step=' . PHP_INT_MAX], 'UP:' . PHP_INT_MAX . ':0'];
    }

    #[DataProvider('validArguments')]
    public function testValidArgumentsPreserveDispatch(array $arguments, string $expected): void
    {
        [$exit, , $errors] = $this->request($arguments);
        $this->assertSame(0, $exit, $errors);
        $this->assertStringContainsString($expected, $errors);
    }

    public function testHelpNeedsNoDatabase(): void
    {
        [$exit, $output, $errors] = $this->request(['--help']);
        $this->assertSame(0, $exit);
        $this->assertStringContainsString('Usage:', $output);
        $this->assertStringContainsString('verify', $output);
        $this->assertStringContainsString('adopt-vessel-blueprints', $output);
        $this->assertStringContainsString('adopt-wars', $output);
        $this->assertStringNotContainsString('DB_CONNECT', $errors);
    }

    public function testStatusDispatchPreserved(): void
    {
        [$exit, $output] = $this->request(['status']);
        $this->assertSame(0, $exit);
        $this->assertStringContainsString('0 executed, 0 adopted, 0 pending', $output);
    }

    public function testVerifySummaryOnlyAfterSuccessfulVerification(): void
    {
        [$exit, $output, $errors] = $this->request(['verify']);
        $this->assertSame(0, $exit, $errors);
        $this->assertStringContainsString('Verified 64 migration(s)', $output);
        $this->assertStringContainsString('No changes made.', $output);
        $this->assertStringNotContainsString('UP:', $errors);
        $this->assertStringNotContainsString('ROLLBACK:', $errors);
    }

    #[DataProvider('failures')]
    public function testVerifyOperationalFailuresNeverPrintSuccess(string $mode): void
    {
        [$exit, $output, $errors] = $this->request(['verify'], $mode);
        $this->assertSame(1, $exit);
        $this->assertStringNotContainsString('Verified', $output);
        $this->assertStringNotContainsString('Fatal error', $errors);
        $this->assertStringContainsString(
            $mode === 'connection' ? 'Database connection failed:' : '[migrate] Failed:',
            $errors
        );
    }

    #[DataProvider('failures')]
    public function testEconomyAdoptionFailuresNeverPrintSuccess(string $mode): void
    {
        [$exit, $output, $errors] = $this->request(['adopt-economy'], $mode);
        $this->assertSame(1, $exit);
        $this->assertStringNotContainsString('Adopted', $output);
        $this->assertStringContainsString(
            $mode === 'connection' ? 'Database connection failed:' : '[migrate] Failed:',
            $errors
        );
    }

    #[DataProvider('failures')]
    public function testAuthAdoptionFailuresNeverPrintSuccess(string $mode): void
    {
        [$exit, $output, $errors] = $this->request(['adopt-auth'], $mode);
        $this->assertSame(1, $exit);
        $this->assertStringNotContainsString('Adopted', $output);
        $this->assertStringContainsString(
            $mode === 'connection' ? 'Database connection failed:' : '[migrate] Failed:',
            $errors
        );
    }

    public function testInvalidEnvironmentVariableFailsBeforeConnection(): void
    {
        [$exit, , $errors] = $this->request(['up'], environment: 'INVALID!');
        $this->assertSame(1, $exit);
        $this->assertStringNotContainsString('DB_CONNECT', $errors);
    }

    /** @return iterable<array{string}> */
    public static function failures(): iterable
    {
        foreach (['connection', 'constructor', 'lock', 'checksum', 'sql'] as $mode) {
            yield [$mode];
        }
    }

    #[DataProvider('failures')]
    public function testOperationalFailuresHaveControlledNonzeroExit(string $mode): void
    {
        [$exit, $output, $errors] = $this->request(['up'], $mode);
        $this->assertSame(1, $exit);
        $this->assertStringNotContainsString('Fatal error', $errors);
        $this->assertStringNotContainsString('Stack trace', $errors);
        $this->assertStringNotContainsString('up to date', $output);
        $this->assertStringContainsString(
            $mode === 'connection' ? 'Database connection failed:' : '[migrate] Failed:',
            $errors
        );
    }

    /** @return iterable<array{string, bool}> */
    public static function blockedRollbacks(): iterable
    {
        yield ['barrier', false];
        yield ['barrier', true];
        yield ['unknown_result', false];
    }

    #[DataProvider('blockedRollbacks')]
    public function testIncompleteRollbackCannotReturnSuccess(string $mode, bool $dryRun): void
    {
        $arguments = ['rollback', '--step=3'];
        if ($dryRun) {
            $arguments[] = '--dry-run';
        }
        [$exit, $output, $errors] = $this->request($arguments, $mode);
        $this->assertSame(1, $exit);
        $this->assertStringContainsString('[migrate] Failed:', $errors);
        $this->assertStringNotContainsString('Rolled back', $output);
        $this->assertStringNotContainsString('Would roll back', $output);
        $this->assertStringContainsString(
            $mode === 'barrier' ? 'Rollback blocked' : 'Unknown rollback result',
            $errors
        );
    }
}
