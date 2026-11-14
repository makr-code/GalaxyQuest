<?php

declare(strict_types=1);

/* phpcs:disable PSR1.Files.SideEffects.FoundWithSymbols, PSR1.Classes.ClassDeclaration -- Global WordPress test stubs. */

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}
if (!function_exists('add_action')) {
    function add_action(string $hook, callable $callback, int $priority = 10, int $acceptedArgs = 1): void
    {
        $GLOBALS['gq_wp_hooks'][$hook] = [$callback, $priority, $acceptedArgs];
        $GLOBALS['gq_wp_hook_callbacks'][$hook][] = [$callback, $priority, $acceptedArgs];
    }
}
if (!function_exists('add_filter')) {
    function add_filter(string $hook, callable $callback, int $priority = 10, int $acceptedArgs = 1): void
    {
        $GLOBALS['gq_wp_hooks'][$hook] = [$callback, $priority, $acceptedArgs];
        $GLOBALS['gq_wp_hook_callbacks'][$hook][] = [$callback, $priority, $acceptedArgs];
    }
}
if (!function_exists('admin_url')) {
    function admin_url(string $path): string
    {
        return ($GLOBALS['gq_game_admin_test_admin_base'] ?? 'https://wordpress.test/wp-admin/') . $path;
    }
}
if (!function_exists('esc_url')) {
    function esc_url(string $url): string
    {
        return htmlspecialchars($url, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
if (!function_exists('esc_attr')) {
    function esc_attr(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
if (!function_exists('get_current_user_id')) {
    function get_current_user_id(): int
    {
        return 42;
    }
}
if (!function_exists('get_option')) {
    function get_option(string $name, mixed $default = false): mixed
    {
        $GLOBALS['gq_game_admin_test_option_reads'][] = $name;
        return $GLOBALS['gq_game_admin_test_options'][$name] ?? $default;
    }

    function update_option(string $name, mixed $value, bool $autoload = false): bool
    {
        $GLOBALS['gq_game_admin_test_options'][$name] = $value;
        return true;
    }
}
if (!function_exists('get_transient')) {
    function get_transient(string $name): mixed
    {
        $GLOBALS['gq_game_admin_test_transient_reads'][] = $name;
        return $GLOBALS['gq_wp_transients'][$name] ?? false;
    }

    function set_transient(string $name, mixed $value, int $ttl): bool
    {
        $GLOBALS['gq_wp_transients'][$name] = $value;
        $GLOBALS['gq_wp_ttls'][$name] = $ttl;
        return true;
    }

    function delete_transient(string $name): bool
    {
        unset($GLOBALS['gq_wp_transients'][$name]);
        return true;
    }
}
if (!function_exists('wp_unslash')) {
    function wp_unslash(string $value): string
    {
        return stripslashes($value);
    }
}
if (!function_exists('wp_safe_redirect')) {
    function wp_safe_redirect(string $url): bool
    {
        throw new RuntimeException('Redirect: ' . $url);
    }
}
if (!function_exists('wp_verify_nonce')) {
    function wp_verify_nonce(string $nonce, string $action): int|false
    {
        return $nonce === 'fixture-' . $action ? 1 : false;
    }

    function wp_nonce_field(string $action, string $name = '_wpnonce'): void
    {
        echo '<input type="hidden" name="' . esc_attr($name) . '" value="' . esc_attr('fixture-' . $action) . '">';
    }
}
if (!function_exists('is_ssl')) {
    function is_ssl(): bool
    {
        return $GLOBALS['gq_game_admin_test_ssl'] ?? true;
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
    private array $query;
    private array $server;

    protected function setUp(): void
    {
        $this->query = $_GET;
        $this->server = $_SERVER;
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_GET = [];
        $privateRoot = getenv('GQ_GAME_ADMIN_TEST_PRIVATE_ROOT') ?: sys_get_temp_dir();
        $this->root = $privateRoot . '/gq-game-admin-test-' . bin2hex(random_bytes(8));
        self::assertTrue(mkdir($this->root, 0700));
        $this->now = time();
        $GLOBALS['gq_game_admin_test_can_manage'] = true;
        $GLOBALS['gq_game_admin_test_options'] = [];
        $GLOBALS['gq_game_admin_test_option_reads'] = [];
        $GLOBALS['gq_game_admin_test_transient_reads'] = [];
        $GLOBALS['gq_wp_transients'] = [];
        $GLOBALS['gq_game_admin_test_ssl'] = true;
        unset($GLOBALS['gq_game_admin_test_admin_base']);
    }

    protected function tearDown(): void
    {
        $_GET = $this->query;
        $_SERVER = $this->server;
        if (is_file($this->root . '/report.json')) {
            unlink($this->root . '/report.json');
        }
        foreach (['staging.json', 'production.json'] as $name) {
            if (is_link($this->root . '/' . $name) || is_file($this->root . '/' . $name)) {
                unlink($this->root . '/' . $name);
            }
        }
        rmdir($this->root);
    }

    public function testRegistersIndependentNativeUpdateHooks(): void
    {
        self::assertContains(
            [[gq_game_admin_updater(), 'update'], 10, 4],
            $GLOBALS['gq_wp_hook_callbacks']['update_plugins_github.com']
        );
        self::assertContains(
            [[gq_game_admin_updater(), 'download'], 20, 4],
            $GLOBALS['gq_wp_hook_callbacks']['upgrader_pre_download']
        );
        self::assertSame('1.2.3', gq_game_admin_updater()->tagVersion('gq-game-admin-v1.2.3'));
        self::assertNull(gq_game_admin_updater()->tagVersion('gq-deployment-status-v1.2.3'));
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

    public function testStandalonePageDefaultsToStagingDatabaseWithoutLoadingInspection(): void
    {
        ob_start();
        gq_game_admin_render_page();
        $html = ob_get_clean();
        self::assertIsString($html);
        self::assertStringContainsString('Staging', $html);
        self::assertStringContainsString('Production', $html);
        self::assertSame(1, substr_count($html, ' disabled'));
        self::assertSame(3, substr_count($html, '<form'));
        self::assertSame(1, substr_count($html, 'value="test"'));
        self::assertSame(1, substr_count($html, 'aria-current="page"'));
        self::assertStringContainsString('id="gq-game-admin-staging"', $html);
        self::assertStringContainsString('fixture-gq_game_admin_database_staging', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_database_production', $html);
        self::assertStringContainsString('Saving does not rewrite the game or CLI collector configuration', $html);
        self::assertStringContainsString('name="section" value="database"', $html);
        self::assertStringContainsString('<option value="staging" selected>', $html);
        self::assertStringNotContainsString('Environment setup checklist', $html);
        self::assertStringNotContainsString('Execution is locked', $html);
        self::assertStringNotContainsString('gq-game-admin-vX.Y.Z', $html);
        self::assertSame(['gq_game_admin_database_staging'], $GLOBALS['gq_game_admin_test_option_reads']);
    }

    public function testRejectsUnauthorizedPageBeforeReadingReports(): void
    {
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_render_page();
    }

    public function testProductionTabShowsOnlyItsDatabaseSettingsAndNonce(): void
    {
        $_GET['environment'] = 'production';
        $GLOBALS['gq_game_admin_test_options'] = [
            'gq_game_admin_database_staging' => 'staging_database',
            'gq_game_admin_database_production' => 'production_database',
        ];
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
            self::assertIsString($html);
            self::assertStringContainsString('id="gq-game-admin-production"', $html);
            self::assertStringContainsString('value="production_database"', $html);
            self::assertStringContainsString('fixture-gq_game_admin_database_production', $html);
            self::assertStringNotContainsString('value="staging_database"', $html);
            self::assertStringNotContainsString('fixture-gq_game_admin_database_staging', $html);
            self::assertSame(3, substr_count($html, '<form'));
            self::assertSame(1, substr_count($html, 'aria-current="page"'));
        } finally {
            ob_end_clean();
        }
    }

    public function testRejectsUnknownOrArrayEnvironmentBeforeRenderingDatabaseForms(): void
    {
        foreach (['other', ['production'], '', null] as $environment) {
            $_GET['environment'] = $environment;
            try {
                gq_game_admin_render_page();
                self::fail('Invalid administration tab was accepted.');
            } catch (RuntimeException $error) {
                self::assertStringContainsString('Unknown game administration environment', $error->getMessage());
            }
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        self::assertSame([], $GLOBALS['gq_game_admin_test_transient_reads']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testRejectsUnknownOrArraySectionBeforeReadingConfigurationOrNotices(): void
    {
        foreach (['other', ['database'], '', null] as $section) {
            $_GET = ['environment' => 'production', 'section' => $section];
            try {
                gq_game_admin_render_page();
                self::fail('Invalid administration section was accepted.');
            } catch (RuntimeException $error) {
                self::assertStringContainsString('Unknown game administration section', $error->getMessage());
            }
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        self::assertSame([], $GLOBALS['gq_game_admin_test_transient_reads']);
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testTechnicalTabsRenderOnlySelectedEnvironmentAndPreserveNavigation(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        foreach (['staging', 'production'] as $environment) {
            $prefix = 'GQ_GAME_ADMIN_' . strtoupper($environment) . '_';
            define($prefix . 'DB_USER', 'fixture_reader');
            define($prefix . 'DB_PASSWORD', 'fixture-secret');
            define($prefix . 'REPORT_FILE', $this->root . '/' . $environment . '.json');
            $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_' . $environment] = 'gq_' . $environment;
            $report = $this->report();
            $report['plan']['environment'] = $environment;
            $report['plan']['database']['name'] = 'gq_' . $environment;
            $report['plan']['release']['version'] = '1.2.3-' . $environment . '-candidate';
            file_put_contents(
                $this->root . '/' . $environment . '.json',
                json_encode($this->withDigest($report), JSON_THROW_ON_ERROR)
            );
        }
        foreach (['staging', 'production'] as $environment) {
            $other = $environment === 'staging' ? 'production' : 'staging';
            $sections = [
                'overview', 'players', 'universe', 'content', 'database', 'inspection', 'operations', 'updates',
            ];
            foreach ($sections as $section) {
                $_GET = ['environment' => $environment, 'section' => $section];
                $GLOBALS['gq_game_admin_test_option_reads'] = [];
                ob_start();
                try {
                    gq_game_admin_render_page();
                    $html = ob_get_contents();
                } finally {
                    ob_end_clean();
                }
                self::assertIsString($html);
                self::assertStringContainsString('<form method="get"', $html);
                self::assertStringContainsString('name="page" value="gq-game-admin"', $html);
                self::assertStringContainsString('name="section" value="' . $section . '"', $html);
                self::assertStringContainsString('<option value="' . $environment . '" selected>', $html);
                self::assertSame(1, substr_count($html, 'aria-current="page"'));
                foreach ($sections as $tab) {
                    self::assertStringContainsString(
                        'section=' . $tab . '&amp;environment=' . $environment,
                        $html
                    );
                }
                self::assertStringNotContainsString($other . '-candidate', $html);
                self::assertStringNotContainsString('fixture-gq_game_admin_database_' . $other, $html);
                $reads = $GLOBALS['gq_game_admin_test_option_reads'];
                self::assertNotContains('gq_game_admin_database_' . $other, $reads);
                self::assertCount(match ($section) {
                    'database' => 1,
                    'inspection' => 2,
                    default => 0,
                }, $reads);
                self::assertSame($section === 'database', str_contains($html, 'name="password"'));
                self::assertSame($section === 'inspection', str_contains($html, 'Environment setup checklist'));
                self::assertSame($section === 'inspection', str_contains($html, $environment . '-candidate'));
                self::assertSame(
                    $section === 'inspection',
                    str_contains($html, 'fixture-gq_game_admin_export_review_' . $environment)
                );
                self::assertSame($section === 'operations', str_contains($html, 'Execution is locked'));
                self::assertSame($section === 'updates', str_contains($html, 'gq-game-admin-vX.Y.Z'));
                if ($section === 'operations') {
                    self::assertSame(5, substr_count($html, 'type="button" class="button" disabled'));
                    self::assertSame(1, substr_count($html, '<form'));
                }
            }
        }
    }

    public function testGameOverviewUsesOnlySelectedEnvironmentSnapshot(): void
    {
        $GLOBALS['gq_wp_transients']['gq_game_admin_overview_42_staging'] = [
            'database' => 'stage_db', 'observed_at' => '2025-01-01 12:00:00 UTC',
            'users' => 3, 'systems' => 12, 'planets' => 33, 'colonies' => 2, 'fleets' => 1,
        ];
        $_GET = ['environment' => 'production', 'section' => 'overview'];
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('No recent overview', $html);
        self::assertStringNotContainsString('stage_db', $html);
        self::assertStringContainsString('fixture-gq_game_admin_overview_production', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_overview_staging', $html);

        $_GET['environment'] = 'staging';
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('stage_db', $html);
        self::assertStringContainsString('2025-01-01 12:00:00 UTC', $html);
        self::assertStringContainsString('<td>33</td>', $html);
        self::assertStringContainsString('including NPCs and deleted accounts', $html);
    }

    public function testGameOverviewRejectsInvalidRequestsBeforeReadingConfiguration(): void
    {
        foreach (
            [
                ['environment' => 'other', '_wpnonce' => 'fixture-gq_game_admin_overview_other'],
                ['environment' => ['staging'], '_wpnonce' => 'fixture-gq_game_admin_overview_staging'],
                ['environment' => 'production', '_wpnonce' => 'fixture-gq_game_admin_overview_staging'],
            ] as $input
        ) {
            try {
                gq_game_admin_process_overview_request($input);
                self::fail('Invalid overview request was accepted.');
            } catch (RuntimeException $error) {
                self::assertMatchesRegularExpression(
                    '/Unknown game administration environment|security check/',
                    $error->getMessage()
                );
            }
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_process_overview_request([
            'environment' => 'staging', '_wpnonce' => 'fixture-gq_game_admin_overview_staging',
        ]);
    }

    public function testGameOverviewReportsUnavailableDatabaseAndDoesNotMutateOptions(): void
    {
        $result = gq_game_admin_process_overview_request([
            'environment' => 'staging', '_wpnonce' => 'fixture-gq_game_admin_overview_staging',
        ]);
        self::assertArrayHasKey('error', $result);
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('requires POST');
        gq_game_admin_process_overview_request([
            'environment' => 'staging', '_wpnonce' => 'fixture-gq_game_admin_overview_staging',
        ]);
    }

    public function testGameOverviewHandlerReplacesStaleSnapshotWithErrorAndKeepsEnvironment(): void
    {
        $post = $_POST;
        $_POST = ['environment' => 'production', '_wpnonce' => 'fixture-gq_game_admin_overview_production'];
        $key = 'gq_game_admin_overview_42_production';
        $GLOBALS['gq_wp_transients'][$key] = ['database' => 'stale'];
        try {
            try {
                gq_game_admin_handle_overview();
                self::fail('Expected redirect.');
            } catch (RuntimeException $error) {
                self::assertStringContainsString('section=overview&environment=production', $error->getMessage());
            }
            self::assertArrayHasKey('error', $GLOBALS['gq_wp_transients'][$key]);
            self::assertArrayNotHasKey('database', $GLOBALS['gq_wp_transients'][$key]);
            self::assertSame(300, $GLOBALS['gq_wp_ttls'][$key]);
        } finally {
            $_POST = $post;
        }
    }

    public function testPlayerInspectionRejectsUnsafeRequestsBeforeReadingConfiguration(): void
    {
        $valid = [
            'action' => 'gq_game_admin_players', 'environment' => 'staging',
            '_wpnonce' => 'fixture-gq_game_admin_players_staging', 'before' => '',
        ];
        foreach (
            [
                ['environment' => 'production'],
                ['_wpnonce' => 'fixture-gq_game_admin_players_production'],
                ['action' => 'other'],
            ] as $invalid
        ) {
            try {
                gq_game_admin_process_players_request(array_replace($valid, $invalid), 'staging');
                self::fail('Invalid player inspection request was accepted.');
            } catch (RuntimeException $error) {
                self::assertMatchesRegularExpression(
                    '/Invalid player inspection|security check/',
                    $error->getMessage()
                );
            }
        }
        foreach (['0', '-1', '2147483648', '1 OR 1=1', ['1']] as $before) {
            $result = gq_game_admin_process_players_request(array_replace($valid, ['before' => $before]), 'staging');
            self::assertSame('Invalid player list cursor.', $result['error']);
        }
        foreach (
            [
                ['player_search' => ['user']], ['player_search' => str_repeat('x', 129)],
                ['player_search' => "\xff"], ['player_search' => "user\n"],
                ['actor' => ['human']], ['actor' => 'administrator'],
            ] as $invalid
        ) {
            $result = gq_game_admin_process_players_request(array_replace($valid, $invalid), 'staging');
            self::assertSame('Invalid player search or control-type filter.', $result['error']);
        }
        foreach (
            [
            ['sort' => 'id; DROP TABLE users'], ['order' => 'descending'],
            ['login' => ['1']], ['admin' => 'yes'], ['before_value' => ['value']],
            ['sort_choice' => ['username:asc']], ['sort_choice' => 'username'],
            ] as $invalid
        ) {
            $result = gq_game_admin_process_players_request(array_replace($valid, $invalid), 'staging');
            self::assertArrayHasKey('error', $result);
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        try {
            gq_game_admin_process_players_request($valid, 'staging');
            self::fail('HTTP player inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTPS is required', $error->getMessage());
        }
        $GLOBALS['gq_game_admin_test_ssl'] = true;
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_process_players_request($valid, 'staging');
    }

    public function testPlayerPageDoesNotReadDatabaseUntilRequestedAndBlocksHttp(): void
    {
        $_GET = ['environment' => 'staging', 'section' => 'players'];
        $_SERVER['REQUEST_METHOD'] = 'GET';
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('No player data loaded.', $html);
        self::assertStringContainsString('fixture-gq_game_admin_players_staging', $html);
        self::assertStringContainsString('name="sort_choice" value="username:asc"', $html);
        self::assertStringContainsString('form="gq-player-controls" name="login"', $html);
        self::assertStringContainsString('form="gq-player-controls" name="admin"', $html);
        self::assertSame(1, preg_match(
            '/<thead>[\s\S]*name="player_search"[\s\S]*name="actor"[\s\S]*<\/thead>/',
            $html
        ));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('HTTPS is required for player inspection.', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_players_staging', $html);
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testOptInLocalPlayerHttpOverrideIsStagingAndPeerRestricted(): void
    {
        define('GQ_GAME_ADMIN_LOCAL_HTTP_STAGING', true);
        define('GQ_GAME_ADMIN_LOCAL_HTTP_PEER', '172.20.0.1');
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        $GLOBALS['gq_game_admin_test_admin_base'] = 'http://localhost:8081/wordpress/wp-admin/';
        $_SERVER['HTTP_HOST'] = 'localhost:8081';
        $_SERVER['REMOTE_ADDR'] = '172.20.0.1';
        self::assertTrue(gq_game_admin_read_transport_allowed('staging'));
        self::assertFalse(gq_game_admin_read_transport_allowed('production'));
        self::assertFalse(gq_game_admin_secure_transport());
        $input = [
            'action' => 'gq_game_admin_players', 'environment' => 'staging',
            '_wpnonce' => 'fixture-gq_game_admin_players_staging', 'before' => '',
        ];
        self::assertArrayHasKey('error', gq_game_admin_process_players_request($input, 'staging'));
        $profileRequest = $this->databaseRequest('staging', 'stage_database');
        self::assertStringContainsString('HTTPS is required', gq_game_admin_process_database_request(
            $profileRequest
        )['message']);
        try {
            gq_game_admin_process_players_request(array_replace(
                $input,
                ['_wpnonce' => 'fixture-gq_game_admin_players_production']
            ), 'staging');
            self::fail('Invalid player inspection nonce was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('security check', $error->getMessage());
        }
        $_SERVER['REQUEST_METHOD'] = 'GET';
        ob_start();
        try {
            gq_game_admin_render_players('staging');
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('Local staging HTTP override is active', $html);
        self::assertStringContainsString('fixture-gq_game_admin_players_staging', $html);
        foreach (
            ['HTTP_FORWARDED', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_FORWARDED_HOST',
                'HTTP_X_FORWARDED_PROTO', 'HTTP_X_REAL_IP'] as $header
        ) {
            $_SERVER[$header] = 'fixture';
            self::assertFalse(gq_game_admin_read_transport_allowed('staging'));
            unset($_SERVER[$header]);
        }
        $_SERVER['REMOTE_ADDR'] = '172.20.0.2';
        self::assertFalse(gq_game_admin_read_transport_allowed('staging'));
        $_SERVER['REMOTE_ADDR'] = '172.20.0.1';
        $_SERVER['HTTP_HOST'] = 'attacker.example';
        self::assertFalse(gq_game_admin_read_transport_allowed('staging'));
        $_SERVER['HTTP_HOST'] = 'localhost:8081';
        $GLOBALS['gq_game_admin_test_admin_base'] = 'http://remote.example/wordpress/wp-admin/';
        self::assertFalse(gq_game_admin_read_transport_allowed('staging'));
    }

    public function testPlayerHttpOverrideIsDisabledByDefault(): void
    {
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        $GLOBALS['gq_game_admin_test_admin_base'] = 'http://localhost:8081/wordpress/wp-admin/';
        $_SERVER['HTTP_HOST'] = 'localhost:8081';
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
        self::assertFalse(gq_game_admin_read_transport_allowed('staging'));
    }

    public function testVesselsRejectUnsafeRequestsBeforeReadingConfiguration(): void
    {
        $valid = [
            'action' => 'gq_game_admin_vessels', 'environment' => 'staging',
            '_wpnonce' => 'fixture-gq_game_admin_vessels_staging',
        ];
        foreach (
            [
            ['environment' => 'production'], ['environment' => ['staging']],
            ['_wpnonce' => 'fixture-gq_game_admin_vessels_production'], ['action' => 'gq_game_admin_ship_inventory'],
            ] as $invalid
        ) {
            try {
                gq_game_admin_process_vessels_request(array_replace($valid, $invalid), 'staging');
                self::fail('Unsafe vessel request was accepted.');
            } catch (RuntimeException $error) {
                self::assertMatchesRegularExpression(
                    '/Invalid vessel inspection|security check/',
                    $error->getMessage()
                );
            }
        }
        foreach (
            [
            ['sort' => 'id; DROP TABLE built_vessels'], ['sort' => ['id']], ['order' => 'other'],
            ['search' => "\xff"], ['search' => "x\n"], ['search' => str_repeat('x', 129)],
            ['owner' => '0'], ['colony' => '2147483648'], ['status_filter' => ['docked']],
            ['status_filter' => 'other'], ['cursor_id' => '0'], ['cursor_id' => '9223372036854775808'],
            ['cursor_id' => '1', 'sort' => 'name'], ['cursor_id' => '1', 'sort' => 'name', 'cursor_value' => '!!!'],
            ['cursor_id' => '1', 'sort' => 'name', 'cursor_value' => base64_encode(str_repeat('x', 401))],
            ['cursor_id' => '1', 'sort' => 'blueprint_id', 'cursor_value' => '9223372036854775808'],
            ['cursor_id' => '1', 'sort' => 'status', 'cursor_value' => 'other'],
            ['sort_choice' => ['id:asc']], ['sort_choice' => 'id'],
            ] as $invalid
        ) {
            self::assertArrayHasKey('error', gq_game_admin_process_vessels_request(
                array_replace($valid, $invalid),
                'staging'
            ));
        }
        self::assertTrue(gq_game_admin_positive_bigint('9007199254740993'));
        self::assertTrue(gq_game_admin_positive_bigint('9223372036854775807'));
        self::assertFalse(gq_game_admin_positive_bigint('9223372036854775808'));
        self::assertFalse(gq_game_admin_positive_bigint('01'));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        try {
            gq_game_admin_process_vessels_request($valid, 'staging');
            self::fail('HTTP vessel inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTPS is required', $error->getMessage());
        }
        $GLOBALS['gq_game_admin_test_ssl'] = true;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_process_vessels_request($valid, 'staging');
            self::fail('GET vessel inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('requires POST', $error->getMessage());
        }
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_process_vessels_request($valid, 'staging');
    }

    public function testVesselsNavigationDoesNotReadDatabaseAndShowsHeaderControls(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = ['section' => 'vessels', 'environment' => 'production'];
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('No vessels loaded.', $html);
        self::assertStringContainsString('fixture-gq_game_admin_vessels_production', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_vessels_staging', $html);
        foreach (array_keys(gq_game_admin_vessel_columns()) as $key) {
            self::assertStringContainsString('name="sort_choice" value="' . $key . ':', $html);
        }
        self::assertSame(1, preg_match(
            '/<thead>[\s\S]*name="owner"[\s\S]*name="colony"[\s\S]*name="search"[\s\S]*name="status_filter"/',
            $html
        ));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testBlueprintsRejectUnsafeRequestsBeforeReadingConfiguration(): void
    {
        $valid = [
            'action' => 'gq_game_admin_blueprints', 'environment' => 'staging',
            '_wpnonce' => 'fixture-gq_game_admin_blueprints_staging',
        ];
        foreach (
            [
            ['environment' => 'production'], ['environment' => ['staging']],
            ['_wpnonce' => 'fixture-gq_game_admin_blueprints_production'], ['_wpnonce' => ['x']],
            ['action' => 'gq_game_admin_vessels'],
            ] as $invalid
        ) {
            try {
                gq_game_admin_process_blueprints_request(array_replace($valid, $invalid), 'staging');
                self::fail('Unsafe blueprint request was accepted.');
            } catch (RuntimeException $error) {
                self::assertMatchesRegularExpression(
                    '/Invalid blueprint inspection|security check/',
                    $error->getMessage()
                );
            }
        }
        foreach (
            [
            ['sort' => 'compiled_stats_json'], ['sort' => 'id; DROP TABLE vessel_blueprints'], ['sort' => ['id']],
            ['order' => 'ASC'], ['search' => "\xff"], ['search' => "x\n"], ['search' => str_repeat('x', 129)],
            ['owner' => '0'], ['owner' => 'NULL'], ['owner' => '2147483648'], ['owner' => ['1']],
            ['hull' => '0'], ['hull' => '9223372036854775808'], ['hull' => '1 OR 1=1'],
            ['source' => str_repeat('s', 33)], ['doctrine' => str_repeat('d', 65)], ['source' => "a\tb"],
            ['public' => '1'], ['public' => ['public']], ['cursor_id' => '0'], ['cursor_id' => '-1'],
            ['cursor_id' => '9223372036854775808'], ['cursor_id' => '1', 'sort' => 'code'],
            ['cursor_id' => '1', 'sort' => 'code', 'cursor_value' => 'not base64!'],
            ['cursor_id' => '1', 'sort' => 'name', 'cursor_value' => 'YQ'],
            ['cursor_id' => '1', 'sort' => 'name', 'cursor_value' => base64_encode("\xff")],
            ['cursor_id' => '1', 'sort' => 'name', 'cursor_value' => base64_encode(str_repeat('x', 513))],
            ['cursor_id' => '1', 'sort' => 'user_id', 'cursor_value' => ''],
            ['cursor_id' => '1', 'sort' => 'user_id', 'cursor_value' => '0'],
            ['cursor_id' => '1', 'sort' => 'hull_id', 'cursor_value' => '9223372036854775808'],
            ['cursor_id' => '1', 'sort' => 'is_public', 'cursor_value' => '2'],
            ['cursor_id' => '1', 'sort' => 'version', 'cursor_value' => '4294967296'],
            ['cursor_id' => '1', 'sort' => 'updated_at', 'cursor_value' => '2026-01-01'],
            ['sort_choice' => ['id:asc']], ['sort_choice' => 'id'], ['sort_choice' => 'other:asc'],
            ] as $invalid
        ) {
            self::assertArrayHasKey('error', gq_game_admin_process_blueprints_request(
                array_replace($valid, $invalid),
                'staging'
            ));
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        try {
            gq_game_admin_process_blueprints_request($valid, 'staging');
            self::fail('HTTP blueprint inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTPS is required', $error->getMessage());
        }
        $GLOBALS['gq_game_admin_test_ssl'] = true;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_process_blueprints_request($valid, 'staging');
            self::fail('GET blueprint inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('requires POST', $error->getMessage());
        }
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        try {
            gq_game_admin_process_blueprints_request($valid, 'staging');
            self::fail('Unauthorized blueprint inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('not allowed', $error->getMessage());
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
    }

    public function testBlueprintsNavigationDoesNotReadDatabaseAndShowsHeaderControls(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = ['section' => 'blueprints', 'environment' => 'production'];
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('aria-current="page">Vessel blueprints</a>', $html);
        self::assertStringContainsString('No blueprints loaded.', $html);
        self::assertStringContainsString('fixture-gq_game_admin_blueprints_production', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_blueprints_staging', $html);
        foreach (array_keys(gq_game_admin_blueprint_columns()) as $key) {
            self::assertStringContainsString('name="sort_choice" value="' . $key . ':', $html);
        }
        self::assertSame(1, preg_match(
            '/<thead>[\s\S]*name="owner"[\s\S]*name="search"[\s\S]*name="hull"[\s\S]*name="doctrine"'
                . '[\s\S]*name="source"[\s\S]*name="public"[\s\S]*<\/thead>/',
            $html
        ));
        self::assertStringNotContainsString('compiled_', $html);
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }
    public function testShipInventoryRejectsUnsafeRequestsBeforeReadingConfiguration(): void
    {
        $valid = [
            'action' => 'gq_game_admin_ship_inventory', 'environment' => 'staging',
            '_wpnonce' => 'fixture-gq_game_admin_ship_inventory_staging',
        ];
        foreach (
            [
            ['environment' => 'production'], ['environment' => ['staging']],
            ['_wpnonce' => 'fixture-gq_game_admin_ship_queue_staging'], ['action' => 'gq_game_admin_ship_queue'],
            ] as $invalid
        ) {
            try {
                gq_game_admin_process_ship_inventory_request(array_replace($valid, $invalid), 'staging');
                self::fail('Unsafe ship inventory request was accepted.');
            } catch (RuntimeException $error) {
                self::assertMatchesRegularExpression(
                    '/Invalid ship inventory inspection|security check/',
                    $error->getMessage()
                );
            }
        }
        foreach (
            [
            ['sort' => 'id; DROP TABLE ships'], ['sort' => ['id']], ['order' => 'other'],
            ['search' => "\xff"], ['search' => "x\n"], ['search' => str_repeat('x', 129)],
            ['colony' => '0'], ['colony' => '2147483648'], ['count_filter' => ['positive']],
            ['count_filter' => 'other'], ['cursor_id' => '0'], ['cursor_id' => '1', 'sort' => 'type'],
            ['cursor_id' => '1', 'sort' => 'count', 'cursor_value' => '2147483648'],
            ['sort_choice' => ['id:asc']], ['sort_choice' => 'id'],
            ] as $invalid
        ) {
            self::assertArrayHasKey('error', gq_game_admin_process_ship_inventory_request(
                array_replace($valid, $invalid),
                'staging'
            ));
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        try {
            gq_game_admin_process_ship_inventory_request($valid, 'staging');
            self::fail('HTTP ship inventory inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTPS is required', $error->getMessage());
        }
        $GLOBALS['gq_game_admin_test_ssl'] = true;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_process_ship_inventory_request($valid, 'staging');
            self::fail('GET ship inventory inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('requires POST', $error->getMessage());
        }
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_process_ship_inventory_request($valid, 'staging');
    }

    public function testShipInventoryNavigationDoesNotReadDatabaseAndShowsHeaderControls(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = ['section' => 'ship_inventory', 'environment' => 'production'];
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('No ship inventory loaded.', $html);
        self::assertStringContainsString('fixture-gq_game_admin_ship_inventory_production', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_ship_queue_production', $html);
        foreach (array_keys(gq_game_admin_ship_inventory_columns()) as $key) {
            self::assertStringContainsString('name="sort_choice" value="' . $key . ':', $html);
        }
        self::assertSame(1, preg_match(
            '/<thead>[\s\S]*name="colony"[\s\S]*name="search"[\s\S]*name="count_filter"/',
            $html
        ));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testShipQueueRejectsUnsafeRequestsBeforeReadingConfiguration(): void
    {
        $valid = [
            'action' => 'gq_game_admin_ship_queue', 'environment' => 'staging',
            '_wpnonce' => 'fixture-gq_game_admin_ship_queue_staging',
        ];
        foreach (
            [
            ['environment' => 'production'], ['environment' => ['staging']],
            ['_wpnonce' => 'fixture-gq_game_admin_building_queue_staging'],
            ['action' => 'gq_game_admin_building_queue'],
            ] as $invalid
        ) {
            try {
                gq_game_admin_process_upgrade_request(array_replace($valid, $invalid), 'staging', 'ship_queue');
                self::fail('Unsafe ship queue request was accepted.');
            } catch (RuntimeException $error) {
                self::assertMatchesRegularExpression(
                    '/Invalid ship queue inspection|security check/',
                    $error->getMessage()
                );
            }
        }
        foreach (
            [
            ['sort' => 'id; DROP TABLE ship_build_queue'], ['sort' => 'target_level'], ['sort' => ['id']],
            ['order' => 'other'], ['search' => "\xff"], ['search' => "x\n"], ['search' => str_repeat('x', 129)],
            ['owner' => '0'], ['scheduled' => ['1']], ['scheduled' => '2'],
            ['status_filter' => ['queued']], ['status_filter' => 'other'],
            ['cursor_id' => '0'], ['cursor_id' => '1', 'sort' => 'eta'],
            ['cursor_id' => '1', 'sort' => 'quantity', 'cursor_value' => '2147483648'],
            ['cursor_id' => '1', 'sort' => 'status', 'cursor_value' => 'other'],
            ['cursor_id' => '1', 'sort' => 'eta', 'cursor_value' => 'invalid'],
            ['sort_choice' => ['id:asc']], ['sort_choice' => 'id'],
            ] as $invalid
        ) {
            self::assertArrayHasKey('error', gq_game_admin_process_upgrade_request(
                array_replace($valid, $invalid),
                'staging',
                'ship_queue'
            ));
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        try {
            gq_game_admin_process_upgrade_request($valid, 'staging', 'ship_queue');
            self::fail('HTTP ship queue inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTPS is required', $error->getMessage());
        }
        $GLOBALS['gq_game_admin_test_ssl'] = true;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_process_upgrade_request($valid, 'staging', 'ship_queue');
            self::fail('GET ship queue inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('requires POST', $error->getMessage());
        }
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_process_upgrade_request($valid, 'staging', 'ship_queue');
    }

    public function testShipQueueNavigationDoesNotReadDatabaseAndShowsHeaderControls(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = ['section' => 'ship_queue', 'environment' => 'production'];
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('No ship queue entries loaded.', $html);
        self::assertStringContainsString('fixture-gq_game_admin_ship_queue_production', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_building_queue_production', $html);
        foreach (array_keys(gq_game_admin_upgrade_columns('ship_queue')) as $key) {
            self::assertStringContainsString('name="sort_choice" value="' . $key . ':', $html);
        }
        self::assertSame(1, preg_match(
            '/<thead>[\s\S]*name="owner"[\s\S]*name="search"[\s\S]*name="scheduled"[\s\S]*name="status_filter"/',
            $html
        ));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testBuildingQueueRejectsUnsafeRequestsBeforeReadingConfiguration(): void
    {
        $valid = [
            'action' => 'gq_game_admin_building_queue', 'environment' => 'staging',
            '_wpnonce' => 'fixture-gq_game_admin_building_queue_staging',
        ];
        foreach (
            [
            ['environment' => 'production'], ['environment' => ['staging']],
            ['_wpnonce' => 'fixture-gq_game_admin_buildings_staging'], ['action' => 'gq_game_admin_buildings'],
            ] as $invalid
        ) {
            try {
                gq_game_admin_process_upgrade_request(array_replace($valid, $invalid), 'staging', 'building_queue');
                self::fail('Unsafe building queue request was accepted.');
            } catch (RuntimeException $error) {
                self::assertMatchesRegularExpression(
                    '/Invalid building queue inspection|security check/',
                    $error->getMessage()
                );
            }
        }
        foreach (
            [
            ['sort' => 'id; DROP TABLE building_upgrade_queue'], ['sort' => 'upgrade_end'], ['sort' => ['id']],
            ['order' => 'other'], ['search' => "\xff"], ['search' => "x\n"], ['search' => str_repeat('x', 129)],
            ['owner' => '0'], ['scheduled' => ['1']], ['scheduled' => '2'],
            ['status_filter' => ['queued']], ['status_filter' => 'other'],
            ['cursor_id' => '0'], ['cursor_id' => '1', 'sort' => 'eta'],
            ['cursor_id' => '1', 'sort' => 'target_level', 'cursor_value' => '2147483648'],
            ['cursor_id' => '1', 'sort' => 'status', 'cursor_value' => 'other'],
            ['cursor_id' => '1', 'sort' => 'eta', 'cursor_value' => 'invalid'],
            ['sort_choice' => ['id:asc']], ['sort_choice' => 'id'],
            ] as $invalid
        ) {
            self::assertArrayHasKey('error', gq_game_admin_process_upgrade_request(
                array_replace($valid, $invalid),
                'staging',
                'building_queue'
            ));
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        try {
            gq_game_admin_process_upgrade_request($valid, 'staging', 'building_queue');
            self::fail('HTTP building queue inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTPS is required', $error->getMessage());
        }
        $GLOBALS['gq_game_admin_test_ssl'] = true;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_process_upgrade_request($valid, 'staging', 'building_queue');
            self::fail('GET building queue inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('requires POST', $error->getMessage());
        }
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_process_upgrade_request($valid, 'staging', 'building_queue');
    }

    public function testBuildingQueueNavigationDoesNotReadDatabaseAndShowsHeaderControls(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = ['section' => 'building_queue', 'environment' => 'production'];
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('No building queue entries loaded.', $html);
        self::assertStringContainsString('fixture-gq_game_admin_building_queue_production', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_buildings_production', $html);
        foreach (array_keys(gq_game_admin_upgrade_columns('building_queue')) as $key) {
            self::assertStringContainsString('name="sort_choice" value="' . $key . ':', $html);
        }
        self::assertSame(1, preg_match(
            '/<thead>[\s\S]*name="owner"[\s\S]*name="search"[\s\S]*name="scheduled"[\s\S]*name="status_filter"/',
            $html
        ));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testBuildingsRejectUnsafeRequestsBeforeReadingConfiguration(): void
    {
        $valid = [
            'action' => 'gq_game_admin_buildings', 'environment' => 'staging',
            '_wpnonce' => 'fixture-gq_game_admin_buildings_staging',
        ];
        foreach (
            [
            ['environment' => 'production'], ['environment' => ['staging']],
            ['_wpnonce' => 'fixture-gq_game_admin_research_staging'], ['action' => 'gq_game_admin_research'],
            ] as $invalid
        ) {
            try {
                gq_game_admin_process_upgrade_request(array_replace($valid, $invalid), 'staging', 'buildings');
                self::fail('Unsafe building request was accepted.');
            } catch (RuntimeException $error) {
                self::assertMatchesRegularExpression(
                    '/Invalid building inspection|security check/',
                    $error->getMessage()
                );
            }
        }
        foreach (
            [
            ['sort' => 'id; DROP TABLE buildings'], ['sort' => 'user_id'], ['sort' => ['id']], ['order' => 'other'],
            ['search' => "\xff"], ['search' => "x\n"], ['search' => str_repeat('x', 129)],
            ['owner' => '0'], ['owner' => '2147483648'], ['scheduled' => ['1']], ['scheduled' => '2'],
            ['cursor_id' => '0'], ['cursor_id' => '1', 'sort' => 'upgrade_end'],
            ['cursor_id' => '1', 'sort' => 'level', 'cursor_value' => '2147483648'],
            ['cursor_id' => '1', 'sort' => 'upgrade_end', 'cursor_value' => 'invalid'],
            ['sort_choice' => ['id:asc']], ['sort_choice' => 'id'],
            ] as $invalid
        ) {
            self::assertArrayHasKey('error', gq_game_admin_process_upgrade_request(
                array_replace($valid, $invalid),
                'staging',
                'buildings'
            ));
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        try {
            gq_game_admin_process_upgrade_request($valid, 'staging', 'buildings');
            self::fail('HTTP building inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTPS is required', $error->getMessage());
        }
        $GLOBALS['gq_game_admin_test_ssl'] = true;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_process_upgrade_request($valid, 'staging', 'buildings');
            self::fail('GET building inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('requires POST', $error->getMessage());
        }
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_process_upgrade_request($valid, 'staging', 'buildings');
    }

    public function testUpgradeCatalogRejectsUnknownTableNames(): void
    {
        $this->expectException(InvalidArgumentException::class);
        gq_game_admin_upgrade_columns('buildings; DROP TABLE research');
    }

    public function testBuildingsNavigationDoesNotReadDatabaseAndShowsHeaderControls(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = ['section' => 'buildings', 'environment' => 'production'];
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('No buildings loaded.', $html);
        self::assertStringContainsString('fixture-gq_game_admin_buildings_production', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_research_production', $html);
        self::assertStringContainsString('Queued upgrades are not included.', $html);
        foreach (array_keys(gq_game_admin_upgrade_columns('buildings')) as $key) {
            self::assertStringContainsString('name="sort_choice" value="' . $key . ':', $html);
        }
        self::assertSame(1, preg_match(
            '/<thead>[\s\S]*name="owner"[\s\S]*name="search"[\s\S]*name="scheduled"/',
            $html
        ));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testResearchRejectsUnsafeRequestsBeforeReadingConfiguration(): void
    {
        $valid = [
            'action' => 'gq_game_admin_research', 'environment' => 'staging',
            '_wpnonce' => 'fixture-gq_game_admin_research_staging',
        ];
        foreach (
            [
            ['environment' => 'production'], ['environment' => ['staging']],
            ['_wpnonce' => 'fixture-gq_game_admin_research_production'], ['action' => 'gq_game_admin_fleets'],
            ] as $invalid
        ) {
            try {
                gq_game_admin_process_research_request(array_replace($valid, $invalid), 'staging');
                self::fail('Unsafe research request was accepted.');
            } catch (RuntimeException $error) {
                self::assertMatchesRegularExpression(
                    '/Invalid research inspection|security check/',
                    $error->getMessage()
                );
            }
        }
        foreach (
            [
            ['sort' => 'id; DROP TABLE research'], ['sort' => ['id']], ['order' => 'other'],
            ['search' => "\xff"], ['search' => "x\n"], ['search' => str_repeat('x', 129)],
            ['owner' => '0'], ['owner' => '2147483648'], ['scheduled' => ['1']], ['scheduled' => '2'],
            ['cursor_id' => '0'], ['cursor_id' => '1', 'sort' => 'research_end'],
            ['cursor_id' => '1', 'sort' => 'level', 'cursor_value' => '2147483648'],
            ['cursor_id' => '1', 'sort' => 'research_end', 'cursor_value' => 'invalid'],
            ['sort_choice' => ['id:asc']], ['sort_choice' => 'id'],
            ] as $invalid
        ) {
            self::assertArrayHasKey('error', gq_game_admin_process_research_request(
                array_replace($valid, $invalid),
                'staging'
            ));
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        try {
            gq_game_admin_process_research_request($valid, 'staging');
            self::fail('HTTP research inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTPS is required', $error->getMessage());
        }
        $GLOBALS['gq_game_admin_test_ssl'] = true;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_process_research_request($valid, 'staging');
            self::fail('GET research inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('requires POST', $error->getMessage());
        }
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_process_research_request($valid, 'staging');
    }

    public function testResearchNavigationDoesNotReadDatabaseAndShowsHeaderControls(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = ['section' => 'research', 'environment' => 'production'];
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('No research loaded.', $html);
        self::assertStringContainsString('fixture-gq_game_admin_research_production', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_research_staging', $html);
        foreach (array_keys(gq_game_admin_research_columns()) as $key) {
            self::assertStringContainsString('name="sort_choice" value="' . $key . ':', $html);
        }
        self::assertSame(1, preg_match(
            '/<thead>[\s\S]*name="owner"[\s\S]*name="search"[\s\S]*name="scheduled"/',
            $html
        ));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testFleetsRejectUnsafeRequestsBeforeReadingConfiguration(): void
    {
        $valid = [
            'action' => 'gq_game_admin_fleets', 'environment' => 'staging',
            '_wpnonce' => 'fixture-gq_game_admin_fleets_staging',
        ];
        foreach (
            [
            ['environment' => 'production'], ['environment' => ['staging']],
            ['_wpnonce' => 'fixture-gq_game_admin_fleets_production'], ['action' => 'gq_game_admin_colonies'],
            ] as $invalid
        ) {
            try {
                gq_game_admin_process_fleets_request(array_replace($valid, $invalid), 'staging');
                self::fail('Unsafe fleet request was accepted.');
            } catch (RuntimeException $error) {
                self::assertMatchesRegularExpression('/Invalid fleet inspection|security check/', $error->getMessage());
            }
        }
        foreach (
            [
            ['sort' => 'id; DROP TABLE fleets'], ['sort' => ['id']], ['order' => 'other'],
            ['search' => "\xff"], ['search' => "x\n"], ['search' => str_repeat('x', 129)],
            ['owner' => '0'], ['owner' => '2147483648'], ['returning' => ['1']], ['returning' => '2'],
            ['cursor_id' => '0'], ['cursor_id' => '1', 'sort' => 'mission'],
            ['cursor_id' => '1', 'sort' => 'returning', 'cursor_value' => '2'],
            ['cursor_id' => '1', 'sort' => 'target_system', 'cursor_value' => '2147483648'],
            ['cursor_id' => '1', 'sort' => 'arrival_time', 'cursor_value' => 'invalid'],
            ['sort_choice' => ['id:asc']], ['sort_choice' => 'id'],
            ] as $invalid
        ) {
            self::assertArrayHasKey('error', gq_game_admin_process_fleets_request(
                array_replace($valid, $invalid),
                'staging'
            ));
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        try {
            gq_game_admin_process_fleets_request($valid, 'staging');
            self::fail('HTTP fleet inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTPS is required', $error->getMessage());
        }
        $GLOBALS['gq_game_admin_test_ssl'] = true;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_process_fleets_request($valid, 'staging');
            self::fail('GET fleet inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('requires POST', $error->getMessage());
        }
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_process_fleets_request($valid, 'staging');
    }

    public function testFleetsNavigationDoesNotReadDatabaseAndShowsHeaderControls(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = ['section' => 'fleets', 'environment' => 'production'];
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('No fleets loaded.', $html);
        self::assertStringContainsString('fixture-gq_game_admin_fleets_production', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_fleets_staging', $html);
        foreach (array_keys(gq_game_admin_fleet_columns()) as $key) {
            self::assertStringContainsString('name="sort_choice" value="' . $key . ':', $html);
        }
        self::assertSame(1, preg_match(
            '/<thead>[\s\S]*name="owner"[\s\S]*name="search"[\s\S]*name="returning"/',
            $html
        ));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testColoniesRejectUnsafeRequestsBeforeReadingConfiguration(): void
    {
        $valid = [
            'action' => 'gq_game_admin_colonies', 'environment' => 'staging',
            '_wpnonce' => 'fixture-gq_game_admin_colonies_staging',
        ];
        foreach (
            [
            ['environment' => 'production'], ['environment' => ['staging']],
            ['_wpnonce' => 'fixture-gq_game_admin_colonies_production'], ['action' => 'gq_game_admin_planets'],
            ] as $invalid
        ) {
            try {
                gq_game_admin_process_colonies_request(array_replace($valid, $invalid), 'staging');
                self::fail('Unsafe colony request was accepted.');
            } catch (RuntimeException $error) {
                self::assertMatchesRegularExpression(
                    '/Invalid colony inspection|security check/',
                    $error->getMessage()
                );
            }
        }
        foreach (
            [
            ['sort' => 'id; DROP TABLE colonies'], ['sort' => ['id']], ['order' => 'other'],
            ['search' => "\xff"], ['search' => "x\n"], ['search' => str_repeat('x', 129)],
            ['owner' => '0'], ['owner' => '2147483648'], ['type_filter' => ['mining']],
            ['type_filter' => 'unknown'], ['cursor_id' => '0'], ['cursor_id' => '1', 'sort' => 'name'],
            ['cursor_id' => '1', 'sort' => 'population', 'cursor_value' => '4294967296'],
            ['cursor_id' => '1', 'sort' => 'last_update', 'cursor_value' => 'invalid'],
            ['sort_choice' => ['id:asc']], ['sort_choice' => 'id'],
            ] as $invalid
        ) {
            self::assertArrayHasKey('error', gq_game_admin_process_colonies_request(
                array_replace($valid, $invalid),
                'staging'
            ));
        }
        self::assertTrue(gq_game_admin_colony_population_valid('4294967295'));
        self::assertFalse(gq_game_admin_colony_population_valid('4294967296'));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        try {
            gq_game_admin_process_colonies_request($valid, 'staging');
            self::fail('HTTP colony inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTPS is required', $error->getMessage());
        }
        $GLOBALS['gq_game_admin_test_ssl'] = true;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_process_colonies_request($valid, 'staging');
            self::fail('GET colony inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('requires POST', $error->getMessage());
        }
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_process_colonies_request($valid, 'staging');
    }

    public function testColoniesNavigationDoesNotReadDatabaseAndShowsHeaderControls(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = ['section' => 'colonies', 'environment' => 'production'];
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('No colonies loaded.', $html);
        self::assertStringContainsString('fixture-gq_game_admin_colonies_production', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_colonies_staging', $html);
        foreach (array_keys(gq_game_admin_colony_columns()) as $key) {
            self::assertStringContainsString('name="sort_choice" value="' . $key . ':', $html);
        }
        self::assertSame(1, preg_match(
            '/<thead>[\s\S]*name="owner"[\s\S]*name="search"[\s\S]*name="type_filter"/',
            $html
        ));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testPlanetsRejectUnsafeRequestsBeforeReadingConfiguration(): void
    {
        $valid = [
            'action' => 'gq_game_admin_planets', 'environment' => 'staging',
            '_wpnonce' => 'fixture-gq_game_admin_planets_staging',
        ];
        foreach (
            [
            ['environment' => 'production'], ['environment' => ['staging']],
            ['_wpnonce' => 'fixture-gq_game_admin_planets_production'], ['action' => 'gq_game_admin_universe'],
            ] as $invalid
        ) {
            try {
                gq_game_admin_process_planets_request(array_replace($valid, $invalid), 'staging');
                self::fail('Unsafe planet request was accepted.');
            } catch (RuntimeException $error) {
                self::assertMatchesRegularExpression(
                    '/Invalid planet inspection|security check/',
                    $error->getMessage()
                );
            }
        }
        foreach (
            [
            ['sort' => 'id; DROP TABLE planets'], ['sort' => ['id']], ['order' => 'other'],
            ['search' => "\xff"], ['search' => "x\n"], ['search' => str_repeat('x', 129)],
            ['galaxy' => '2147483648'], ['system' => '-2147483649'], ['position' => ['0']],
            ['cursor_id' => '0'], ['cursor_id' => '1', 'sort' => 'type'],
            ['cursor_id' => '1', 'sort' => 'position', 'cursor_value' => 'bad'],
            ['sort_choice' => ['id:asc']], ['sort_choice' => 'id'],
            ] as $invalid
        ) {
            self::assertArrayHasKey('error', gq_game_admin_process_planets_request(
                array_replace($valid, $invalid),
                'staging'
            ));
        }
        self::assertTrue(gq_game_admin_planet_integer('0'));
        self::assertTrue(gq_game_admin_planet_integer('-2147483648'));
        self::assertFalse(gq_game_admin_planet_integer('00'));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        try {
            gq_game_admin_process_planets_request($valid, 'staging');
            self::fail('HTTP planet inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTPS is required', $error->getMessage());
        }
        $GLOBALS['gq_game_admin_test_ssl'] = true;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_process_planets_request($valid, 'staging');
            self::fail('GET planet inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('requires POST', $error->getMessage());
        }
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_process_planets_request($valid, 'staging');
    }

    public function testPlanetsNavigationDoesNotReadDatabaseAndShowsHeaderControls(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = ['section' => 'planets', 'environment' => 'production'];
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('No planets loaded.', $html);
        self::assertStringContainsString('fixture-gq_game_admin_planets_production', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_planets_staging', $html);
        foreach (array_keys(gq_game_admin_planet_columns()) as $key) {
            self::assertStringContainsString('name="sort_choice" value="' . $key . ':', $html);
        }
        self::assertSame(1, preg_match(
            '/<thead>[\s\S]*name="galaxy"[\s\S]*name="system"[\s\S]*name="position"[\s\S]*name="search"/',
            $html
        ));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testUniverseRejectsUnsafeRequestsBeforeReadingConfiguration(): void
    {
        $valid = [
            'action' => 'gq_game_admin_universe', 'environment' => 'staging',
            '_wpnonce' => 'fixture-gq_game_admin_universe_staging',
        ];
        foreach (
            [
            ['environment' => 'production'], ['environment' => ['staging']],
            ['_wpnonce' => 'fixture-gq_game_admin_players_staging'],
            ['action' => 'gq_game_admin_players'],
            ] as $invalid
        ) {
            try {
                gq_game_admin_process_universe_request(array_replace($valid, $invalid), 'staging');
                self::fail('Unsafe universe request was accepted.');
            } catch (RuntimeException $error) {
                self::assertMatchesRegularExpression(
                    '/Invalid universe inspection|security check/',
                    $error->getMessage()
                );
            }
        }
        foreach (
            [
            ['sort' => 'id; DROP TABLE star_systems'], ['sort' => ['id']], ['order' => 'other'],
            ['search' => ['foo']], ['search' => "\xff"], ['search' => "foo\n"], ['search' => str_repeat('x', 129)],
            ['galaxy' => '-1'], ['galaxy' => '256'], ['galaxy' => ['1']], ['planets' => 'yes'],
            ['cursor_id' => '2147483648'], ['cursor_id' => ['1']],
            ['cursor_id' => '1', 'sort' => 'name'],
            ['cursor_id' => '1', 'sort' => 'planet_count', 'cursor_value' => '999'],
            ['sort_choice' => ['id:asc']], ['sort_choice' => 'id'],
            ] as $invalid
        ) {
            self::assertArrayHasKey(
                'error',
                gq_game_admin_process_universe_request(array_replace($valid, $invalid), 'staging')
            );
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        try {
            gq_game_admin_process_universe_request($valid, 'staging');
            self::fail('HTTP universe inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTPS is required', $error->getMessage());
        }
        $GLOBALS['gq_game_admin_test_ssl'] = true;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_process_universe_request($valid, 'staging');
            self::fail('GET universe inspection was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('requires POST', $error->getMessage());
        }
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not allowed');
        gq_game_admin_process_universe_request($valid, 'staging');
    }

    public function testUniverseNavigationOnlyRendersSelectedEnvironmentAndDoesNotQueryDatabase(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = ['section' => 'universe', 'environment' => 'production'];
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('No systems loaded.', $html);
        self::assertStringContainsString('fixture-gq_game_admin_universe_production', $html);
        self::assertStringNotContainsString('fixture-gq_game_admin_universe_staging', $html);
        self::assertStringContainsString('name="sort_choice" value="name:asc"', $html);
        self::assertSame(1, preg_match(
            '/<thead>[\s\S]*name="galaxy"[\s\S]*name="search"[\s\S]*name="planets"/',
            $html
        ));
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
        } finally {
            ob_end_clean();
        }
        self::assertStringContainsString('HTTPS is required for universe inspection.', $html);
        self::assertStringNotContainsString('name="search"', $html);
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testConnectionProfileShowsOnlySelectedEnvironmentAndNeverPasswords(): void
    {
        define('GQ_GAME_ADMIN_STAGING_DB_HOST', 'stage.example.test');
        define('GQ_GAME_ADMIN_STAGING_DB_USER', 'stage_reader');
        define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'stage-secret-fixture');
        define('GQ_GAME_ADMIN_PRODUCTION_DB_HOST', 'prod.example.test');
        define('GQ_GAME_ADMIN_PRODUCTION_DB_PORT', 3307);
        define('GQ_GAME_ADMIN_PRODUCTION_DB_USER', '<prod_reader>');
        define('GQ_GAME_ADMIN_PRODUCTION_DB_PASSWORD', 'prod-secret-fixture');
        foreach (['staging', 'production'] as $environment) {
            $_GET['environment'] = $environment;
            ob_start();
            try {
                gq_game_admin_render_page();
                $html = ob_get_contents();
                self::assertIsString($html);
                self::assertStringContainsString('Configured (hidden)', $html);
                self::assertStringContainsString('Configured does not mean the connection was tested', $html);
                self::assertStringNotContainsString('stage-secret-fixture', $html);
                self::assertStringNotContainsString('prod-secret-fixture', $html);
                if ($environment === 'production') {
                    self::assertStringContainsString('prod.example.test', $html);
                    self::assertStringContainsString('3307', $html);
                    self::assertStringContainsString('&lt;prod_reader&gt;', $html);
                    self::assertStringNotContainsString('<prod_reader>', $html);
                    self::assertStringNotContainsString('stage.example.test', $html);
                    self::assertStringNotContainsString('stage_reader', $html);
                } else {
                    self::assertStringContainsString('stage.example.test', $html);
                    self::assertStringContainsString('stage_reader', $html);
                    self::assertStringNotContainsString('prod.example.test', $html);
                    self::assertStringNotContainsString('prod_reader', $html);
                }
            } finally {
                ob_end_clean();
            }
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testIncompleteConnectionProfileReportsConfigurationErrorWithoutLeakingPassword(): void
    {
        define('GQ_GAME_ADMIN_STAGING_DB_PORT', ['invalid']);
        define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'hidden-fixture-password');
        ob_start();
        try {
            gq_game_admin_render_database_settings('staging');
            $html = ob_get_contents();
            self::assertIsString($html);
            self::assertStringContainsString('localhost', $html);
            self::assertStringContainsString('Not configured or invalid', $html);
            self::assertStringContainsString('Configured (hidden)', $html);
            self::assertStringContainsString('Configure the environment-specific', $html);
            self::assertStringNotContainsString('hidden-fixture-password', $html);
        } finally {
            ob_end_clean();
        }
        self::assertArrayHasKey('error', gq_game_admin_database_credentials('staging'));
    }

    public function testMissingConnectionProfileDoesNotClaimPasswordIsConfigured(): void
    {
        ob_start();
        try {
            gq_game_admin_render_database_settings('production');
            $html = ob_get_contents();
            self::assertIsString($html);
            self::assertStringContainsString('Not configured or invalid', $html);
            self::assertStringContainsString('Configure the environment-specific', $html);
            self::assertStringNotContainsString('Configured (hidden)', $html);
        } finally {
            ob_end_clean();
        }
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testPrivateConnectionFileBindsDatabaseAndFailsClosedInsteadOfUsingConstants(): void
    {
        $file = $this->root . '/report.json';
        file_put_contents($file, json_encode($this->connectionProfile(), JSON_THROW_ON_ERROR));
        chmod($file, 0600);
        define('GQ_GAME_ADMIN_STAGING_DB_CONFIG_FILE', $file);
        define('GQ_GAME_ADMIN_STAGING_DB_USER', 'must-not-fall-back');
        define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'fallback-secret');
        define('GQ_GAME_ADMIN_PRODUCTION_DB_USER', 'production-only');
        define('GQ_GAME_ADMIN_PRODUCTION_DB_PASSWORD', 'production-secret');
        $credentials = gq_game_admin_database_credentials('staging');
        self::assertSame('private_reader', $credentials['user']);
        self::assertSame('stage_database', $credentials['database']);
        self::assertSame('production-only', gq_game_admin_database_credentials('production')['user']);
        $input = $this->databaseRequest('staging', 'different_database');
        $result = gq_game_admin_process_database_request($input);
        self::assertSame('error', $result['type']);
        self::assertStringContainsString('explicitly confirm', $result['message']);
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
        $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'outdated_database';
        self::assertArrayHasKey('error', gq_game_admin_environment_report('staging'));
        $checks = gq_game_admin_setup_checks('staging', $this->report(), $this->now);
        self::assertSame('observed', $checks['credentials']['status']);
        self::assertSame('blocked', $checks['inspection']['status']);
        self::assertSame(['name' => 'stage_database'], gq_game_admin_database_settings('staging'));
        ob_start();
        try {
            gq_game_admin_render_page();
            $html = ob_get_contents();
            self::assertIsString($html);
            self::assertStringContainsString('Private JSON file', $html);
            self::assertStringContainsString('private_reader', $html);
            self::assertStringContainsString('profile database overrides legacy name options', $html);
            foreach ([$file, 'private-secret', 'fallback-secret', 'production-secret', 'production-only'] as $secret) {
                self::assertStringNotContainsString($secret, $html);
            }
        } finally {
            ob_end_clean();
        }
        file_put_contents($file, '{"invalid":');
        self::assertArrayHasKey('error', gq_game_admin_database_credentials('staging'));
        self::assertSame('error', gq_game_admin_process_database_request(
            $this->databaseRequest('staging', 'stage_database')
        )['type']);
        self::assertSame(
            'outdated_database',
            $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging']
        );
    }

    public function testPrivateConnectionFileRejectsPublicRelativeMissingAndOverPermissivePaths(): void
    {
        $file = $this->root . '/report.json';
        file_put_contents($file, json_encode($this->connectionProfile(), JSON_THROW_ON_ERROR));
        chmod($file, 0600);
        self::assertSame('private_reader', gq_game_admin_read_database_configuration($file, 'staging')['user']);
        $paths = ['report.json', 'https://example.test/config.json', $this->root . '/missing.json', $file . "\0"];
        foreach ($paths as $path) {
            self::assertArrayHasKey('error', gq_game_admin_read_database_configuration($path, 'staging'));
        }
        self::assertArrayHasKey('error', gq_game_admin_read_database_configuration($file, 'unknown'));
        $documentRoot = $_SERVER['DOCUMENT_ROOT'] ?? null;
        try {
            $_SERVER['DOCUMENT_ROOT'] = $this->root;
            self::assertArrayHasKey('error', gq_game_admin_read_database_configuration($file, 'staging'));
        } finally {
            if ($documentRoot === null) {
                unset($_SERVER['DOCUMENT_ROOT']);
            } else {
                $_SERVER['DOCUMENT_ROOT'] = $documentRoot;
            }
        }
        if (DIRECTORY_SEPARATOR === '/') {
            $link = $this->root . '/config-link.json';
            self::assertTrue(symlink($file, $link));
            try {
                self::assertArrayHasKey('error', gq_game_admin_read_database_configuration($link, 'staging'));
            } finally {
                unlink($link);
            }
            chmod($file, 0644);
            clearstatcache(true, $file);
            self::assertArrayHasKey('error', gq_game_admin_read_database_configuration($file, 'staging'));
        }
    }

    public function testPrivateConnectionFileRejectsMalformedOversizedAndWrongEnvironmentProfiles(): void
    {
        $file = $this->root . '/report.json';
        $invalid = ['[]', '{', str_repeat('x', 65537)];
        $invalidFields = [
            'environment' => 'production', 'host' => 'host;port=3307', 'port' => '3306',
            'database' => 'db;invalid', 'username' => '', 'password' => '',
        ];
        foreach ($invalidFields as $key => $value) {
            $profile = $this->connectionProfile();
            $profile[$key] = $value;
            $invalid[] = json_encode($profile, JSON_THROW_ON_ERROR);
        }
        foreach ($invalid as $body) {
            file_put_contents($file, $body);
            chmod($file, 0600);
            $result = gq_game_admin_read_database_configuration($file, 'staging');
            self::assertArrayHasKey('error', $result);
            self::assertStringNotContainsString($file, $result['error']);
            self::assertStringNotContainsString('private-secret', $result['error']);
        }
    }

    public function testSetupChecklistExplainsMissingConfigurationWithoutSavingOrConnecting(): void
    {
        $checks = gq_game_admin_setup_checks('staging', ['error' => 'No report configured.'], $this->now);
        self::assertSame('action-required', $checks['database']['status']);
        self::assertStringContainsString('Create the database in Plesk', $checks['database']['message']);
        self::assertSame('blocked', $checks['credentials']['status']);
        self::assertSame('blocked', $checks['inspection']['status']);
        self::assertSame('blocked', $checks['migrations']['status']);
        self::assertSame('blocked', $checks['execution']['status']);
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testSetupChecklistDistinguishesMigrationReviewStatesButNeverUnlocksExecution(): void
    {
        define('GQ_GAME_ADMIN_STAGING_DB_USER', 'inspection_reader');
        define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'checklist-private-secret');
        $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_staging';
        $report = $this->report();
        $checks = gq_game_admin_setup_checks('staging', $report, $this->now);
        self::assertSame('observed', $checks['database']['status']);
        self::assertSame('observed', $checks['credentials']['status']);
        self::assertStringContainsString('SELECT-only grants are not certified', $checks['credentials']['message']);
        self::assertSame('observed', $checks['inspection']['status']);
        self::assertSame('action-required', $checks['migrations']['status']);
        self::assertStringContainsString('1 pending', $checks['migrations']['message']);
        self::assertSame('blocked', $checks['execution']['status']);
        $report['plan']['migrations']['entries'][0]['status'] = 'executed';
        $checks = gq_game_admin_setup_checks('staging', $this->withDigest($report), $this->now);
        self::assertSame('observed', $checks['migrations']['status']);
        self::assertStringContainsString('not a deployment approval', $checks['migrations']['message']);
        self::assertSame('blocked', $checks['execution']['status']);
        foreach (['empty' => 0, 'untracked' => 1] as $state => $count) {
            $report = $this->report();
            $report['plan']['database']['state'] = $state;
            $report['plan']['database']['table_count'] = $count;
            $report['plan']['migrations']['tracking_present'] = false;
            $checks = gq_game_admin_setup_checks('staging', $this->withDigest($report), $this->now);
            self::assertSame('observed', $checks['inspection']['status']);
            self::assertSame('action-required', $checks['migrations']['status']);
            self::assertStringContainsString(
                $state === 'empty' ? 'Independently verify' : 'audit/adoption',
                $checks['migrations']['message']
            );
            self::assertSame('blocked', $checks['execution']['status']);
        }
        self::assertStringNotContainsString('checklist-private-secret', json_encode($checks, JSON_THROW_ON_ERROR));
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testSetupChecklistRejectsStaleWrongTargetAndTamperedSnapshots(): void
    {
        $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_staging';
        $stale = $wrongTarget = $tampered = $this->report();
        $stale['generated_at'] = $this->now - 901;
        $wrongTarget['plan']['environment'] = 'production';
        $tampered['plan']['migrations']['entries'] = [];
        foreach ([$stale, $this->withDigest($wrongTarget), $tampered] as $report) {
            $checks = gq_game_admin_setup_checks('staging', $report, $this->now);
            self::assertSame('blocked', $checks['inspection']['status']);
            self::assertSame('blocked', $checks['migrations']['status']);
            self::assertSame('blocked', $checks['execution']['status']);
        }
    }

    public function testSetupChecklistPreservesAndEscapesMigrationBlockers(): void
    {
        $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_staging';
        $report = $this->report();
        $report['plan']['migrations']['blockers'] = ['<script>blocked</script>'];
        $checks = gq_game_admin_setup_checks('staging', $this->withDigest($report), $this->now);
        self::assertSame('blocked', $checks['migrations']['status']);
        self::assertSame('<script>blocked</script>', $checks['migrations']['message']);
        ob_start();
        try {
            gq_game_admin_render_setup_checks($checks);
            $html = ob_get_contents();
            self::assertIsString($html);
            self::assertStringContainsString('&lt;script&gt;blocked&lt;/script&gt;', $html);
            self::assertStringNotContainsString('<script>', $html);
            self::assertStringContainsString('not an execution authorization', $html);
            self::assertStringNotContainsString('<form', $html);
            self::assertStringNotContainsString('<button', $html);
        } finally {
            ob_end_clean();
        }
    }

    public function testReviewExportProjectsOnlyEvidenceAndBindsItsDigestWithoutAuthorizingExecution(): void
    {
        $report = $this->report();
        $report['private_config'] = ['password' => 'private-export-secret'];
        $report['plan']['database']['password'] = 'private-export-secret';
        $report['plan']['release']['private_path'] = '/private/must-not-export';
        $report['plan']['migrations']['entries'][0]['sql'] = 'DROP TABLE private_example;';
        $report = $this->withDigest($report);
        $result = gq_game_admin_build_review_export(
            $report,
            'staging',
            'gq_staging',
            $report['plan_sha256'],
            $this->now
        );
        self::assertArrayNotHasKey('error', $result);
        $export = json_decode($result['body'], true, 32, JSON_THROW_ON_ERROR);
        self::assertFalse($export['execution_allowed']);
        self::assertSame('manual-migration-review', $export['purpose']);
        self::assertSame('staging', $export['plan']['environment']);
        self::assertSame('gq_staging', $export['plan']['database']['name']);
        self::assertSame($report['generated_at'], $export['observed_at']);
        self::assertSame($report['plan_sha256'], $export['source_plan_sha256']);
        self::assertSame(
            hash('sha256', json_encode($export['plan'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)),
            $export['plan_sha256']
        );
        self::assertSame(
            'gq-staging-migration-review-' . substr($export['plan_sha256'], 0, 12) . '.json',
            $result['filename']
        );
        foreach (['private-export-secret', '/private/must-not-export', 'DROP TABLE'] as $private) {
            self::assertStringNotContainsString($private, $result['body']);
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testReviewExportRejectsExpiredChangedOrWrongTargetEvidence(): void
    {
        $report = $this->report();
        $cases = [
            [$report, 'production', 'gq_staging', $report['plan_sha256'], $this->now],
            [$report, 'staging', 'other_database', $report['plan_sha256'], $this->now],
            [$report, 'staging', 'gq_staging', str_repeat('f', 64), $this->now],
            [$report, 'staging', 'gq_staging', $report['plan_sha256'], $this->now + 901],
            [['error' => 'Missing report.'], 'staging', 'gq_staging', $report['plan_sha256'], $this->now],
        ];
        foreach ($cases as $arguments) {
            $result = gq_game_admin_build_review_export(...$arguments);
            self::assertArrayHasKey('error', $result);
            self::assertArrayNotHasKey('body', $result);
        }
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testReviewDownloadRechecksCurrentServerReportAndRejectsRacingPlanChanges(): void
    {
        $file = $this->root . '/report.json';
        define('GQ_GAME_ADMIN_STAGING_REPORT_FILE', $file);
        $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_staging';
        $report = $this->report();
        file_put_contents($file, json_encode($report, JSON_THROW_ON_ERROR));
        $input = [
            'environment' => 'staging', 'database' => 'gq_staging', 'plan_sha256' => $report['plan_sha256'],
            '_wpnonce' => 'fixture-gq_game_admin_export_review_staging_' . $report['plan_sha256'],
            'report_file' => '/not-a-browser-controlled-path.json',
        ];
        self::assertArrayHasKey('body', gq_game_admin_process_review_export($input));
        ob_start();
        try {
            gq_game_admin_render_environment('Staging', $report);
            $html = ob_get_contents();
            self::assertIsString($html);
            self::assertStringContainsString('gq_game_admin_export_review', $html);
            self::assertStringContainsString($input['_wpnonce'], $html);
            self::assertStringContainsString('Download read-only review plan', $html);
            self::assertStringNotContainsString($file, $html);
        } finally {
            ob_end_clean();
        }
        $report['plan']['migrations']['entries'][0]['status'] = 'executed';
        file_put_contents($file, json_encode($this->withDigest($report), JSON_THROW_ON_ERROR));
        $result = gq_game_admin_process_review_export($input);
        self::assertArrayHasKey('error', $result);
        self::assertStringContainsString('plan changed', $result['error']);
        $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'different_database';
        self::assertArrayHasKey('error', gq_game_admin_process_review_export($input));
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testReviewDownloadRejectsUnauthorizedMalformedAndCrossEnvironmentRequests(): void
    {
        $digest = $this->report()['plan_sha256'];
        $input = [
            'environment' => 'staging', 'database' => 'gq_staging', 'plan_sha256' => $digest,
            '_wpnonce' => 'fixture-gq_game_admin_export_review_staging_' . $digest,
        ];
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        try {
            gq_game_admin_process_review_export($input);
            self::fail('Unauthorized review download was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('not allowed', $error->getMessage());
        } finally {
            $GLOBALS['gq_game_admin_test_can_manage'] = true;
        }
        foreach (['environment' => ['staging'], 'database' => 'bad;database', 'plan_sha256' => []] as $key => $value) {
            $invalid = $input;
            $invalid[$key] = $value;
            self::assertArrayHasKey('error', gq_game_admin_process_review_export($invalid));
        }
        foreach (['', 'fixture-gq_game_admin_export_review_production_' . $digest] as $nonce) {
            $input['_wpnonce'] = $nonce;
            try {
                gq_game_admin_process_review_export($input);
                self::fail('Invalid review download nonce was accepted.');
            } catch (RuntimeException $error) {
                self::assertStringContainsString('security check failed', $error->getMessage());
            }
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
    }

    public function testReviewDownloadRequiresPost(): void
    {
        $method = $_SERVER['REQUEST_METHOD'] ?? null;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_handle_review_export();
            self::fail('GET review download was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('require POST', $error->getMessage());
        } finally {
            if ($method === null) {
                unset($_SERVER['REQUEST_METHOD']);
            } else {
                $_SERVER['REQUEST_METHOD'] = $method;
            }
        }
    }

    public function testDatabaseActionsRedirectBackToSelectedEnvironmentDatabaseTab(): void
    {
        $post = $_POST;
        $method = $_SERVER['REQUEST_METHOD'] ?? null;
        $_SERVER['REQUEST_METHOD'] = 'POST';
        try {
            foreach (['staging', 'production'] as $environment) {
                foreach (['save', 'test', 'save_profile', 'test_entered'] as $operation) {
                    $_POST = $this->databaseRequest($environment, $environment . '_database');
                    $_POST['section'] = 'updates';
                    $_POST['operation'] = $operation;
                    try {
                        gq_game_admin_handle_database();
                        self::fail('Expected redirect interception.');
                    } catch (RuntimeException $error) {
                        self::assertSame(
                            'Redirect: https://wordpress.test/wp-admin/admin.php?page=gq-game-admin'
                                . '&section=database&environment=' . $environment,
                            $error->getMessage()
                        );
                    }
                }
            }
        } finally {
            $_POST = $post;
            if ($method === null) {
                unset($_SERVER['REQUEST_METHOD']);
            } else {
                $_SERVER['REQUEST_METHOD'] = $method;
            }
        }
    }

    public function testDatabaseRedirectCannotBypassEnvironmentNonce(): void
    {
        $post = $_POST;
        try {
            foreach (['', ['invalid'], 'fixture-gq_game_admin_database_staging'] as $nonce) {
                $_POST = $this->databaseRequest('production', 'production_database');
                $_POST['_wpnonce'] = $nonce;
                $_POST['section'] = 'updates';
                try {
                    gq_game_admin_handle_database();
                    self::fail('Invalid nonce reached the redirect.');
                } catch (RuntimeException $error) {
                    self::assertSame('Database settings security check failed.', $error->getMessage());
                }
            }
        } finally {
            $_POST = $post;
        }
        self::assertSame([], $GLOBALS['gq_wp_transients']);
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
        self::assertSame([], $GLOBALS['gq_game_admin_test_option_reads']);
    }

    public function testConstantsOnlyCannotPersistProfilesAndBrowserPathsAreIgnored(): void
    {
        foreach (['staging' => 'plesk_stage_42', 'production' => 'plesk_live_42'] as $environment => $database) {
            $input = $this->databaseRequest($environment, $database);
            $input['config_file'] = $this->root . '/staging.json';
            $result = gq_game_admin_process_database_request($input);
            self::assertSame('error', $result['type']);
            self::assertStringContainsString('fixed DB_CONFIG_FILE', $result['message']);
            self::assertSame(['name' => ''], gq_game_admin_database_settings($environment));
        }
        self::assertFileDoesNotExist($this->root . '/staging.json');
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testLegacyHttpActionsSaveOnlyNamesAndTestServerConstantsWithoutSendingSecrets(): void
    {
        define('GQ_GAME_ADMIN_STAGING_DB_HOST', '127.0.0.1');
        define('GQ_GAME_ADMIN_STAGING_DB_PORT', 1);
        define('GQ_GAME_ADMIN_STAGING_DB_USER', 'legacy_reader');
        define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'legacy-server-fixture-secret');
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        $input = [
            'environment' => 'staging', 'database' => 'legacy_staging', 'operation' => 'save',
            '_wpnonce' => 'fixture-gq_game_admin_database_staging',
        ];
        self::assertSame('success', gq_game_admin_process_database_request($input)['type']);
        self::assertSame(['name' => 'legacy_staging'], gq_game_admin_database_settings('staging'));
        $input['environment'] = 'production';
        $input['database'] = 'legacy_production';
        $input['_wpnonce'] = 'fixture-gq_game_admin_database_production';
        self::assertSame('success', gq_game_admin_process_database_request($input)['type']);
        self::assertSame(['name' => 'legacy_production'], gq_game_admin_database_settings('production'));
        $input['environment'] = 'staging';
        $input['database'] = 'legacy_staging';
        $input['_wpnonce'] = 'fixture-gq_game_admin_database_staging';
        $input['operation'] = 'test';
        $result = gq_game_admin_process_database_request($input);
        self::assertSame('error', $result['type']);
        self::assertMatchesRegularExpression('/Connection failed|ext-mysqli/', $result['message']);
        self::assertStringNotContainsString('legacy-server-fixture-secret', $result['message']);
        self::assertSame([
            'gq_game_admin_database_staging' => 'legacy_staging',
            'gq_game_admin_database_production' => 'legacy_production',
        ], $GLOBALS['gq_game_admin_test_options']);
        ob_start();
        try {
            gq_game_admin_render_database_settings('staging');
            $html = ob_get_contents();
            preg_match_all('~<form\b[^>]*>.*?</form>~s', $html, $forms);
            self::assertCount(2, $forms[0]);
            $legacyForm = $forms[0][0];
            self::assertStringContainsString('value="save">', $legacyForm);
            self::assertStringContainsString('value="test">', $legacyForm);
            foreach (['password', 'host', 'port', 'user'] as $field) {
                self::assertStringNotContainsString('name="' . $field . '"', $legacyForm);
            }
            self::assertStringContainsString('value="test_entered" disabled', $forms[0][1]);
            self::assertStringNotContainsString('legacy-server-fixture-secret', $html);
        } finally {
            ob_end_clean();
        }
        $input['password'] = 'must-not-be-accepted-over-http';
        self::assertStringContainsString(
            'never submitted credentials',
            gq_game_admin_process_database_request($input)['message']
        );
    }

    public function testLegacyActionsStillRequireCapabilityPostAndEnvironmentNonce(): void
    {
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        $input = [
            'environment' => 'staging', 'database' => 'legacy_staging', 'operation' => 'save',
            '_wpnonce' => 'fixture-gq_game_admin_database_production',
        ];
        try {
            gq_game_admin_process_database_request($input);
            self::fail('Legacy cross-environment nonce was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('security check failed', $error->getMessage());
        }
        $input['_wpnonce'] = 'fixture-gq_game_admin_database_staging';
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_process_database_request($input);
            self::fail('Legacy GET action was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('require POST', $error->getMessage());
        }
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        try {
            gq_game_admin_process_database_request($input);
            self::fail('Legacy unauthorized action was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('not allowed', $error->getMessage());
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testGroupReadableLegacyJsonRemainsAuthoritativeButCannotBeOverwritten(): void
    {
        $file = $this->root . '/staging.json';
        file_put_contents($file, json_encode($this->connectionProfile(), JSON_THROW_ON_ERROR));
        chmod($file, 0640);
        chmod($this->root, 0750);
        define('GQ_GAME_ADMIN_STAGING_DB_CONFIG_FILE', $file);
        $GLOBALS['gq_game_admin_test_options'] = ['gq_game_admin_database_staging' => 'obsolete_name'];
        $body = file_get_contents($file);
        try {
            self::assertSame('private-secret', gq_game_admin_database_credentials('staging')['password']);
            self::assertSame(['name' => 'stage_database'], gq_game_admin_database_settings('staging'));
            self::assertFalse(gq_game_admin_safe_profile_path($file));
            $input = $this->databaseRequest('staging', 'stage_database');
            $input['replace_profile'] = '1';
            self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
            $input = [
                'environment' => 'staging', 'database' => 'different_name', 'operation' => 'save',
                '_wpnonce' => 'fixture-gq_game_admin_database_staging',
            ];
            self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
            self::assertSame($body, file_get_contents($file));
            self::assertSame(
                ['gq_game_admin_database_staging' => 'obsolete_name'],
                $GLOBALS['gq_game_admin_test_options']
            );
        } finally {
            chmod($file, 0600);
            chmod($this->root, 0700);
        }
    }

    public function testRejectsInvalidDatabaseNamesAndOperationsWithoutSaving(): void
    {
        foreach (['', str_repeat('a', 65), 'mysql;host=evil', 'mysql/database', ['array']] as $database) {
            $input = $this->databaseRequest('staging', 'valid_name');
            $input['database'] = $database;
            self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
        }
        foreach (['environment' => 'other', 'operation' => 'create'] as $key => $value) {
            $input = $this->databaseRequest('staging', 'valid_name');
            $input[$key] = $value;
            self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
        }
        foreach (['setup', 'migrate', 'backup', 'restore', 'configure'] as $operation) {
            $input = $this->databaseRequest('staging', 'valid_name');
            $input['operation'] = $operation;
            self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
    }

    public function testRejectsUnauthorizedDatabaseRequestsBeforeSaving(): void
    {
        $GLOBALS['gq_game_admin_test_can_manage'] = false;
        try {
            gq_game_admin_process_database_request($this->databaseRequest('staging', 'valid_name'));
            self::fail('Unauthorized database settings were accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('not allowed', $error->getMessage());
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
    }

    public function testRejectsMissingAndCrossEnvironmentNoncesBeforeSaving(): void
    {
        foreach (['', 'fixture-gq_game_admin_database_staging'] as $nonce) {
            $input = $this->databaseRequest('production', 'valid_name');
            $input['_wpnonce'] = $nonce;
            try {
                gq_game_admin_process_database_request($input);
                self::fail('Invalid database settings nonce was accepted.');
            } catch (RuntimeException $error) {
                self::assertStringContainsString('security check failed', $error->getMessage());
            }
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
    }

    public function testDatabaseHandlerRejectsGetWithoutPersistingAnything(): void
    {
        $method = $_SERVER['REQUEST_METHOD'] ?? null;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            gq_game_admin_handle_database();
            self::fail('GET database action was accepted.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('require POST', $error->getMessage());
        } finally {
            if ($method === null) {
                unset($_SERVER['REQUEST_METHOD']);
            } else {
                $_SERVER['REQUEST_METHOD'] = $method;
            }
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    public function testConnectionTestDoesNotSaveNamesOrReuseWordPressCredentials(): void
    {
        $input = $this->databaseRequest('staging', 'unsaved_database');
        $input['operation'] = 'test_entered';
        $input['password'] = '';
        $result = gq_game_admin_process_database_request($input);
        self::assertSame('error', $result['type']);
        self::assertStringContainsString('Enter a password', $result['message']);
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
    }

    public function testHttpsIsRequiredEvenWithSpoofedLocalOrProxyHeaders(): void
    {
        $GLOBALS['gq_game_admin_test_ssl'] = false;
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
        $_SERVER['HTTP_HOST'] = 'localhost';
        $_SERVER['HTTP_X_FORWARDED_FOR'] = '127.0.0.1';
        $_SERVER['HTTP_X_FORWARDED_PROTO'] = 'https';
        foreach (['save_profile', 'test_entered'] as $operation) {
            $input = $this->databaseRequest('staging', 'stage_database');
            $input['operation'] = $operation;
            $result = gq_game_admin_process_database_request($input);
            self::assertSame('error', $result['type']);
            self::assertStringContainsString('HTTPS is required', $result['message']);
            self::assertStringNotContainsString($input['password'], json_encode($result, JSON_THROW_ON_ERROR));
        }
        ob_start();
        try {
            gq_game_admin_render_database_settings('staging');
            $html = ob_get_contents();
            self::assertStringContainsString('including local development', $html);
            self::assertStringContainsString('name="password" type="password" value=""', $html);
            self::assertStringContainsString('value="test_entered" disabled', $html);
        } finally {
            ob_end_clean();
        }
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testMissingPrivateProfileStillRendersFieldsAndAllowsUnsavedTest(): void
    {
        define('GQ_GAME_ADMIN_STAGING_DB_CONFIG_FILE', $this->root . '/staging.json');
        foreach (['staging', 'production'] as $environment) {
            ob_start();
            try {
                gq_game_admin_render_database_settings($environment);
                $html = ob_get_contents();
                foreach (['database', 'host', 'port', 'user', 'password'] as $field) {
                    self::assertStringContainsString('name="' . $field . '"', $html);
                }
                self::assertStringContainsString('value="test_entered">', $html);
                self::assertStringNotContainsString($this->root, $html);
                if ($environment === 'production') {
                    self::assertStringContainsString('Profile saving unavailable', $html);
                    self::assertStringContainsString('value="save_profile" disabled', $html);
                }
            } finally {
                ob_end_clean();
            }
        }
        $input = $this->databaseRequest('staging', 'entered_database');
        $input['operation'] = 'test_entered';
        $result = gq_game_admin_process_database_request($input);
        // Port 1 on loopback is intentionally unavailable; reaching the probe needs no saved profile.
        self::assertSame('error', $result['type']);
        self::assertMatchesRegularExpression('/Connection failed|ext-mysqli/', $result['message']);
        self::assertFileDoesNotExist($this->root . '/staging.json');
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testAtomicallySavesCollectorJsonAndUsesProfileNamesWithoutOptionWrites(): void
    {
        define('GQ_GAME_ADMIN_STAGING_DB_CONFIG_FILE', $this->root . '/staging.json');
        define('GQ_GAME_ADMIN_PRODUCTION_DB_CONFIG_FILE', $this->root . '/production.json');
        $GLOBALS['gq_game_admin_test_options'] = ['gq_game_admin_database_staging' => 'legacy_name'];
        foreach (['staging' => 'stage_database', 'production' => 'production_database'] as $environment => $database) {
            $input = $this->databaseRequest($environment, $database);
            self::assertSame('success', gq_game_admin_process_database_request($input)['type']);
            $file = $this->root . '/' . $environment . '.json';
            $profile = json_decode(file_get_contents($file), true, 16, JSON_THROW_ON_ERROR);
            self::assertSame([
                'environment' => $environment, 'host' => '127.0.0.1', 'port' => 1,
                'database' => $database, 'username' => 'inspection_reader', 'password' => 'entered-fixture-secret',
            ], $profile);
            self::assertSame(0, fileperms($file) & 0077);
            self::assertSame(['name' => $database], gq_game_admin_database_settings($environment));
            self::assertSame(
                'entered-fixture-secret',
                gq_game_admin_read_database_configuration($file, $environment)['password']
            );
            require_once dirname(__DIR__, 2) . '/scripts/inspect_game_administration.php';
            try {
                gq_admin_snapshot_main([
                    '--environment=' . $environment, '--db-config=' . $file,
                    '--release-dir=' . __DIR__, '--output=' . $this->root . '/report.json',
                ]);
                self::fail('The unavailable loopback test connection unexpectedly succeeded.');
            } catch (PDOException) {
                // The actual CLI collector accepted the saved JSON and reached its connection boundary.
                self::assertFileDoesNotExist($this->root . '/report.json');
            }
            self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
            self::assertSame($profile, json_decode(file_get_contents($file), true, 16, JSON_THROW_ON_ERROR));
        }
        self::assertSame(
            ['gq_game_admin_database_staging' => 'legacy_name'],
            $GLOBALS['gq_game_admin_test_options']
        );
        self::assertSame([], glob($this->root . '/.gq-profile-*'));
        self::assertSame([], $GLOBALS['gq_wp_transients']);
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testConstantsRemainReadableAndBlankPasswordCannotFollowChangedIdentity(): void
    {
        define('GQ_GAME_ADMIN_STAGING_DB_HOST', '127.0.0.1');
        define('GQ_GAME_ADMIN_STAGING_DB_PORT', 1);
        define('GQ_GAME_ADMIN_STAGING_DB_USER', 'inspection_reader');
        define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'constant-fixture-secret');
        define('GQ_GAME_ADMIN_STAGING_EXPECTED_DATABASE', 'stage_database');
        $input = $this->databaseRequest('staging', 'stage_database');
        $input['password'] = '';
        $stored = gq_game_admin_database_configuration('staging');
        self::assertSame(
            'constant-fixture-secret',
            gq_game_admin_entered_credentials('staging', $input, $stored)['password']
        );
        $changes = ['host' => 'different.example.test', 'user' => 'different_user', 'database' => 'different_db'];
        foreach ($changes as $key => $value) {
            $changed = $input;
            $changed[$key] = $value;
            self::assertArrayHasKey('error', gq_game_admin_entered_credentials('staging', $changed, $stored));
        }
        self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
        self::assertSame($stored, gq_game_admin_database_configuration('staging'));
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testReplacementRequiresConfirmationAndFreshRevisionAndPreservesUnchangedPassword(): void
    {
        $file = $this->root . '/staging.json';
        define('GQ_GAME_ADMIN_STAGING_DB_CONFIG_FILE', $file);
        $input = $this->databaseRequest('staging', 'stage_database');
        self::assertSame('success', gq_game_admin_process_database_request($input)['type']);
        $stored = gq_game_admin_database_configuration('staging');
        $input['profile_revision'] = 'fixture-' . gq_game_admin_profile_revision('staging', $stored);
        $input['password'] = '';
        $body = file_get_contents($file);
        self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
        self::assertSame($body, file_get_contents($file));
        $input['replace_profile'] = '1';
        self::assertSame('success', gq_game_admin_process_database_request($input)['type']);
        self::assertSame($stored['password'], gq_game_admin_database_configuration('staging')['password']);
        $changes = [
            'host' => 'other.example.test', 'port' => '3307', 'user' => 'other_reader', 'database' => 'other_db',
        ];
        foreach ($changes as $key => $value) {
            $changed = $input;
            $changed[$key] = $value;
            $result = gq_game_admin_process_database_request($changed);
            self::assertSame('error', $result['type']);
            self::assertStringContainsString('Enter a password', $result['message']);
            self::assertSame($body, file_get_contents($file));
        }
        $input['password'] = 'intentional-new-fixture-secret';
        self::assertSame('success', gq_game_admin_process_database_request($input)['type']);
        $newBody = file_get_contents($file);
        self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
        self::assertSame($newBody, file_get_contents($file));
        ob_start();
        try {
            gq_game_admin_render_database_settings('staging');
            $html = ob_get_contents();
            self::assertStringNotContainsString($stored['password'], $html);
            self::assertStringNotContainsString($input['password'], $html);
            self::assertStringNotContainsString($file, $html);
        } finally {
            ob_end_clean();
        }
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testBusyDirectoryUnsafePermissionsAndInvalidExistingFileFailWithoutPartialPersistence(): void
    {
        $file = $this->root . '/staging.json';
        define('GQ_GAME_ADMIN_STAGING_DB_CONFIG_FILE', $file);
        $input = $this->databaseRequest('staging', 'stage_database');
        $lock = fopen($this->root, 'r');
        try {
            self::assertTrue(flock($lock, LOCK_EX | LOCK_NB));
            self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
            self::assertFileDoesNotExist($file);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        chmod($this->root, 0750);
        try {
            self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
            self::assertFileDoesNotExist($file);
        } finally {
            chmod($this->root, 0700);
        }
        file_put_contents($file, '{"invalid":');
        chmod($file, 0600);
        $input['replace_profile'] = '1';
        self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
        self::assertSame('{"invalid":', file_get_contents($file));
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
        self::assertSame([], glob($this->root . '/.gq-profile-*'));
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testSavingRejectsPublicMissingAndSymlinkedDirectoriesAndFiles(): void
    {
        $file = $this->root . '/staging.json';
        $target = $this->root . '/report.json';
        file_put_contents($target, json_encode($this->connectionProfile(), JSON_THROW_ON_ERROR));
        chmod($target, 0600);
        $body = file_get_contents($target);
        define('GQ_GAME_ADMIN_STAGING_DB_CONFIG_FILE', $file);
        $input = $this->databaseRequest('staging', 'stage_database');
        self::assertTrue(symlink($target, $file));
        self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
        unlink($file);
        self::assertTrue(link($target, $file));
        self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
        unlink($file);
        self::assertFalse(gq_game_admin_safe_profile_path($this->root . '/missing/config.json'));
        $link = $this->root . '/linked-directory';
        self::assertTrue(symlink($this->root, $link));
        try {
            self::assertFalse(gq_game_admin_safe_profile_path($link . '/config.json'));
        } finally {
            unlink($link);
        }
        $_SERVER['DOCUMENT_ROOT'] = $this->root;
        self::assertSame('error', gq_game_admin_process_database_request($input)['type']);
        self::assertFileDoesNotExist($file);
        self::assertSame($body, file_get_contents($target));
        self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
    }

    public function testInvalidStoredSettingsAreReportedAndEscapedNotSilentlyUsed(): void
    {
        $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = '<script>alert(1)</script>';
        self::assertArrayHasKey('error', gq_game_admin_database_settings('staging'));
        ob_start();
        gq_game_admin_render_database_settings('staging');
        $html = ob_get_clean();
        self::assertStringContainsString('configured database name is invalid', $html);
        self::assertStringNotContainsString('<script>', $html);
    }

    public function testMysqlProbeChecksExistingDatabaseAndRejectsBadCredentialsWithoutSchemaChanges(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_CONNECTION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_connection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_connection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        $root->exec("CREATE USER 'gq_connection_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $root->exec("GRANT SELECT ON gq_admin_connection.* TO 'gq_connection_reader'@'%'");
        $driver = new mysqli_driver();
        $originalMode = $driver->report_mode;
        $credentials = [
            'host' => $host[1], 'port' => 3306, 'user' => 'gq_connection_reader', 'password' => 'fixture-read-only',
        ];
        try {
            $success = gq_game_admin_probe_database($credentials, 'gq_admin_connection');
            self::assertSame('gq_admin_connection', $success['name'] ?? $success);
            self::assertNotSame('', $success['server_version']);
            $input = $this->databaseRequest('staging', 'gq_admin_connection');
            $input['operation'] = 'test_entered';
            $input['host'] = $credentials['host'];
            $input['port'] = '3306';
            $input['user'] = $credentials['user'];
            $input['password'] = $credentials['password'];
            $result = gq_game_admin_process_database_request($input);
            self::assertSame('success', $result['type']);
            self::assertStringContainsString('gq_admin_connection', $result['message']);
            self::assertStringNotContainsString($input['password'], $result['message']);
            self::assertSame([], $GLOBALS['gq_game_admin_test_options']);
            $input['password'] = 'wrong-fixture-password';
            $result = gq_game_admin_process_database_request($input);
            self::assertSame('error', $result['type']);
            self::assertStringNotContainsString($input['password'], $result['message']);
            foreach ([MYSQLI_REPORT_OFF, MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT] as $mode) {
                mysqli_report($mode);
                $wrong = $credentials;
                $wrong['password'] = 'private-fixture-must-not-leak';
                $failure = gq_game_admin_probe_database($wrong, 'gq_admin_connection');
                self::assertArrayHasKey('error', $failure);
                self::assertStringNotContainsString($wrong['password'], json_encode($failure, JSON_THROW_ON_ERROR));
                self::assertArrayHasKey('error', gq_game_admin_probe_database($credentials, 'gq_missing_database'));
                self::assertSame($mode, $driver->report_mode);
            }
            self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
            self::assertSame(0, (int)$root->query(
                "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'gq_missing_database'"
            )->fetchColumn());
        } finally {
            mysqli_report($originalMode);
            $root->exec("DROP USER 'gq_connection_reader'@'%'");
        }
    }

    public function testMysqlOverviewReturnsCountsAndReportsMissingTables(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_CONNECTION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_connection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_connection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        $root->exec("CREATE USER 'gq_overview_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $tables = [];
        try {
            $root->exec("GRANT SELECT ON gq_admin_connection.* TO 'gq_overview_reader'@'%'");
            $credentials = [
                'host' => $host[1], 'port' => 3306,
                'user' => 'gq_overview_reader', 'password' => 'fixture-read-only',
            ];
            self::assertArrayHasKey('error', gq_game_admin_query_overview($credentials, 'gq_admin_connection'));
            foreach (['users', 'star_systems', 'planets', 'colonies', 'fleets'] as $table) {
                $root->exec('CREATE TABLE `' . $table . '` (id INT NOT NULL PRIMARY KEY)');
                $tables[] = $table;
            }
            $root->exec('INSERT INTO users VALUES (1), (2)');
            $root->exec('INSERT INTO planets VALUES (1), (2), (3)');
            self::assertSame(
                ['users' => 2, 'systems' => 0, 'planets' => 3, 'colonies' => 0, 'fleets' => 0],
                gq_game_admin_query_overview($credentials, 'gq_admin_connection')
            );
            $credentials['password'] = 'incorrect-private-password';
            $failure = gq_game_admin_query_overview($credentials, 'gq_admin_connection');
            self::assertArrayHasKey('error', $failure);
            self::assertStringNotContainsString($credentials['password'], json_encode($failure, JSON_THROW_ON_ERROR));
            self::assertSame(2, (int)$root->query('SELECT COUNT(*) FROM users')->fetchColumn());
        } finally {
            foreach (array_reverse($tables) as $table) {
                $root->exec('DROP TABLE `' . $table . '`');
            }
            $root->exec("DROP USER 'gq_overview_reader'@'%'");
        }
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testMysqlVesselsKeepBigintAndNullableNameCursorsExact(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_CONNECTION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_connection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_connection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        $root->exec("CREATE USER 'gq_vessels_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $created = false;
        $post = $_POST;
        try {
            $root->exec("GRANT SELECT ON gq_admin_connection.* TO 'gq_vessels_reader'@'%'");
            define('GQ_GAME_ADMIN_STAGING_DB_HOST', $host[1]);
            define('GQ_GAME_ADMIN_STAGING_DB_USER', 'gq_vessels_reader');
            define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'fixture-read-only');
            $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_admin_connection';
            $base = [
                'action' => 'gq_game_admin_vessels', 'environment' => 'staging',
                '_wpnonce' => 'fixture-gq_game_admin_vessels_staging',
            ];
            self::assertArrayHasKey('error', gq_game_admin_process_vessels_request($base, 'staging'));
            $root->exec(
                "CREATE TABLE built_vessels (id BIGINT PRIMARY KEY, owner_user_id INT NOT NULL, colony_id INT NOT NULL,"
                . " blueprint_id BIGINT NOT NULL, name VARCHAR(100) DEFAULT NULL,"
                . " status ENUM('docked','assigned','destroyed') NOT NULL,"
                . " snapshot_stats_json JSON NOT NULL, hp_state_json JSON NOT NULL)"
            );
            $created = true;
            $insert = $root->prepare('INSERT INTO built_vessels VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $statuses = ['docked', 'assigned', 'destroyed'];
            for ($index = 1; $index <= 155; $index++) {
                $id = $index === 155 ? '9223372036854775807' : (string)(9007199254740990 + $index);
                $blueprint = $index % 2 ? '9007199254740993' : '9007199254740994';
                $name = $index === 1 ? '%_<script>fixture</script>'
                    : ($index <= 60 ? null : ($index <= 120 ? "\nAlpha" : 'Vessel'));
                $insert->execute([
                    $id, $index % 2 + 1, $index % 3 + 1, $blueprint, $name,
                    $statuses[($index - 1) % 3], '{"private_stats":1}', '{"private_hp":1}',
                ]);
            }
            $before = $root->query('SELECT * FROM built_vessels ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
            foreach (gq_game_admin_vessel_columns() as $sort => [, $expression]) {
                foreach (['asc', 'desc'] as $order) {
                    $input = $base + ['sort' => $sort, 'order' => $order];
                    $rows = [];
                    do {
                        $page = gq_game_admin_process_vessels_request($input, 'staging');
                        self::assertArrayNotHasKey('error', $page);
                        array_push($rows, ...$page['vessels']);
                        if ($page['has_more']) {
                            $last = end($page['vessels']);
                            $input['cursor_id'] = (string)$last['id'];
                            $value = (string)$last[$sort];
                            $input['cursor_value'] = $sort === 'name' ? base64_encode($value) : addslashes($value);
                        }
                    } while ($page['has_more'] && count($rows) <= 200);
                    $expected = $root->query("SELECT id FROM built_vessels ORDER BY $expression $order, id $order")
                        ->fetchAll(PDO::FETCH_COLUMN);
                    self::assertCount(155, $rows);
                    self::assertSame(array_map('strval', $expected), array_column($rows, 'id'));
                    self::assertArrayNotHasKey('snapshot_stats_json', $rows[0]);
                    self::assertArrayNotHasKey('hp_state_json', $rows[0]);
                }
            }
            $filtered = gq_game_admin_process_vessels_request($base + [
                'search' => '%_', 'owner' => '2', 'colony' => '2', 'status_filter' => 'docked',
            ], 'staging');
            self::assertSame(['9007199254740991'], array_column($filtered['vessels'], 'id'));
            self::assertSame([], gq_game_admin_process_vessels_request(
                $base + ['search' => "' OR 1=1 --"],
                'staging'
            )['vessels']);
            $_POST = $base + ['sort' => 'name', 'order' => 'asc'];
            ob_start();
            try {
                gq_game_admin_render_vessels('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('Load next page', $html);
            self::assertSame(2, substr_count($html, 'name="environment" value="staging"'));
            self::assertSame(2, substr_count($html, 'name="sort" value="name"'));
            self::assertStringContainsString('name="cursor_value" value=""', $html);
            $_POST = $base + ['search' => '%_'];
            ob_start();
            try {
                gq_game_admin_render_vessels('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('&lt;script&gt;fixture&lt;/script&gt;', $html);
            self::assertStringNotContainsString('<script>fixture</script>', $html);
            self::assertStringNotContainsString('private_stats', $html);
            self::assertStringNotContainsString('private_hp', $html);
            self::assertSame([], $GLOBALS['gq_wp_transients']);
            self::assertSame(
                $before,
                $root->query('SELECT * FROM built_vessels ORDER BY id')->fetchAll(PDO::FETCH_ASSOC)
            );
        } finally {
            $_POST = $post;
            if ($created) {
                $root->exec('DROP TABLE built_vessels');
            }
            $root->exec("DROP USER 'gq_vessels_reader'@'%'");
        }
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testMysqlShipInventoryUsesBoundFiltersAndStablePagination(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_CONNECTION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_connection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_connection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        $root->exec("CREATE USER 'gq_ship_inventory_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $created = false;
        $post = $_POST;
        try {
            $root->exec("GRANT SELECT ON gq_admin_connection.* TO 'gq_ship_inventory_reader'@'%'");
            define('GQ_GAME_ADMIN_STAGING_DB_HOST', $host[1]);
            define('GQ_GAME_ADMIN_STAGING_DB_USER', 'gq_ship_inventory_reader');
            define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'fixture-read-only');
            $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_admin_connection';
            $base = [
                'action' => 'gq_game_admin_ship_inventory', 'environment' => 'staging',
                '_wpnonce' => 'fixture-gq_game_admin_ship_inventory_staging',
            ];
            self::assertArrayHasKey('error', gq_game_admin_process_ship_inventory_request($base, 'staging'));
            $root->exec(
                'CREATE TABLE ships (id INT PRIMARY KEY, colony_id INT NOT NULL, type VARCHAR(64) NOT NULL,'
                . ' `count` INT NOT NULL, UNIQUE KEY unique_ship (colony_id,type))'
            );
            $created = true;
            $insert = $root->prepare('INSERT INTO ships VALUES (?, ?, ?, ?)');
            for ($id = 1; $id <= 155; $id++) {
                $type = $id === 1 ? '%_<script>fixture</script>' : ($id % 2 ? 'ship_alpha' : 'ship_beta');
                $insert->execute([$id, $id, $type, $id % 3 - 1]);
            }
            $before = $root->query('SELECT * FROM ships ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
            foreach (gq_game_admin_ship_inventory_columns() as $sort => [, $expression]) {
                foreach (['asc', 'desc'] as $order) {
                    $input = $base + ['sort' => $sort, 'order' => $order];
                    $rows = [];
                    do {
                        $page = gq_game_admin_process_ship_inventory_request($input, 'staging');
                        self::assertArrayNotHasKey('error', $page);
                        array_push($rows, ...$page['ships']);
                        if ($page['has_more']) {
                            $last = end($page['ships']);
                            $input['cursor_id'] = (string)$last['id'];
                            $input['cursor_value'] = addslashes((string)$last[$sort]);
                        }
                    } while ($page['has_more'] && count($rows) <= 200);
                    $expected = $root->query("SELECT id FROM ships ORDER BY $expression $order, id $order")
                        ->fetchAll(PDO::FETCH_COLUMN);
                    self::assertCount(155, $rows);
                    self::assertSame(array_map('intval', $expected), array_column($rows, 'id'));
                }
            }
            $countCases = ['positive' => ['>', 2], 'zero' => ['=', 1], 'negative' => ['<', 3]];
            foreach ($countCases as $filter => [$operator, $id]) {
                $result = gq_game_admin_process_ship_inventory_request(
                    $base + ['count_filter' => $filter, 'colony' => (string)$id],
                    'staging'
                );
                $expected = $root->query("SELECT id FROM ships WHERE colony_id = $id AND `count` $operator 0")
                    ->fetchAll(PDO::FETCH_COLUMN);
                self::assertSame(array_map('intval', $expected), array_column($result['ships'], 'id'));
            }
            self::assertSame([], gq_game_admin_process_ship_inventory_request(
                $base + ['count_filter' => 'negative', 'colony' => '2'],
                'staging'
            )['ships']);
            self::assertSame([1], array_column(gq_game_admin_process_ship_inventory_request(
                $base + ['search' => '%_'],
                'staging'
            )['ships'], 'id'));
            self::assertSame([], gq_game_admin_process_ship_inventory_request(
                $base + ['search' => "' OR 1=1 --"],
                'staging'
            )['ships']);
            $_POST = $base + ['sort' => 'type', 'order' => 'asc', 'search' => 'ship', 'count_filter' => 'positive'];
            ob_start();
            try {
                gq_game_admin_render_ship_inventory('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('Load next page', $html);
            self::assertSame(2, substr_count($html, 'name="environment" value="staging"'));
            self::assertSame(2, substr_count($html, 'name="sort" value="type"'));
            self::assertStringContainsString('name="count_filter" value="positive"', $html);
            self::assertStringContainsString('name="search" value="ship"', $html);
            $_POST = $base + ['search' => '%_'];
            ob_start();
            try {
                gq_game_admin_render_ship_inventory('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('&lt;script&gt;fixture&lt;/script&gt;', $html);
            self::assertStringNotContainsString('<script>fixture</script>', $html);
            self::assertSame([], $GLOBALS['gq_wp_transients']);
            self::assertSame($before, $root->query('SELECT * FROM ships ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
        } finally {
            $_POST = $post;
            if ($created) {
                $root->exec('DROP TABLE ships');
            }
            $root->exec("DROP USER 'gq_ship_inventory_reader'@'%'");
        }
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testMysqlShipQueuePaginatesAndFiltersWithoutProcessing(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_CONNECTION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_connection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_connection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        $root->exec("CREATE USER 'gq_ship_queue_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $created = false;
        $post = $_POST;
        try {
            $root->exec("GRANT SELECT ON gq_admin_connection.* TO 'gq_ship_queue_reader'@'%'");
            define('GQ_GAME_ADMIN_STAGING_DB_HOST', $host[1]);
            define('GQ_GAME_ADMIN_STAGING_DB_USER', 'gq_ship_queue_reader');
            define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'fixture-read-only');
            $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_admin_connection';
            $base = [
                'action' => 'gq_game_admin_ship_queue', 'environment' => 'staging',
                '_wpnonce' => 'fixture-gq_game_admin_ship_queue_staging',
            ];
            self::assertArrayHasKey('error', gq_game_admin_process_upgrade_request($base, 'staging', 'ship_queue'));
            $root->exec(
                "CREATE TABLE ship_build_queue (id INT PRIMARY KEY, colony_id INT NOT NULL,"
                . " ship_type VARCHAR(64) NOT NULL, quantity INT NOT NULL, eta DATETIME DEFAULT NULL,"
                . " status ENUM('queued','running','done','cancelled') NOT NULL,"
                . " blueprint_id INT DEFAULT NULL, cost_metal INT NOT NULL)"
            );
            $created = true;
            $insert = $root->prepare('INSERT INTO ship_build_queue VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $statuses = ['queued', 'running', 'done', 'cancelled'];
            for ($id = 1; $id <= 205; $id++) {
                $type = $id === 1 ? '%_<script>fixture</script>' : ($id % 2 ? 'ship_alpha' : 'ship_beta');
                $insert->execute([
                    $id, $id, $type, $id % 3, $id <= 110 ? null : '2024-01-02 10:00:00',
                    $statuses[($id - 1) % 4], $id % 2 ? null : 1, 42,
                ]);
            }
            $before = $root->query('SELECT * FROM ship_build_queue ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
            foreach (gq_game_admin_upgrade_columns('ship_queue') as $sort => [, $expression]) {
                foreach (['asc', 'desc'] as $order) {
                    $input = $base + ['sort' => $sort, 'order' => $order];
                    $rows = [];
                    do {
                        $page = gq_game_admin_process_upgrade_request($input, 'staging', 'ship_queue');
                        self::assertArrayNotHasKey('error', $page);
                        array_push($rows, ...$page['ship_queue']);
                        if ($page['has_more']) {
                            $last = end($page['ship_queue']);
                            $input['cursor_id'] = (string)$last['id'];
                            $input['cursor_value'] = addslashes((string)$last[$sort]);
                        }
                    } while ($page['has_more'] && count($rows) <= 250);
                    $expected = $root->query(
                        "SELECT id FROM ship_build_queue ORDER BY $expression $order, id $order"
                    )->fetchAll(PDO::FETCH_COLUMN);
                    self::assertCount(205, $rows);
                    self::assertSame(array_map('intval', $expected), array_column($rows, 'id'));
                    self::assertArrayNotHasKey('cost_metal', $rows[0]);
                    self::assertArrayNotHasKey('blueprint_id', $rows[0]);
                }
            }
            $filtered = gq_game_admin_process_upgrade_request($base + [
                'search' => 'ship', 'owner' => '10', 'scheduled' => '0', 'status_filter' => 'running',
            ], 'staging', 'ship_queue');
            self::assertSame([10], array_column($filtered['ship_queue'], 'id'));
            self::assertSame([1], array_column(gq_game_admin_process_upgrade_request(
                $base + ['search' => '%_'],
                'staging',
                'ship_queue'
            )['ship_queue'], 'id'));
            self::assertSame([], gq_game_admin_process_upgrade_request(
                $base + ['search' => "' OR 1=1 --"],
                'staging',
                'ship_queue'
            )['ship_queue']);
            $_POST = $base + [
                'sort' => 'status', 'order' => 'desc', 'search' => 'ship', 'status_filter' => 'queued',
            ];
            ob_start();
            try {
                gq_game_admin_render_upgrade_records('staging', 'ship_queue');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('Load next page', $html);
            self::assertSame(2, substr_count($html, 'name="environment" value="staging"'));
            self::assertSame(2, substr_count($html, 'name="sort" value="status"'));
            self::assertStringContainsString('name="status_filter" value="queued"', $html);
            self::assertStringContainsString('name="search" value="ship"', $html);
            $_POST = $base + ['search' => '%_'];
            ob_start();
            try {
                gq_game_admin_render_upgrade_records('staging', 'ship_queue');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('&lt;script&gt;fixture&lt;/script&gt;', $html);
            self::assertStringNotContainsString('<script>fixture</script>', $html);
            self::assertSame([], $GLOBALS['gq_wp_transients']);
            self::assertSame(
                $before,
                $root->query('SELECT * FROM ship_build_queue ORDER BY id')->fetchAll(PDO::FETCH_ASSOC)
            );
        } finally {
            $_POST = $post;
            if ($created) {
                $root->exec('DROP TABLE ship_build_queue');
            }
            $root->exec("DROP USER 'gq_ship_queue_reader'@'%'");
        }
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testMysqlBuildingQueuePaginatesAndFiltersWithoutProcessing(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_CONNECTION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_connection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_connection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        $root->exec("CREATE USER 'gq_queue_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $created = false;
        $post = $_POST;
        try {
            $root->exec("GRANT SELECT ON gq_admin_connection.* TO 'gq_queue_reader'@'%'");
            define('GQ_GAME_ADMIN_STAGING_DB_HOST', $host[1]);
            define('GQ_GAME_ADMIN_STAGING_DB_USER', 'gq_queue_reader');
            define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'fixture-read-only');
            $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_admin_connection';
            $base = [
                'action' => 'gq_game_admin_building_queue', 'environment' => 'staging',
                '_wpnonce' => 'fixture-gq_game_admin_building_queue_staging',
            ];
            self::assertArrayHasKey('error', gq_game_admin_process_upgrade_request($base, 'staging', 'building_queue'));
            $root->exec(
                "CREATE TABLE building_upgrade_queue (id INT PRIMARY KEY, colony_id INT NOT NULL,"
                . " building_type VARCHAR(64) NOT NULL, target_level INT NOT NULL, eta DATETIME DEFAULT NULL,"
                . " status ENUM('queued','running','done','cancelled') NOT NULL, cost_metal INT NOT NULL)"
            );
            $created = true;
            $insert = $root->prepare('INSERT INTO building_upgrade_queue VALUES (?, ?, ?, ?, ?, ?, ?)');
            $statuses = ['queued', 'running', 'done', 'cancelled'];
            for ($id = 1; $id <= 205; $id++) {
                $type = $id === 1 ? '%_<script>fixture</script>' : ($id % 2 ? 'mine_alpha' : 'mine_beta');
                $insert->execute([
                    $id, $id, $type, $id % 3, $id <= 110 ? null : '2024-01-02 10:00:00',
                    $statuses[($id - 1) % 4], 42,
                ]);
            }
            $before = $root->query('SELECT * FROM building_upgrade_queue ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
            foreach (gq_game_admin_upgrade_columns('building_queue') as $sort => [, $expression]) {
                foreach (['asc', 'desc'] as $order) {
                    $input = $base + ['sort' => $sort, 'order' => $order];
                    $rows = [];
                    do {
                        $page = gq_game_admin_process_upgrade_request($input, 'staging', 'building_queue');
                        self::assertArrayNotHasKey('error', $page);
                        array_push($rows, ...$page['building_queue']);
                        if ($page['has_more']) {
                            $last = end($page['building_queue']);
                            $input['cursor_id'] = (string)$last['id'];
                            $input['cursor_value'] = addslashes((string)$last[$sort]);
                        }
                    } while ($page['has_more'] && count($rows) <= 250);
                    $expected = $root->query(
                        "SELECT id FROM building_upgrade_queue ORDER BY $expression $order, id $order"
                    )->fetchAll(PDO::FETCH_COLUMN);
                    self::assertCount(205, $rows);
                    self::assertSame(array_map('intval', $expected), array_column($rows, 'id'));
                    self::assertArrayNotHasKey('cost_metal', $rows[0]);
                }
            }
            $filtered = gq_game_admin_process_upgrade_request($base + [
                'search' => 'mine', 'owner' => '10', 'scheduled' => '0', 'status_filter' => 'running',
            ], 'staging', 'building_queue');
            self::assertSame([10], array_column($filtered['building_queue'], 'id'));
            self::assertSame([1], array_column(gq_game_admin_process_upgrade_request(
                $base + ['search' => '%_'],
                'staging',
                'building_queue'
            )['building_queue'], 'id'));
            self::assertSame([], gq_game_admin_process_upgrade_request(
                $base + ['search' => "' OR 1=1 --"],
                'staging',
                'building_queue'
            )['building_queue']);
            $_POST = $base + [
                'sort' => 'status', 'order' => 'desc', 'search' => 'mine', 'status_filter' => 'queued',
            ];
            ob_start();
            try {
                gq_game_admin_render_upgrade_records('staging', 'building_queue');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('Load next page', $html);
            self::assertSame(2, substr_count($html, 'name="environment" value="staging"'));
            self::assertSame(2, substr_count($html, 'name="sort" value="status"'));
            self::assertStringContainsString('name="status_filter" value="queued"', $html);
            self::assertStringContainsString('name="search" value="mine"', $html);
            $_POST = $base + ['search' => '%_'];
            ob_start();
            try {
                gq_game_admin_render_upgrade_records('staging', 'building_queue');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('&lt;script&gt;fixture&lt;/script&gt;', $html);
            self::assertStringNotContainsString('<script>fixture</script>', $html);
            self::assertSame([], $GLOBALS['gq_wp_transients']);
            self::assertSame(
                $before,
                $root->query('SELECT * FROM building_upgrade_queue ORDER BY id')->fetchAll(PDO::FETCH_ASSOC)
            );
        } finally {
            $_POST = $post;
            if ($created) {
                $root->exec('DROP TABLE building_upgrade_queue');
            }
            $root->exec("DROP USER 'gq_queue_reader'@'%'");
        }
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testMysqlBuildingsUseStablePaginationAcrossNullEndTimes(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_CONNECTION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_connection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_connection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        $root->exec("CREATE USER 'gq_buildings_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $created = false;
        $post = $_POST;
        try {
            $root->exec("GRANT SELECT ON gq_admin_connection.* TO 'gq_buildings_reader'@'%'");
            define('GQ_GAME_ADMIN_STAGING_DB_HOST', $host[1]);
            define('GQ_GAME_ADMIN_STAGING_DB_USER', 'gq_buildings_reader');
            define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'fixture-read-only');
            $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_admin_connection';
            $base = [
                'action' => 'gq_game_admin_buildings', 'environment' => 'staging',
                '_wpnonce' => 'fixture-gq_game_admin_buildings_staging',
            ];
            self::assertArrayHasKey('error', gq_game_admin_process_upgrade_request($base, 'staging', 'buildings'));
            $root->exec(
                'CREATE TABLE buildings (id INT PRIMARY KEY, colony_id INT NOT NULL, type VARCHAR(64) NOT NULL,'
                . ' level INT NOT NULL, upgrade_end DATETIME DEFAULT NULL, UNIQUE KEY unique_building (colony_id,type))'
            );
            $created = true;
            $insert = $root->prepare('INSERT INTO buildings VALUES (?, ?, ?, ?, ?)');
            for ($id = 1; $id <= 155; $id++) {
                $type = $id === 1 ? '%_<script>fixture</script>' : ($id % 2 ? 'mine_alpha' : 'mine_beta');
                $insert->execute([$id, $id, $type, $id % 3, $id <= 85 ? null : '2024-01-02 10:00:00']);
            }
            $before = $root->query('SELECT * FROM buildings ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
            foreach (gq_game_admin_upgrade_columns('buildings') as $sort => [, $expression]) {
                foreach (['asc', 'desc'] as $order) {
                    $input = $base + ['sort' => $sort, 'order' => $order];
                    $rows = [];
                    do {
                        $page = gq_game_admin_process_upgrade_request($input, 'staging', 'buildings');
                        self::assertArrayNotHasKey('error', $page);
                        array_push($rows, ...$page['buildings']);
                        if ($page['has_more']) {
                            $last = end($page['buildings']);
                            $input['cursor_id'] = (string)$last['id'];
                            $input['cursor_value'] = addslashes((string)$last[$sort]);
                        }
                    } while ($page['has_more'] && count($rows) <= 200);
                    $expected = $root->query("SELECT id FROM buildings ORDER BY $expression $order, id $order")
                        ->fetchAll(PDO::FETCH_COLUMN);
                    self::assertCount(155, $rows);
                    self::assertSame(array_map('intval', $expected), array_column($rows, 'id'));
                }
            }
            $filtered = gq_game_admin_process_upgrade_request($base + [
                'search' => 'mine', 'owner' => '10', 'scheduled' => '0',
            ], 'staging', 'buildings');
            self::assertSame([10], array_column($filtered['buildings'], 'id'));
            self::assertSame([1], array_column(gq_game_admin_process_upgrade_request(
                $base + ['search' => '%_'],
                'staging',
                'buildings'
            )['buildings'], 'id'));
            self::assertSame([], gq_game_admin_process_upgrade_request(
                $base + ['search' => "' OR 1=1 --"],
                'staging',
                'buildings'
            )['buildings']);
            $_POST = $base + [
                'sort' => 'upgrade_end', 'order' => 'asc', 'search' => 'mine', 'scheduled' => '0',
            ];
            ob_start();
            try {
                gq_game_admin_render_buildings('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('Load next page', $html);
            self::assertSame(2, substr_count($html, 'name="environment" value="staging"'));
            self::assertSame(2, substr_count($html, 'name="sort" value="upgrade_end"'));
            self::assertStringContainsString('name="cursor_value" value=""', $html);
            self::assertStringContainsString('name="scheduled" value="0"', $html);
            self::assertStringContainsString('name="search" value="mine"', $html);
            $_POST = $base + ['search' => '%_'];
            ob_start();
            try {
                gq_game_admin_render_buildings('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('&lt;script&gt;fixture&lt;/script&gt;', $html);
            self::assertStringNotContainsString('<script>fixture</script>', $html);
            self::assertSame([], $GLOBALS['gq_wp_transients']);
            self::assertSame($before, $root->query('SELECT * FROM buildings ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
        } finally {
            $_POST = $post;
            if ($created) {
                $root->exec('DROP TABLE buildings');
            }
            $root->exec("DROP USER 'gq_buildings_reader'@'%'");
        }
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testMysqlResearchUsesStablePaginationAcrossNullEndTimes(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_CONNECTION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_connection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_connection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        $root->exec("CREATE USER 'gq_research_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $created = false;
        $post = $_POST;
        try {
            $root->exec("GRANT SELECT ON gq_admin_connection.* TO 'gq_research_reader'@'%'");
            define('GQ_GAME_ADMIN_STAGING_DB_HOST', $host[1]);
            define('GQ_GAME_ADMIN_STAGING_DB_USER', 'gq_research_reader');
            define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'fixture-read-only');
            $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_admin_connection';
            $base = [
                'action' => 'gq_game_admin_research', 'environment' => 'staging',
                '_wpnonce' => 'fixture-gq_game_admin_research_staging',
            ];
            self::assertArrayHasKey('error', gq_game_admin_process_research_request($base, 'staging'));
            $root->exec(
                'CREATE TABLE research (id INT PRIMARY KEY, user_id INT NOT NULL, type VARCHAR(64) NOT NULL,'
                . ' level INT NOT NULL, research_start DATETIME DEFAULT NULL, research_end DATETIME DEFAULT NULL,'
                . ' UNIQUE KEY unique_research (user_id, type))'
            );
            $created = true;
            $insert = $root->prepare('INSERT INTO research VALUES (?, ?, ?, ?, ?, ?)');
            for ($id = 1; $id <= 155; $id++) {
                $type = $id === 1 ? '%_<script>fixture</script>' : ($id % 2 ? 'tech_alpha' : 'tech_beta');
                $insert->execute([
                    $id, $id, $type, $id % 3, null, $id <= 85 ? null : '2024-01-02 10:00:00',
                ]);
            }
            $before = $root->query('SELECT * FROM research ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
            foreach (gq_game_admin_research_columns() as $sort => [, $expression]) {
                foreach (['asc', 'desc'] as $order) {
                    $input = $base + ['sort' => $sort, 'order' => $order];
                    $rows = [];
                    do {
                        $page = gq_game_admin_process_research_request($input, 'staging');
                        self::assertArrayNotHasKey('error', $page);
                        array_push($rows, ...$page['research']);
                        if ($page['has_more']) {
                            $last = end($page['research']);
                            $input['cursor_id'] = (string)$last['id'];
                            $input['cursor_value'] = addslashes((string)$last[$sort]);
                        }
                    } while ($page['has_more'] && count($rows) <= 200);
                    $expected = $root->query("SELECT id FROM research ORDER BY $expression $order, id $order")
                        ->fetchAll(PDO::FETCH_COLUMN);
                    self::assertCount(155, $rows);
                    self::assertSame(array_map('intval', $expected), array_column($rows, 'id'));
                }
            }
            $filtered = gq_game_admin_process_research_request($base + [
                'search' => 'tech', 'owner' => '10', 'scheduled' => '0',
            ], 'staging');
            self::assertSame([10], array_column($filtered['research'], 'id'));
            self::assertSame([1], array_column(gq_game_admin_process_research_request(
                $base + ['search' => '%_'],
                'staging'
            )['research'], 'id'));
            self::assertSame([], gq_game_admin_process_research_request(
                $base + ['search' => "' OR 1=1 --"],
                'staging'
            )['research']);
            $_POST = $base + [
                'sort' => 'research_end', 'order' => 'asc', 'search' => 'tech', 'scheduled' => '0',
            ];
            ob_start();
            try {
                gq_game_admin_render_research('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('Load next page', $html);
            self::assertSame(2, substr_count($html, 'name="environment" value="staging"'));
            self::assertSame(2, substr_count($html, 'name="sort" value="research_end"'));
            self::assertStringContainsString('name="cursor_value" value=""', $html);
            self::assertStringContainsString('name="scheduled" value="0"', $html);
            self::assertStringContainsString('name="search" value="tech"', $html);
            $_POST = $base + ['search' => '%_'];
            ob_start();
            try {
                gq_game_admin_render_research('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('&lt;script&gt;fixture&lt;/script&gt;', $html);
            self::assertStringNotContainsString('<script>fixture</script>', $html);
            self::assertSame([], $GLOBALS['gq_wp_transients']);
            self::assertSame($before, $root->query('SELECT * FROM research ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
        } finally {
            $_POST = $post;
            if ($created) {
                $root->exec('DROP TABLE research');
            }
            $root->exec("DROP USER 'gq_research_reader'@'%'");
        }
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testMysqlFleetsAreReadOnlyAndUseStableKeysetPagination(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_CONNECTION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_connection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_connection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        $root->exec("CREATE USER 'gq_fleets_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $created = false;
        $post = $_POST;
        try {
            $root->exec("GRANT SELECT ON gq_admin_connection.* TO 'gq_fleets_reader'@'%'");
            define('GQ_GAME_ADMIN_STAGING_DB_HOST', $host[1]);
            define('GQ_GAME_ADMIN_STAGING_DB_USER', 'gq_fleets_reader');
            define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'fixture-read-only');
            $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_admin_connection';
            $base = [
                'action' => 'gq_game_admin_fleets', 'environment' => 'staging',
                '_wpnonce' => 'fixture-gq_game_admin_fleets_staging',
            ];
            self::assertArrayHasKey('error', gq_game_admin_process_fleets_request($base, 'staging'));
            $root->exec(
                "CREATE TABLE fleets (id INT PRIMARY KEY, user_id INT NOT NULL,"
                . " mission ENUM('attack','transport','colonize','harvest','spy','recall','survey') NOT NULL,"
                . " `returning` TINYINT(1) NOT NULL, target_galaxy INT NOT NULL, target_system INT NOT NULL,"
                . " target_position INT NOT NULL, arrival_time DATETIME NOT NULL, ships_json TEXT NOT NULL)"
            );
            $created = true;
            $insert = $root->prepare('INSERT INTO fleets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
            for ($id = 1; $id <= 105; $id++) {
                $insert->execute([
                    $id, $id % 2 + 1, $id % 2 ? 'attack' : 'transport', $id % 2,
                    $id % 3, $id % 5, $id % 4, $id % 2 ? '2024-01-01 10:00:00' : '2024-01-02 10:00:00',
                    '{"private_ship_fixture":1}',
                ]);
            }
            $before = $root->query('SELECT * FROM fleets ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
            foreach (gq_game_admin_fleet_columns() as $sort => [, $expression]) {
                foreach (['asc', 'desc'] as $order) {
                    $input = $base + ['sort' => $sort, 'order' => $order];
                    $rows = [];
                    do {
                        $page = gq_game_admin_process_fleets_request($input, 'staging');
                        self::assertArrayNotHasKey('error', $page);
                        array_push($rows, ...$page['fleets']);
                        if ($page['has_more']) {
                            $last = end($page['fleets']);
                            $input['cursor_id'] = (string)$last['id'];
                            $input['cursor_value'] = (string)$last[$sort];
                        }
                    } while ($page['has_more'] && count($rows) <= 150);
                    $expected = $root->query("SELECT id FROM fleets ORDER BY $expression $order, id $order")
                        ->fetchAll(PDO::FETCH_COLUMN);
                    self::assertCount(105, $rows);
                    self::assertSame(array_map('intval', $expected), array_column($rows, 'id'));
                    self::assertArrayNotHasKey('ships_json', $rows[0]);
                }
            }
            $filtered = gq_game_admin_process_fleets_request($base + [
                'search' => 'transport', 'owner' => '1', 'returning' => '0',
            ], 'staging');
            self::assertCount(50, $filtered['fleets']);
            self::assertTrue($filtered['has_more']);
            self::assertSame(range(2, 100, 2), array_column($filtered['fleets'], 'id'));
            self::assertSame([], gq_game_admin_process_fleets_request(
                $base + ['search' => '%_'],
                'staging'
            )['fleets']);
            self::assertSame([], gq_game_admin_process_fleets_request(
                $base + ['search' => "' OR 1=1 --"],
                'staging'
            )['fleets']);
            $_POST = $base + [
                'sort' => 'mission', 'order' => 'desc', 'search' => 'transport', 'owner' => '1', 'returning' => '0',
            ];
            ob_start();
            try {
                gq_game_admin_render_fleets('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('Load next page', $html);
            self::assertSame(2, substr_count($html, 'name="environment" value="staging"'));
            self::assertSame(2, substr_count($html, 'name="sort" value="mission"'));
            self::assertSame(2, substr_count($html, 'name="order" value="desc"'));
            self::assertStringContainsString('name="search" value="transport"', $html);
            self::assertStringContainsString('name="owner" value="1"', $html);
            self::assertStringContainsString('name="returning" value="0"', $html);
            self::assertStringNotContainsString('private_ship_fixture', $html);
            self::assertSame([], $GLOBALS['gq_wp_transients']);
            self::assertSame($before, $root->query('SELECT * FROM fleets ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
            $root->exec('UPDATE fleets SET `returning` = 2 WHERE id = 1');
            self::assertArrayHasKey('error', gq_game_admin_process_fleets_request($base, 'staging'));
        } finally {
            $_POST = $post;
            if ($created) {
                $root->exec('DROP TABLE fleets');
            }
            $root->exec("DROP USER 'gq_fleets_reader'@'%'");
        }
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testMysqlColoniesAreReadOnlyAndUseStableKeysetPagination(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_CONNECTION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_connection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_connection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        $root->exec("CREATE USER 'gq_colonies_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $created = false;
        $post = $_POST;
        try {
            $root->exec("GRANT SELECT ON gq_admin_connection.* TO 'gq_colonies_reader'@'%'");
            define('GQ_GAME_ADMIN_STAGING_DB_HOST', $host[1]);
            define('GQ_GAME_ADMIN_STAGING_DB_USER', 'gq_colonies_reader');
            define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'fixture-read-only');
            $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_admin_connection';
            $base = [
                'action' => 'gq_game_admin_colonies', 'environment' => 'staging',
                '_wpnonce' => 'fixture-gq_game_admin_colonies_staging',
            ];
            self::assertArrayHasKey('error', gq_game_admin_process_colonies_request($base, 'staging'));
            $root->exec(
                "CREATE TABLE colonies (id INT PRIMARY KEY, user_id INT NOT NULL, name VARCHAR(64) NOT NULL,"
                . " colony_type ENUM('balanced','mining','industrial','research','agricultural','military') NOT NULL,"
                . " population INT UNSIGNED NOT NULL, last_update DATETIME NOT NULL)"
            );
            $created = true;
            $insert = $root->prepare('INSERT INTO colonies VALUES (?, ?, ?, ?, ?, ?)');
            for ($id = 1; $id <= 105; $id++) {
                $insert->execute([
                    $id, $id % 2 + 1, $id === 1 ? '' : ($id === 2 ? '%_<script>fixture</script>' : 'colony'),
                    $id % 2 ? 'balanced' : 'mining', $id === 105 ? '4294967295' : $id % 3,
                    $id % 2 ? '2024-01-01 10:00:00' : '2024-01-02 10:00:00',
                ]);
            }
            $before = $root->query('SELECT * FROM colonies ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
            foreach (gq_game_admin_colony_columns() as $sort => [, $expression]) {
                foreach (['asc', 'desc'] as $order) {
                    $input = $base + ['sort' => $sort, 'order' => $order];
                    $rows = [];
                    do {
                        $page = gq_game_admin_process_colonies_request($input, 'staging');
                        self::assertArrayNotHasKey('error', $page);
                        array_push($rows, ...$page['colonies']);
                        if ($page['has_more']) {
                            $last = end($page['colonies']);
                            $input['cursor_id'] = (string)$last['id'];
                            $input['cursor_value'] = (string)$last[$sort];
                        }
                    } while ($page['has_more'] && count($rows) <= 150);
                    $expected = $root->query("SELECT id FROM colonies ORDER BY $expression $order, id $order")
                        ->fetchAll(PDO::FETCH_COLUMN);
                    self::assertCount(105, $rows);
                    self::assertSame(array_map('intval', $expected), array_column($rows, 'id'));
                }
            }
            $emptyCursor = gq_game_admin_process_colonies_request($base + [
                'sort' => 'name', 'order' => 'asc', 'cursor_id' => '1', 'cursor_value' => '',
            ], 'staging');
            self::assertSame(2, $emptyCursor['colonies'][0]['id']);
            self::assertSame([2], array_column(gq_game_admin_process_colonies_request(
                $base + ['search' => '%_', 'owner' => '1', 'type_filter' => 'mining'],
                'staging'
            )['colonies'], 'id'));
            self::assertSame([], gq_game_admin_process_colonies_request(
                $base + ['search' => "' OR 1=1 --"],
                'staging'
            )['colonies']);
            $_POST = $base + ['sort' => 'name', 'order' => 'desc', 'search' => 'colony'];
            ob_start();
            try {
                gq_game_admin_render_colonies('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('Load next page', $html);
            self::assertSame(2, substr_count($html, 'name="environment" value="staging"'));
            self::assertSame(2, substr_count($html, 'name="sort" value="name"'));
            self::assertSame(2, substr_count($html, 'name="order" value="desc"'));
            self::assertStringContainsString('name="search" value="colony"', $html);
            $_POST = $base + ['search' => '%_'];
            ob_start();
            try {
                gq_game_admin_render_colonies('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('&lt;script&gt;fixture&lt;/script&gt;', $html);
            self::assertStringNotContainsString('<script>fixture</script>', $html);
            self::assertSame([], $GLOBALS['gq_wp_transients']);
            self::assertSame($before, $root->query('SELECT * FROM colonies ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
        } finally {
            $_POST = $post;
            if ($created) {
                $root->exec('DROP TABLE colonies');
            }
            $root->exec("DROP USER 'gq_colonies_reader'@'%'");
        }
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testMysqlPlanetsUseBoundFiltersAndStableEnumSorting(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_CONNECTION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_connection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_connection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        $root->exec("CREATE USER 'gq_planets_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $created = false;
        $post = $_POST;
        try {
            $root->exec("GRANT SELECT ON gq_admin_connection.* TO 'gq_planets_reader'@'%'");
            define('GQ_GAME_ADMIN_STAGING_DB_HOST', $host[1]);
            define('GQ_GAME_ADMIN_STAGING_DB_USER', 'gq_planets_reader');
            define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'fixture-read-only');
            $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_admin_connection';
            $base = [
                'action' => 'gq_game_admin_planets', 'environment' => 'staging',
                '_wpnonce' => 'fixture-gq_game_admin_planets_staging',
            ];
            self::assertArrayHasKey('error', gq_game_admin_process_planets_request($base, 'staging'));
            $root->exec(
                "CREATE TABLE planets (id INT PRIMARY KEY, galaxy INT NOT NULL, `system` INT NOT NULL,"
                . " position INT NOT NULL, type ENUM('terrestrial','gas_giant','ice','desert','volcanic') NOT NULL,"
                . " planet_class ENUM('rocky','super_earth','ocean','gas_giant','ice_giant','hot_jupiter',"
                . "'lava','ice_dwarf','comet_belt') NOT NULL)"
            );
            $created = true;
            $insert = $root->prepare('INSERT INTO planets VALUES (?, ?, ?, ?, ?, ?)');
            for ($id = 1; $id <= 105; $id++) {
                $insert->execute([
                    $id, $id % 3, $id % 5, $id % 4,
                    $id % 2 ? 'terrestrial' : 'gas_giant', $id % 2 ? 'rocky' : 'ocean',
                ]);
            }
            foreach (gq_game_admin_planet_columns() as $sort => [, $expression]) {
                foreach (['asc', 'desc'] as $order) {
                    $input = $base + ['sort' => $sort, 'order' => $order];
                    $rows = [];
                    do {
                        $page = gq_game_admin_process_planets_request($input, 'staging');
                        self::assertArrayNotHasKey('error', $page);
                        array_push($rows, ...$page['planets']);
                        if ($page['has_more']) {
                            $last = end($page['planets']);
                            $input['cursor_id'] = (string)$last['id'];
                            $input['cursor_value'] = (string)$last[$sort];
                        }
                    } while ($page['has_more'] && count($rows) <= 150);
                    $expected = $root->query("SELECT id FROM planets ORDER BY $expression $order, id $order")
                        ->fetchAll(PDO::FETCH_COLUMN);
                    self::assertCount(105, $rows);
                    self::assertSame(array_map('intval', $expected), array_column($rows, 'id'));
                }
            }
            $filtered = gq_game_admin_process_planets_request(
                $base + ['galaxy' => '0', 'system' => '0', 'position' => '0'],
                'staging'
            );
            self::assertSame([60], array_column($filtered['planets'], 'id'));
            self::assertCount(50, gq_game_admin_process_planets_request(
                $base + ['search' => 'ocean'],
                'staging'
            )['planets']);
            self::assertSame([], gq_game_admin_process_planets_request(
                $base + ['search' => '%_'],
                'staging'
            )['planets']);
            self::assertSame([], gq_game_admin_process_planets_request(
                $base + ['search' => "' OR 1=1 --"],
                'staging'
            )['planets']);
            $_POST = $base + ['sort' => 'type', 'order' => 'desc', 'search' => 'r'];
            ob_start();
            try {
                gq_game_admin_render_planets('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('Load next page', $html);
            self::assertSame(2, substr_count($html, 'name="environment" value="staging"'));
            self::assertStringContainsString('name="search" value="r"', $html);
            self::assertStringContainsString('name="system" value=""', $html);
            self::assertSame(2, substr_count($html, 'name="sort" value="type"'));
            self::assertSame(2, substr_count($html, 'name="order" value="desc"'));
            $_POST = $base + ['sort' => 'type', 'order' => 'desc', 'search' => 'giant', 'galaxy' => '0'];
            ob_start();
            try {
                gq_game_admin_render_planets('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('aria-sort="descending"', $html);
            self::assertStringContainsString('name="search" maxlength="128"', $html);
            self::assertStringContainsString('value="giant"', $html);
            self::assertSame([], $GLOBALS['gq_wp_transients']);
            self::assertSame(105, (int)$root->query('SELECT COUNT(*) FROM planets')->fetchColumn());
        } finally {
            $_POST = $post;
            if ($created) {
                $root->exec('DROP TABLE planets');
            }
            $root->exec("DROP USER 'gq_planets_reader'@'%'");
        }
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testMysqlUniverseUsesBoundFiltersStableSortingAndEscapedHeaders(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_CONNECTION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_connection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_connection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        $root->exec("CREATE USER 'gq_universe_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $created = false;
        $post = $_POST;
        try {
            $root->exec("GRANT SELECT ON gq_admin_connection.* TO 'gq_universe_reader'@'%'");
            define('GQ_GAME_ADMIN_STAGING_DB_HOST', $host[1]);
            define('GQ_GAME_ADMIN_STAGING_DB_USER', 'gq_universe_reader');
            define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'fixture-read-only');
            $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_admin_connection';
            $base = [
                'action' => 'gq_game_admin_universe', 'environment' => 'staging',
                '_wpnonce' => 'fixture-gq_game_admin_universe_staging',
            ];
            self::assertArrayHasKey('error', gq_game_admin_process_universe_request($base, 'staging'));
            $root->exec(
                'CREATE TABLE star_systems (id INT PRIMARY KEY, galaxy_index TINYINT UNSIGNED NOT NULL,'
                . ' system_index SMALLINT UNSIGNED NOT NULL, name VARCHAR(16) NOT NULL,'
                . ' catalog_name VARCHAR(32) NOT NULL, planet_count TINYINT UNSIGNED NOT NULL)'
            );
            $created = true;
            $insert = $root->prepare('INSERT INTO star_systems VALUES (?, ?, ?, ?, ?, ?)');
            for ($id = 1; $id <= 53; $id++) {
                $insert->execute([
                    $id, $id <= 51 ? 0 : 1, $id, $id < 3 ? '' : 'system' . $id,
                    $id === 52 ? '%_<script>fixture</script>' : 'catalog' . $id, $id % 2,
                ]);
            }
            foreach (array_keys(gq_game_admin_universe_columns()) as $sort) {
                foreach (['asc', 'desc'] as $order) {
                    $input = $base + ['sort' => $sort, 'order' => $order];
                    $first = gq_game_admin_process_universe_request($input, 'staging');
                    self::assertCount(50, $first['systems']);
                    self::assertTrue($first['has_more']);
                    $last = $first['systems'][49];
                    $second = gq_game_admin_process_universe_request($input + [
                        'cursor_id' => (string)$last['id'], 'cursor_value' => (string)$last[$sort],
                    ], 'staging');
                    self::assertCount(3, $second['systems']);
                    self::assertFalse($second['has_more']);
                    $actual = array_column(array_merge($first['systems'], $second['systems']), 'id');
                    $expected = $root->query("SELECT id FROM star_systems ORDER BY $sort $order, id $order")
                        ->fetchAll(PDO::FETCH_COLUMN);
                    self::assertSame(array_map('intval', $expected), $actual);
                }
            }
            $emptyNameCursor = gq_game_admin_process_universe_request($base + [
                'sort' => 'name', 'order' => 'asc', 'cursor_id' => '1', 'cursor_value' => '',
            ], 'staging');
            self::assertSame(2, $emptyNameCursor['systems'][0]['id']);
            $filtered = gq_game_admin_process_universe_request($base + [
                'galaxy' => '0', 'planets' => '0',
            ], 'staging');
            self::assertSame(range(2, 50, 2), array_column($filtered['systems'], 'id'));
            self::assertSame(range(1, 53, 2), array_column(gq_game_admin_process_universe_request(
                $base + ['planets' => '1'],
                'staging'
            )['systems'], 'id'));
            self::assertSame([52], array_column(gq_game_admin_process_universe_request(
                $base + ['search' => '%_'],
                'staging'
            )['systems'], 'id'));
            self::assertSame([], gq_game_admin_process_universe_request(
                $base + ['search' => "' OR 1=1 --"],
                'staging'
            )['systems']);
            $_POST = $base + ['sort' => 'name', 'order' => 'desc', 'search' => 'system'];
            ob_start();
            try {
                gq_game_admin_render_universe('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('Load next page', $html);
            self::assertSame(2, substr_count($html, 'name="environment" value="staging"'));
            self::assertStringContainsString('name="search" value="system"', $html);
            self::assertSame(2, substr_count($html, 'name="sort" value="name"'));
            self::assertSame(2, substr_count($html, 'name="order" value="desc"'));
            $_POST = $base + ['sort' => 'catalog_name', 'order' => 'asc', 'search' => 'script'];
            ob_start();
            try {
                gq_game_admin_render_universe('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('&lt;script&gt;fixture&lt;/script&gt;', $html);
            self::assertStringNotContainsString('<script>fixture</script>', $html);
            self::assertStringContainsString('form="gq-universe-controls"', $html);
            self::assertStringContainsString('aria-sort="ascending"', $html);
            self::assertStringContainsString('value="script"', $html);
            self::assertSame([], $GLOBALS['gq_wp_transients']);
            self::assertSame(53, (int)$root->query('SELECT COUNT(*) FROM star_systems')->fetchColumn());
        } finally {
            $_POST = $post;
            if ($created) {
                $root->exec('DROP TABLE star_systems');
            }
            $root->exec("DROP USER 'gq_universe_reader'@'%'");
        }
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testMysqlPlayersArePaginatedFilteredEscapedAndNotPersisted(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_CONNECTION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_connection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_connection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        $root->exec("CREATE USER 'gq_players_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $created = false;
        $post = $_POST;
        try {
            $root->exec("GRANT SELECT ON gq_admin_connection.* TO 'gq_players_reader'@'%'");
            $root->exec(
                'CREATE TABLE users (id INT PRIMARY KEY, username VARCHAR(32), control_type VARCHAR(24),'
                . ' auth_enabled TINYINT, is_admin TINYINT, deleted_at DATETIME NULL, email VARCHAR(100))'
            );
            $created = true;
            $insert = $root->prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)');
            for ($id = 1; $id <= 53; $id++) {
                $insert->execute([
                    $id, $id === 52 ? '%_<script>fixture</script>' : 'user' . $id, 'human', 1, 0,
                    $id === 53 ? '2024-01-01 00:00:00' : null, 'private-email-fixture',
                ]);
            }
            define('GQ_GAME_ADMIN_STAGING_DB_HOST', $host[1]);
            define('GQ_GAME_ADMIN_STAGING_DB_USER', 'gq_players_reader');
            define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'fixture-read-only');
            $GLOBALS['gq_game_admin_test_options']['gq_game_admin_database_staging'] = 'gq_admin_connection';
            $_POST = [
                'action' => 'gq_game_admin_players', 'environment' => 'staging',
                '_wpnonce' => 'fixture-gq_game_admin_players_staging', 'before' => '',
            ];
            $first = gq_game_admin_process_players_request($_POST, 'staging');
            self::assertCount(50, $first['players']);
            self::assertTrue($first['has_more']);
            self::assertSame(52, $first['players'][0]['id']);
            self::assertSame(3, $first['players'][49]['id']);
            ob_start();
            try {
                gq_game_admin_render_players('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('&lt;script&gt;fixture&lt;/script&gt;', $html);
            self::assertStringNotContainsString('<script>fixture</script>', $html);
            self::assertStringNotContainsString('private-email-fixture', $html);
            self::assertStringContainsString('name="before" value="3"', $html);
            $_POST['before'] = '3';
            $second = gq_game_admin_process_players_request($_POST, 'staging');
            self::assertSame([2, 1], array_column($second['players'], 'id'));
            self::assertFalse($second['has_more']);
            self::assertSame([], $GLOBALS['gq_wp_transients']);
            self::assertSame(53, (int)$root->query('SELECT COUNT(*) FROM users')->fetchColumn());
            $_POST['before'] = '';
            $_POST['player_search'] = 'user';
            $_POST['actor'] = 'human';
            $filtered = gq_game_admin_process_players_request($_POST, 'staging');
            self::assertCount(50, $filtered['players']);
            self::assertSame(51, $filtered['players'][0]['id']);
            self::assertSame(2, $filtered['players'][49]['id']);
            self::assertTrue($filtered['has_more']);
            ob_start();
            try {
                gq_game_admin_render_players('staging');
                $html = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            self::assertStringContainsString('type="hidden" name="player_search" value="user"', $html);
            self::assertStringContainsString('type="hidden" name="actor" value="human"', $html);
            self::assertStringContainsString('<option value="human" selected>', $html);
            $_POST['before'] = '2';
            self::assertSame([1], array_column(
                gq_game_admin_process_players_request($_POST, 'staging')['players'],
                'id'
            ));
            $_POST['before'] = '';
            $_POST['player_search'] = '%_';
            self::assertSame([52], array_column(
                gq_game_admin_process_players_request($_POST, 'staging')['players'],
                'id'
            ));
            $_POST['player_search'] = "' OR 1=1 --";
            self::assertSame([], gq_game_admin_process_players_request($_POST, 'staging')['players']);
            $root->exec("UPDATE users SET control_type = 'npc_engine', auth_enabled = 0 WHERE id = 2");
            $_POST['player_search'] = '';
            $_POST['actor'] = 'npc_engine';
            self::assertSame([2], array_column(
                gq_game_admin_process_players_request($_POST, 'staging')['players'],
                'id'
            ));
            self::assertSame([], $GLOBALS['gq_wp_transients']);
            $_POST['actor'] = '';
            $_POST['sort'] = 'username';
            $_POST['order'] = 'asc';
            $sorted = gq_game_admin_process_players_request($_POST, 'staging');
            self::assertCount(50, $sorted['players']);
            self::assertTrue($sorted['has_more']);
            $last = $sorted['players'][49];
            $_POST['before'] = (string)$last['id'];
            $_POST['before_value'] = $last['username'];
            $tail = gq_game_admin_process_players_request($_POST, 'staging');
            self::assertCount(2, $tail['players']);
            self::assertCount(52, array_unique(array_column(
                array_merge($sorted['players'], $tail['players']),
                'id'
            )));
            $_POST['before'] = '';
            $_POST['sort'] = 'auth_enabled';
            $byLogin = gq_game_admin_process_players_request($_POST, 'staging');
            self::assertSame(2, $byLogin['players'][0]['id']);
            self::assertSame(1, $byLogin['players'][1]['id']);
            $last = $byLogin['players'][49];
            $_POST['before'] = (string)$last['id'];
            $_POST['before_value'] = (string)$last['auth_enabled'];
            $loginTail = gq_game_admin_process_players_request($_POST, 'staging');
            self::assertCount(52, array_unique(array_column(
                array_merge($byLogin['players'], $loginTail['players']),
                'id'
            )));
            $_POST['before'] = '';
            $_POST['login'] = '0';
            self::assertSame([2], array_column(
                gq_game_admin_process_players_request($_POST, 'staging')['players'],
                'id'
            ));
            $_POST['admin'] = '1';
            self::assertSame([], gq_game_admin_process_players_request($_POST, 'staging')['players']);
        } finally {
            $_POST = $post;
            if ($created) {
                $root->exec('DROP TABLE users');
            }
            $root->exec("DROP USER 'gq_players_reader'@'%'");
        }
    }

    private function connectionProfile(): array
    {
        return [
            'environment' => 'staging', 'host' => '127.0.0.1', 'port' => 3306,
            'database' => 'stage_database', 'username' => 'private_reader', 'password' => 'private-secret',
        ];
    }

    private function databaseRequest(string $environment, string $database): array
    {
        return [
            'environment' => $environment, 'database' => $database, 'operation' => 'save_profile',
            'host' => '127.0.0.1', 'port' => '1', 'user' => 'inspection_reader', 'password' => 'entered-fixture-secret',
            '_wpnonce' => 'fixture-gq_game_admin_database_' . $environment,
            'profile_revision' => 'fixture-' . gq_game_admin_profile_revision($environment, []),
        ];
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
