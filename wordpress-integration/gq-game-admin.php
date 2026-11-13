<?php

/**
 * Plugin Name: GalaxyQuest Administration
 * Description: Separate game administration for configuration, setup and read-only database migration planning.
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 8.2
 * Update URI: https://github.com/makr-code/GalaxyQuest/tree/main/wordpress-integration/gq-game-admin.php
 */

declare(strict_types=1);

/* phpcs:disable PSR1.Files.SideEffects.FoundWithSymbols -- WordPress registers its menu at file scope. */

if (!defined('ABSPATH')) {
    exit;
}

function gq_game_admin_register_menu(): void
{
    add_menu_page(
        __('GalaxyQuest Administration', 'gq-game-admin'),
        __('GalaxyQuest Administration', 'gq-game-admin'),
        'manage_options',
        'gq-game-admin',
        'gq_game_admin_render_page',
        'dashicons-admin-generic'
    );
}
add_action('admin_menu', 'gq_game_admin_register_menu');

/** @return array<string,mixed> */
function gq_game_admin_validate_report(array $report, string $environment, string $database, int $now): array
{
    if (
        !in_array($environment, ['staging', 'production'], true)
        || ($report['schema_version'] ?? null) !== 1 || ($report['read_only'] ?? null) !== true
        || !is_int($report['generated_at'] ?? null)
        || $report['generated_at'] < $now - 900 || $report['generated_at'] > $now + 60
    ) {
        return ['error' => __('Administration report is invalid, stale or has a future timestamp.', 'gq-game-admin')];
    }
    $plan = $report['plan'] ?? null;
    if (
        !is_array($plan) || ($plan['environment'] ?? null) !== $environment
        || !is_array($plan['database'] ?? null) || ($plan['database']['name'] ?? null) !== $database
        || !is_string($plan['database']['server_version'] ?? null)
        || strlen($plan['database']['server_version']) > 120
        || !is_int($plan['database']['table_count'] ?? null) || $plan['database']['table_count'] < 0
        || !in_array($plan['database']['state'] ?? null, ['empty', 'untracked', 'tracked'], true)
    ) {
        return ['error' => __(
            'Report does not match the configured environment and database identity.',
            'gq-game-admin'
        )];
    }
    $release = $plan['release'] ?? null;
    if (
        !is_array($release) || !is_string($release['version'] ?? null)
        || preg_match('/\A[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\z/D', $release['version']) !== 1
        || !is_string($release['commit'] ?? null) || preg_match('/\A[a-f0-9]{40}\z/D', $release['commit']) !== 1
        || ($release['status'] ?? null) !== 'not-deployable'
    ) {
        return ['error' => __('Report has no valid native candidate identity.', 'gq-game-admin')];
    }
    foreach (['manifest_sha256', 'baseline_sha256'] as $field) {
        if (!is_string($release[$field] ?? null) || preg_match('/\A[a-f0-9]{64}\z/D', $release[$field]) !== 1) {
            return ['error' => __('Report is missing the baseline or manifest digest.', 'gq-game-admin')];
        }
    }
    $migrations = $plan['migrations'] ?? null;
    if (
        !is_array($migrations) || !is_bool($migrations['tracking_present'] ?? null)
        || !is_array($migrations['entries'] ?? null) || !array_is_list($migrations['entries'])
        || count($migrations['entries']) > 2000
        || !is_array($migrations['blockers'] ?? null) || !array_is_list($migrations['blockers'])
        || count($migrations['blockers']) > 100
    ) {
        return ['error' => __('Invalid migration report structure.', 'gq-game-admin')];
    }
    $expectedState = $migrations['tracking_present'] ? 'tracked'
        : ($plan['database']['table_count'] === 0 ? 'empty' : 'untracked');
    if (
        $plan['database']['state'] !== $expectedState
        || ($migrations['tracking_present'] && $plan['database']['table_count'] < 1)
    ) {
        return ['error' => __('Database and migration history states disagree.', 'gq-game-admin')];
    }
    $seen = [];
    foreach ($migrations['entries'] as $entry) {
        if (
            !is_array($entry) || !is_string($entry['name'] ?? null)
            || preg_match('/\A[A-Za-z0-9][A-Za-z0-9_-]*\.sql\z/D', $entry['name']) !== 1
            || str_ends_with(strtolower($entry['name']), '_down.sql') || isset($seen[strtolower($entry['name'])])
            || !in_array($entry['status'] ?? null, ['pending', 'executed', 'adopted'], true)
            || (!$migrations['tracking_present'] && $entry['status'] !== 'pending')
            || !is_string($entry['sha256'] ?? null) || preg_match('/\A[a-f0-9]{64}\z/D', $entry['sha256']) !== 1
        ) {
            return ['error' => __('Invalid or duplicate migration identity/status.', 'gq-game-admin')];
        }
        $seen[strtolower($entry['name'])] = true;
    }
    foreach ($migrations['blockers'] as $blocker) {
        if (!is_string($blocker) || $blocker === '' || strlen($blocker) > 2048) {
            return ['error' => __('Invalid migration blocker.', 'gq-game-admin')];
        }
    }
    if (
        !is_string($report['plan_sha256'] ?? null)
        || !hash_equals(
            hash('sha256', json_encode($plan, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)),
            $report['plan_sha256']
        )
    ) {
        return ['error' => __('Administration plan digest does not match its contents.', 'gq-game-admin')];
    }
    return $report;
}

/** @return array<string,mixed> */
function gq_game_admin_read_report(string $file, string $environment, string $database, int $now): array
{
    if (
        !(str_starts_with($file, '/') || preg_match('/\A[A-Za-z]:[\\\\\/]/', $file) === 1)
        || !is_file($file) || !is_readable($file) || is_link($file)
    ) {
        return ['error' => __('Private administration report is missing or unreadable.', 'gq-game-admin')];
    }
    $body = file_get_contents($file, false, null, 0, 2097153);
    if (!is_string($body) || strlen($body) > 2097152) {
        return ['error' => __('Administration report is unreadable or oversized.', 'gq-game-admin')];
    }
    try {
        $report = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
        return is_array($report)
            ? gq_game_admin_validate_report($report, $environment, $database, $now)
            : ['error' => __('Administration report must be a JSON object.', 'gq-game-admin')];
    } catch (JsonException $error) {
        return ['error' => __('Administration report contains invalid JSON.', 'gq-game-admin')];
    }
}

/** @return array<string,mixed> */
function gq_game_admin_environment_report(string $environment): array
{
    if (!in_array($environment, ['staging', 'production'], true)) {
        return ['error' => __('Unknown game administration environment.', 'gq-game-admin')];
    }
    $prefix = 'GQ_GAME_ADMIN_' . strtoupper($environment) . '_';
    if (
        !defined($prefix . 'REPORT_FILE') || !is_string(constant($prefix . 'REPORT_FILE'))
        || !defined($prefix . 'EXPECTED_DATABASE') || !is_string(constant($prefix . 'EXPECTED_DATABASE'))
        || preg_match('/\A[A-Za-z0-9_-]+\z/D', constant($prefix . 'EXPECTED_DATABASE')) !== 1
    ) {
        return ['error' => __(
            'Configure the private report path and expected database name in wp-config.php.'
                . ' No database connection is made by this plugin.',
            'gq-game-admin'
        )];
    }
    return gq_game_admin_read_report(
        constant($prefix . 'REPORT_FILE'),
        $environment,
        constant($prefix . 'EXPECTED_DATABASE'),
        time()
    );
}

function gq_game_admin_render_environment(string $label, array $report): void
{
    echo '<h2>' . esc_html($label) . '</h2>';
    if (isset($report['error'])) {
        echo '<div class="notice notice-warning inline"><p>' . esc_html($report['error']) . '</p></div>';
        return;
    }
    $plan = $report['plan'];
    echo '<table class="widefat striped"><tbody>';
    foreach (
        [
        __('Database', 'gq-game-admin') => $plan['database']['name'],
        __('Database server', 'gq-game-admin') => $plan['database']['server_version'],
        __('Schema state', 'gq-game-admin') => $plan['database']['state'],
        __('Visible tables / views', 'gq-game-admin') => (string)$plan['database']['table_count'],
        __('Candidate version', 'gq-game-admin') => $plan['release']['version'],
        __('Candidate commit', 'gq-game-admin') => $plan['release']['commit'],
        __('Candidate status', 'gq-game-admin') => $plan['release']['status'],
        __('Observed at (UTC)', 'gq-game-admin') => gmdate('Y-m-d H:i:s', $report['generated_at']),
        __('Plan SHA-256', 'gq-game-admin') => $report['plan_sha256'],
        ] as $name => $value
    ) {
        echo '<tr><th>' . esc_html($name) . '</th><td><code>' . esc_html($value) . '</code></td></tr>';
    }
    echo '</tbody></table><h3>' . esc_html__('Setup and configuration', 'gq-game-admin') . '</h3><p>';
    $setup = match ($plan['database']['state']) {
        'empty' => __(
            'No visible tables/views: independent empty-target verification and initial seed review are required.',
            'gq-game-admin'
        ),
        'untracked' => __(
            'Existing schema without history: audit/adoption is required; do not rerun setup.',
            'gq-game-admin'
        ),
        default => __('Migration history exists. This is not a readiness or deployment approval.', 'gq-game-admin'),
    };
    echo esc_html($setup) . ' ';
    echo esc_html__(
        'Secrets and connection settings stay in private server configuration, not WordPress options.',
        'gq-game-admin'
    );
    echo '</p>';
    foreach ($plan['migrations']['blockers'] as $blocker) {
        echo '<p><strong>' . esc_html__('Blocked:', 'gq-game-admin') . '</strong> ' . esc_html($blocker) . '</p>';
    }
    $pending = count(array_filter(
        $plan['migrations']['entries'],
        static fn(array $entry): bool => $entry['status'] === 'pending'
    ));
    echo '<details><summary>' . esc_html(sprintf(
        __('Migration inventory: %d pending / %d total', 'gq-game-admin'),
        $pending,
        count($plan['migrations']['entries'])
    )) . '</summary><table class="widefat striped"><thead><tr>';
    foreach (['Migration', 'State', 'SQL SHA-256'] as $heading) {
        echo '<th>' . esc_html($heading) . '</th>';
    }
    echo '</tr></thead><tbody>';
    foreach ($plan['migrations']['entries'] as $entry) {
        echo '<tr><td>' . esc_html($entry['name']) . '</td><td>' . esc_html($entry['status'])
            . '</td><td><code>' . esc_html($entry['sha256']) . '</code></td></tr>';
    }
    echo '</tbody></table></details>';
}

function gq_game_admin_render_page(): void
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    echo '<div class="wrap"><h1>' . esc_html__('GalaxyQuest Administration', 'gq-game-admin') . '</h1><p>';
    echo esc_html__(
        'Game configuration, setup and operations are separate from deployment and plugin updates.'
            . ' This first version only displays private, read-only inspection snapshots.',
        'gq-game-admin'
    );
    echo '</p>';
    foreach (['staging' => 'Staging', 'production' => 'Production'] as $environment => $label) {
        gq_game_admin_render_environment($label, gq_game_admin_environment_report($environment));
    }
    echo '<h2>' . esc_html__('Controlled game operations', 'gq-game-admin') . '</h2><p>';
    echo esc_html__(
        'Execution is locked. The CLI inspection is not a setup or migration executor.'
            . ' Release approval, verified backup/restore, writer coordination'
            . ' and an authorized job runner must be implemented first.'
            . ' MySQL DDL may commit implicitly; switching PHP files back does not restore the database.',
        'gq-game-admin'
    );
    echo '</p>';
    foreach (
        ['Edit game configuration', 'Run initial setup', 'Apply migrations', 'Create backup', 'Restore database']
        as $label
    ) {
        echo '<button type="button" class="button" disabled>' . esc_html($label) . '</button> ';
    }
    echo '</div>';
}
