<?php

/**
 * Plugin Name: GalaxyQuest Deployment Status
 * Description: Read-only deployment status and controlled Plesk Git fetch operations.
 * Version: 0.2.1
 * Requires at least: 6.5
 * Requires PHP: 8.2
 * Update URI: https://github.com/makr-code/GalaxyQuest/tree/main/wordpress-integration
 */

/* phpcs:ignoreFile PSR1.Files.SideEffects.FoundWithSymbols -- WordPress plugins register hooks at file scope. */

declare(strict_types=1);

use GalaxyQuest\WordPress\GitHubPluginUpdaterV1 as GitHubPluginUpdater;
use GalaxyQuest\WordPress\AdminTablesV1 as AdminTables;

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/gq-github-plugin-updater.php';
require_once __DIR__ . '/gq-admin-tables.php';

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
const GQ_DEPLOYMENT_STATUS_PLUGIN_VERSION = '0.2.1';
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
    $environment = $_GET['environment'] ?? 'staging';
    $branch = is_string($environment) ? gq_deployment_status_branch_for_environment($environment) : null;
    if ($branch === null) {
        wp_die(esc_html__('Unknown deployment environment.', 'gq-deployment-status'), '', ['response' => 400]);
    }

    if (isset($_GET['gq_refresh'])) {
        check_admin_referer('gq_deployment_status_refresh');
        delete_transient('gq_deployment_status_staging');
        delete_transient('gq_deployment_status_production');
        delete_transient(GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE);
    }
    $report = gq_deployment_status_get_report($environment);
    $notice = gq_deployment_status_take_notice();
    $refreshUrl = wp_nonce_url(
        admin_url('admin.php?page=gq-deployment-status&gq_refresh=1&environment=' . $environment),
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
        <nav class="nav-tab-wrapper" aria-label="<?php echo esc_attr(__('Environment', 'gq-deployment-status')); ?>">
            <?php foreach (['staging' => 'Staging', 'production' => 'Production'] as $tab => $label) : ?>
                <a class="nav-tab<?php echo $tab === $environment ? ' nav-tab-active' : ''; ?>"
                    href="<?php echo esc_url(admin_url('admin.php?page=gq-deployment-status&environment=' . $tab)); ?>"
                    <?php if ($tab === $environment) : ?>
                        aria-current="page"
                    <?php endif; ?>
                ><?php echo esc_html(__($label, 'gq-deployment-status')); ?></a>
            <?php endforeach; ?>
        </nav>
        <section id="gq-deployment-status-<?php echo esc_attr($environment); ?>">
            <h2>
                <?php echo esc_html($environment === 'staging' ? 'Staging' : 'Production'); ?>
                — <?php echo esc_html($branch); ?>
            </h2>
            <p><a class="button" href="<?php echo esc_url($refreshUrl); ?>">
                <?php esc_html_e('Refresh status', 'gq-deployment-status'); ?>
            </a></p>
            <?php gq_deployment_status_render_environment($environment, $report); ?>
        </section>
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
    <table class="widefat striped" data-gq-admin-table>
        <?php AdminTables::header(['Source', 'Commit', 'Status / evidence']); ?>
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
    <?php AdminTables::assets(); ?>
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
    wp_safe_redirect(admin_url('admin.php?page=gq-deployment-status&environment=' . $environment));
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
    return gq_deployment_status_updater()->apiGet($endpoint);
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

function gq_deployment_status_updater(): GitHubPluginUpdater
{
    static $updater = null;
    return $updater ??= new GitHubPluginUpdater(
        __FILE__,
        GQ_DEPLOYMENT_STATUS_PLUGIN_SLUG,
        'GalaxyQuest Deployment Status',
        GQ_DEPLOYMENT_STATUS_PLUGIN_VERSION,
        GQ_DEPLOYMENT_STATUS_PLUGIN_UPDATE_URI,
        GQ_DEPLOYMENT_STATUS_PLUGIN_RELEASE_CACHE,
        'GQ_DEPLOY_STATUS_GITHUB_TOKEN'
    );
}

function gq_deployment_status_plugin_tag_version(string $tag): ?string
{
    return gq_deployment_status_updater()->tagVersion($tag);
}

function gq_deployment_status_plugin_release_data(array $release): array|WP_Error
{
    return gq_deployment_status_updater()->releaseData($release);
}

function gq_deployment_status_find_plugin_release(): array|WP_Error|null
{
    return gq_deployment_status_updater()->findRelease();
}

function gq_deployment_status_get_plugin_release(): array|WP_Error|null
{
    return gq_deployment_status_updater()->getRelease();
}

function gq_deployment_status_plugin_update_blocker(): ?string
{
    return gq_deployment_status_updater()->blocker();
}

function gq_deployment_status_plugin_update(mixed $update, array $pluginData, string $pluginFile, array $locales): mixed
{
    return gq_deployment_status_updater()->update($update, $pluginData, $pluginFile, $locales);
}

function gq_deployment_status_plugin_information(mixed $result, string $action, object $args): mixed
{
    return gq_deployment_status_updater()->information($result, $action, $args);
}

function gq_deployment_status_plugin_zip_error(string $file, string $version): ?string
{
    return gq_deployment_status_updater()->zipError($file, $version);
}

function gq_deployment_status_plugin_download(mixed $reply, string $package, object $upgrader, array $extra): mixed
{
    return gq_deployment_status_updater()->download($reply, $package, $upgrader, $extra);
}

function gq_deployment_status_plugin_updated(object $upgrader, array $options): void
{
    gq_deployment_status_updater()->updated($upgrader, $options);
}

function gq_deployment_status_plugin_update_notice(): void
{
    gq_deployment_status_updater()->notice();
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
