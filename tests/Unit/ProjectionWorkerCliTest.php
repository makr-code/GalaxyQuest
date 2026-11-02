<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/lib/projection_runtime.php';

final class ProjectionWorkerCliTest extends TestCase
{
    public static function invalidArguments(): iterable
    {
        foreach (['batch', 'max-seconds', 'max-items'] as $key) {
            $maximum = (string)PHP_INT_MAX;
            $overflow = substr($maximum, 0, -1) . ((int)substr($maximum, -1) + 1);
            yield $key . ' exact overflow' => [['--' . $key . '=' . $overflow]];
            foreach (['', '-1', '+1', '1.5', '1e2', ' 2', '2 ', "2\n", '99999999999999999999999'] as $value) {
                yield $key . ':' . json_encode($value) => [['--' . $key . '=' . $value]];
            }
            yield $key . ' missing value' => [['--' . $key]];
            yield $key . ' separated value' => [['--' . $key, '2']];
            yield $key . ' duplicate' => [['--' . $key . '=1', '--' . $key . '=2']];
        }
        yield 'batch zero' => [['--batch=0']];
        yield 'unknown' => [['--unknown']];
        yield 'typo dry run' => [['--dryrun']];
        yield 'valued dry run' => [['--dry-run=1']];
        yield 'duplicate dry run' => [['--dry-run', '--dry-run']];
        yield 'positional' => [['run']];
        yield 'end separator' => [['--']];
        yield 'mixed help' => [['--help', '--dry-run']];
        yield 'duplicate help' => [['--help', '--help']];
    }

    #[DataProvider('invalidArguments')]
    public function testInvalidArgumentsAreRejected(array $arguments): void
    {
        $this->expectException(InvalidArgumentException::class);
        parse_worker_args(['worker', ...$arguments]);
    }

    public function testExactBoundariesAndLeadingZerosAreAccepted(): void
    {
        $this->assertSame([
            'batch' => PHP_INT_MAX, 'max-seconds' => PHP_INT_MAX, 'max-items' => 0, 'dry-run' => true,
        ], parse_worker_args([
            'worker', '--batch=' . PHP_INT_MAX, '--max-seconds=' . PHP_INT_MAX,
            '--max-items=000', '--dry-run',
        ]));
        $this->assertSame(1, parse_worker_args(['worker', '--batch=0001'])['batch']);
        $this->assertSame(200, parse_worker_args(['worker'], 200)['batch']);
    }

    public function testInvalidConfiguredBatchFailsExplicitly(): void
    {
        $this->expectException(InvalidArgumentException::class);
        parse_worker_args(['worker'], 0);
    }

    public function testNegativeConfiguredBatchFailsExplicitly(): void
    {
        $this->expectException(InvalidArgumentException::class);
        parse_worker_args(['worker'], -1);
    }

    #[DataProvider('invalidArguments')]
    public function testActualWorkersRejectArgumentsBeforeConfiguration(array $arguments): void
    {
        foreach (['project_user_overview', 'project_system_snapshots'] as $worker) {
            [$exit, $output, $errors] = $this->request($worker, $arguments);
            $this->assertSame(1, $exit, $errors);
            $this->assertSame('', $output);
            $this->assertStringContainsString('FATAL:', $errors);
            $this->assertStringNotContainsString('CONFIG_LOADED', $errors);
            $this->assertStringNotContainsString('start ', $errors);
            $this->assertStringNotContainsString('finish ', $errors);
            $this->assertStringNotContainsString('Uncaught', $errors);
        }
    }

    public function testActualWorkerHelpRequiresNoConfiguration(): void
    {
        foreach (['project_user_overview', 'project_system_snapshots'] as $worker) {
            [$exit, $output, $errors] = $this->request($worker, ['--help']);
            $this->assertSame(0, $exit, $errors);
            $this->assertStringContainsString('Usage:', $output);
            $this->assertStringContainsString('--dry-run', $output);
            $this->assertStringNotContainsString('CONFIG_LOADED', $errors);
        }
    }

    public function testValidArgumentsReachConfiguration(): void
    {
        foreach (['project_user_overview', 'project_system_snapshots'] as $worker) {
            [$exit, , $errors] = $this->request($worker, ['--batch=0005', '--max-items=0', '--dry-run']);
            $this->assertSame(9, $exit, $errors);
            $this->assertStringContainsString('CONFIG_LOADED', $errors);
        }
    }

    /** @return array{int, string, string} */
    private function request(string $worker, array $arguments): array
    {
        $root = sys_get_temp_dir() . '/gq-projector-cli-' . bin2hex(random_bytes(8));
        foreach (['', '/scripts', '/lib', '/config'] as $directory) {
            if (!mkdir($root . $directory)) {
                throw new RuntimeException('Cannot create projector CLI fixture.');
            }
        }
        try {
            $repo = dirname(__DIR__, 2);
            copy($repo . '/scripts/' . $worker . '.php', $root . '/scripts/' . $worker . '.php');
            copy($repo . '/lib/projection_runtime.php', $root . '/lib/projection_runtime.php');
            file_put_contents($root . '/config/config.php', '<?php fwrite(STDERR, "CONFIG_LOADED\n"); exit(9);');
            $process = proc_open(
                [PHP_BINARY, $root . '/scripts/' . $worker . '.php', ...$arguments],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                $root,
                array_merge(getenv(), ['XDEBUG_MODE' => 'off'])
            );
            if ($process === false) {
                throw new RuntimeException('Cannot start projector CLI fixture.');
            }
            fclose($pipes[0]);
            $output = stream_get_contents($pipes[1]);
            $errors = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            return [proc_close($process), (string)$output, (string)$errors];
        } finally {
            foreach (['/scripts', '/lib', '/config', ''] as $directory) {
                foreach (new DirectoryIterator($root . $directory) as $entry) {
                    if ($entry->isFile()) {
                        unlink($entry->getPathname());
                    }
                }
                rmdir($root . $directory);
            }
        }
    }
}
