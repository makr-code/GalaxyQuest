<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/lib/UpdateManager.php';
require_once dirname(__DIR__, 2) . '/lib/GithubReleaseChecker.php';

final class UpdateMutationGuardTest extends TestCase
{
    public function testManagerRejectsInstallAndRollbackBeforeAccessingState(): void
    {
        $manager = (new ReflectionClass(UpdateManager::class))->newInstanceWithoutConstructor();
        foreach ([
            static fn () => $manager->installRelease('1.2.0', '/unused.tar.gz'),
            static fn () => $manager->installRelease('1.2.0', '/unused.tar.gz', true),
            static fn () => $manager->rollback(),
            static fn () => $manager->rollback('1.1.0'),
        ] as $operation) {
            try {
                $operation();
                self::fail('Disabled update operation did not fail.');
            } catch (LogicException $error) {
                self::assertSame(UpdateManager::MUTATION_UNAVAILABLE, $error->getMessage());
            }
        }
    }

    public static function disabledCommands(): iterable
    {
        yield 'install' => [['install', '1.2.0']];
        yield 'install preview' => [['install', '1.2.0', '--dry-run']];
        yield 'forced install' => [['--force', 'install', '1.2.0']];
        yield 'rollback' => [['rollback']];
        yield 'rollback preview' => [['rollback', '--dry-run']];
        yield 'forced rollback' => [['rollback', '1.1.0', '--force']];
    }

    #[DataProvider('disabledCommands')]
    public function testCliRejectsDisabledCommandsBeforeConfiguration(array $arguments): void
    {
        [$exitCode, $output, $errors] = $this->request($arguments);
        self::assertSame(1, $exitCode);
        self::assertSame('', $output);
        self::assertStringContainsString(UpdateManager::MUTATION_UNAVAILABLE, $errors);
        self::assertStringNotContainsString('CONFIG_LOADED', $errors);
    }

    public function testHelpExplainsDisabledOperationsWithoutConfiguration(): void
    {
        [$exitCode, $output, $errors] = $this->request(['--help']);
        self::assertSame(0, $exitCode);
        self::assertStringContainsString('Disabled: installation is not implemented', $output);
        self::assertStringContainsString('Disabled: restore is not implemented', $output);
        self::assertStringContainsString('Check the latest valid prerelease instead of stable', $output);
        self::assertStringNotContainsString('CONFIG_LOADED', $errors);
    }

    public function testPrereleaseCheckIsNotRejectedBeforeConfiguration(): void
    {
        [$exitCode, $output, $errors] = $this->request(['check', '--prerelease']);
        self::assertSame(9, $exitCode);
        self::assertSame('', $output);
        self::assertStringContainsString('CONFIG_LOADED', $errors);
    }

    public function testReleaseCheckRejectsUnimplementedNotificationsBeforeConfiguration(): void
    {
        [$exitCode, $output, $errors] = $this->requestReleaseCheck(['--notify', '--store-releases']);
        self::assertSame(1, $exitCode);
        self::assertSame('', $output);
        self::assertStringContainsString('Notifications are not implemented.', $errors);
        self::assertStringNotContainsString('CONFIG_LOADED', $errors);
    }

    public function testReleaseCheckLoadsSharedConfigurationWithoutRedeclaringItsHelper(): void
    {
        [$exitCode, , $errors] = $this->requestReleaseCheck([]);
        self::assertSame(1, $exitCode);
        self::assertStringContainsString('Database connection failed: fixture database unavailable', $errors);
        self::assertStringNotContainsString('Cannot redeclare', $errors);
    }

    /** @param list<string> $arguments
     *  @return array{int, string, string}
     */
    private function request(array $arguments): array
    {
        $root = sys_get_temp_dir() . '/gq-update-cli-' . bin2hex(random_bytes(8));
        foreach (['', '/bin', '/lib', '/config'] as $directory) {
            if (!mkdir($root . $directory)) {
                throw new RuntimeException('Cannot create update CLI fixture.');
            }
        }
        try {
            $repository = dirname(__DIR__, 2);
            if (!copy($repository . '/bin/update.php', $root . '/bin/update.php')
                || !copy($repository . '/lib/UpdateManager.php', $root . '/lib/UpdateManager.php')
                || !copy($repository . '/lib/GithubReleaseChecker.php', $root . '/lib/GithubReleaseChecker.php')
                || file_put_contents($root . '/config/config.php', '<?php fwrite(STDERR, "CONFIG_LOADED"); exit(9);') === false) {
                throw new RuntimeException('Cannot create update CLI fixture files.');
            }
            $process = proc_open(
                [PHP_BINARY, $root . '/bin/update.php', ...$arguments],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                $root,
                array_merge(getenv(), ['XDEBUG_MODE' => 'off'])
            );
            if ($process === false) {
                throw new RuntimeException('Cannot start update CLI fixture.');
            }
            fclose($pipes[0]);
            $output = stream_get_contents($pipes[1]);
            $errors = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            return [proc_close($process), (string)$output, (string)$errors];
        } finally {
            foreach (['/bin/update.php', '/lib/UpdateManager.php', '/lib/GithubReleaseChecker.php', '/config/config.php'] as $file) {
                if (is_file($root . $file)) {
                    unlink($root . $file);
                }
            }
            foreach (['/bin', '/lib', '/config', ''] as $directory) {
                rmdir($root . $directory);
            }
        }
    }

    /** @param list<string> $arguments
     *  @return array{int, string, string}
     */
    private function requestReleaseCheck(array $arguments): array
    {
        $root = sys_get_temp_dir() . '/gq-release-check-' . bin2hex(random_bytes(8));
        foreach (['', '/scripts', '/lib', '/config'] as $directory) {
            if (!mkdir($root . $directory)) {
                throw new RuntimeException('Cannot create release check fixture.');
            }
        }
        try {
            $repository = dirname(__DIR__, 2);
            $config = <<<'PHP'
<?php
fwrite(STDERR, 'CONFIG_LOADED');
function env_value(string $key, $default) { return $default; }
function get_db(): PDO { throw new RuntimeException('fixture database unavailable'); }
PHP;
            if (!copy($repository . '/scripts/check_github_releases.php', $root . '/scripts/check_github_releases.php')
                || file_put_contents($root . '/config/config.php', $config) === false
                || file_put_contents($root . '/lib/app_version.php', "<?php function gq_read_app_version(string \$root): string { return '1.2.3'; }") === false
                || file_put_contents($root . '/lib/GithubReleaseChecker.php', '<?php') === false) {
                throw new RuntimeException('Cannot create release check fixture files.');
            }
            $process = proc_open(
                [PHP_BINARY, $root . '/scripts/check_github_releases.php', ...$arguments],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                $root,
                array_merge(getenv(), ['XDEBUG_MODE' => 'off'])
            );
            if ($process === false) {
                throw new RuntimeException('Cannot start release check fixture.');
            }
            fclose($pipes[0]);
            $output = stream_get_contents($pipes[1]);
            $errors = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            return [proc_close($process), (string)$output, (string)$errors];
        } finally {
            foreach ([
                '/scripts/check_github_releases.php', '/lib/app_version.php',
                '/lib/GithubReleaseChecker.php', '/config/config.php',
            ] as $file) {
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
