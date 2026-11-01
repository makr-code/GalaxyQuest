<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

use function GalaxyQuest\Quality\PhpStyle\collectFindings;
use function GalaxyQuest\Quality\PhpStyle\compareFindings;
use function GalaxyQuest\Quality\PhpStyle\loadBaseline;
use function GalaxyQuest\Quality\PhpStyle\runPhpcs;

final class PhpStyleGateTest extends TestCase
{
    private string $directory;
    private string $source;

    public static function setUpBeforeClass(): void
    {
        require_once dirname(__DIR__, 2) . '/scripts/check_phpcs.php';
    }

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir() . '/gq-php-style-' . bin2hex(random_bytes(8));
        foreach (['', '/api', '/vendor', '/vendor/bin', '/scripts'] as $suffix) {
            if (!mkdir($this->directory . $suffix)) {
                throw new RuntimeException('Cannot create PHPCS fixture directory.');
            }
        }
        $this->source = $this->directory . '/api/fixture.php';
        file_put_contents($this->source, "<?php\nbad line\n");
    }

    protected function tearDown(): void
    {
        foreach (['/vendor/bin', '/vendor', '/scripts', '/api', ''] as $suffix) {
            $directory = $this->directory . $suffix;
            foreach (new \DirectoryIterator($directory) as $entry) {
                if ($entry->isFile()) {
                    unlink($entry->getPathname());
                }
            }
            rmdir($directory);
        }
    }

    private function report(string $type = 'ERROR', int $line = 2): array
    {
        return [
            'totals' => ['errors' => $type === 'ERROR' ? 1 : 0, 'warnings' => $type === 'WARNING' ? 1 : 0],
            'files' => [$this->source => ['messages' => [[
                'source' => 'PSR12.Test.Rule',
                'message' => 'Existing violation',
                'type' => $type,
                'line' => $line,
                'column' => 1,
            ]]]],
        ];
    }

    public function testUnchangedFindingsPassAndSourceIsNotCopiedToBaseline(): void
    {
        $findings = collectFindings($this->report(), $this->directory);
        $this->assertSame([], compareFindings($findings, $findings));
        $this->assertStringNotContainsString('bad line', json_encode($findings, JSON_THROW_ON_ERROR));
        $this->assertSame(hash('sha256', 'bad line'), array_values($findings)[0]['lineHash']);
    }

    public function testLineShiftsAndCrLfDoNotInvalidateFindings(): void
    {
        $baseline = collectFindings($this->report(), $this->directory);
        file_put_contents($this->source, "<?php\r\n\r\nbad line\r\n");
        $actual = collectFindings($this->report(line: 3), $this->directory);
        $this->assertSame([], compareFindings($actual, $baseline));
    }

    public function testChangedSourceLineCannotReuseExistingException(): void
    {
        $baseline = collectFindings($this->report(), $this->directory);
        file_put_contents($this->source, "<?php\nworse line\n");
        $differences = compareFindings(collectFindings($this->report(), $this->directory), $baseline);
        $this->assertCount(2, $differences);
        $this->assertStringStartsWith('NEW:', $differences[0]);
        $this->assertStringStartsWith('STALE:', $differences[1]);
    }

    public function testDuplicateOccurrenceCountsAndResolvedFindingsAreEnforced(): void
    {
        $baseline = collectFindings($this->report(), $this->directory);
        $report = $this->report();
        $report['files'][$this->source]['messages'][] = $report['files'][$this->source]['messages'][0];
        $report['totals']['errors'] = 2;
        $this->assertStringContainsString(
            'current 2, baseline 1',
            compareFindings(collectFindings($report, $this->directory), $baseline)[0]
        );
        $this->assertStringStartsWith('STALE:', compareFindings([], $baseline)[0]);
    }

    public function testWarningsAreBlockingAndRenamesDoNotReuseOtherFileExceptions(): void
    {
        $warnings = collectFindings($this->report('WARNING'), $this->directory);
        $this->assertStringStartsWith('NEW:', compareFindings($warnings, [])[0]);
        $baseline = collectFindings($this->report(), $this->directory);
        $renamed = $this->directory . '/api/renamed.php';
        copy($this->source, $renamed);
        $report = $this->report();
        $report['files'] = [$renamed => $report['files'][$this->source]];
        $this->assertCount(2, compareFindings(collectFindings($report, $this->directory), $baseline));
    }

    /** @return iterable<array{string}> */
    public static function invalidReports(): iterable
    {
        foreach (['empty', 'totals', 'type', 'line', 'column', 'internal', 'outside'] as $case) {
            yield $case => [$case];
        }
    }

    #[DataProvider('invalidReports')]
    public function testMalformedReportsAndInternalErrorsFailClosed(string $case): void
    {
        $report = $this->report();
        $message = &$report['files'][$this->source]['messages'][0];
        switch ($case) {
            case 'empty':
                $report['files'] = [];
                break;
            case 'totals':
                $report['totals']['errors'] = 0;
                break;
            case 'type':
                $message['type'] = 'NOTICE';
                break;
            case 'line':
                $message['line'] = 0;
                break;
            case 'column':
                $message['column'] = null;
                break;
            case 'internal':
                $message['source'] = 'Internal.Exception';
                break;
            case 'outside':
                $report['files'] = ['/outside.php' => $report['files'][$this->source]];
                break;
        }
        $this->expectException(RuntimeException::class);
        collectFindings($report, $this->directory);
    }

    public function testBaselineRoundTripAndTampering(): void
    {
        $findings = collectFindings($this->report(), $this->directory);
        $baseline = ['version' => 1, 'standard' => 'PSR12', 'findings' => $findings];
        $path = $this->directory . '/baseline.json';
        file_put_contents($path, json_encode($baseline, JSON_THROW_ON_ERROR));
        $this->assertSame($findings, loadBaseline($path));
        $baseline['findings'][array_key_first($findings)]['column'] = 99;
        file_put_contents($path, json_encode($baseline, JSON_THROW_ON_ERROR));
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('fingerprint mismatch');
        loadBaseline($path);
    }

    public function testToolFailureCannotBecomeBaselineSuccess(): void
    {
        file_put_contents(
            $this->directory . '/vendor/bin/phpcs',
            '<?php fwrite(STDERR, "fixture tool failure\n"); exit(16);'
        );
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('exit code 16');
        runPhpcs($this->directory);
    }

    public function testRealPhpcsCliRejectsNewAndStaleFindings(): void
    {
        $root = dirname(__DIR__, 2);
        copy($root . '/scripts/check_phpcs.php', $this->directory . '/scripts/check_phpcs.php');
        file_put_contents(
            $this->directory . '/vendor/bin/phpcs',
            '<?php require ' . var_export($root . '/vendor/bin/phpcs', true) . ';'
        );
        file_put_contents(
            $this->directory . '/phpcs.xml',
            '<?xml version="1.0"?><ruleset name="Fixture"><rule ref="PSR12"/><file>api</file></ruleset>'
        );
        file_put_contents($this->source, "<?php\n\$legacy=1;\n");
        $this->assertSame(0, $this->cli(['--write-baseline'])[0]);
        $this->assertSame(0, $this->cli([])[0]);
        file_put_contents($this->source, "<?php\n\$legacy=1;\n\$new=2;\n");
        [$exit, $errors] = $this->cli([]);
        $this->assertSame(1, $exit);
        $this->assertStringContainsString('NEW:', $errors);
        file_put_contents($this->source, "<?php\n\$legacy=1;\n// phpcs:ignore\n\$new=2;\n");
        [$exit, $errors] = $this->cli([]);
        $this->assertSame(1, $exit);
        $this->assertStringContainsString('NEW:', $errors);
        file_put_contents($this->source, "<?php\n\n\$legacy = 1;\n");
        [$exit, $errors] = $this->cli([]);
        $this->assertSame(1, $exit);
        $this->assertStringContainsString('STALE:', $errors);
    }

    /** @return iterable<array{string}> */
    public static function invalidBaselines(): iterable
    {
        foreach (['version', 'standard', 'missing', 'count', 'lineHash', 'extra'] as $case) {
            yield $case => [$case];
        }
    }

    #[DataProvider('invalidBaselines')]
    public function testMalformedBaselinesFailClosed(string $case): void
    {
        $findings = collectFindings($this->report(), $this->directory);
        $baseline = ['version' => 1, 'standard' => 'PSR12', 'findings' => $findings];
        $entry = &$baseline['findings'][array_key_first($findings)];
        switch ($case) {
            case 'version':
                $baseline['version'] = 2;
                break;
            case 'standard':
                $baseline['standard'] = 'PSR2';
                break;
            case 'missing':
                unset($baseline['findings']);
                break;
            case 'count':
                $entry['count'] = 0;
                break;
            case 'lineHash':
                $entry['lineHash'] = 'not a hash';
                break;
            case 'extra':
                $entry['extra'] = true;
                break;
        }
        $path = $this->directory . '/baseline.json';
        file_put_contents($path, json_encode($baseline, JSON_THROW_ON_ERROR));
        $this->expectException(RuntimeException::class);
        loadBaseline($path);
    }

    public function testMalformedJsonFromSuccessfulToolStillFails(): void
    {
        file_put_contents($this->directory . '/vendor/bin/phpcs', '<?php echo "{broken";');
        $this->expectException(\JsonException::class);
        runPhpcs($this->directory);
    }

    /** @return array{int, string} */
    private function cli(array $arguments): array
    {
        $errors = tmpfile();
        if ($errors === false) {
            throw new RuntimeException('Cannot create CLI diagnostic stream.');
        }
        try {
            $process = proc_open(
                [PHP_BINARY, $this->directory . '/scripts/check_phpcs.php', ...$arguments],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => $errors],
                $pipes
            );
            if ($process === false) {
                throw new RuntimeException('Cannot start PHPCS gate fixture.');
            }
            fclose($pipes[0]);
            stream_get_contents($pipes[1]);
            fclose($pipes[1]);
            $exit = proc_close($process);
            rewind($errors);
            return [$exit, (string)stream_get_contents($errors)];
        } finally {
            fclose($errors);
        }
    }
}
