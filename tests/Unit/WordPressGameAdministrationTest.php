<?php

declare(strict_types=1);

/* phpcs:disable PSR1.Files.SideEffects.FoundWithSymbols, PSR1.Classes.ClassDeclaration -- Global WordPress test stubs. */

use PHPUnit\Framework\TestCase;

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}
if (!function_exists('add_action')) {
    function add_action(string $hook, callable $callback, int $priority = 10, int $acceptedArgs = 1): void
    {
    }
}
if (!function_exists('__')) {
    function __(string $text, ?string $domain = null): string
    {
        return $text;
    }
}
if (!function_exists('esc_html')) {
    function esc_html(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
if (!function_exists('esc_html__')) {
    function esc_html__(string $text, ?string $domain = null): string
    {
        return esc_html($text);
    }
}
if (!function_exists('current_user_can')) {
    function current_user_can(string $capability): bool
    {
        return $GLOBALS['gq_game_admin_test_can_manage'] ?? false;
    }
}
if (!function_exists('wp_die')) {
    function wp_die(string $message, string $title = '', array $options = []): never
    {
        throw new RuntimeException($message);
    }
}

require_once dirname(__DIR__, 2) . '/wordpress-integration/gq-game-admin.php';

final class WordPressGameAdministrationTest extends TestCase
{
    private string $root;
    private int $now;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir() . '/gq-game-admin-test-' . bin2hex(random_bytes(8));
        self::assertTrue(mkdir($this->root, 0700));
        $this->now = time();
        $GLOBALS['gq_game_admin_test_can_manage'] = true;
    }

    protected function tearDown(): void
    {
        if (is_file($this->root . '/report.json')) {
            unlink($this->root . '/report.json');
        }
        rmdir($this->root);
    }

    public function testAcceptsFreshEnvironmentAndDatabaseBoundReadOnlyReport(): void
    {
        $report = $this->report();
        file_put_contents($this->root . '/report.json', json_encode($report, JSON_THROW_ON_ERROR));
        self::assertSame($report, gq_game_admin_read_report(
            $this->root . '/report.json',
            'staging',
            'gq_staging',
            $this->now
        ));
    }

    public function testRejectsWrongEnvironmentDatabaseAndMutatingReport(): void
    {
        $report = $this->report();
        self::assertArrayHasKey('error', gq_game_admin_validate_report(
            $report,
            'production',
            'gq_staging',
            $this->now
        ));
        self::assertArrayHasKey('error', gq_game_admin_validate_report(
            $report,
            'staging',
            'gq_production',
            $this->now
        ));
        $report['read_only'] = false;
        self::assertArrayHasKey('error', gq_game_admin_validate_report($report, 'staging', 'gq_staging', $this->now));
    }

    public function testRejectsExpiredAndFutureReports(): void
    {
        foreach ([-901, 61] as $delta) {
            $report = $this->report();
            $report['generated_at'] = $this->now + $delta;
            self::assertArrayHasKey('error', gq_game_admin_validate_report(
                $report,
                'staging',
                'gq_staging',
                $this->now
            ));
        }
    }

    public function testRejectsTamperedPlanAndDuplicateMigrationIdentity(): void
    {
        $report = $this->report();
        $report['plan']['release']['commit'] = str_repeat('f', 40);
        self::assertArrayHasKey('error', gq_game_admin_validate_report(
            $report,
            'staging',
            'gq_staging',
            $this->now
        ));
        $report = $this->report();
        $report['plan']['migrations']['entries'][] = $report['plan']['migrations']['entries'][0];
        $report = $this->withDigest($report);
        self::assertArrayHasKey('error', gq_game_admin_validate_report(
            $report,
            'staging',
            'gq_staging',
            $this->now
        ));
    }

    public function testMissingHistoryCannotClaimAppliedMigrationsOrTrackedSchema(): void
    {
        $report = $this->report();
        $report['plan']['migrations']['tracking_present'] = false;
        $report = $this->withDigest($report);
        self::assertArrayHasKey('error', gq_game_admin_validate_report(
            $report,
            'staging',
            'gq_staging',
            $this->now
        ));
        $report['plan']['database']['state'] = 'untracked';
        $report['plan']['migrations']['entries'][0]['status'] = 'executed';
        self::assertArrayHasKey('error', gq_game_admin_validate_report(
            $this->withDigest($report),
            'staging',
            'gq_staging',
            $this->now
        ));
    }

    public function testRejectsMissingRemoteMalformedAndOversizedReports(): void
    {
        foreach ([$this->root . '/missing.json', 'https://example.test/report.json'] as $file) {
            self::assertArrayHasKey('error', gq_game_admin_read_report(
                $file,
                'staging',
                'gq_staging',
                $this->now
            ));
        }
        foreach (['{invalid', str_repeat(' ', 2097153)] as $body) {
            file_put_contents($this->root . '/report.json', $body);
            self::assertArrayHasKey('error', gq_game_admin_read_report(
                $this->root . '/report.json',
                'staging',
                'gq_staging',
                $this->now
            ));
        }
    }

    public function testRendersEscapedInventoryAndNeverClaimsReadiness(): void
    {
        $report = $this->report();
        $report['plan']['database']['server_version'] = '<script>alert(1)</script>';
        $report = $this->withDigest($report);
        ob_start();
        gq_game_admin_render_environment('Staging', $report);
        $html = ob_get_clean();
        self::assertIsString($html);
        self::assertStringContainsString('&lt;script&gt;', $html);
        self::assertStringNotContainsString('<script>', $html);
        self::assertStringContainsString('first.sql', $html);
        self::assertStringContainsString('not a readiness or deployment approval', $html);
    }

    public function testStandalonePageShowsBothEnvironmentsAndNoEnabledMutationControls(): void
    {
        ob_start();
        gq_game_admin_render_page();
        $html = ob_get_clean();
        self::assertIsString($html);
        self::assertStringContainsString('Staging', $html);
        self::assertStringContainsString('Production', $html);
        self::assertSame(5, substr_count($html, ' disabled'));
        self::assertStringNotContainsString('<form', $html);
        self::assertStringContainsString('No database connection is made by this plugin', $html);
    }

    public function testRejectsUnauthorizedPageBeforeReadingReports(): void
    {
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_render_page();
    }

    private function report(): array
    {
        return $this->withDigest([
            'schema_version' => 1, 'read_only' => true, 'generated_at' => $this->now,
            'plan' => [
                'environment' => 'staging',
                'database' => [
                    'name' => 'gq_staging', 'server_version' => '11.8-MariaDB',
                    'table_count' => 1, 'state' => 'tracked',
                ],
                'release' => [
                    'commit' => str_repeat('a', 40), 'version' => '1.2.3', 'status' => 'not-deployable',
                    'manifest_sha256' => str_repeat('b', 64), 'baseline_sha256' => str_repeat('c', 64),
                ],
                'migrations' => [
                    'tracking_present' => true, 'blockers' => [],
                    'entries' => [['name' => 'first.sql', 'status' => 'pending', 'sha256' => str_repeat('d', 64)]],
                ],
            ],
        ]);
    }

    private function withDigest(array $report): array
    {
        $report['plan_sha256'] = hash(
            'sha256',
            json_encode($report['plan'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)
        );
        return $report;
    }
}
