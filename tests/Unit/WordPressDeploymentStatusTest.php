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
if (!function_exists('add_menu_page')) {
    function add_menu_page(...$arguments): string
    {
        $GLOBALS['gq_deployment_status_registered_menu'] = $arguments;
        return 'toplevel_page_' . $arguments[3];
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
if (!function_exists('esc_url')) {
    function esc_url(string $url): string
    {
        return htmlspecialchars($url, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
if (!function_exists('esc_html__')) {
    function esc_html__(string $text, ?string $domain = null): string
    {
        return esc_html($text);
    }
}
if (!function_exists('esc_html_e')) {
    function esc_html_e(string $text, ?string $domain = null): void
    {
        echo esc_html__($text, $domain);
    }
}
if (!function_exists('esc_attr')) {
    function esc_attr(string $text): string
    {
        return esc_html($text);
    }
}
if (!function_exists('admin_url')) {
    function admin_url(string $path): string
    {
        return 'https://wordpress.test/wp-admin/' . $path;
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
if (!function_exists('get_current_user_id')) {
    function get_current_user_id(): int
    {
        return 42;
    }
}
if (!function_exists('wp_nonce_url')) {
    function wp_nonce_url(string $url, string $action): string
    {
        return $url . '&_wpnonce=fixture-' . $action;
    }
}
if (!function_exists('check_admin_referer')) {
    function check_admin_referer(string $action): int
    {
        $GLOBALS['gq_wp_nonce_action'] = $action;
        return 1;
    }
}
if (!function_exists('wp_safe_redirect')) {
    function wp_safe_redirect(string $url): bool
    {
        throw new RuntimeException('Redirect: ' . $url);
    }
}
if (!function_exists('wp_unslash')) {
    function wp_unslash(string $text): string
    {
        return stripslashes($text);
    }
}
if (!function_exists('sanitize_key')) {
    function sanitize_key(string $text): string
    {
        return preg_replace('/[^a-z0-9_-]/', '', strtolower($text));
    }
}
if (!function_exists('sanitize_text_field')) {
    function sanitize_text_field(string $value): string
    {
        return strip_tags($value);
    }
}
// phpcs:disable Squiz.Classes.ValidClassName, PSR1.Methods.CamelCapsMethodName -- Match WordPress names.
if (!class_exists('WP_Error')) {
    class WP_Error
    {
        public function __construct(private string $code, private string $message)
        {
        }
        public function get_error_message(): string
        {
            return $this->message;
        }

        public function get_error_code(): string
        {
            return $this->code;
        }
    }
}
// phpcs:enable Squiz.Classes.ValidClassName, PSR1.Methods.CamelCapsMethodName
if (!function_exists('is_wp_error')) {
    function is_wp_error(mixed $value): bool
    {
        return $value instanceof WP_Error;
    }
}
if (!function_exists('plugin_basename')) {
    function plugin_basename(string $file): string
    {
        return $GLOBALS['gq_wp_basenames'][$file]
            ?? $GLOBALS['gq_wp_basename'] ?? 'gq-deployment-status/gq-deployment-status.php';
    }
}
if (!function_exists('plugin_dir_path')) {
    function plugin_dir_path(string $file): string
    {
        return $GLOBALS['gq_wp_installed_dir'] . '/';
    }
}
if (!function_exists('get_transient')) {
    function get_transient(string $name): mixed
    {
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
if (!function_exists('wp_remote_get')) {
    function wp_remote_get(string $url, array $args): array|WP_Error
    {
        $GLOBALS['gq_wp_requests'][] = [$url, $args];
        return $GLOBALS['gq_wp_responses'][$url] ?? new WP_Error('unexpected_request', 'Unexpected request: ' . $url);
    }

    function wp_remote_retrieve_response_code(array|WP_Error $response): int
    {
        return $response instanceof WP_Error ? 0 : ($response['response']['code'] ?? 0);
    }

    function wp_remote_retrieve_body(array|WP_Error $response): string
    {
        return $response instanceof WP_Error ? '' : ($response['body'] ?? '');
    }

    function wp_safe_remote_get(string $url, array $args): array|WP_Error
    {
        $GLOBALS['gq_wp_download_request'] = [$url, $args];
        file_put_contents($args['filename'], $GLOBALS['gq_wp_download_bytes']);
        return $GLOBALS['gq_wp_download_response'] ?? ['response' => ['code' => 200]];
    }
}
if (!function_exists('wp_tempnam')) {
    function wp_tempnam(string $name): string|false
    {
        $file = tempnam($GLOBALS['gq_wp_installed_dir'], 'download-');
        $GLOBALS['gq_wp_temporary_files'][] = $file;
        return $file;
    }

    function wp_delete_file(string $file): void
    {
        unlink($file);
    }
}

require_once dirname(__DIR__, 2) . '/wordpress-integration/gq-deployment-status.php';

final class WordPressDeploymentStatusTest extends TestCase
{
    private string $root;
    private string $gitDirectory;
    private array $query;

    protected function setUp(): void
    {
        $this->query = $_GET;
        $_GET = [];
        $GLOBALS['gq_game_admin_test_can_manage'] = true;
        $this->root = sys_get_temp_dir() . '/gq-wp-deploy-status-' . bin2hex(random_bytes(8));
        $this->gitDirectory = $this->root . '/mirror.git';
        self::assertTrue(mkdir($this->gitDirectory, 0700, true));
        self::assertNotFalse(file_put_contents(
            $this->gitDirectory . '/config',
            "[core]\n\tbare = true\n[remote \"origin\"]\n\turl = https://github.com/makr-code/GalaxyQuest.git\n"
        ));
        $GLOBALS['gq_wp_installed_dir'] = $this->root;
        $GLOBALS['gq_wp_basename'] = 'gq-deployment-status/gq-deployment-status.php';
        $GLOBALS['gq_wp_basenames'] = [];
        $GLOBALS['gq_wp_transients'] = [];
        $GLOBALS['gq_wp_ttls'] = [];
        $GLOBALS['gq_wp_requests'] = [];
        $GLOBALS['gq_wp_responses'] = [];
        $GLOBALS['gq_wp_temporary_files'] = [];
        unset($GLOBALS['gq_wp_download_request'], $GLOBALS['gq_wp_download_response']);
        self::assertNotFalse(file_put_contents(
            $this->root . '/gq-deployment-status.php',
            '<?php // installed fixture'
        ));
        self::assertNotFalse(file_put_contents($this->root . '/gq-game-admin.php', '<?php // installed fixture'));
    }

    protected function tearDown(): void
    {
        $_GET = $this->query;
        foreach ($GLOBALS['gq_wp_temporary_files'] as $file) {
            if (is_file($file)) {
                unlink($file);
            }
        }
        foreach (
            [
            '/gq-deployment-status.php',
            '/gq-game-admin.php',
            '/mirror.git/config',
            '/mirror.git/HEAD',
            '/mirror.git/packed-refs',
            '/mirror.git/refs/heads/develop',
            '/mirror.git/refs/heads/main',
            '/mirror.git/refs/heads',
            '/mirror.git/refs',
            '/state.json',
            '/mirror.git',
            '',
            ] as $path
        ) {
            $target = $this->root . $path;
            if (is_file($target)) {
                unlink($target);
            } elseif (is_dir($target)) {
                rmdir($target);
            }
        }
    }

    public function testRegistersTopLevelMenuForAdministrators(): void
    {
        $GLOBALS['gq_deployment_status_registered_menu'] = null;
        gq_deployment_status_register_menu();
        $arguments = $GLOBALS['gq_deployment_status_registered_menu'];

        self::assertIsArray($arguments);
        self::assertSame('GalaxyQuest Deployment Status', $arguments[0]);
        self::assertSame('GalaxyQuest Deployment', $arguments[1]);
        self::assertSame('manage_options', $arguments[2]);
        self::assertSame('gq-deployment-status', $arguments[3]);
        self::assertSame('gq_deployment_status_render_page', $arguments[4]);
        self::assertSame('dashicons-update', $arguments[5]);
    }

    public function testMapsStagingAndProductionToTheirBranches(): void
    {
        self::assertSame('develop', gq_deployment_status_branch_for_environment('staging'));
        self::assertSame('main', gq_deployment_status_branch_for_environment('production'));
        self::assertNull(gq_deployment_status_branch_for_environment('preview'));
    }

    public function testBuildsPleskFetchRequestWithoutDeployOperation(): void
    {
        $packet = gq_deployment_status_build_plesk_fetch_packet(
            'staging.example.test',
            'galaxyquest-develop.git'
        );

        self::assertIsString($packet);
        self::assertStringContainsString('<fetch><domain>staging.example.test</domain>', $packet);
        self::assertStringContainsString('<name>galaxyquest-develop.git</name>', $packet);
        self::assertStringNotContainsString('<deploy>', $packet);
        self::assertNull(gq_deployment_status_build_plesk_fetch_packet('staging.example.test/evil', 'repo'));
        self::assertNull(gq_deployment_status_build_plesk_fetch_packet('staging.example.test', '../repo'));
    }

    public function testParsesPleskFetchSuccessAndRejectsUnsafeOrFailedResponses(): void
    {
        $success = '<packet><extension><call><result><status>ok</status>'
            . '<git><fetch/></git></result></call></extension></packet>';
        $failure = '<packet><extension><call><result><status>error</status>'
            . '<errcode>1234</errcode><errtext>private details</errtext>'
            . '</result></call></extension></packet>';
        $unsafe = '<!DOCTYPE packet [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
            . '<packet><extension><call><result><status>ok</status></result></call></extension></packet>';

        self::assertSame(
            ['success' => true, 'error_code' => null],
            gq_deployment_status_parse_plesk_fetch_response($success)
        );
        self::assertSame(
            ['success' => false, 'error_code' => '1234'],
            gq_deployment_status_parse_plesk_fetch_response($failure)
        );
        self::assertSame(
            ['success' => false, 'error_code' => null],
            gq_deployment_status_parse_plesk_fetch_response($unsafe)
        );
    }

    public function testReadsOnlyAllowedBranchFromExpectedBareMirrorOrigin(): void
    {
        $commit = str_repeat('a', 40);
        $this->writeRef('refs/heads/develop', $commit);

        self::assertSame($commit, gq_deployment_status_read_mirror_commit($this->gitDirectory, 'develop'));
        self::assertNull(gq_deployment_status_read_mirror_commit($this->gitDirectory, '../../config'));

        $config = file_get_contents($this->gitDirectory . '/config');
        self::assertIsString($config);
        self::assertNotFalse(file_put_contents(
            $this->gitDirectory . '/config',
            str_replace('bare = true', 'bare = false', $config)
        ));
        self::assertNull(gq_deployment_status_read_mirror_commit($this->gitDirectory, 'develop'));

        self::assertNotFalse(file_put_contents(
            $this->gitDirectory . '/config',
            str_replace('bare = false', 'bare = true', $config)
        ));
        $config = file_get_contents($this->gitDirectory . '/config');
        self::assertIsString($config);
        self::assertNotFalse(file_put_contents(
            $this->gitDirectory . '/config',
            str_replace('makr-code/GalaxyQuest.git', 'attacker/GalaxyQuest.git', $config)
        ));
        self::assertNull(gq_deployment_status_read_mirror_commit($this->gitDirectory, 'develop'));
    }

    public function testReadsPackedBranchRefs(): void
    {
        $commit = str_repeat('b', 40);
        self::assertNotFalse(file_put_contents(
            $this->gitDirectory . '/packed-refs',
            "# pack-refs with: peeled fully-peeled\n{$commit} refs/heads/main\n"
        ));

        self::assertSame($commit, gq_deployment_status_read_mirror_commit($this->gitDirectory, 'main'));
    }

    public function testMissingPackedRefsIsReportedAsUnavailable(): void
    {
        self::assertNull(gq_deployment_status_read_mirror_commit($this->gitDirectory, 'main'));
    }

    public function testRequiresValidDeployedCommitAndArtifactDigest(): void
    {
        $stateFile = $this->root . '/state.json';
        $state = [
            'commit' => str_repeat('c', 40),
            'status' => 'staging-active',
            'artifact_digest' => 'sha256:' . str_repeat('d', 64),
        ];
        self::assertNotFalse(file_put_contents($stateFile, json_encode($state, JSON_THROW_ON_ERROR)));
        self::assertSame($state, gq_deployment_status_read_web_state($stateFile));

        $state['artifact_digest'] = 'sha1:invalid';
        self::assertNotFalse(file_put_contents($stateFile, json_encode($state, JSON_THROW_ON_ERROR)));
        self::assertSame(
            ['commit' => str_repeat('c', 40), 'status' => 'staging-active'],
            gq_deployment_status_read_web_state($stateFile)
        );

        $state['commit'] = 'short';
        self::assertNotFalse(file_put_contents($stateFile, json_encode($state, JSON_THROW_ON_ERROR)));
        self::assertSame([], gq_deployment_status_read_web_state($stateFile));
    }

    public function testRequiresSuccessfulFpmAcceptanceBeforeArtifactPreservation(): void
    {
        $jobs = $this->successfulJobs();
        self::assertTrue(gq_deployment_status_validate_jobs($jobs));

        $jobs['jobs'][7]['steps'][1]['conclusion'] = 'skipped';
        self::assertFalse(gq_deployment_status_validate_jobs($jobs));

        $jobs = $this->successfulJobs();
        [$jobs['jobs'][7]['steps'][0], $jobs['jobs'][7]['steps'][1]] =
            [$jobs['jobs'][7]['steps'][1], $jobs['jobs'][7]['steps'][0]];
        self::assertFalse(gq_deployment_status_validate_jobs($jobs));
    }

    public function testUnsuccessfulRunStillLinksToGitHubDetails(): void
    {
        ob_start();
        gq_deployment_status_render_github([
            'run_id' => 42,
            'conclusion' => 'failure',
            'error' => 'The latest matching CI run is not successful.',
        ]);
        $output = ob_get_clean();
        self::assertIsString($output);
        self::assertStringContainsString(
            'href="https://github.com/makr-code/GalaxyQuest/actions/runs/42"',
            $output
        );
        self::assertStringContainsString('Run #42: failure', $output);
        self::assertStringContainsString('The latest matching CI run is not successful.', $output);
    }

    public function testSelectsHighestStablePluginVersionAcrossPagesAndIgnoresGameReleases(): void
    {
        $page = array_fill(0, 100, [
            'tag_name' => 'v9.9.9', 'draft' => false, 'prerelease' => false,
        ]);
        $page[0] = $this->pluginRelease('0.3.0');
        $page[1] = array_replace($this->pluginRelease('9.9.9'), ['draft' => true]);
        $page[2] = array_replace($this->pluginRelease('8.8.8'), ['prerelease' => true]);
        $this->respond('releases?per_page=100&page=1', $page);
        $this->respond('releases?per_page=100&page=2', [$this->pluginRelease('0.4.0')]);
        $release = gq_deployment_status_get_plugin_release();

        self::assertIsArray($release);
        self::assertSame('0.4.0', $release['version']);
        self::assertCount(2, $GLOBALS['gq_wp_requests']);
        self::assertSame($release, gq_deployment_status_get_plugin_release());
        self::assertCount(2, $GLOBALS['gq_wp_requests']);
        self::assertSame(3600, $GLOBALS['gq_wp_ttls'][GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE]);
        self::assertTrue($GLOBALS['gq_wp_requests'][0][1]['sslverify']);
        self::assertSame(0, $GLOBALS['gq_wp_requests'][0][1]['redirection']);
    }

    public function testDoesNotFallBackToOlderPluginWhenHighestReleaseHasInvalidDigest(): void
    {
        $broken = $this->pluginRelease('0.4.0');
        unset($broken['assets'][0]['digest']);
        $this->respond('releases?per_page=100&page=1', [$this->pluginRelease('0.3.0'), $broken]);

        self::assertInstanceOf(WP_Error::class, gq_deployment_status_get_plugin_release());
        self::assertSame(300, $GLOBALS['gq_wp_ttls'][GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE]);
    }

    public function testDiscoveryFailsClosedOnNetworkErrorsOrPaginationLimit(): void
    {
        self::assertInstanceOf(WP_Error::class, gq_deployment_status_find_plugin_release());
        for ($page = 1; $page <= 10; $page++) {
            $this->respond('releases?per_page=100&page=' . $page, array_fill(0, 100, [
                'tag_name' => 'v1.0.0', 'draft' => false, 'prerelease' => false,
            ]));
        }
        $result = gq_deployment_status_find_plugin_release();
        self::assertInstanceOf(WP_Error::class, $result);
        self::assertSame('gq_plugin_discovery_limit', $result->get_error_code());
    }

    public function testNoPublishedPluginIsDifferentFromAnApiFailure(): void
    {
        $this->respond('releases?per_page=100&page=1', []);
        self::assertNull(gq_deployment_status_get_plugin_release());
    }

    public function testRejectsForeignOrDuplicatePluginAssets(): void
    {
        $foreign = $this->pluginRelease('0.3.0');
        $foreign['assets'][0]['browser_download_url'] = 'https://example.test/evil.zip';
        self::assertInstanceOf(WP_Error::class, gq_deployment_status_plugin_release_data($foreign));
        $duplicate = $this->pluginRelease('0.3.0');
        $duplicate['assets'][] = $duplicate['assets'][0];
        self::assertInstanceOf(WP_Error::class, gq_deployment_status_plugin_release_data($duplicate));
    }

    public function testIntegratesWordPressUpdateHookWithoutOptingIntoAutomaticInstallation(): void
    {
        self::assertContains(
            ['gq_deployment_status_plugin_update', 10, 4],
            $GLOBALS['gq_wp_hook_callbacks']['update_plugins_github.com']
        );
        $this->respond('releases?per_page=100&page=1', [$this->pluginRelease('0.3.0')]);
        $update = gq_deployment_status_plugin_update(false, [], plugin_basename(''), []);
        self::assertIsArray($update);
        self::assertSame('0.3.0', $update['version']);
        self::assertSame('gq-deployment-status', $update['slug']);
        self::assertArrayNotHasKey('autoupdate', $update);
        self::assertSame('unrelated', gq_deployment_status_plugin_update('unrelated', [], 'other/plugin.php', []));
    }

    public function testBlocksFlatFileAndHardlinkedDevelopmentInstallations(): void
    {
        $GLOBALS['gq_wp_basename'] = 'gq-deployment-status.php';
        self::assertFalse(gq_deployment_status_plugin_update(false, [], 'gq-deployment-status.php', []));
        self::assertNotNull(gq_deployment_status_plugin_update_blocker());
        $GLOBALS['gq_wp_basename'] = 'gq-deployment-status/gq-deployment-status.php';
        self::assertNull(gq_deployment_status_plugin_update_blocker());
        self::assertTrue(link($this->root . '/gq-deployment-status.php', $this->root . '/linked.php'));
        try {
            clearstatcache();
            self::assertNotNull(gq_deployment_status_plugin_update_blocker());
        } finally {
            unlink($this->root . '/linked.php');
            clearstatcache();
        }
    }

    public function testDownloadsAndVerifiesFreshReleaseRatherThanCachedPackageMetadata(): void
    {
        $bytes = $this->pluginZip('0.3.0');
        $release = $this->pluginRelease('0.3.0', $bytes);
        $this->respond('releases/tags/gq-deployment-status-v0.3.0', $release);
        $GLOBALS['gq_wp_download_bytes'] = $bytes;
        $package = $release['assets'][0]['browser_download_url'];
        $result = gq_deployment_status_plugin_download(false, $package, new stdClass(), [
            'plugin' => plugin_basename(''),
        ]);

        self::assertIsString($result);
        self::assertSame($bytes, file_get_contents($result));
        self::assertSame(1, count($GLOBALS['gq_wp_requests']));
        [$url, $args] = $GLOBALS['gq_wp_download_request'];
        self::assertSame($package, $url);
        self::assertTrue($args['sslverify']);
        self::assertArrayNotHasKey('headers', $args);
        self::assertSame(strlen($bytes) + 1, $args['limit_response_size']);
    }

    public function testDigestMismatchDeletesDownloadedFileAndReturnsWordPressError(): void
    {
        $bytes = $this->pluginZip('0.3.0');
        $release = $this->pluginRelease('0.3.0', $bytes);
        $this->respond('releases/tags/gq-deployment-status-v0.3.0', $release);
        $GLOBALS['gq_wp_download_bytes'] = str_repeat('x', strlen($bytes));
        $result = gq_deployment_status_plugin_download(
            false,
            $release['assets'][0]['browser_download_url'],
            new stdClass(),
            ['plugin' => plugin_basename('')]
        );
        self::assertInstanceOf(WP_Error::class, $result);
        self::assertSame('gq_plugin_digest', $result->get_error_code());
        self::assertFileDoesNotExist($GLOBALS['gq_wp_download_request'][1]['filename']);
    }

    public function testRefusesDowngradesWrongSourceAndPreviouslyShortCircuitedDownloads(): void
    {
        $release = $this->pluginRelease('0.1.0');
        $this->respond('releases/tags/gq-deployment-status-v0.1.0', $release);
        $extra = ['plugin' => plugin_basename('')];
        self::assertInstanceOf(WP_Error::class, gq_deployment_status_plugin_download(
            false,
            $release['assets'][0]['browser_download_url'],
            new stdClass(),
            $extra
        ));
        self::assertInstanceOf(WP_Error::class, gq_deployment_status_plugin_download(
            false,
            'https://example.test/evil.zip',
            new stdClass(),
            $extra
        ));
        self::assertInstanceOf(WP_Error::class, gq_deployment_status_plugin_download(
            '/unverified/file.zip',
            'https://example.test/evil.zip',
            new stdClass(),
            $extra
        ));
        self::assertArrayNotHasKey('gq_wp_download_request', $GLOBALS);
        self::assertSame(false, gq_deployment_status_plugin_download(
            false,
            'https://example.test/other.zip',
            new stdClass(),
            ['plugin' => 'other/plugin.php']
        ));
    }

    public function testRejectsTraversalForeignRootAndWrongVersionInsideZip(): void
    {
        foreach (
            [
            ['0.3.0', '../escape.php'],
            ['0.3.0', 'other/plugin.php'],
            ['9.9.9', 'gq-deployment-status/gq-deployment-status.php'],
            ] as [$version, $entry]
        ) {
            $bytes = $this->pluginZip($version, $entry);
            $file = $this->root . '/fixture.zip';
            try {
                file_put_contents($file, $bytes);
                self::assertNotNull(gq_deployment_status_plugin_zip_error($file, '0.3.0'));
            } finally {
                unlink($file);
            }
        }
    }

    public function testInvalidatesPluginReleaseCacheOnlyAfterOwnPluginUpdate(): void
    {
        $GLOBALS['gq_wp_transients'][GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE] = ['release' => null];
        gq_deployment_status_plugin_updated(new stdClass(), [
            'type' => 'plugin', 'action' => 'update', 'plugins' => ['other/plugin.php'],
        ]);
        self::assertIsArray(get_transient(GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE));
        gq_deployment_status_plugin_updated(new stdClass(), [
            'type' => 'plugin', 'action' => 'update', 'plugins' => [plugin_basename('')],
        ]);
        self::assertFalse(get_transient(GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE));
    }

    public function testAdministrationChannelAndCacheAreIndependentOfDeploymentAndGameReleases(): void
    {
        $admin = $this->administrationUpdater();
        $this->respond('releases?per_page=100&page=1', [
            $this->pluginRelease('9.9.9'),
            $this->pluginRelease('0.2.0', 'fixture', 'gq-game-admin'),
            ['tag_name' => 'v99.0.0', 'draft' => false, 'prerelease' => false],
        ]);
        $update = $admin->update(false, [], 'gq-game-admin/gq-game-admin.php', []);
        self::assertIsArray($update);
        self::assertSame('gq-game-admin', $update['slug']);
        self::assertSame('0.2.0', $update['version']);
        self::assertArrayNotHasKey('autoupdate', $update);
        self::assertSame('unchanged', $admin->update('unchanged', [], plugin_basename(''), []));
        self::assertSame('9.9.9', gq_deployment_status_get_plugin_release()['version']);
        self::assertSame('0.2.0', $admin->getRelease()['version']);
        self::assertCount(2, $GLOBALS['gq_wp_requests']);
        $options = ['type' => 'plugin', 'action' => 'update', 'plugins' => [plugin_basename('')]];
        $admin->updated(new stdClass(), $options);
        gq_deployment_status_plugin_updated(new stdClass(), $options);
        self::assertFalse(get_transient(GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE));
        self::assertIsArray(get_transient('gq_game_admin_plugin_release'));
        $admin->updated(new stdClass(), [
            'type' => 'plugin', 'action' => 'update', 'plugins' => ['gq-game-admin/gq-game-admin.php'],
        ]);
        self::assertFalse(get_transient('gq_game_admin_plugin_release'));
    }

    public function testAdministrationDownloadsRequireOwnZipRootAndMatchingDigest(): void
    {
        $admin = $this->administrationUpdater();
        $valid = $this->pluginZip('0.2.0', null, 'gq-game-admin');
        $foreign = $this->pluginZip('0.2.0');
        $cases = [[$valid, $valid, null], [$foreign, $foreign, 'gq_plugin_zip'],
            [$valid, str_repeat('x', strlen($valid)), 'gq_plugin_digest']];
        foreach ($cases as [$expected, $download, $error]) {
            $release = $this->pluginRelease('0.2.0', $expected, 'gq-game-admin');
            $this->respond('releases/tags/gq-game-admin-v0.2.0', $release);
            $GLOBALS['gq_wp_download_bytes'] = $download;
            $result = $admin->download(false, $release['assets'][0]['browser_download_url'], new stdClass(), [
                'plugin' => 'gq-game-admin/gq-game-admin.php',
            ]);
            if ($error === null) {
                self::assertIsString($result);
                self::assertSame($valid, file_get_contents($result));
            } else {
                self::assertInstanceOf(WP_Error::class, $result);
                self::assertSame($error, $result->get_error_code());
                self::assertFileDoesNotExist($GLOBALS['gq_wp_download_request'][1]['filename']);
            }
            self::assertArrayNotHasKey('headers', $GLOBALS['gq_wp_download_request'][1]);
        }
    }

    public function testRejectsPackagesMissingBundledUpdater(): void
    {
        $bytes = $this->pluginZip('0.3.0', null, 'gq-deployment-status', false);
        $file = $this->root . '/fixture.zip';
        try {
            file_put_contents($file, $bytes);
            self::assertNotNull(gq_deployment_status_plugin_zip_error($file, '0.3.0'));
        } finally {
            unlink($file);
        }
    }

    public function testAdministrationFlatFileInstallationDoesNotCheckForUpdates(): void
    {
        $admin = $this->administrationUpdater();
        $GLOBALS['gq_wp_basenames'][$this->root . '/gq-game-admin.php'] = 'gq-game-admin.php';
        self::assertNotNull($admin->blocker());
        self::assertFalse($admin->update(false, [], 'gq-game-admin.php', []));
        self::assertSame([], $GLOBALS['gq_wp_requests']);
    }

    public function testEnvironmentTabsDefaultToStagingAndRenderOnlyItsReport(): void
    {
        $html = $this->renderPage();
        self::assertStringContainsString('id="gq-deployment-status-staging"', $html);
        self::assertStringNotContainsString('id="gq-deployment-status-production"', $html);
        self::assertStringContainsString('staging-evidence', $html);
        self::assertStringNotContainsString('production-evidence', $html);
        self::assertSame(1, substr_count($html, 'aria-current="page"'));
        self::assertSame([], $GLOBALS['gq_wp_requests']);
    }

    public function testProductionTabRendersOnlyProductionAndKeepsRefreshSelection(): void
    {
        $_GET['environment'] = 'production';
        $html = $this->renderPage();
        self::assertStringContainsString('id="gq-deployment-status-production"', $html);
        self::assertStringNotContainsString('id="gq-deployment-status-staging"', $html);
        self::assertStringContainsString('production-evidence', $html);
        self::assertStringNotContainsString('staging-evidence', $html);
        self::assertStringContainsString('gq_refresh=1&amp;environment=production', $html);
        self::assertSame(1, substr_count($html, 'nav-tab-active'));
    }

    public function testRefreshingProductionDoesNotFetchInactiveStagingReport(): void
    {
        $_GET = ['environment' => 'production', 'gq_refresh' => '1'];
        $this->renderPage();
        $urls = array_column($GLOBALS['gq_wp_requests'], 0);
        self::assertContains('https://api.github.com/repos/makr-code/GalaxyQuest/commits/main', $urls);
        self::assertNotContains('https://api.github.com/repos/makr-code/GalaxyQuest/commits/develop', $urls);
        self::assertSame('gq_deployment_status_refresh', $GLOBALS['gq_wp_nonce_action']);
    }

    public function testRejectsUnknownOrArrayEnvironmentBeforeReadingDeploymentReports(): void
    {
        foreach (['other', ['production']] as $environment) {
            $_GET['environment'] = $environment;
            try {
                gq_deployment_status_render_page();
                self::fail('Invalid deployment tab was accepted.');
            } catch (RuntimeException $error) {
                self::assertStringContainsString('Unknown deployment environment', $error->getMessage());
            }
        }
        self::assertSame([], $GLOBALS['gq_wp_requests']);
    }

    public function testPleskFetchRedirectReturnsToProductionTab(): void
    {
        $post = $_POST;
        $_POST = ['environment' => 'production'];
        try {
            gq_deployment_status_handle_plesk_fetch();
            self::fail('Expected redirect interception.');
        } catch (RuntimeException $error) {
            self::assertSame(
                'Redirect: https://wordpress.test/wp-admin/admin.php?page=gq-deployment-status&environment=production',
                $error->getMessage()
            );
        } finally {
            $_POST = $post;
        }
        self::assertSame([], $GLOBALS['gq_wp_requests']);
    }

    private function renderPage(): string
    {
        foreach (['staging', 'production'] as $environment) {
            $GLOBALS['gq_wp_transients']['gq_deployment_status_' . $environment] = [
                'github' => ['error' => $environment . '-evidence'], 'mirror' => [], 'web' => [],
                'mirror_match' => null, 'web_match' => null,
            ];
        }
        $GLOBALS['gq_wp_transients'][GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE] = ['release' => null];
        ob_start();
        try {
            gq_deployment_status_render_page();
            $html = ob_get_contents();
            self::assertIsString($html);
            return $html;
        } finally {
            ob_end_clean();
        }
    }

    private function administrationUpdater(): \GalaxyQuest\WordPress\GitHubPluginUpdaterV1
    {
        $file = $this->root . '/gq-game-admin.php';
        $GLOBALS['gq_wp_basenames'][$file] = 'gq-game-admin/gq-game-admin.php';
        return new \GalaxyQuest\WordPress\GitHubPluginUpdaterV1(
            $file,
            'gq-game-admin',
            'GalaxyQuest Administration',
            '0.1.0',
            'https://github.com/makr-code/GalaxyQuest/tree/main/wordpress-integration/gq-game-admin.php',
            'gq_game_admin_plugin_release',
            'GQ_GAME_ADMIN_GITHUB_TOKEN'
        );
    }

    private function respond(string $endpoint, array $data): void
    {
        $GLOBALS['gq_wp_responses']['https://api.github.com/repos/makr-code/GalaxyQuest/' . $endpoint] = [
            'response' => ['code' => 200], 'body' => json_encode($data, JSON_THROW_ON_ERROR),
        ];
    }

    private function pluginRelease(
        string $version,
        string $bytes = 'fixture',
        string $slug = 'gq-deployment-status'
    ): array {
        $tag = $slug . '-v' . $version;
        $name = $slug . '-' . $version . '.zip';
        return [
            'tag_name' => $tag, 'draft' => false, 'prerelease' => false,
            'assets' => [[
                'name' => $name, 'state' => 'uploaded', 'size' => strlen($bytes),
                'digest' => 'sha256:' . hash('sha256', $bytes),
                'browser_download_url' => 'https://github.com/makr-code/GalaxyQuest/releases/download/'
                    . $tag . '/' . $name,
            ]],
        ];
    }

    private function pluginZip(
        string $version,
        ?string $entry = null,
        string $slug = 'gq-deployment-status',
        bool $includeUpdater = true
    ): string {
        $entry ??= $slug . '/' . $slug . '.php';
        $name = $slug === 'gq-game-admin' ? 'GalaxyQuest Administration' : 'GalaxyQuest Deployment Status';
        $file = $this->root . '/fixture.zip';
        $zip = new ZipArchive();
        self::assertTrue($zip->open($file, ZipArchive::CREATE | ZipArchive::OVERWRITE));
        self::assertTrue($zip->addFromString(
            $entry,
            "<?php\n/**\n * Plugin Name: " . $name . "\n * Version: " . $version . "\n */\n"
        ));
        if ($includeUpdater) {
            self::assertTrue($zip->addFromString($slug . '/gq-github-plugin-updater.php', '<?php // updater fixture'));
        }
        self::assertTrue($zip->close());
        $bytes = file_get_contents($file);
        self::assertIsString($bytes);
        unlink($file);
        return $bytes;
    }

    private function writeRef(string $ref, string $commit): void
    {
        $path = $this->gitDirectory . '/' . $ref;
        self::assertTrue(mkdir(dirname($path), 0700, true));
        self::assertNotFalse(file_put_contents($path, $commit . "\n"));
    }

    /** @return array{total_count: int, jobs: list<array<string, mixed>>} */
    private function successfulJobs(): array
    {
        $jobs = array_map(static fn(string $name): array => [
            'name' => $name,
            'status' => 'completed',
            'conclusion' => 'success',
        ], GQ_DEPLOYMENT_STATUS_REQUIRED_JOBS);
        $jobs[7]['steps'] = [
            [
                'name' => GQ_DEPLOYMENT_STATUS_ACCEPTANCE_STEP,
                'status' => 'completed',
                'conclusion' => 'success',
            ],
            [
                'name' => GQ_DEPLOYMENT_STATUS_ARTIFACT_STEP,
                'status' => 'completed',
                'conclusion' => 'success',
            ],
        ];
        return ['total_count' => count($jobs), 'jobs' => $jobs];
    }
}
