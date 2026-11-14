<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

// phpcs:disable PSR1.Files.SideEffects.FoundWithSymbols -- Load the CLI-only diagnostic for pure evaluation.

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

use function GalaxyQuest\Deployment\inspectNativePhpRuntime;

require_once __DIR__ . '/../../deploy/preflight-native-php.php';

final class NativePhpHostPreflightTest extends TestCase
{
    private const EXTENSIONS = ['PDO', 'pdo_mysql', 'mysqli', 'curl', 'mbstring', 'gd', 'json', 'session', 'hash'];

    public function testCompleteCliRuntimePassesWithoutApprovingDeployment(): void
    {
        $report = inspectNativePhpRuntime('8.4.27', 'cli', self::EXTENSIONS, []);
        self::assertSame('passed', $report['status']);
        self::assertSame([], $report['errors']);
        self::assertSame('not-deployable', $report['candidate_status']);
        self::assertContains('php-fpm', $report['does_not_verify']);
        self::assertContains('opcache', $report['does_not_verify']);
        self::assertContains('deployment-approval', $report['does_not_verify']);
        self::assertFalse($report['activated']);
    }

    public function testEveryRequiredExtensionFailsIndividuallyWhenMissing(): void
    {
        foreach (self::EXTENSIONS as $extension) {
            $loaded = array_values(array_diff(self::EXTENSIONS, [$extension]));
            $report = inspectNativePhpRuntime('8.4.27', 'cli', $loaded, []);
            self::assertSame('failed', $report['status']);
            self::assertSame(['missing-extension:' . strtolower($extension)], $report['errors']);
            self::assertFalse($report['extensions'][strtolower($extension)]);
        }
    }

    #[DataProvider('unsupportedVersions')]
    public function testUntestedPhpLinesFailClosed(string $version): void
    {
        $report = inspectNativePhpRuntime($version, 'cli', self::EXTENSIONS, []);
        self::assertSame('failed', $report['status']);
        self::assertSame(['php-8.4-required'], $report['errors']);
    }

    public static function unsupportedVersions(): array
    {
        return [['8.2.30'], ['8.3.29'], ['8.5.0'], ['9.4.0'], ['8.40.1'], ['8.4.0RC1']];
    }

    #[DataProvider('nonCliSapis')]
    public function testNonCliRuntimeIsRejected(string $sapi): void
    {
        $report = inspectNativePhpRuntime('8.4.27', $sapi, self::EXTENSIONS, []);
        self::assertSame('failed', $report['status']);
        self::assertSame(['cli-required'], $report['errors']);
    }

    public static function nonCliSapis(): array
    {
        return [['fpm-fcgi'], ['cgi-fcgi'], ['apache2handler'], ['cli-server'], ['phpdbg']];
    }

    #[DataProvider('abusiveArguments')]
    public function testArgumentsAreRejectedWithoutEchoingTheirContents(array $arguments): void
    {
        $report = inspectNativePhpRuntime('8.4.27', 'cli', self::EXTENSIONS, $arguments);
        self::assertSame('failed', $report['status']);
        self::assertSame(['arguments-not-allowed'], $report['errors']);
        foreach ($arguments as $argument) {
            self::assertStringNotContainsString($argument, json_encode($report, JSON_THROW_ON_ERROR));
        }
    }

    public static function abusiveArguments(): array
    {
        return [
            [['--php=/sensitive/operator/path']],
            [['--help']],
            [['--', '$(touch injected-marker)']],
            [['https://example.invalid/secret-token']],
            [['-r', 'phpinfo();']],
        ];
    }

    public function testActualCliProcessReportsOnlyTheRequiredRuntimeSnapshot(): void
    {
        $result = $this->runCli([]);
        self::assertSame('', $result['stderr']);
        $report = json_decode($result['stdout'], true, flags: JSON_THROW_ON_ERROR);
        self::assertSame(PHP_VERSION, $report['php_version']);
        self::assertSame('cli', $report['sapi']);
        self::assertSame($report['status'] === 'passed' ? 0 : 1, $result['exit']);
        self::assertSame('not-deployable', $report['candidate_status']);
        self::assertSame(
            array_keys(inspectNativePhpRuntime('8.4.27', 'cli', self::EXTENSIONS, [])['extensions']),
            array_keys($report['extensions'])
        );
        self::assertStringNotContainsString(__DIR__, $result['stdout']);
    }

    public function testActualCliRejectsArgumentsAndDisabledExtensionsWithNonzeroExit(): void
    {
        $result = $this->runCli(['--php=/sensitive/operator/path', '$(touch injected-marker)']);
        self::assertSame(1, $result['exit']);
        $report = json_decode($result['stdout'], true, flags: JSON_THROW_ON_ERROR);
        self::assertContains('arguments-not-allowed', $report['errors']);
        self::assertStringNotContainsString('sensitive', $result['stdout']);
        self::assertStringNotContainsString('injected-marker', $result['stdout']);

        $result = $this->runCli([], ['-n']);
        self::assertSame(1, $result['exit']);
        $report = json_decode($result['stdout'], true, flags: JSON_THROW_ON_ERROR);
        self::assertContains('missing-extension:pdo_mysql', $report['errors']);
    }

    /** @return array{stdout: string, stderr: string, exit: int} */
    private function runCli(array $arguments, array $phpOptions = []): array
    {
        $process = proc_open(
            [PHP_BINARY, ...$phpOptions, __DIR__ . '/../../deploy/preflight-native-php.php', ...$arguments],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes
        );
        self::assertIsResource($process);
        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        return ['stdout' => $stdout, 'stderr' => $stderr, 'exit' => proc_close($process)];
    }
}
