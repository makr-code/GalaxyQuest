<?php

/**
 * Plugin Name: GalaxyQuest Deployment Status
 * Description: Read-only deployment status and controlled Plesk Git fetch operations.
 * Version: 0.2.0
 * Requires at least: 6.5
 * Requires PHP: 8.2
 * Update URI: https://github.com/makr-code/GalaxyQuest/tree/main/wordpress-integration
 */

/* phpcs:ignoreFile PSR1.Files.SideEffects.FoundWithSymbols -- WordPress plugins register hooks at file scope. */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

const GQ_DEPLOYMENT_STATUS_REPOSITORY = 'makr-code/GalaxyQuest';
const GQ_DEPLOYMENT_STATUS_WORKFLOW = '.github/workflows/ci.yml';
const GQ_DEPLOYMENT_STATUS_REQUIRED_JOBS = [
    'PHP Syntax, PSR-12 and PHPStan Level 5',
    'JavaScript Architecture Validation',
    'PHPUnit Unit Tests (SQLite)',
    'PHPUnit Tests',
    'Native PHP 8.4 and MariaDB 11.8',
    'Vitest Unit Tests',
    'Playwright E2E Smoke Test',
    'Build & Publish Docker Image',
];
const GQ_DEPLOYMENT_STATUS_ACCEPTANCE_STEP =
    'Accept native candidate on PHP 8.4 FPM behind Apache with WordPress routing';
const GQ_DEPLOYMENT_STATUS_ARTIFACT_STEP = 'Preserve non-deployable native candidate';
const GQ_DEPLOYMENT_STATUS_PLUGIN_VERSION = '0.2.0';
const GQ_DEPLOYMENT_STATUS_PLUGIN_SLUG = 'gq-deployment-status';
const GQ_DEPLOYMENT_STATUS_PLUGIN_UPDATE_URI =
    'https://github.com/makr-code/GalaxyQuest/tree/main/wordpress-integration';
const GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE = 'gq_deployment_status_plugin_release';

function gq_deployment_status_register_menu(): void
{
    add_menu_page(
        __('GalaxyQuest Deployment Status', 'gq-deployment-status'),
        __('GalaxyQuest Deployment', 'gq-deployment-status'),
        'manage_options',
        'gq-deployment-status',
        'gq_deployment_status_render_page',
        'dashicons-update'
    );
}
add_action('admin_menu', 'gq_deployment_status_register_menu');
add_action('admin_post_gq_deployment_status_fetch_git', 'gq_deployment_status_handle_plesk_fetch');
add_filter('update_plugins_github.com', 'gq_deployment_status_plugin_update', 10, 4);
add_filter('plugins_api', 'gq_deployment_status_plugin_information', 10, 3);
add_filter('upgrader_pre_download', 'gq_deployment_status_plugin_download', 20, 4);
add_action('admin_notices', 'gq_deployment_status_plugin_update_notice');
add_action('upgrader_process_complete', 'gq_deployment_status_plugin_updated', 10, 2);

function gq_deployment_status_render_page(): void
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to view deployment status.', 'gq-deployment-status'));
    }

    if (isset($_GET['gq_refresh'])) {
        check_admin_referer('gq_deployment_status_refresh');
        delete_transient('gq_deployment_status_staging');
        delete_transient('gq_deployment_status_production');
        delete_transient(GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE);
    }
    $reports = [
        'staging' => gq_deployment_status_get_report('staging'),
        'production' => gq_deployment_status_get_report('production'),
    ];
    $notice = gq_deployment_status_take_notice();
    $refreshUrl = wp_nonce_url(
        admin_url('admin.php?page=gq-deployment-status&gq_refresh=1'),
        'gq_deployment_status_refresh'
    );
    ?>
    <div class="wrap">
        <h1><?php esc_html_e('GalaxyQuest Deployment Status', 'gq-deployment-status'); ?></h1>
        <p>
            <?php esc_html_e(
                'Status is read-only. Plesk Git fetch updates repository metadata only; it never deploys to a webroot.',
                'gq-deployment-status'
            ); ?>
        </p>
        <?php if ($notice !== null) : ?>
            <div class="notice notice-<?php echo esc_attr($notice['type']); ?> is-dismissible">
                <p><?php echo esc_html($notice['message']); ?></p>
            </div>
        <?php endif; ?>
        <p><a class="button" href="<?php echo esc_url($refreshUrl); ?>">
            <?php esc_html_e('Refresh status', 'gq-deployment-status'); ?>
        </a></p>
        <?php foreach ([
            'staging' => ['label' => 'Staging', 'branch' => 'develop'],
            'production' => ['label' => 'Production', 'branch' => 'main'],
        ] as $environment => $details) : ?>
            <h2><?php echo esc_html($details['label']); ?> — <?php echo esc_html($details['branch']); ?></h2>
            <?php gq_deployment_status_render_environment($environment, $reports[$environment]); ?>
        <?php endforeach; ?>
        <h2><?php esc_html_e('Promote staging to production', 'gq-deployment-status'); ?></h2>
        <p class="description">
            <?php esc_html_e(
                'Production promotion is locked: the current CI package is non-deployable and a server-side atomic activation/rollback runner is not implemented. Plesk Git deploy is intentionally not called.',
                'gq-deployment-status'
            ); ?>
        </p>
        <button type="button" class="button button-primary" disabled>
            <?php esc_html_e('Promote verified staging release', 'gq-deployment-status'); ?>
        </button>
        <?php gq_deployment_status_render_plugin_updates(); ?>
    </div>
    <?php
}

function gq_deployment_status_render_environment(string $environment, array $report): void
{
    ?>
    <table class="widefat striped">
        <thead>
            <tr>
                <th><?php esc_html_e('Source', 'gq-deployment-status'); ?></th>
                <th><?php esc_html_e('Commit', 'gq-deployment-status'); ?></th>
                <th><?php esc_html_e('Status / evidence', 'gq-deployment-status'); ?></th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <th><?php esc_html_e('GitHub branch and CI', 'gq-deployment-status'); ?></th>
                <td><code><?php echo esc_html($report['github']['commit'] ?? 'unavailable'); ?></code></td>
                <td><?php gq_deployment_status_render_github($report['github']); ?></td>
            </tr>
            <tr>
                <th><?php esc_html_e('Plesk Git mirror', 'gq-deployment-status'); ?></th>
                <td><code><?php echo esc_html($report['mirror']['commit'] ?? 'not configured'); ?></code></td>
                <td><?php gq_deployment_status_render_match($report['mirror_match']); ?></td>
            </tr>
            <tr>
                <th><?php esc_html_e('Web release state', 'gq-deployment-status'); ?></th>
                <td><code><?php echo esc_html($report['web']['commit'] ?? 'not configured'); ?></code></td>
                <td>
                    <?php
                    $webStatus = $report['web']['status']
                        ?? __('No trusted deployment manifest found.', 'gq-deployment-status');
                    echo esc_html($webStatus);
                    if (isset($report['web']['artifact_digest'])) {
                        echo '<br>' . esc_html__('Artifact SHA-256:', 'gq-deployment-status') . ' ';
                        echo '<code>' . esc_html($report['web']['artifact_digest']) . '</code>';
                    }
                    if (isset($report['github']['artifact']['digest'])) {
                        echo '<br>' . esc_html__('CI artifact SHA-256:', 'gq-deployment-status') . ' ';
                        echo '<code>' . esc_html($report['github']['artifact']['digest']) . '</code>';
                    }
                    gq_deployment_status_render_match($report['web_match']);
                    ?>
                </td>
            </tr>
        </tbody>
    </table>
    <?php gq_deployment_status_render_fetch_form($environment); ?>
    <?php
}

function gq_deployment_status_render_fetch_form(string $environment): void
{
    $settings = gq_deployment_status_plesk_settings($environment);
    if ($settings === null) {
        echo '<p class="description">'
            . esc_html__('Plesk Git fetch is disabled until its HTTPS endpoint, API key, domain, and repository are configured in wp-config.php.', 'gq-deployment-status')
            . '</p>';
        return;
    }
    ?>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="gq_deployment_status_fetch_git">
        <input type="hidden" name="environment" value="<?php echo esc_attr($environment); ?>">
        <?php wp_nonce_field('gq_deployment_status_fetch_git_' . $environment); ?>
        <button type="submit" class="button">
            <?php esc_html_e('Fetch Plesk Git mirror (no webroot deploy)', 'gq-deployment-status'); ?>
        </button>
    </form>
    <?php
}

function gq_deployment_status_render_github(array $github): void
{
    if (!isset($github['run_id'])) {
        echo esc_html(
            $github['error'] ?? __('No successful CI run for the current branch commit.', 'gq-deployment-status')
        );
        return;
    }

    $runUrl = 'https://github.com/' . GQ_DEPLOYMENT_STATUS_REPOSITORY . '/actions/runs/' . $github['run_id'];
    printf(
        '<a href="%1$s" rel="noopener noreferrer" target="_blank">%2$s</a>',
        esc_url($runUrl),
        esc_html(sprintf(__('Run #%d: %s', 'gq-deployment-status'), $github['run_id'], $github['conclusion']))
    );
    if (isset($github['error'])) {
        echo '<br>' . esc_html($github['error']);
        return;
    }
    if (isset($github['artifact']['name'], $github['artifact']['id'])) {
        echo '<br>'
            . esc_html($github['artifact']['name'])
            . ' (#'
            . esc_html((string)$github['artifact']['id'])
            . ')';
        echo '<br>' . esc_html__(
            'CI acceptance passed; artifact is not a deployment approval.',
            'gq-deployment-status'
        );
    }
}

function gq_deployment_status_render_match(?bool $matches): void
{
    if ($matches === null) {
        echo '<br>' . esc_html__('Comparison unavailable until both sources are configured.', 'gq-deployment-status');
        return;
    }
    $matchStatus = $matches
        ? __('Matches GitHub branch commit.', 'gq-deployment-status')
        : __('Does not match GitHub branch commit.', 'gq-deployment-status');
    echo '<br><strong>' . esc_html($matchStatus) . '</strong>';
}

/** @return array{github: array<string, mixed>, mirror: array<string, mixed>, web: array<string, mixed>, mirror_match: ?bool, web_match: ?bool} */
function gq_deployment_status_get_report(string $environment): array
{
    $branch = gq_deployment_status_branch_for_environment($environment);
    if ($branch === null) {
        return [
            'github' => ['error' => __('Unknown deployment environment.', 'gq-deployment-status')],
            'mirror' => ['commit' => null],
            'web' => [],
            'mirror_match' => null,
            'web_match' => null,
        ];
    }
    $cacheKey = 'gq_deployment_status_' . $environment;
    $cached = get_transient($cacheKey);
    if (is_array($cached)) {
        return $cached;
    }

    $github = gq_deployment_status_get_github_evidence($branch);
    $mirrorCommit = gq_deployment_status_read_mirror_commit(
        gq_deployment_status_environment_path($environment, 'GIT_DIR'),
        $branch
    );
    $web = gq_deployment_status_read_web_state(
        gq_deployment_status_environment_path($environment, 'STATE_FILE')
    );
    $githubCommit = $github['commit'] ?? null;

    $report = [
        'github' => $github,
        'mirror' => ['commit' => $mirrorCommit],
        'web' => $web,
        'mirror_match' => is_string($githubCommit) && is_string($mirrorCommit)
            ? hash_equals($githubCommit, $mirrorCommit) : null,
        'web_match' => is_string($githubCommit) && is_string($web['commit'] ?? null)
            ? hash_equals($githubCommit, $web['commit']) : null,
    ];
    set_transient($cacheKey, $report, 60);
    return $report;
}

function gq_deployment_status_branch_for_environment(string $environment): ?string
{
    return match ($environment) {
        'staging' => 'develop',
        'production' => 'main',
        default => null,
    };
}

function gq_deployment_status_environment_path(string $environment, string $suffix): string
{
    if (
        !in_array($environment, ['staging', 'production'], true)
        || !in_array($suffix, ['GIT_DIR', 'STATE_FILE'], true)
    ) {
        return '';
    }
    $constant = 'GQ_DEPLOY_STATUS_' . strtoupper($environment) . '_' . $suffix;
    if (defined($constant) && is_string(constant($constant))) {
        return constant($constant);
    }
    if (
        defined('GQ_DEPLOY_STATUS_ENVIRONMENT')
        && GQ_DEPLOY_STATUS_ENVIRONMENT === $environment
    ) {
        $legacyConstant = 'GQ_DEPLOY_STATUS_' . $suffix;
        if (defined($legacyConstant) && is_string(constant($legacyConstant))) {
            return constant($legacyConstant);
        }
    }
    return '';
}

/**
 * @return array{endpoint: string, api_key: string, domain: string, repository: string}|null
 */
function gq_deployment_status_plesk_settings(string $environment): ?array
{
    if (!in_array($environment, ['staging', 'production'], true)) {
        return null;
    }
    $repoConstant = 'GQ_DEPLOY_STATUS_PLESK_' . strtoupper($environment) . '_REPOSITORY';
    $domainConstant = 'GQ_DEPLOY_STATUS_PLESK_' . strtoupper($environment) . '_DOMAIN';
    foreach ([
        'GQ_DEPLOY_STATUS_PLESK_API_URL',
        'GQ_DEPLOY_STATUS_PLESK_API_KEY',
        $domainConstant,
        $repoConstant,
    ] as $constant) {
        if (!defined($constant) || !is_string(constant($constant)) || constant($constant) === '') {
            return null;
        }
    }

    $endpoint = GQ_DEPLOY_STATUS_PLESK_API_URL;
    $parts = parse_url($endpoint);
    if (
        !is_array($parts)
        || ($parts['scheme'] ?? null) !== 'https'
        || !is_string($parts['host'] ?? null)
        || preg_match('/\A[a-z0-9.-]+\z/i', $parts['host']) !== 1
        || ($parts['port'] ?? null) !== 8443
        || ($parts['path'] ?? null) !== '/enterprise/control/agent.php'
        || isset($parts['user'])
        || isset($parts['pass'])
        || isset($parts['query'])
        || isset($parts['fragment'])
        || preg_match('/[\r\n]/', GQ_DEPLOY_STATUS_PLESK_API_KEY) === 1
    ) {
        return null;
    }
    $domain = constant($domainConstant);
    $repository = constant($repoConstant);
    if (
        filter_var($domain, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME) === false
        || preg_match('/\A[A-Za-z0-9._-]{1,128}\z/D', $repository) !== 1
    ) {
        return null;
    }
    return [
        'endpoint' => $endpoint,
        'api_key' => GQ_DEPLOY_STATUS_PLESK_API_KEY,
        'domain' => $domain,
        'repository' => $repository,
    ];
}

function gq_deployment_status_build_plesk_fetch_packet(string $domain, string $repository): ?string
{
    if (
        filter_var($domain, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME) === false
        || preg_match('/\A[A-Za-z0-9._-]{1,128}\z/D', $repository) !== 1
    ) {
        return null;
    }
    $domainXml = htmlspecialchars($domain, ENT_XML1 | ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $repositoryXml = htmlspecialchars($repository, ENT_XML1 | ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    return '<?xml version="1.0" encoding="UTF-8"?>'
        . '<packet><extension><call><git><fetch><domain>'
        . $domainXml
        . '</domain><name>'
        . $repositoryXml
        . '</name></fetch></git></call></extension></packet>';
}

/** @return array{success: bool, error_code: ?string} */
function gq_deployment_status_parse_plesk_fetch_response(string $responseBody): array
{
    if (
        strlen($responseBody) > 1048576
        || preg_match('/<!DOCTYPE|<!ENTITY/i', $responseBody) === 1
        || !function_exists('simplexml_load_string')
    ) {
        return ['success' => false, 'error_code' => null];
    }
    $previousErrorMode = libxml_use_internal_errors(true);
    try {
        $packet = simplexml_load_string(
            $responseBody,
            SimpleXMLElement::class,
            LIBXML_NONET | LIBXML_NOBLANKS
        );
    } finally {
        libxml_clear_errors();
        libxml_use_internal_errors($previousErrorMode);
    }
    if (!$packet instanceof SimpleXMLElement || $packet->getName() !== 'packet') {
        return ['success' => false, 'error_code' => null];
    }
    $results = $packet->xpath('/packet/extension/call/result');
    if (!is_array($results) || count($results) !== 1 || !$results[0] instanceof SimpleXMLElement) {
        return ['success' => false, 'error_code' => null];
    }
    $result = $results[0];
    if ((string)($result->status ?? '') === 'ok') {
        return ['success' => true, 'error_code' => null];
    }
    $errorCode = (string)($result->errcode ?? '');
    return [
        'success' => false,
        'error_code' => preg_match('/\A[0-9]{1,10}\z/D', $errorCode) === 1 ? $errorCode : null,
    ];
}

/** @return array{success: bool, error_code: ?string} */
function gq_deployment_status_plesk_fetch(string $environment): array
{
    $settings = gq_deployment_status_plesk_settings($environment);
    if ($settings === null) {
        return ['success' => false, 'error_code' => null];
    }
    $packet = gq_deployment_status_build_plesk_fetch_packet($settings['domain'], $settings['repository']);
    if ($packet === null) {
        return ['success' => false, 'error_code' => null];
    }
    $response = wp_remote_post($settings['endpoint'], [
        'timeout' => 30,
        'redirection' => 0,
        'sslverify' => true,
        'limit_response_size' => 1048576,
        'headers' => [
            'Accept' => 'text/xml',
            'Content-Type' => 'text/xml; charset=UTF-8',
            'KEY' => $settings['api_key'],
        ],
        'body' => $packet,
    ]);
    if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
        return ['success' => false, 'error_code' => null];
    }
    return gq_deployment_status_parse_plesk_fetch_response(wp_remote_retrieve_body($response));
}

function gq_deployment_status_handle_plesk_fetch(): void
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to control Plesk Git.', 'gq-deployment-status'), '', ['response' => 403]);
    }
    $environment = isset($_POST['environment']) && is_string($_POST['environment'])
        ? sanitize_key(wp_unslash($_POST['environment']))
        : '';
    if (!in_array($environment, ['staging', 'production'], true)) {
        wp_die(esc_html__('Unknown deployment environment.', 'gq-deployment-status'), '', ['response' => 400]);
    }
    check_admin_referer('gq_deployment_status_fetch_git_' . $environment);

    $result = gq_deployment_status_plesk_fetch($environment);
    $message = $result['success']
        ? sprintf(
            __('Plesk fetched the %s Git mirror. No webroot deployment was performed.', 'gq-deployment-status'),
            $environment
        )
        : sprintf(
            __('Plesk Git fetch failed for %1$s. Check the API connection and repository configuration%2$s.', 'gq-deployment-status'),
            $environment,
            $result['error_code'] !== null ? ' (Plesk error ' . $result['error_code'] . ')' : ''
        );
    set_transient('gq_deployment_status_notice_' . get_current_user_id(), [
        'type' => $result['success'] ? 'success' : 'error',
        'message' => $message,
    ], 120);
    delete_transient('gq_deployment_status_' . $environment);
    wp_safe_redirect(admin_url('admin.php?page=gq-deployment-status'));
    exit;
}

function gq_deployment_status_take_notice(): ?array
{
    $noticeKey = 'gq_deployment_status_notice_' . get_current_user_id();
    $notice = get_transient($noticeKey);
    delete_transient($noticeKey);
    if (
        !is_array($notice)
        || !in_array($notice['type'] ?? null, ['success', 'error'], true)
        || !is_string($notice['message'] ?? null)
    ) {
        return null;
    }
    return $notice;
}

function gq_deployment_status_get_github_evidence(string $branch): array
{
    if (!in_array($branch, ['develop', 'main'], true)) {
        return [
            'error' => __(
                'Deployment branch is not configured.',
                'gq-deployment-status'
            ),
        ];
    }
    $head = gq_deployment_status_api_get('commits/' . rawurlencode($branch));
    if (isset($head['error'])) {
        return $head;
    }
    $commit = $head['sha'] ?? null;
    if (!is_string($commit) || preg_match('/\A[a-f0-9]{40}\z/D', $commit) !== 1) {
        return ['error' => __('GitHub returned an invalid branch commit.', 'gq-deployment-status')];
    }

    $runs = gq_deployment_status_api_get(
        'actions/workflows/ci.yml/runs?branch=' . rawurlencode($branch) . '&event=push&per_page=20'
    );
    if (isset($runs['error']) || !is_array($runs['workflow_runs'] ?? null)) {
        return [
            'error' => $runs['error'] ?? __('GitHub returned an invalid workflow list.', 'gq-deployment-status'),
            'commit' => $commit,
        ];
    }
    $run = null;
    foreach ($runs['workflow_runs'] as $candidate) {
        if (
            is_array($candidate)
            && ($candidate['head_sha'] ?? null) === $commit
            && ($candidate['head_branch'] ?? null) === $branch
            && ($candidate['event'] ?? null) === 'push'
            && ($candidate['path'] ?? null) === GQ_DEPLOYMENT_STATUS_WORKFLOW
            && ($candidate['repository']['full_name'] ?? null) === GQ_DEPLOYMENT_STATUS_REPOSITORY
            && ($candidate['head_repository']['full_name'] ?? null) === GQ_DEPLOYMENT_STATUS_REPOSITORY
        ) {
            $run = $candidate;
            break;
        }
    }
    if (!is_array($run) || !is_int($run['id'] ?? null) || !is_int($run['run_attempt'] ?? null)) {
        return [
            'commit' => $commit,
            'error' => __('No matching CI run exists for this branch commit.', 'gq-deployment-status'),
        ];
    }
    if (($run['status'] ?? null) !== 'completed' || ($run['conclusion'] ?? null) !== 'success') {
        return [
            'commit' => $commit,
            'run_id' => $run['id'],
            'conclusion' => is_string($run['conclusion'] ?? null) ? $run['conclusion'] : (string)$run['status'],
            'error' => __('The latest matching CI run is not successful.', 'gq-deployment-status'),
        ];
    }

    $jobs = gq_deployment_status_api_get(
        'actions/runs/' . $run['id'] . '/attempts/' . $run['run_attempt'] . '/jobs?per_page=100'
    );
    if (!gq_deployment_status_validate_jobs($jobs)) {
        return [
            'commit' => $commit,
            'run_id' => $run['id'],
            'conclusion' => 'success',
            'error' => __(
                'Required CI jobs or candidate acceptance steps are missing or unsuccessful.',
                'gq-deployment-status'
            ),
        ];
    }

    $artifacts = gq_deployment_status_api_get('actions/runs/' . $run['id'] . '/artifacts?per_page=100');
    $artifact = gq_deployment_status_find_artifact($artifacts, $branch, $commit, $run['id'], $run['run_attempt']);
    if ($artifact === null) {
        return [
            'commit' => $commit,
            'run_id' => $run['id'],
            'conclusion' => 'success',
            'error' => __('Matching non-expired CI artifact evidence is unavailable.', 'gq-deployment-status'),
        ];
    }
    return [
        'commit' => $commit,
        'run_id' => $run['id'],
        'conclusion' => 'success',
        'artifact' => $artifact,
    ];
}

function gq_deployment_status_api_get(string $endpoint): array
{
    $headers = [
        'Accept' => 'application/vnd.github+json',
        'X-GitHub-Api-Version' => '2022-11-28',
        'User-Agent' => 'GalaxyQuest-Plesk-Deployment-Status',
    ];
    if (
        defined('GQ_DEPLOY_STATUS_GITHUB_TOKEN')
        && is_string(GQ_DEPLOY_STATUS_GITHUB_TOKEN)
        && GQ_DEPLOY_STATUS_GITHUB_TOKEN !== ''
    ) {
        $headers['Authorization'] = 'Bearer ' . GQ_DEPLOY_STATUS_GITHUB_TOKEN;
    }
    $response = wp_remote_get(
        'https://api.github.com/repos/' . GQ_DEPLOYMENT_STATUS_REPOSITORY . '/' . $endpoint,
        [
            'timeout' => 10,
            'redirection' => 0,
            'sslverify' => true,
            'limit_response_size' => 2097152,
            'headers' => $headers,
        ]
    );
    if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
        return [
            'error' => __(
                'Could not read GitHub data; check server connectivity, credentials or API limits.',
                'gq-deployment-status'
            ),
        ];
    }
    $data = json_decode(wp_remote_retrieve_body($response), true);
    return is_array($data)
        ? $data
        : ['error' => __('GitHub returned invalid JSON.', 'gq-deployment-status')];
}

function gq_deployment_status_validate_jobs(array $response): bool
{
    if (
        !is_array($response['jobs'] ?? null)
        || !is_int($response['total_count'] ?? null)
        || $response['total_count'] !== count($response['jobs'])
        || $response['total_count'] > 100
    ) {
        return false;
    }
    $jobs = [];
    foreach ($response['jobs'] as $job) {
        if (
            !is_array($job)
            || !is_string($job['name'] ?? null)
            || isset($jobs[$job['name']])
            || ($job['status'] ?? null) !== 'completed'
            || ($job['conclusion'] ?? null) !== 'success'
        ) {
            return false;
        }
        $jobs[$job['name']] = $job;
    }
    foreach (GQ_DEPLOYMENT_STATUS_REQUIRED_JOBS as $name) {
        if (!isset($jobs[$name])) {
            return false;
        }
    }
    $steps = $jobs['Build & Publish Docker Image']['steps'] ?? null;
    if (!is_array($steps)) {
        return false;
    }
    $acceptanceIndex = gq_deployment_status_step_index($steps, GQ_DEPLOYMENT_STATUS_ACCEPTANCE_STEP);
    $artifactIndex = gq_deployment_status_step_index($steps, GQ_DEPLOYMENT_STATUS_ARTIFACT_STEP);
    return $acceptanceIndex !== null && $artifactIndex !== null && $acceptanceIndex < $artifactIndex;
}

function gq_deployment_status_step_index(array $steps, string $expectedName): ?int
{
    $matches = [];
    foreach ($steps as $index => $step) {
        if (is_array($step) && ($step['name'] ?? null) === $expectedName) {
            if (($step['status'] ?? null) !== 'completed' || ($step['conclusion'] ?? null) !== 'success') {
                return null;
            }
            $matches[] = (int)$index;
        }
    }
    return count($matches) === 1 ? $matches[0] : null;
}

function gq_deployment_status_find_artifact(
    array $response,
    string $branch,
    string $commit,
    int $runId,
    int $attempt
): ?array {
    if (
        !is_array($response['artifacts'] ?? null)
        || !is_int($response['total_count'] ?? null)
        || $response['total_count'] !== count($response['artifacts'])
        || $response['total_count'] > 100
    ) {
        return null;
    }
    $expectedName = 'native-plesk-candidate-attempt-' . $attempt;
    $matches = array_values(array_filter(
        $response['artifacts'],
        static fn($artifact): bool => is_array($artifact) && ($artifact['name'] ?? null) === $expectedName
    ));
    if (count($matches) !== 1) {
        return null;
    }
    $artifact = $matches[0];
    $workflowRun = $artifact['workflow_run'] ?? null;
    if (
        !is_array($workflowRun)
        || !is_int($artifact['id'] ?? null)
        || !is_int($artifact['size_in_bytes'] ?? null)
        || $artifact['size_in_bytes'] < 1
        || ($artifact['expired'] ?? null) !== false
        || !is_string($artifact['digest'] ?? null)
        || preg_match('/\Asha256:[a-f0-9]{64}\z/D', $artifact['digest']) !== 1
        || (string)($workflowRun['id'] ?? '') !== (string)$runId
        || ($workflowRun['head_branch'] ?? null) !== $branch
        || ($workflowRun['head_sha'] ?? null) !== $commit
        || !is_int($workflowRun['repository_id'] ?? null)
        || $workflowRun['repository_id'] < 1
        || ($workflowRun['head_repository_id'] ?? null) !== $workflowRun['repository_id']
    ) {
        return null;
    }
    return [
        'id' => $artifact['id'],
        'name' => $artifact['name'],
        'digest' => $artifact['digest'],
    ];
}

function gq_deployment_status_read_mirror_commit(string $gitDirectory, string $branch): ?string
{
    if (!in_array($branch, ['develop', 'main'], true) || !str_starts_with($gitDirectory, '/')) {
        return null;
    }
    $directory = realpath($gitDirectory);
    if (
        $directory === false
        || !is_dir($directory)
        || !is_file($directory . '/config')
        || !is_readable($directory . '/config')
    ) {
        return null;
    }
    $config = file_get_contents($directory . '/config');
    if (!is_string($config) || !gq_deployment_status_has_expected_origin($config)) {
        return null;
    }

    $ref = 'refs/heads/' . $branch;
    $looseRefPath = $directory . '/' . $ref;
    if (is_file($looseRefPath) && is_readable($looseRefPath) && !is_link($looseRefPath)) {
        $commit = trim((string)file_get_contents($looseRefPath));
        if (preg_match('/\A[a-f0-9]{40}\z/D', $commit) === 1) {
            return $commit;
        }
    }
    $packedRefsPath = $directory . '/packed-refs';
    if (!is_file($packedRefsPath) || !is_readable($packedRefsPath)) {
        return null;
    }
    $packedRefs = file_get_contents($packedRefsPath);
    if (!is_string($packedRefs)) {
        return null;
    }
    foreach (explode("\n", $packedRefs) as $line) {
        if (preg_match('/\A([a-f0-9]{40}) ' . preg_quote($ref, '/') . '\z/D', $line, $matches) === 1) {
            return $matches[1];
        }
    }
    return null;
}

function gq_deployment_status_has_expected_origin(string $config): bool
{
    $section = '';
    $bare = false;
    $origin = null;
    foreach (preg_split('/\r?\n/', $config) ?: [] as $line) {
        $trimmed = trim($line);
        if (preg_match('/^\[([^\]]+)\]$/', $trimmed, $matches) === 1) {
            $section = strtolower($matches[1]);
            continue;
        }
        if ($section === 'core' && preg_match('/^bare\s*=\s*true$/i', $trimmed) === 1) {
            $bare = true;
        }
        if ($section === 'remote "origin"' && preg_match('/^url\s*=\s*(.+)$/i', $trimmed, $matches) === 1) {
            $url = trim($matches[1], " \t\"'");
            $origin = in_array($url, [
                'https://github.com/makr-code/GalaxyQuest.git',
                'https://github.com/makr-code/GalaxyQuest',
            ], true);
        }
    }
    return $bare && $origin === true;
}

function gq_deployment_status_read_web_state(string $stateFile): array
{
    if (!str_starts_with($stateFile, '/')) {
        return [];
    }
    $realPath = realpath($stateFile);
    if ($realPath === false || !is_file($realPath) || !is_readable($realPath)) {
        return [];
    }
    $state = json_decode((string)file_get_contents($realPath), true);
    if (
        !is_array($state)
        || !is_string($state['commit'] ?? null)
        || preg_match('/\A[a-f0-9]{40}\z/D', $state['commit']) !== 1
        || !is_string($state['status'] ?? null)
    ) {
        return [];
    }
    $result = ['commit' => $state['commit'], 'status' => sanitize_text_field($state['status'])];
    if (
        is_string($state['artifact_digest'] ?? null)
        && preg_match('/\Asha256:[a-f0-9]{64}\z/D', $state['artifact_digest']) === 1
    ) {
        $result['artifact_digest'] = $state['artifact_digest'];
    }
    return $result;
}

function gq_deployment_status_plugin_tag_version(string $tag): ?string
{
    $number = '(?:0|[1-9][0-9]*)';
    return preg_match('/\Agq-deployment-status-v(' . $number . '\.' . $number . '\.' . $number . ')\z/D', $tag, $match)
        === 1 ? $match[1] : null;
}

function gq_deployment_status_plugin_release_data(array $release): array|WP_Error
{
    $tag = $release['tag_name'] ?? '';
    $version = is_string($tag) ? gq_deployment_status_plugin_tag_version($tag) : null;
    if (
        $version === null
        || ($release['draft'] ?? null) !== false
        || ($release['prerelease'] ?? null) !== false
        || !is_array($release['assets'] ?? null)
    ) {
        return new WP_Error('gq_plugin_release', __('Invalid published plugin release.', 'gq-deployment-status'));
    }
    $name = 'gq-deployment-status-' . $version . '.zip';
    $package = 'https://github.com/' . GQ_DEPLOYMENT_STATUS_REPOSITORY . '/releases/download/' . $tag . '/' . $name;
    $assets = array_values(array_filter(
        $release['assets'],
        static fn($asset): bool => is_array($asset) && ($asset['name'] ?? null) === $name
    ));
    $asset = count($assets) === 1 ? $assets[0] : [];
    if (
        ($asset['state'] ?? null) !== 'uploaded'
        || ($asset['browser_download_url'] ?? null) !== $package
        || !is_int($asset['size'] ?? null)
        || $asset['size'] < 1 || $asset['size'] > 5242880
        || !is_string($asset['digest'] ?? null)
        || preg_match('/\Asha256:[a-f0-9]{64}\z/D', $asset['digest']) !== 1
    ) {
        return new WP_Error(
            'gq_plugin_asset',
            __('Plugin ZIP or GitHub SHA-256 metadata is missing or invalid.', 'gq-deployment-status')
        );
    }
    return [
        'tag' => $tag, 'version' => $version, 'package' => $package,
        'digest' => substr($asset['digest'], 7), 'size' => $asset['size'],
        'url' => 'https://github.com/' . GQ_DEPLOYMENT_STATUS_REPOSITORY . '/releases/tag/' . $tag,
    ];
}

function gq_deployment_status_find_plugin_release(): array|WP_Error|null
{
    $selected = null;
    for ($page = 1; $page <= 10; $page++) {
        $releases = gq_deployment_status_api_get('releases?per_page=100&page=' . $page);
        if (isset($releases['error']) || !array_is_list($releases)) {
            return new WP_Error(
                'gq_plugin_discovery',
                $releases['error'] ?? __('Invalid GitHub release list.', 'gq-deployment-status')
            );
        }
        foreach ($releases as $release) {
            if (!is_array($release) || !is_string($release['tag_name'] ?? null)) {
                return new WP_Error('gq_plugin_discovery', __('Invalid GitHub release entry.', 'gq-deployment-status'));
            }
            $version = gq_deployment_status_plugin_tag_version($release['tag_name']);
            if ($version === null || ($release['draft'] ?? true) || ($release['prerelease'] ?? true)) {
                continue;
            }
            if ($selected === null || version_compare($version, $selected['version'], '>')) {
                $selected = ['version' => $version, 'release' => $release];
            }
        }
        if (count($releases) < 100) {
            return $selected === null ? null : gq_deployment_status_plugin_release_data($selected['release']);
        }
    }
    return new WP_Error(
        'gq_plugin_discovery_limit',
        __('Plugin update discovery exceeded its release pagination limit.', 'gq-deployment-status')
    );
}

function gq_deployment_status_get_plugin_release(): array|WP_Error|null
{
    $cached = get_transient(GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE);
    if (is_array($cached) && array_key_exists('release', $cached)) {
        return $cached['release'];
    }
    $release = gq_deployment_status_find_plugin_release();
    set_transient(GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE, ['release' => $release], is_wp_error($release) ? 300 : 3600);
    return $release;
}

function gq_deployment_status_plugin_update_blocker(): ?string
{
    $installed = plugin_dir_path(__FILE__) . basename(__FILE__);
    if (
        plugin_basename(__FILE__) !== 'gq-deployment-status/gq-deployment-status.php'
        || is_link($installed) || is_link(dirname($installed))
        || (stat($installed)['nlink'] ?? 1) > 1
    ) {
        return __(
            'Plugin self-updates are disabled for flat-file, linked or development installations. Install the release ZIP in its own gq-deployment-status directory first.',
            'gq-deployment-status'
        );
    }
    return null;
}

function gq_deployment_status_plugin_update(mixed $update, array $pluginData, string $pluginFile, array $locales): mixed
{
    if ($pluginFile !== plugin_basename(__FILE__)) {
        return $update;
    }
    if (gq_deployment_status_plugin_update_blocker() !== null) {
        return false;
    }
    $release = gq_deployment_status_get_plugin_release();
    if ($release === null || is_wp_error($release)) {
        return false;
    }
    return [
        'id' => GQ_DEPLOYMENT_STATUS_PLUGIN_UPDATE_URI, 'slug' => GQ_DEPLOYMENT_STATUS_PLUGIN_SLUG,
        'version' => $release['version'], 'url' => $release['url'], 'package' => $release['package'],
        'requires' => '6.5', 'requires_php' => '8.2',
    ];
}

function gq_deployment_status_plugin_information(mixed $result, string $action, object $args): mixed
{
    if ($action !== 'plugin_information' || ($args->slug ?? null) !== GQ_DEPLOYMENT_STATUS_PLUGIN_SLUG) {
        return $result;
    }
    $release = gq_deployment_status_get_plugin_release();
    if (is_wp_error($release)) {
        return $release;
    }
    if ($release === null) {
        return new WP_Error('gq_plugin_unreleased', __('No published plugin release is available.', 'gq-deployment-status'));
    }
    return (object)[
        'name' => 'GalaxyQuest Deployment Status', 'slug' => GQ_DEPLOYMENT_STATUS_PLUGIN_SLUG,
        'version' => $release['version'], 'homepage' => $release['url'],
        'requires' => '6.5', 'requires_php' => '8.2', 'download_link' => $release['package'],
        'sections' => ['description' => esc_html__(
            'WordPress plugin updates only. This does not install or promote the GalaxyQuest game.',
            'gq-deployment-status'
        )],
    ];
}

function gq_deployment_status_plugin_zip_error(string $file, string $version): ?string
{
    if (!class_exists(ZipArchive::class)) {
        return __('PHP ext-zip is required to verify plugin updates.', 'gq-deployment-status');
    }
    $zip = new ZipArchive();
    if ($zip->open($file) !== true) {
        return __('Plugin package is not a readable ZIP.', 'gq-deployment-status');
    }
    try {
        $seen = [];
        $size = 0;
        if ($zip->numFiles < 1 || $zip->numFiles > 100) {
            return __('Unexpected plugin ZIP entry count.', 'gq-deployment-status');
        }
        for ($index = 0; $index < $zip->numFiles; $index++) {
            $entry = $zip->statIndex($index);
            $name = $entry['name'] ?? '';
            $parts = explode('/', rtrim($name, '/'));
            $attributes = 0;
            $system = 0;
            $zip->getExternalAttributesIndex($index, $system, $attributes);
            $type = ($attributes >> 16) & 0170000;
            $size += $entry['size'] ?? 10485761;
            if (
                $parts[0] !== GQ_DEPLOYMENT_STATUS_PLUGIN_SLUG
                || in_array('', $parts, true) || in_array('..', $parts, true) || in_array('.', $parts, true)
                || str_contains($name, '\\') || preg_match('/[\x00-\x1f]/', $name)
                || isset($seen[rtrim($name, '/')]) || $size > 10485760
                || !in_array($type, [0, 0100000, 0040000], true)
            ) {
                return __('Unsafe plugin ZIP paths, links or expanded size.', 'gq-deployment-status');
            }
            $seen[rtrim($name, '/')] = true;
        }
        $main = $zip->getFromName('gq-deployment-status/gq-deployment-status.php');
        if (
            !is_string($main)
            || preg_match('/^[ \t*]*Version:[ \t]*([^\r\n]+)/m', $main, $match) !== 1
            || trim($match[1]) !== $version
            || !str_contains($main, 'Plugin Name: GalaxyQuest Deployment Status')
        ) {
            return __('Plugin ZIP entrypoint or version does not match the release.', 'gq-deployment-status');
        }
        return null;
    } finally {
        $zip->close();
    }
}

function gq_deployment_status_plugin_download(mixed $reply, string $package, object $upgrader, array $extra): mixed
{
    if (($extra['type'] ?? 'plugin') !== 'plugin') {
        return $reply;
    }
    $prefix = 'https://github.com/' . GQ_DEPLOYMENT_STATUS_REPOSITORY . '/releases/download/gq-deployment-status-v';
    if (($extra['plugin'] ?? null) !== plugin_basename(__FILE__) && !str_starts_with($package, $prefix)) {
        return $reply;
    }
    if (is_wp_error($reply)) {
        return $reply;
    }
    $blocker = gq_deployment_status_plugin_update_blocker();
    if ($blocker !== null || $reply !== false) {
        return new WP_Error('gq_plugin_update_blocked', $blocker ?? __('Conflicting plugin download filter.', 'gq-deployment-status'));
    }
    if (preg_match('~\A' . preg_quote($prefix, '~') . '([^/]+)/[^/]+\z~D', $package, $match) !== 1) {
        return new WP_Error('gq_plugin_package', __('Untrusted plugin package URL.', 'gq-deployment-status'));
    }
    $tag = 'gq-deployment-status-v' . $match[1];
    if (gq_deployment_status_plugin_tag_version($tag) === null) {
        return new WP_Error('gq_plugin_package', __('Invalid plugin release tag.', 'gq-deployment-status'));
    }
    // Never trust cached release metadata at the installation boundary.
    $data = gq_deployment_status_api_get('releases/tags/' . rawurlencode($tag));
    $release = gq_deployment_status_plugin_release_data($data);
    if (is_wp_error($release)) {
        return $release;
    }
    if (
        $release['package'] !== $package || $release['tag'] !== $tag
        || !version_compare($release['version'], GQ_DEPLOYMENT_STATUS_PLUGIN_VERSION, '>')
    ) {
        return new WP_Error('gq_plugin_package', __('Plugin package identity or upgrade version changed.', 'gq-deployment-status'));
    }
    $file = wp_tempnam('gq-deployment-status.zip');
    if ($file === false) {
        return new WP_Error('gq_plugin_tempfile', __('Could not create plugin download file.', 'gq-deployment-status'));
    }
    $keep = false;
    try {
        // Public release download: never forward the GitHub API token to redirects/CDNs.
        $response = wp_safe_remote_get($package, [
            'timeout' => 60, 'redirection' => 3, 'sslverify' => true,
            'stream' => true, 'filename' => $file, 'limit_response_size' => $release['size'] + 1,
        ]);
        if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
            return new WP_Error('gq_plugin_download', __('Plugin ZIP download failed.', 'gq-deployment-status'));
        }
        if (filesize($file) !== $release['size'] || !hash_equals($release['digest'], (string)hash_file('sha256', $file))) {
            return new WP_Error('gq_plugin_digest', __('Plugin ZIP size or SHA-256 verification failed.', 'gq-deployment-status'));
        }
        $error = gq_deployment_status_plugin_zip_error($file, $release['version']);
        if ($error !== null) {
            return new WP_Error('gq_plugin_zip', $error);
        }
        $keep = true;
        return $file;
    } finally {
        if (!$keep) {
            wp_delete_file($file);
        }
    }
}

function gq_deployment_status_plugin_updated(object $upgrader, array $options): void
{
    if (
        ($options['type'] ?? null) === 'plugin' && ($options['action'] ?? null) === 'update'
        && in_array(plugin_basename(__FILE__), $options['plugins'] ?? [], true)
    ) {
        delete_transient(GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE);
    }
}

function gq_deployment_status_plugin_update_notice(): void
{
    if (!current_user_can('update_plugins')) {
        return;
    }
    $cached = get_transient(GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE);
    if (is_array($cached) && is_wp_error($cached['release'] ?? null)) {
        echo '<div class="notice notice-error"><p>'
            . esc_html__('GalaxyQuest plugin update check failed:', 'gq-deployment-status') . ' '
            . esc_html($cached['release']->get_error_message()) . '</p></div>';
    }
}

function gq_deployment_status_render_plugin_updates(): void
{
    $release = gq_deployment_status_get_plugin_release();
    echo '<h2>' . esc_html__('WordPress plugin updates', 'gq-deployment-status') . '</h2><p>';
    echo esc_html('GalaxyQuest Deployment Status ' . GQ_DEPLOYMENT_STATUS_PLUGIN_VERSION . ' — GitHub stable');
    echo '</p><p>';
    $blocker = gq_deployment_status_plugin_update_blocker();
    if ($blocker !== null) {
        echo esc_html($blocker) . '<br>';
    }
    if (is_wp_error($release)) {
        echo esc_html($release->get_error_message());
    } elseif ($release === null) {
        echo esc_html__('No published plugin release is available. Game releases are not plugin updates.', 'gq-deployment-status');
    } else {
        echo esc_html(sprintf(__('Latest plugin release: %s', 'gq-deployment-status'), $release['version']));
    }
    echo '</p><p><a class="button" href="' . esc_url(admin_url('plugins.php')) . '">'
        . esc_html__('Manage plugin updates in WordPress', 'gq-deployment-status') . '</a> ';
    echo '<a class="button" href="' . esc_url(admin_url('update-core.php?force-check=1')) . '">'
        . esc_html__('Check for updates', 'gq-deployment-status') . '</a></p>';
}
