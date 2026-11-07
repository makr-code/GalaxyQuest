<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/simulation_tick_cli.php';

final class SimulationTickCliTest extends TestCase
{
    public static function invalidArguments(): iterable
    {
        yield 'invalid scope does not become global' => [['--scope=typo']];
        yield 'scope casing is not normalized' => [['--scope=Global']];
        yield 'duplicate scope' => [['--scope=user', '--scope=global', '--user=1']];
        yield 'missing user ID' => [['--scope=user']];
        yield 'user ID with global scope' => [['--user=1']];
        yield 'duplicate user ID' => [['--scope=user', '--user=1', '--user=2']];
        yield 'zero user ID' => [['--scope=user', '--user=0']];
        yield 'negative user ID' => [['--scope=user', '--user=-1']];
        yield 'non-decimal user ID' => [['--scope=user', '--user=1.5']];
        yield 'overflowing user ID' => [['--scope=user', '--user=' . self::integerOverflowValue()]];
        yield 'duplicate force' => [['--force', '--force']];
        yield 'unknown option' => [['--unknown']];
        yield 'positional argument' => [['global']];
        yield 'help mixed with options' => [['--help', '--force']];
        yield 'duplicate help' => [['--help', '--help']];
    }

    /** @param array<int, string> $arguments */
    #[DataProvider('invalidArguments')]
    public function testInvalidArgumentsAreRejected(array $arguments): void
    {
        $this->expectException(InvalidArgumentException::class);
        parse_simulation_tick_args($arguments);
    }

    public function testValidOptionsAndIntegerBoundaries(): void
    {
        self::assertSame(
            ['scope' => 'global', 'user_id' => 0, 'force' => false, 'help' => false],
            parse_simulation_tick_args([])
        );
        self::assertSame(
            ['scope' => 'user', 'user_id' => 123, 'force' => true, 'help' => false],
            parse_simulation_tick_args(['--scope=user', '--user=00123', '--force'])
        );
        self::assertSame(
            ['scope' => 'user', 'user_id' => PHP_INT_MAX, 'force' => false, 'help' => false],
            parse_simulation_tick_args(['--scope=user', '--user=' . PHP_INT_MAX])
        );
        self::assertTrue(parse_simulation_tick_args(['--help'])['help']);
    }

    /** @param array<int, string> $arguments */
    #[DataProvider('invalidArguments')]
    public function testActualRunnerRejectsInvalidArgumentsBeforeLoadingConfiguration(array $arguments): void
    {
        [$exitCode, $stdout, $stderr] = $this->runCli($arguments);

        self::assertSame(1, $exitCode);
        self::assertSame('', $stdout);
        self::assertStringContainsString('invalid arguments:', $stderr);
        self::assertStringContainsString('Usage:', $stderr);
        self::assertStringNotContainsString('CONFIG_LOADED', $stderr);
        self::assertStringNotContainsString('Uncaught', $stderr);
    }

    public function testActualRunnerHelpDoesNotLoadConfiguration(): void
    {
        [$exitCode, $stdout, $stderr] = $this->runCli(['--help']);

        self::assertSame(0, $exitCode);
        self::assertStringContainsString('--scope=global|user', $stdout);
        self::assertSame('', $stderr);
    }

    public function testValidOptionsReachConfiguration(): void
    {
        [$exitCode, , $stderr] = $this->runCli(['--scope=user', '--user=1', '--force']);

        self::assertSame(9, $exitCode);
        self::assertStringContainsString('CONFIG_LOADED', $stderr);
    }

    private static function integerOverflowValue(): string
    {
        return (string) PHP_INT_MAX . '0';
    }

    /**
     * @param list<string> $arguments
     * @return array{int, string, string}
     */
    private function runCli(array $arguments): array
    {
        $root = sys_get_temp_dir() . '/gq-simulation-cli-' . bin2hex(random_bytes(8));
        foreach (['', '/scripts', '/lib', '/config'] as $directory) {
            if (!mkdir($root . $directory)) {
                throw new RuntimeException('Cannot create simulation CLI fixture.');
            }
        }
        try {
            $repo = dirname(__DIR__, 2);
            if (
                !copy($repo . '/scripts/run_simulation_tick.php', $root . '/scripts/run_simulation_tick.php')
                || !copy($repo . '/lib/simulation_tick_cli.php', $root . '/lib/simulation_tick_cli.php')
                || file_put_contents(
                    $root . '/config/config.php',
                    '<?php fwrite(STDERR, "CONFIG_LOADED\n"); exit(9);'
                ) === false
            ) {
                throw new RuntimeException('Cannot prepare simulation CLI fixture.');
            }
            $process = proc_open(
                [PHP_BINARY, '-n', $root . '/scripts/run_simulation_tick.php', ...$arguments],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                $root,
                array_merge(getenv(), ['XDEBUG_MODE' => 'off'])
            );
            if ($process === false) {
                throw new RuntimeException('Unable to start simulation tick CLI.');
            }

            fclose($pipes[0]);
            $stdout = stream_get_contents($pipes[1]);
            $stderr = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);

            return [proc_close($process), (string) $stdout, (string) $stderr];
        } finally {
            foreach (['/scripts/run_simulation_tick.php', '/lib/simulation_tick_cli.php', '/config/config.php'] as $file) {
                if (is_file($root . $file)) {
                    unlink($root . $file);
                }
            }
            foreach (['/scripts', '/lib', '/config', ''] as $directory) {
                rmdir($root . $directory);
            }
        }
    }
}
