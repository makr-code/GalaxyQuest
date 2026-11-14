<?php

/**
 * Plugin Name: GalaxyQuest Administration
 * Description: Read-only game overview and player inspection, database configuration and migration planning.
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 8.2
 * Update URI: https://github.com/makr-code/GalaxyQuest/tree/main/wordpress-integration/gq-game-admin.php
 */

declare(strict_types=1);

use GalaxyQuest\WordPress\GitHubPluginUpdaterV1 as GitHubPluginUpdater;
use GalaxyQuest\WordPress\AdminTablesV1 as AdminTables;

/* phpcs:disable PSR1.Files.SideEffects.FoundWithSymbols -- WordPress registers its menu at file scope. */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/gq-github-plugin-updater.php';
require_once __DIR__ . '/gq-admin-tables.php';

const GQ_GAME_ADMIN_PLUGIN_VERSION = '0.1.0';
const GQ_GAME_ADMIN_PLUGIN_UPDATE_URI =
    'https://github.com/makr-code/GalaxyQuest/tree/main/wordpress-integration/gq-game-admin.php';

function gq_game_admin_updater(): GitHubPluginUpdater
{
    static $updater = null;
    return $updater ??= new GitHubPluginUpdater(
        __FILE__,
        'gq-game-admin',
        'GalaxyQuest Administration',
        GQ_GAME_ADMIN_PLUGIN_VERSION,
        GQ_GAME_ADMIN_PLUGIN_UPDATE_URI,
        'gq_game_admin_plugin_release',
        'GQ_GAME_ADMIN_GITHUB_TOKEN'
    );
}
gq_game_admin_updater()->register();

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
add_action('admin_post_gq_game_admin_database', 'gq_game_admin_handle_database');
add_action('admin_post_gq_game_admin_export_review', 'gq_game_admin_handle_review_export');
add_action('admin_post_gq_game_admin_overview', 'gq_game_admin_handle_overview');

function gq_game_admin_valid_database_name(string $name): bool
{
    return preg_match('/\A[A-Za-z0-9_$-]{1,64}\z/D', $name) === 1;
}

/** @return array{name?:string,error?:string} */
function gq_game_admin_database_settings(string $environment): array
{
    if (!in_array($environment, ['staging', 'production'], true)) {
        return ['error' => __('Unknown game administration environment.', 'gq-game-admin')];
    }
    if (defined('GQ_GAME_ADMIN_' . strtoupper($environment) . '_DB_CONFIG_FILE')) {
        $profile = gq_game_admin_database_configuration($environment);
        return isset($profile['error']) ? $profile : ['name' => $profile['database']];
    }
    $name = get_option('gq_game_admin_database_' . $environment, null);
    if ($name === null) {
        $constant = 'GQ_GAME_ADMIN_' . strtoupper($environment) . '_EXPECTED_DATABASE';
        $name = defined($constant) ? constant($constant) : '';
    }
    if (!is_string($name) || ($name !== '' && !gq_game_admin_valid_database_name($name))) {
        return ['error' => __(
            'The configured database name is invalid. Save a valid Plesk database name.',
            'gq-game-admin'
        )];
    }
    return ['name' => $name];
}

/** @return array{host:string,port:int,user:string,password:string,database:string}|array{error:string} */
function gq_game_admin_read_database_configuration(string $file, string $environment): array
{
    $failure = ['error' => __(
        'The private database configuration is missing, unsafe or invalid.'
            . ' Use an environment-bound JSON file outside the webroots with restricted permissions.',
        'gq-game-admin'
    )];
    if (
        !in_array($environment, ['staging', 'production'], true)
        || !(str_starts_with($file, '/') || preg_match('/\A[A-Za-z]:[\\\\\/]/', $file) === 1)
        || str_contains($file, "\0") || is_link($file)
    ) {
        return $failure;
    }
    for ($parent = dirname($file);; $parent = dirname($parent)) {
        if (is_link($parent)) {
            return $failure;
        }
        if (dirname($parent) === $parent) {
            break;
        }
    }
    $resolved = realpath($file);
    if ($resolved === false || !is_file($resolved) || !is_readable($resolved)) {
        return $failure;
    }
    $normalize = static function (string $path): string {
        $path = str_replace('\\', '/', $path);
        return DIRECTORY_SEPARATOR === '\\' ? strtolower($path) : $path;
    };
    foreach ([ABSPATH, dirname(__DIR__), $_SERVER['DOCUMENT_ROOT'] ?? ''] as $root) {
        if (!is_string($root) || $root === '') {
            continue;
        }
        $root = realpath($root);
        if ($root === false) {
            continue;
        }
        $prefix = rtrim($normalize($root), '/') . '/';
        foreach ([$file, $resolved] as $path) {
            if (str_starts_with($normalize($path), $prefix)) {
                return $failure;
            }
        }
    }
    $stream = @fopen($resolved, 'rb');
    if ($stream === false) {
        return $failure;
    }
    try {
        $stat = fstat($stream);
        $expected = @lstat($file);
        if (
            $stat === false || $expected === false
            || $stat['ino'] !== $expected['ino'] || $stat['dev'] !== $expected['dev']
            || is_link($file) || realpath($file) !== $resolved
            || (DIRECTORY_SEPARATOR === '/' && ($stat['mode'] & 0027) !== 0)
        ) {
            return $failure;
        }
        $body = stream_get_contents($stream, 65537);
    } finally {
        fclose($stream);
    }
    if (!is_string($body) || strlen($body) > 65536) {
        return $failure;
    }
    try {
        $config = json_decode($body, true, 16, JSON_THROW_ON_ERROR);
    } catch (JsonException $error) {
        return $failure;
    }
    if (
        !is_array($config) || ($config['environment'] ?? null) !== $environment
        || !is_string($config['host'] ?? null) || preg_match('/\A[A-Za-z0-9.:-]+\z/D', $config['host']) !== 1
        || !is_int($config['port'] ?? null) || $config['port'] < 1 || $config['port'] > 65535
        || !is_string($config['database'] ?? null)
        || !gq_game_admin_valid_database_name($config['database'])
        || preg_match('/\A[A-Za-z0-9_-]+\z/D', $config['database']) !== 1
        || !is_string($config['username'] ?? null) || $config['username'] === ''
        || !is_string($config['password'] ?? null) || $config['password'] === ''
    ) {
        return $failure;
    }
    return [
        'host' => $config['host'], 'port' => $config['port'],
        'user' => $config['username'], 'password' => $config['password'], 'database' => $config['database'],
    ];
}

/**
 * The private directory must already exist and belong only to the PHP account.
 * POSIX checks deliberately fail closed where ownership/ACLs cannot be verified.
 */
function gq_game_admin_safe_profile_path(string $file): bool
{
    if (
        DIRECTORY_SEPARATOR !== '/' || !function_exists('posix_geteuid')
        || !str_starts_with($file, '/') || str_contains($file, "\0")
        || preg_match('~(?:^|/)\.\.?(?:/|$)|//~', $file)
    ) {
        return false;
    }
    $parent = dirname($file);
    clearstatcache();
    $directory = @lstat($parent);
    if (
        $directory === false || ($directory['mode'] & 0170000) !== 0040000
        || $directory['uid'] !== posix_geteuid() || ($directory['mode'] & 0077) !== 0
        || !is_writable($parent)
    ) {
        return false;
    }
    for ($path = $parent;; $path = dirname($path)) {
        $stat = @lstat($path);
        if ($stat === false || ($stat['mode'] & 0170000) !== 0040000) {
            return false;
        }
        // A root-owned sticky ancestor (e.g. /tmp) cannot replace our owned private directory.
        if (($stat['mode'] & 0022) !== 0 && !($stat['uid'] === 0 && ($stat['mode'] & 01000) !== 0)) {
            return false;
        }
        if ($path === '/') {
            break;
        }
    }
    foreach ([ABSPATH, dirname(__DIR__), $_SERVER['DOCUMENT_ROOT'] ?? ''] as $root) {
        if (!is_string($root) || $root === '') {
            continue;
        }
        $resolvedRoot = realpath($root);
        if ($resolvedRoot === false) {
            return false;
        }
        if ($parent === $resolvedRoot || str_starts_with($parent, rtrim($resolvedRoot, '/') . '/')) {
            return false;
        }
    }
    $stat = @lstat($file);
    return $stat === false || (
        ($stat['mode'] & 0170000) === 0100000 && ($stat['mode'] & 0077) === 0
        && $stat['uid'] === posix_geteuid() && $stat['nlink'] === 1
    );
}

/** @param array<string,mixed> $configuration */
function gq_game_admin_profile_revision(string $environment, array $configuration): string
{
    return 'gq_game_admin_profile_' . $environment . '_'
        . hash('sha256', json_encode($configuration, JSON_THROW_ON_ERROR));
}

/** @return array{type:string,message:string} */
function gq_game_admin_save_profile(string $environment, array $input): array
{
    $failure = ['type' => 'error', 'message' => __(
        'Profile not saved. Configure a fixed DB_CONFIG_FILE in an existing private owner-only directory'
            . ' outside all webroots. POSIX ownership checks are required; no directories are created.',
        'gq-game-admin'
    )];
    $constant = 'GQ_GAME_ADMIN_' . strtoupper($environment) . '_DB_CONFIG_FILE';
    $file = defined($constant) ? constant($constant) : null;
    if (!is_string($file) || !gq_game_admin_safe_profile_path($file)) {
        return $failure;
    }
    // Lock the stable directory inode, not the profile inode that atomic rename replaces.
    $lock = @fopen(dirname($file), 'r');
    if ($lock === false) {
        return $failure;
    }
    $temporary = null;
    try {
        if (!flock($lock, LOCK_EX | LOCK_NB) || !gq_game_admin_safe_profile_path($file)) {
            return $failure;
        }
        $directory = fstat($lock);
        $currentDirectory = @lstat(dirname($file));
        if (
            $directory === false || $currentDirectory === false
            || $directory['ino'] !== $currentDirectory['ino'] || $directory['dev'] !== $currentDirectory['dev']
        ) {
            return $failure;
        }
        $exists = file_exists($file);
        $previous = $exists ? gq_game_admin_read_database_configuration($file, $environment) : [];
        if (isset($previous['error'])) {
            return $failure;
        }
        $revision = $input['profile_revision'] ?? '';
        if (
            !is_string($revision)
            || wp_verify_nonce(wp_unslash($revision), gq_game_admin_profile_revision($environment, $previous)) === false
            || ($exists && ($input['replace_profile'] ?? '') !== '1')
        ) {
            return ['type' => 'error', 'message' => __(
                'Profile not saved. Reload the form; explicitly confirm replacement of an existing profile.'
                    . ' A concurrent save or expired revision requires a fresh form.',
                'gq-game-admin'
            )];
        }
        $credentials = gq_game_admin_entered_credentials($environment, $input, $previous);
        if (isset($credentials['error'])) {
            return ['type' => 'error', 'message' => $credentials['error']];
        }
        $body = json_encode([
            'environment' => $environment, 'host' => $credentials['host'], 'port' => $credentials['port'],
            'database' => $credentials['database'], 'username' => $credentials['user'],
            'password' => $credentials['password'],
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        $temporary = dirname($file) . '/.gq-profile-' . bin2hex(random_bytes(16));
        $mask = umask(0077);
        try {
            $stream = @fopen($temporary, 'x+b');
        } finally {
            umask($mask);
        }
        if ($stream === false) {
            return $failure;
        }
        try {
            if (
                !gq_game_admin_safe_profile_path($temporary)
                || fwrite($stream, $body) !== strlen($body) || !fflush($stream) || !fsync($stream)
            ) {
                return $failure;
            }
        } finally {
            fclose($stream);
        }
        $current = file_exists($file) ? gq_game_admin_read_database_configuration($file, $environment) : [];
        $currentDirectory = @lstat(dirname($file));
        if (
            $current !== $previous || !gq_game_admin_safe_profile_path($file)
            || $currentDirectory === false || $directory['ino'] !== $currentDirectory['ino']
            || $directory['dev'] !== $currentDirectory['dev'] || !@rename($temporary, $file)
        ) {
            return $failure;
        }
        $temporary = null;
        return ['type' => 'success', 'message' => __(
            'Private inspection profile saved atomically (not connection-tested). Its database name is authoritative;'
                . ' legacy WordPress name options are ignored, not updated.'
                . ' No game runtime configuration or data changed.',
            'gq-game-admin'
        )];
    } finally {
        if ($temporary !== null) {
            @unlink($temporary);
        }
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/** @return array<string,mixed> */
function gq_game_admin_entered_credentials(string $environment, array $input, array $stored): array
{
    $credentials = [];
    foreach (['database', 'host', 'port', 'user', 'password'] as $key) {
        if (!is_string($input[$key] ?? null)) {
            return ['error' => __('Enter all inspection connection fields.', 'gq-game-admin')];
        }
        $credentials[$key] = wp_unslash($input[$key]);
    }
    $port = filter_var(
        $credentials['port'],
        FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1, 'max_range' => 65535]]
    );
    if (
        !gq_game_admin_valid_database_name($credentials['database'])
        || preg_match('/\A[A-Za-z0-9_-]+\z/D', $credentials['database']) !== 1
        || strlen($credentials['host']) > 253
        || preg_match('/\A[A-Za-z0-9.:-]+\z/D', $credentials['host']) !== 1
        || $port === false || $credentials['user'] === '' || strlen($credentials['user']) > 128
        || preg_match('/[\x00-\x1f\x7f]/', $credentials['user']) || strlen($credentials['password']) > 4096
        || preg_match('//u', $credentials['user']) !== 1 || preg_match('//u', $credentials['password']) !== 1
    ) {
        return ['error' => __(
            'Invalid inspection connection fields. Use a collector-compatible database name.',
            'gq-game-admin'
        )];
    }
    $credentials['port'] = $port;
    if ($credentials['password'] === '') {
        $name = $stored['database'] ?? (gq_game_admin_database_settings($environment)['name'] ?? '');
        foreach (['host', 'port', 'user'] as $key) {
            if (($stored[$key] ?? null) !== $credentials[$key]) {
                return ['error' => __(
                    'Enter a password when changing the connection target or user.',
                    'gq-game-admin'
                )];
            }
        }
        if (
            $name !== $credentials['database']
            || !is_string($stored['password'] ?? null) || $stored['password'] === ''
        ) {
            return ['error' => __('Enter a password when changing the connection target or user.', 'gq-game-admin')];
        }
        $credentials['password'] = $stored['password'];
    }
    return $credentials;
}

/** @return array{host:mixed,port:mixed,user:mixed,password:mixed,database?:string}|array{error:string} */
function gq_game_admin_database_configuration(string $environment): array
{
    if (!in_array($environment, ['staging', 'production'], true)) {
        return ['error' => __('Unknown game administration environment.', 'gq-game-admin')];
    }
    $prefix = 'GQ_GAME_ADMIN_' . strtoupper($environment) . '_DB_';
    if (defined($prefix . 'CONFIG_FILE')) {
        $file = constant($prefix . 'CONFIG_FILE');
        return gq_game_admin_read_database_configuration(is_string($file) ? $file : '', $environment);
    }
    $credentials = [];
    foreach (['HOST' => 'localhost', 'PORT' => 3306, 'USER' => '', 'PASSWORD' => ''] as $key => $default) {
        $credentials[strtolower($key)] = defined($prefix . $key) ? constant($prefix . $key) : $default;
    }
    return $credentials;
}

/** @return array{host:string,port:int,user:string,password:string,database?:string}|array{error:string} */
function gq_game_admin_database_credentials(string $environment): array
{
    $credentials = gq_game_admin_database_configuration($environment);
    if (isset($credentials['error'])) {
        return $credentials;
    }
    if (
        !is_string($credentials['host']) || $credentials['host'] === ''
        || preg_match('/[;\x00-\x20]/', $credentials['host'])
        || !is_int($credentials['port']) || $credentials['port'] < 1 || $credentials['port'] > 65535
        || !is_string($credentials['user']) || $credentials['user'] === ''
        || !is_string($credentials['password']) || $credentials['password'] === ''
    ) {
        return ['error' => __(
            'Configure the environment-specific DB_HOST, DB_PORT, DB_USER and DB_PASSWORD constants in wp-config.php.'
                . ' Use a separate Plesk database account, not the WordPress database credentials.',
            'gq-game-admin'
        )];
    }
    return $credentials;
}

/**
 * @param array{host:string,port:int,user:string,password:string} $credentials
 * @return array{name?:string,server_version?:string,error?:string}
 */
function gq_game_admin_probe_database(array $credentials, string $database): array
{
    if (!gq_game_admin_valid_database_name($database)) {
        return ['error' => __('Invalid database name.', 'gq-game-admin')];
    }
    if (!extension_loaded('mysqli')) {
        return ['error' => __('PHP ext-mysqli is required for database connection tests.', 'gq-game-admin')];
    }
    $connection = mysqli_init();
    if ($connection === false) {
        return ['error' => __('Could not initialize the database connection test.', 'gq-game-admin')];
    }
    // Scope strict reporting to this probe so failures cannot emit raw connection warnings.
    $driver = new mysqli_driver();
    $originalMode = $driver->report_mode;
    $driver->report_mode = MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT;
    try {
        if (
            !$connection->options(MYSQLI_OPT_CONNECT_TIMEOUT, 5)
            || !$connection->options(MYSQLI_OPT_READ_TIMEOUT, 5)
            || !$connection->options(MYSQLI_INIT_COMMAND, 'SET SESSION TRANSACTION READ ONLY')
            || !$connection->real_connect(
                $credentials['host'],
                $credentials['user'],
                $credentials['password'],
                $database,
                $credentials['port']
            )
        ) {
            return ['error' => __(
                'Connection failed. Check the Plesk database, credentials and access grants.',
                'gq-game-admin'
            )];
        }
        $result = $connection->query('SELECT DATABASE() AS name, VERSION() AS server_version');
        if (!$result instanceof mysqli_result) {
            return ['error' => __('Could not verify the connected database identity.', 'gq-game-admin')];
        }
        try {
            $identity = $result->fetch_assoc();
            if (
                !is_array($identity) || ($identity['name'] ?? null) !== $database
                || !is_string($identity['server_version'] ?? null)
            ) {
                return ['error' => __(
                    'The connected database identity does not match the entered name.',
                    'gq-game-admin'
                )];
            }
            return ['name' => $identity['name'], 'server_version' => $identity['server_version']];
        } finally {
            $result->free();
        }
    } catch (mysqli_sql_exception $error) {
        return ['error' => __(
            'Connection failed. Check the Plesk database, credentials and access grants.',
            'gq-game-admin'
        )];
    } finally {
        $driver->report_mode = $originalMode;
        $connection->close();
    }
}

/** @return array{type:string,message:string} */
function gq_game_admin_process_database_request(array $input): array
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_die(esc_html__('Database actions require POST.', 'gq-game-admin'), '', ['response' => 405]);
    }
    $environment = $input['environment'] ?? null;
    $operation = $input['operation'] ?? null;
    if (
        !in_array($environment, ['staging', 'production'], true)
        || !in_array($operation, ['save', 'test', 'save_profile', 'test_entered'], true)
    ) {
        return ['type' => 'error', 'message' => __('Invalid database settings request.', 'gq-game-admin')];
    }
    $nonce = $input['_wpnonce'] ?? null;
    if (!is_string($nonce) || wp_verify_nonce(wp_unslash($nonce), 'gq_game_admin_database_' . $environment) === false) {
        wp_die(esc_html__('Database settings security check failed.', 'gq-game-admin'), '', ['response' => 403]);
    }
    $legacy = in_array($operation, ['save', 'test'], true);
    if ($legacy) {
        if (
            defined('GQ_GAME_ADMIN_' . strtoupper($environment) . '_DB_CONFIG_FILE')
            || array_intersect(['host', 'port', 'user', 'password'], array_keys($input)) !== []
        ) {
            return ['type' => 'error', 'message' => __(
                'Legacy actions accept only a database name and server constants, never submitted credentials.'
                    . ' A configured JSON profile is authoritative; use its separate HTTPS form.',
                'gq-game-admin'
            )];
        }
        $name = $input['database'] ?? null;
        $name = is_string($name) ? trim(wp_unslash($name)) : '';
        if (!gq_game_admin_valid_database_name($name)) {
            return ['type' => 'error', 'message' => __('Enter a valid Plesk database name.', 'gq-game-admin')];
        }
        if ($operation === 'save') {
            $option = 'gq_game_admin_database_' . $environment;
            update_option($option, $name, false);
            if (get_option($option) !== $name) {
                return ['type' => 'error', 'message' => __('Could not save the database name.', 'gq-game-admin')];
            }
            return ['type' => 'success', 'message' => __(
                'Database name saved for administration only. Server credentials and game data were not changed.',
                'gq-game-admin'
            )];
        }
        $credentials = gq_game_admin_database_credentials($environment);
    } elseif (!gq_game_admin_secure_transport()) {
        return ['type' => 'error', 'message' => __(
            'HTTPS is required for inspection credentials, including local development.'
                . ' No credentials were used or saved.',
            'gq-game-admin'
        )];
    } elseif ($operation === 'save_profile') {
        return gq_game_admin_save_profile($environment, $input);
    } else {
        $credentials = gq_game_admin_entered_credentials(
            $environment,
            $input,
            gq_game_admin_database_configuration($environment)
        );
        $name = $credentials['database'] ?? '';
    }
    if (isset($credentials['error'])) {
        return ['type' => 'error', 'message' => $credentials['error']];
    }
    $label = $environment === 'staging' ? 'Staging' : 'Production';
    $probe = gq_game_admin_probe_database($credentials, $name);
    if (isset($probe['error'])) {
        return ['type' => 'error', 'message' => $label . ': ' . $probe['error']];
    }
    return ['type' => 'success', 'message' => sprintf(
        __(
            '%1$s: Connected to %2$s (%3$s). Read-only test; name not saved and no setup/migration approval.',
            'gq-game-admin'
        ),
        $label,
        $probe['name'],
        $probe['server_version']
    )];
}

function gq_game_admin_secure_transport(): bool
{
    // No HTTP localhost exception: a loopback reverse proxy cannot establish the client's locality.
    return is_ssl() && strtolower((string)parse_url(admin_url('admin-post.php'), PHP_URL_SCHEME)) === 'https';
}

function gq_game_admin_read_transport_allowed(string $environment): bool
{
    if (gq_game_admin_secure_transport()) {
        return true;
    }
    if (
        $environment !== 'staging'
        || !defined('GQ_GAME_ADMIN_LOCAL_HTTP_STAGING')
        || GQ_GAME_ADMIN_LOCAL_HTTP_STAGING !== true
        || !defined('GQ_GAME_ADMIN_LOCAL_HTTP_PEER')
        || !is_string(GQ_GAME_ADMIN_LOCAL_HTTP_PEER)
        || filter_var(GQ_GAME_ADMIN_LOCAL_HTTP_PEER, FILTER_VALIDATE_IP) === false
    ) {
        return false;
    }
    $url = parse_url(admin_url('admin.php'));
    if (
        !is_array($url) || ($url['scheme'] ?? '') !== 'http'
        || !in_array($url['host'] ?? '', ['localhost', '127.0.0.1'], true)
        || isset($url['user']) || isset($url['pass'])
    ) {
        return false;
    }
    $host = $url['host'] . (isset($url['port']) ? ':' . $url['port'] : '');
    if (
        strtolower((string)($_SERVER['HTTP_HOST'] ?? '')) !== $host
        || ($_SERVER['REMOTE_ADDR'] ?? null) !== GQ_GAME_ADMIN_LOCAL_HTTP_PEER
    ) {
        return false;
    }
    foreach (
        ['HTTP_FORWARDED', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_FORWARDED_HOST', 'HTTP_X_FORWARDED_PROTO',
            'HTTP_X_REAL_IP'] as $header
    ) {
        if (isset($_SERVER[$header])) {
            return false;
        }
    }
    return true;
}

function gq_game_admin_handle_database(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_die(esc_html__('Database actions require POST.', 'gq-game-admin'), '', ['response' => 405]);
    }
    $notice = gq_game_admin_process_database_request($_POST);
    $noticeKey = 'gq_game_admin_notice_' . get_current_user_id();
    if (!set_transient($noticeKey, $notice, 60) && get_transient($noticeKey) !== $notice) {
        wp_die(esc_html__('Could not store the database action result.', 'gq-game-admin'));
    }
    $environment = $_POST['environment'] ?? null;
    $target = 'admin.php?page=gq-game-admin&section=database';
    if (in_array($environment, ['staging', 'production'], true)) {
        $target .= '&environment=' . $environment;
    }
    if (!wp_safe_redirect(admin_url($target))) {
        wp_die(esc_html__('Could not redirect to the database action result.', 'gq-game-admin'));
    }
    exit;
}

function gq_game_admin_render_database_settings(string $environment): void
{
    $configuration = gq_game_admin_database_configuration($environment);
    if (isset($configuration['error'])) {
        echo '<p class="notice notice-error">' . esc_html($configuration['error']) . '</p>';
        $configuration = ['host' => '', 'port' => 3306, 'user' => '', 'password' => ''];
    }
    $settings = gq_game_admin_database_settings($environment);
    if (isset($settings['error'])) {
        echo '<p class="notice notice-error">' . esc_html($settings['error']) . '</p>';
    }
    $credentials = gq_game_admin_database_credentials($environment);
    if (isset($credentials['error'])) {
        echo '<p class="notice notice-error">' . esc_html($credentials['error']) . '</p>';
    }
    if (
        isset($configuration['database']) && ($settings['name'] ?? '') !== ''
        && $settings['name'] !== $configuration['database']
    ) {
        echo '<p class="notice notice-error">' . esc_html__(
            'The saved database does not match the private connection profile. Save the profile database name.',
            'gq-game-admin'
        ) . '</p>';
    }
    echo '<table class="widefat striped" data-gq-admin-table><caption>'
        . esc_html__('Read-only connection profile', 'gq-game-admin') . '</caption>';
    AdminTables::header(['Setting', 'Value']);
    echo '<tbody>';
    echo '<tr><th scope="row">' . esc_html__('Credential source', 'gq-game-admin') . '</th><td>'
        . esc_html(isset($configuration['database'])
            ? __('Private JSON file', 'gq-game-admin')
            : __('Server constants', 'gq-game-admin')) . '</td></tr>';
    if (isset($configuration['database'])) {
        echo '<tr><th scope="row">' . esc_html__('Profile database', 'gq-game-admin') . '</th><td>'
            . esc_html($configuration['database']) . '</td></tr>';
    }
    foreach (['host' => 'Host', 'port' => 'Port', 'user' => 'Database user'] as $key => $label) {
        $value = $configuration[$key];
        $display = (is_string($value) && $value !== '') || is_int($value)
            ? (string)$value : __('Not configured or invalid', 'gq-game-admin');
        echo '<tr><th scope="row">' . esc_html__($label, 'gq-game-admin') . '</th><td>'
            . esc_html($display) . '</td></tr>';
    }
    echo '<tr><th scope="row">' . esc_html__('Password', 'gq-game-admin') . '</th><td>'
        . esc_html(is_string($configuration['password']) && $configuration['password'] !== ''
            ? __('Configured (hidden)', 'gq-game-admin')
            : __('Not configured or invalid', 'gq-game-admin')) . '</td></tr></tbody></table>';
    echo '<p>' . esc_html__(
        'Each environment needs its own Plesk database user and password. Enter credentials below or configure'
            . ' them server-side; passwords are never displayed. Configured does not mean the connection was tested.'
            . ' Use an independently provisioned SELECT-only account; this test does not certify grants.',
        'gq-game-admin'
    ) . '</p>';
    $constant = 'GQ_GAME_ADMIN_' . strtoupper($environment) . '_DB_CONFIG_FILE';
    $file = defined($constant) ? constant($constant) : null;
    if (!defined($constant)) {
        echo '<h3>' . esc_html__('Database name and server-stored credentials', 'gq-game-admin') . '</h3>';
        echo '<p>' . esc_html__(
            'This separate form sends no password. Save only the administration database name, or run'
                . ' a read-only test using server constants. These legacy actions also work over HTTP.',
            'gq-game-admin'
        ) . '</p>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        echo '<input type="hidden" name="action" value="gq_game_admin_database">';
        echo '<input type="hidden" name="environment" value="' . esc_attr($environment) . '">';
        wp_nonce_field('gq_game_admin_database_' . $environment);
        echo '<p><label>' . esc_html__('Plesk database name', 'gq-game-admin')
            . ' <input type="text" name="database" maxlength="64" required value="'
            . esc_attr($settings['name'] ?? '') . '"></label></p>';
        echo '<p><button type="submit" class="button" name="operation" value="save">'
            . esc_html__('Save database name only', 'gq-game-admin') . '</button> ';
        echo '<button type="submit" class="button" name="operation" value="test">'
            . esc_html__('Test with server-stored credentials', 'gq-game-admin') . '</button></p></form>';
    }
    $canSave = is_string($file) && gq_game_admin_safe_profile_path($file) && is_writable(dirname($file))
        && (!file_exists($file) || isset($configuration['database']));
    if (!$canSave) {
        echo '<p class="notice notice-warning">' . esc_html__(
            'Profile saving unavailable: an administrator must configure a fixed private DB_CONFIG_FILE'
                . ' and an existing owner-only directory outside the webroots (POSIX ownership checks required).'
                . ' Server constants remain read-only. You can test entered credentials over HTTPS without saving.',
            'gq-game-admin'
        ) . '</p>';
    }
    $secure = gq_game_admin_secure_transport();
    if (!$secure) {
        echo '<p class="notice notice-error">' . esc_html__(
            'HTTPS is required before entering or submitting credentials, including local development.'
                . ' There is no HTTP localhost or reverse-proxy exemption.',
            'gq-game-admin'
        ) . '</p>';
    }
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    echo '<input type="hidden" name="action" value="gq_game_admin_database">';
    echo '<input type="hidden" name="environment" value="' . esc_attr($environment) . '">';
    wp_nonce_field('gq_game_admin_database_' . $environment);
    if ($canSave) {
        wp_nonce_field(
            gq_game_admin_profile_revision($environment, isset($configuration['database']) ? $configuration : []),
            'profile_revision'
        );
    }
    echo '<p><label for="gq-database-' . esc_attr($environment) . '">'
        . esc_html__('Plesk database name', 'gq-game-admin') . '</label> ';
    echo '<input type="text" name="database" id="gq-database-' . esc_attr($environment)
        . '" maxlength="64" required value="'
        . esc_attr($settings['name'] ?? '') . '"></p>';
    $fields = ['host' => 'Host', 'port' => 'Port', 'user' => 'Database user', 'password' => 'Password'];
    foreach ($fields as $key => $label) {
        $value = $key === 'password' ? '' : $configuration[$key];
        $value = is_string($value) || is_int($value) ? (string)$value : '';
        echo '<p><label>' . esc_html__($label, 'gq-game-admin') . ' <input name="' . esc_attr($key)
            . '" type="' . ($key === 'password' ? 'password' : 'text') . '" value="' . esc_attr($value)
            . '" autocomplete="' . ($key === 'password' ? 'new-password' : 'off') . '"'
            . (!$secure ? ' disabled' : '') . '></label></p>';
    }
    echo '<p>' . esc_html__(
        'Blank password preserves the safely readable secret only when host, port, user and database are unchanged.'
            . ' Otherwise enter a new password. Tests never save.'
            . ' Saving does not rewrite the game or CLI collector configuration;'
            . ' a collector explicitly configured to read this same JSON file will use it.'
            . ' The profile database overrides legacy name options; no WordPress options are updated.',
        'gq-game-admin'
    ) . '</p>';
    echo '<p><label><input type="checkbox" name="replace_profile" value="1">'
        . esc_html__('Explicitly replace the existing inspection profile', 'gq-game-admin') . '</label></p>';
    echo '<p><button type="submit" class="button button-primary" name="operation" value="save_profile"'
        . (!$canSave || !$secure ? ' disabled' : '') . '>'
        . esc_html__('Save private inspection profile', 'gq-game-admin') . '</button> ';
    echo '<button type="submit" class="button" name="operation" value="test_entered"'
        . (!$secure ? ' disabled' : '') . '>'
        . esc_html__('Test entered credentials (no save)', 'gq-game-admin') . '</button></p></form>';
}

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
    $settings = gq_game_admin_database_settings($environment);
    if (isset($settings['error'])) {
        return $settings;
    }
    $configuration = gq_game_admin_database_configuration($environment);
    if (isset($configuration['error'])) {
        return $configuration;
    }
    if (isset($configuration['database']) && $configuration['database'] !== $settings['name']) {
        return ['error' => __(
            'Save the database name bound to the private connection profile before loading its inspection report.',
            'gq-game-admin'
        )];
    }
    if (
        !defined($prefix . 'REPORT_FILE') || !is_string(constant($prefix . 'REPORT_FILE'))
        || $settings['name'] === ''
    ) {
        return ['error' => __(
            'Configure the private report path in wp-config.php and save the Plesk database name above.'
                . ' Reports are separate from the on-demand connection test.',
            'gq-game-admin'
        )];
    }
    return gq_game_admin_read_report(
        constant($prefix . 'REPORT_FILE'),
        $environment,
        $settings['name'],
        time()
    );
}

/** @return array<string,array{label:string,status:string,message:string}> */
function gq_game_admin_setup_checks(string $environment, array $report, int $now): array
{
    $settings = gq_game_admin_database_settings($environment);
    $credentials = gq_game_admin_database_credentials($environment);
    $databaseConfigured = !isset($settings['error']) && $settings['name'] !== '';
    $profileMatches = !isset($credentials['database'])
        || ($databaseConfigured && $credentials['database'] === $settings['name']);
    $profileConfigured = !isset($credentials['error']) && $profileMatches;
    if (!$databaseConfigured) {
        $report = ['error' => __('Save the exact Plesk database name first.', 'gq-game-admin')];
    } elseif (!$profileMatches) {
        $report = ['error' => __('The database name does not match the private connection profile.', 'gq-game-admin')];
    } elseif (!isset($report['error'])) {
        $report = gq_game_admin_validate_report($report, $environment, $settings['name'], $now);
    }
    $checks = [
        'database' => [
            'label' => __('Plesk database selection', 'gq-game-admin'),
            'status' => $databaseConfigured ? 'observed' : 'action-required',
            'message' => $databaseConfigured ? $settings['name']
                : ($settings['error'] ?? __('Create the database in Plesk and save its exact name.', 'gq-game-admin')),
        ],
        'credentials' => [
            'label' => __('Private inspection credentials', 'gq-game-admin'),
            'status' => $profileConfigured ? 'observed' : 'blocked',
            'message' => $credentials['error'] ?? ($profileMatches
                ? __('Configured only; use the connection test. SELECT-only grants are not certified.', 'gq-game-admin')
                : __('Save the database name bound to the private connection profile.', 'gq-game-admin')),
        ],
        'inspection' => [
            'label' => __('Fresh candidate and database inspection', 'gq-game-admin'),
            'status' => isset($report['error']) ? 'blocked' : 'observed',
            'message' => $report['error'] ?? sprintf(
                __('Valid snapshot from %s UTC; not a live connection test or release approval.', 'gq-game-admin'),
                gmdate('Y-m-d H:i:s', $report['generated_at'])
            ),
        ],
        'migrations' => [
            'label' => __('Setup and migration review', 'gq-game-admin'),
            'status' => 'blocked',
            'message' => __(
                'Generate a valid inspection report before reviewing setup or migrations.',
                'gq-game-admin'
            ),
        ],
        'execution' => [
            'label' => __('Controlled execution', 'gq-game-admin'),
            'status' => 'blocked',
            'message' => __(
                'Locked: release approval, verified backup/restore, writer coordination and an authorized runner'
                    . ' are not implemented. No setup, migration or restore can start here.',
                'gq-game-admin'
            ),
        ],
    ];
    if (!isset($report['error'])) {
        $plan = $report['plan'];
        $review = $checks['migrations'];
        if ($plan['migrations']['blockers'] !== []) {
            $review['message'] = implode(' ', $plan['migrations']['blockers']);
        } elseif ($plan['database']['state'] === 'empty') {
            $review['status'] = 'action-required';
            $review['message'] = __(
                'No visible tables/views. Independently verify the empty target and review initial seeds.'
                    . ' Setup is locked.',
                'gq-game-admin'
            );
        } elseif ($plan['database']['state'] === 'untracked') {
            $review['status'] = 'action-required';
            $review['message'] = __(
                'Existing schema without history: audit/adoption is required. Do not rerun initial setup.',
                'gq-game-admin'
            );
        } else {
            $pending = count(array_filter(
                $plan['migrations']['entries'],
                static fn(array $entry): bool => $entry['status'] === 'pending'
            ));
            $review['status'] = $pending > 0 ? 'action-required' : 'observed';
            $review['message'] = $pending > 0 ? sprintf(
                __('%d pending migration(s) require review; execution remains locked.', 'gq-game-admin'),
                $pending
            ) : __('No pending migrations in this snapshot; not a deployment approval.', 'gq-game-admin');
        }
        $checks['migrations'] = $review;
    }
    return $checks;
}

function gq_game_admin_render_setup_checks(array $checks): void
{
    echo '<h2>' . esc_html__('Environment setup checklist', 'gq-game-admin') . '</h2><p>'
        . esc_html__(
            'Read-only guidance, not an execution authorization. Observed configuration is not operational readiness.',
            'gq-game-admin'
        ) . '</p><table class="widefat striped" data-gq-admin-table>';
    AdminTables::header(['Check', 'Status', 'Required action / evidence']);
    echo '<tbody>';
    foreach ($checks as $check) {
        $status = match ($check['status']) {
            'observed' => __('Observed', 'gq-game-admin'),
            'action-required' => __('Action required', 'gq-game-admin'),
            default => __('Blocked', 'gq-game-admin'),
        };
        echo '<tr><th scope="row">' . esc_html($check['label']) . '</th><td>'
            . esc_html($status) . '</td><td>' . esc_html($check['message']) . '</td></tr>';
    }
    echo '</tbody></table>';
}

/** @return array{filename:string,body:string}|array{error:string} */
function gq_game_admin_build_review_export(
    array $report,
    string $environment,
    string $database,
    string $expectedDigest,
    int $now
): array {
    if (isset($report['error'])) {
        return ['error' => $report['error']];
    }
    $report = gq_game_admin_validate_report($report, $environment, $database, $now);
    if (isset($report['error'])) {
        return $report;
    }
    if (!hash_equals($report['plan_sha256'], $expectedDigest)) {
        return ['error' => __(
            'The inspection plan changed. Reload the environment page and review the current plan before downloading.',
            'gq-game-admin'
        )];
    }
    $source = $report['plan'];
    $plan = [
        'environment' => $environment,
        'database' => [
            'name' => $database, 'server_version' => $source['database']['server_version'],
            'table_count' => $source['database']['table_count'], 'state' => $source['database']['state'],
        ],
        'release' => [
            'commit' => $source['release']['commit'], 'version' => $source['release']['version'],
            'status' => $source['release']['status'],
            'manifest_sha256' => $source['release']['manifest_sha256'],
            'baseline_sha256' => $source['release']['baseline_sha256'],
        ],
        'migrations' => [
            'tracking_present' => $source['migrations']['tracking_present'],
            'entries' => array_map(
                static fn(array $entry): array => [
                    'name' => $entry['name'], 'status' => $entry['status'], 'sha256' => $entry['sha256'],
                ],
                $source['migrations']['entries']
            ),
            'blockers' => $source['migrations']['blockers'],
        ],
    ];
    try {
        $export = [
            'schema_version' => 1,
            'purpose' => 'manual-migration-review',
            'execution_allowed' => false,
            'exported_at' => $now,
            'observed_at' => $report['generated_at'],
            'source_plan_sha256' => $report['plan_sha256'],
            'plan_sha256' => hash('sha256', json_encode($plan, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)),
            'plan' => $plan,
            'limitations' => [
                'Read-only snapshot, not a live database check, job request or execution approval.',
                'Digests are integrity checks, not independent signatures.',
                'Setup, migrations and restore remain locked;'
                    . ' verified backup/restore and approvals are still required.',
            ],
        ];
        return [
            'filename' => 'gq-' . $environment . '-migration-review-' . substr($export['plan_sha256'], 0, 12) . '.json',
            'body' => json_encode($export, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n",
        ];
    } catch (JsonException $error) {
        return ['error' => __('Could not encode the read-only review plan.', 'gq-game-admin')];
    }
}

/** @return array{filename:string,body:string}|array{error:string} */
function gq_game_admin_process_review_export(array $input): array
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    $environment = $input['environment'] ?? null;
    $database = $input['database'] ?? null;
    $digest = $input['plan_sha256'] ?? null;
    if (
        !in_array($environment, ['staging', 'production'], true)
        || !is_string($database) || !gq_game_admin_valid_database_name($database)
        || !is_string($digest) || preg_match('/\A[a-f0-9]{64}\z/D', $digest) !== 1
    ) {
        return ['error' => __('Invalid review plan download request.', 'gq-game-admin')];
    }
    $nonce = $input['_wpnonce'] ?? null;
    if (
        !is_string($nonce)
        || wp_verify_nonce(wp_unslash($nonce), 'gq_game_admin_export_review_' . $environment . '_' . $digest) === false
    ) {
        wp_die(esc_html__('Review plan security check failed.', 'gq-game-admin'), '', ['response' => 403]);
    }
    return gq_game_admin_build_review_export(
        gq_game_admin_environment_report($environment),
        $environment,
        $database,
        $digest,
        time()
    );
}

function gq_game_admin_handle_review_export(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_die(esc_html__('Review plan downloads require POST.', 'gq-game-admin'), '', ['response' => 405]);
    }
    $export = gq_game_admin_process_review_export($_POST);
    if (isset($export['error'])) {
        wp_die(esc_html($export['error']), '', ['response' => 409]);
    }
    if (headers_sent()) {
        wp_die(esc_html__('Could not send review plan download headers.', 'gq-game-admin'), '', ['response' => 500]);
    }
    nocache_headers();
    header('Cache-Control: no-store, private');
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Content-Disposition: attachment; filename="' . $export['filename'] . '"');
    echo $export['body'];
    exit;
}

function gq_game_admin_render_environment(string $label, array $report): void
{
    echo '<h2>' . esc_html($label) . '</h2>';
    if (isset($report['error'])) {
        echo '<div class="notice notice-warning inline"><p>' . esc_html($report['error']) . '</p></div>';
        return;
    }
    $plan = $report['plan'];
    echo '<table class="widefat striped" data-gq-admin-table>';
    AdminTables::header(['Property', 'Value']);
    echo '<tbody>';
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
        'Credentials stay in private server configuration; only database names are stored in WordPress options.',
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
    )) . '</summary><table class="widefat striped" data-gq-admin-table>';
    AdminTables::header(['Migration', 'State', 'SQL SHA-256']);
    echo '<tbody>';
    foreach ($plan['migrations']['entries'] as $entry) {
        echo '<tr><td>' . esc_html($entry['name']) . '</td><td>' . esc_html($entry['status'])
            . '</td><td><code>' . esc_html($entry['sha256']) . '</code></td></tr>';
    }
    echo '</tbody></table></details>';
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    $fields = [
        'action' => 'gq_game_admin_export_review', 'environment' => $plan['environment'],
        'database' => $plan['database']['name'], 'plan_sha256' => $report['plan_sha256'],
    ];
    foreach ($fields as $name => $value) {
        echo '<input type="hidden" name="' . esc_attr($name) . '" value="' . esc_attr($value) . '">';
    }
    wp_nonce_field('gq_game_admin_export_review_' . $plan['environment'] . '_' . $report['plan_sha256']);
    echo '<p><button type="submit" class="button">'
        . esc_html__('Download read-only review plan (JSON)', 'gq-game-admin') . '</button></p></form><p>'
        . esc_html__(
            'The download contains snapshot evidence and checksums, not SQL, credentials or execution approval.'
                . ' A changed or expired report must be reviewed again.',
            'gq-game-admin'
        ) . '</p>';
}

function gq_game_admin_render_page(): void
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    $environment = array_key_exists('environment', $_GET) ? $_GET['environment'] : 'staging';
    if (!in_array($environment, ['staging', 'production'], true)) {
        wp_die(esc_html__('Unknown game administration environment.', 'gq-game-admin'), '', ['response' => 400]);
    }
    $sections = [
        'overview' => __('Game overview', 'gq-game-admin'),
        'players' => __('Players', 'gq-game-admin'),
        'universe' => __('Universe', 'gq-game-admin'),
        'planets' => __('Planets', 'gq-game-admin'),
        'colonies' => __('Colonies', 'gq-game-admin'),
        'buildings' => __('Buildings', 'gq-game-admin'),
        'building_queue' => __('Building queue', 'gq-game-admin'),
        'ship_queue' => __('Ship queue', 'gq-game-admin'),
        'ship_inventory' => __('Ship inventory', 'gq-game-admin'),
        'vessels' => __('Built vessels', 'gq-game-admin'),
        'blueprints' => __('Vessel blueprints', 'gq-game-admin'),
        'fleets' => __('Fleets', 'gq-game-admin'),
        'research' => __('Research', 'gq-game-admin'),
        'content' => __('Content and assets', 'gq-game-admin'),
        'database' => __('Database', 'gq-game-admin'),
        'inspection' => __('Inspection', 'gq-game-admin'),
        'operations' => __('Controlled operations', 'gq-game-admin'),
        'updates' => __('Plugin updates', 'gq-game-admin'),
    ];
    $section = array_key_exists('section', $_GET) ? $_GET['section'] : 'database';
    if (!is_string($section) || !array_key_exists($section, $sections)) {
        wp_die(esc_html__('Unknown game administration section.', 'gq-game-admin'), '', ['response' => 400]);
    }
    echo '<div class="wrap"><h1>' . esc_html__('GalaxyQuest Administration', 'gq-game-admin') . '</h1><p>';
    echo esc_html__(
        'Choose an environment and administration area. WordPress access does not grant game administrator'
            . ' privileges. Deployment remains separate and databases are created in Plesk.',
        'gq-game-admin'
    );
    echo '</p>';
    $noticeKey = 'gq_game_admin_notice_' . get_current_user_id();
    $notice = get_transient($noticeKey);
    if (is_array($notice)) {
        delete_transient($noticeKey);
        $type = ($notice['type'] ?? null) === 'success' ? 'success' : 'error';
        echo '<div class="notice notice-' . $type . '"><p>' . esc_html($notice['message'] ?? '') . '</p></div>';
    }
    echo '<form method="get" action="' . esc_url(admin_url('admin.php')) . '">';
    echo '<input type="hidden" name="page" value="gq-game-admin">';
    echo '<input type="hidden" name="section" value="' . esc_attr($section) . '">';
    echo '<p><label for="gq-game-admin-environment">' . esc_html__('Environment', 'gq-game-admin')
        . '</label> <select id="gq-game-admin-environment" name="environment">';
    foreach (['staging' => 'Staging', 'production' => 'Production'] as $value => $label) {
        echo '<option value="' . esc_attr($value) . '"' . ($value === $environment ? ' selected' : '') . '>'
            . esc_html__($label, 'gq-game-admin') . '</option>';
    }
    echo '</select> <button type="submit" class="button">'
        . esc_html__('Select environment', 'gq-game-admin') . '</button></p></form>';
    echo '<nav class="nav-tab-wrapper" aria-label="' . esc_attr(__('Administration sections', 'gq-game-admin'))
        . '">';
    foreach ($sections as $tab => $label) {
        $active = $tab === $section;
        echo '<a class="nav-tab' . ($active ? ' nav-tab-active' : '') . '" href="'
            . esc_url(admin_url('admin.php?page=gq-game-admin&section=' . $tab . '&environment=' . $environment))
            . '"' . ($active ? ' aria-current="page"' : '') . '>' . esc_html($label) . '</a>';
    }
    echo '</nav><section id="gq-game-admin-' . esc_attr($environment) . '">';
    $label = $environment === 'staging' ? 'Staging' : 'Production';
    if ($section === 'overview') {
        gq_game_admin_render_overview($environment);
    } elseif ($section === 'players') {
        gq_game_admin_render_players($environment);
    } elseif ($section === 'universe') {
        gq_game_admin_render_universe($environment);
    } elseif ($section === 'planets') {
        gq_game_admin_render_planets($environment);
    } elseif ($section === 'colonies') {
        gq_game_admin_render_colonies($environment);
    } elseif ($section === 'buildings') {
        gq_game_admin_render_buildings($environment);
    } elseif ($section === 'building_queue') {
        gq_game_admin_render_upgrade_records($environment, 'building_queue');
    } elseif ($section === 'ship_queue') {
        gq_game_admin_render_upgrade_records($environment, 'ship_queue');
    } elseif ($section === 'ship_inventory') {
        gq_game_admin_render_ship_inventory($environment);
    } elseif ($section === 'vessels') {
        gq_game_admin_render_vessels($environment);
    } elseif ($section === 'blueprints') {
        gq_game_admin_render_blueprints($environment);
    } elseif ($section === 'fleets') {
        gq_game_admin_render_fleets($environment);
    } elseif ($section === 'research') {
        gq_game_admin_render_research($environment);
    } elseif ($section === 'content') {
        gq_game_admin_render_game_area($section);
    } elseif ($section === 'database') {
        echo '<h2>' . esc_html__($label, 'gq-game-admin') . '</h2><p>' . esc_html__(
            'The connection test uses private environment-specific credentials and the entered database name.'
                . ' Testing does not save the name or replace a fresh migration report.'
                . ' Saving does not rewrite the game or CLI collector configuration.',
            'gq-game-admin'
        ) . '</p>';
        gq_game_admin_render_database_settings($environment);
    } elseif ($section === 'inspection') {
        $report = gq_game_admin_environment_report($environment);
        gq_game_admin_render_setup_checks(gq_game_admin_setup_checks($environment, $report, time()));
        gq_game_admin_render_environment(
            __($label, 'gq-game-admin') . ' - ' . __('Inspection', 'gq-game-admin'),
            $report
        );
    } elseif ($section === 'operations') {
        gq_game_admin_render_operations();
    } else {
        gq_game_admin_render_plugin_updates();
    }
    echo '</section></div>';
    AdminTables::assets();
}

/**
 * @param array{host:string,port:int,user:string,password:string} $credentials
 * @param callable(mysqli):array $reader
 */
function gq_game_admin_read_database(array $credentials, string $database, callable $reader): array
{
    if (!gq_game_admin_valid_database_name($database)) {
        return ['error' => __('Configure a valid database name first.', 'gq-game-admin')];
    }
    if (!extension_loaded('mysqli')) {
        return ['error' => __('PHP ext-mysqli is required for game inspection.', 'gq-game-admin')];
    }
    $connection = mysqli_init();
    if ($connection === false) {
        return ['error' => __('Could not initialize the game inspection connection.', 'gq-game-admin')];
    }
    $driver = new mysqli_driver();
    $originalMode = $driver->report_mode;
    $driver->report_mode = MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT;
    try {
        if (
            !$connection->options(MYSQLI_OPT_CONNECT_TIMEOUT, 5)
            || !$connection->options(MYSQLI_OPT_READ_TIMEOUT, 5)
            || !$connection->options(MYSQLI_INIT_COMMAND, 'SET SESSION TRANSACTION READ ONLY')
            || !$connection->real_connect(
                $credentials['host'],
                $credentials['user'],
                $credentials['password'],
                $database,
                $credentials['port']
            )
        ) {
            return ['error' => __(
                'Could not connect for game inspection. Check the connection and grants.',
                'gq-game-admin'
            )];
        }
        if (!$connection->set_charset('utf8mb4')) {
            return ['error' => __('Could not set the game inspection character set.', 'gq-game-admin')];
        }
        $result = $connection->query('SELECT DATABASE() AS db_name');
        if (!$result instanceof mysqli_result) {
            return ['error' => __('Could not verify the connected database identity.', 'gq-game-admin')];
        }
        try {
            $row = $result->fetch_assoc();
            if (!is_array($row) || ($row['db_name'] ?? null) !== $database) {
                return ['error' => __('The connected database identity does not match.', 'gq-game-admin')];
            }
        } finally {
            $result->free();
        }
        return $reader($connection);
    } catch (mysqli_sql_exception $error) {
        return ['error' => __(
            'Could not read game data. Check the connection, game schema and SELECT grants.',
            'gq-game-admin'
        )];
    } finally {
        $driver->report_mode = $originalMode;
        $connection->close();
    }
}

/** @return array<string,int|string> */
function gq_game_admin_query_overview(array $credentials, string $database): array
{
    return gq_game_admin_read_database($credentials, $database, static function (mysqli $connection): array {
        $result = $connection->query(
            'SELECT (SELECT COUNT(*) FROM users) AS users,'
            . ' (SELECT COUNT(*) FROM star_systems) AS systems,'
            . ' (SELECT COUNT(*) FROM planets) AS planets,'
            . ' (SELECT COUNT(*) FROM colonies) AS colonies,'
            . ' (SELECT COUNT(*) FROM fleets) AS fleets'
        );
        if (!$result instanceof mysqli_result) {
            return ['error' => __('Could not read the game overview.', 'gq-game-admin')];
        }
        try {
            $row = $result->fetch_assoc();
            $counts = [];
            foreach (['users', 'systems', 'planets', 'colonies', 'fleets'] as $key) {
                if (!is_array($row) || !isset($row[$key]) || !ctype_digit((string)$row[$key])) {
                    return ['error' => __('The game overview returned invalid data.', 'gq-game-admin')];
                }
                $counts[$key] = (int)$row[$key];
            }
            return $counts;
        } finally {
            $result->free();
        }
    });
}

/** @return array{credentials?:array,database?:string,error?:string} */
function gq_game_admin_inspection_target(string $environment): array
{
    $settings = gq_game_admin_database_settings($environment);
    if (isset($settings['error'])) {
        return $settings;
    }
    $credentials = gq_game_admin_database_credentials($environment);
    if (isset($credentials['error'])) {
        return $credentials;
    }
    $database = $settings['name'];
    if (isset($credentials['database']) && $credentials['database'] !== $database) {
        return ['error' => __('The database name does not match the inspection profile.', 'gq-game-admin')];
    }
    return ['credentials' => $credentials, 'database' => $database];
}

/** @return array<string,int|string> */
function gq_game_admin_process_overview_request(array $input): array
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_die(esc_html__('Game overview refresh requires POST.', 'gq-game-admin'), '', ['response' => 405]);
    }
    $environment = $input['environment'] ?? null;
    if (!in_array($environment, ['staging', 'production'], true)) {
        wp_die(esc_html__('Unknown game administration environment.', 'gq-game-admin'), '', ['response' => 400]);
    }
    $nonce = $input['_wpnonce'] ?? null;
    if (!is_string($nonce) || wp_verify_nonce(wp_unslash($nonce), 'gq_game_admin_overview_' . $environment) === false) {
        wp_die(esc_html__('Game overview security check failed.', 'gq-game-admin'), '', ['response' => 403]);
    }
    $target = gq_game_admin_inspection_target($environment);
    if (isset($target['error'])) {
        return $target;
    }
    $result = gq_game_admin_query_overview($target['credentials'], $target['database']);
    if (!isset($result['error'])) {
        $result['observed_at'] = gmdate('Y-m-d H:i:s') . ' UTC';
        $result['database'] = $target['database'];
    }
    return $result;
}

function gq_game_admin_handle_overview(): void
{
    $result = gq_game_admin_process_overview_request($_POST);
    $environment = $_POST['environment'];
    $key = 'gq_game_admin_overview_' . get_current_user_id() . '_' . $environment;
    delete_transient($key);
    if (!set_transient($key, $result, 300) && get_transient($key) !== $result) {
        wp_die(esc_html__('Could not store the game overview result.', 'gq-game-admin'));
    }
    if (!wp_safe_redirect(admin_url('admin.php?page=gq-game-admin&section=overview&environment=' . $environment))) {
        wp_die(esc_html__('Could not redirect to the game overview.', 'gq-game-admin'));
    }
    exit;
}

function gq_game_admin_render_overview(string $environment): void
{
    echo '<h2>' . esc_html__('Game overview', 'gq-game-admin') . '</h2><p>' . esc_html__(
        'Refresh explicitly to read aggregate counts using the selected environment\'s inspection account.'
            . ' Counts include all user records, including NPCs and deleted accounts;'
            . ' they are not active-player counts.'
            . ' No game data is changed.',
        'gq-game-admin'
    ) . '</p>';
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    echo '<input type="hidden" name="action" value="gq_game_admin_overview">';
    echo '<input type="hidden" name="environment" value="' . esc_attr($environment) . '">';
    wp_nonce_field('gq_game_admin_overview_' . $environment);
    echo '<p><button class="button" type="submit">' . esc_html__('Refresh game overview', 'gq-game-admin')
        . '</button></p></form>';
    $result = get_transient('gq_game_admin_overview_' . get_current_user_id() . '_' . $environment);
    if (!is_array($result)) {
        echo '<p>' . esc_html__('No recent overview. Refresh to read the selected game database.', 'gq-game-admin')
            . '</p>';
        return;
    }
    if (isset($result['error'])) {
        echo '<p class="notice notice-error">' . esc_html($result['error']) . '</p>';
        return;
    }
    echo '<p>' . esc_html(sprintf(
        __('Database: %1$s. Observed: %2$s. Snapshot expires after five minutes.', 'gq-game-admin'),
        $result['database'],
        $result['observed_at']
    )) . '</p><table class="widefat striped" data-gq-admin-table>';
    AdminTables::header(['Metric', 'Count']);
    echo '<tbody>';
    foreach (
        ['users' => 'User records', 'systems' => 'Star systems', 'planets' => 'Planets',
            'colonies' => 'Colonies', 'fleets' => 'Fleets'] as $key => $label
    ) {
        echo '<tr><th scope="row">' . esc_html__($label, 'gq-game-admin') . '</th><td>'
            . esc_html((string)$result[$key]) . '</td></tr>';
    }
    echo '</tbody></table>';
}

function gq_game_admin_query_players(
    array $credentials,
    string $database,
    string $before,
    string $search = '',
    string $actor = '',
    array $options = []
): array {
    $sort = $options['sort'] ?? 'id';
    $order = $options['order'] ?? 'desc';
    if (
        !in_array($sort, ['id', 'username', 'control_type', 'auth_enabled', 'is_admin'], true)
        || !in_array($order, ['asc', 'desc'], true)
    ) {
        return ['error' => __('Invalid player list sorting.', 'gq-game-admin')];
    }
    return gq_game_admin_read_database(
        $credentials,
        $database,
        static function (mysqli $connection) use ($before, $search, $actor, $sort, $order, $options): array {
            $parameters = [];
            $where = ' WHERE deleted_at IS NULL';
            if ($before !== '') {
                $operator = $order === 'asc' ? '>' : '<';
                if ($sort === 'id') {
                    $where .= ' AND id ' . $operator . ' ?';
                } else {
                    $where .= " AND ($sort $operator ? OR ($sort = ? AND id $operator ?))";
                    $parameters[] = $options['before_value'];
                    $parameters[] = $options['before_value'];
                }
                $parameters[] = $before;
            }
            if ($search !== '') {
                $where .= ' AND LOCATE(?, username) > 0';
                $parameters[] = $search;
            }
            if ($actor !== '') {
                $where .= ' AND control_type = ?';
                $parameters[] = $actor;
            }
            foreach (['login' => 'auth_enabled', 'admin' => 'is_admin'] as $key => $column) {
                if (($options[$key] ?? '') !== '') {
                    $where .= ' AND ' . $column . ' = ?';
                    $parameters[] = $options[$key];
                }
            }
            $sql = 'SELECT id, username, control_type, auth_enabled, is_admin FROM users'
                . $where . " ORDER BY $sort $order" . ($sort === 'id' ? '' : ", id $order") . ' LIMIT 51';
            $statement = $connection->prepare($sql);
            if ($statement === false) {
                return ['error' => __('Could not prepare the player inspection.', 'gq-game-admin')];
            }
            try {
                if (
                    ($parameters !== [] && !$statement->bind_param(str_repeat('s', count($parameters)), ...$parameters))
                    || !$statement->execute()
                    || !$statement->bind_result($id, $username, $controlType, $authEnabled, $isAdmin)
                ) {
                    return ['error' => __('Could not read the player list.', 'gq-game-admin')];
                }
                $rows = [];
                while (($fetched = $statement->fetch()) === true) {
                    if (
                        !ctype_digit((string)$id) || (int)$id < 1 || !is_string($username)
                        || !is_string($controlType) || !in_array((string)$authEnabled, ['0', '1'], true)
                        || !in_array((string)$isAdmin, ['0', '1'], true)
                    ) {
                        return ['error' => __('The player list returned invalid data.', 'gq-game-admin')];
                    }
                    $rows[] = [
                        'id' => (int)$id, 'username' => $username, 'control_type' => $controlType,
                        'auth_enabled' => (int)$authEnabled, 'is_admin' => (int)$isAdmin,
                    ];
                }
                if ($fetched === false) {
                    return ['error' => __('Could not read the player list.', 'gq-game-admin')];
                }
                $hasMore = count($rows) > 50;
                if ($hasMore) {
                    array_pop($rows);
                }
                return ['players' => $rows, 'has_more' => $hasMore];
            } finally {
                $statement->close();
            }
        }
    );
}

function gq_game_admin_process_players_request(array $input, string $environment): array
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_die(esc_html__('Player inspection requires POST.', 'gq-game-admin'), '', ['response' => 405]);
    }
    if (!gq_game_admin_read_transport_allowed($environment)) {
        wp_die(esc_html__('HTTPS is required for player inspection.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (
        !in_array($environment, ['staging', 'production'], true)
        || ($input['environment'] ?? null) !== $environment
        || ($input['action'] ?? null) !== 'gq_game_admin_players'
    ) {
        wp_die(esc_html__('Invalid player inspection request.', 'gq-game-admin'), '', ['response' => 400]);
    }
    $nonce = $input['_wpnonce'] ?? null;
    if (!is_string($nonce) || wp_verify_nonce(wp_unslash($nonce), 'gq_game_admin_players_' . $environment) === false) {
        wp_die(esc_html__('Player inspection security check failed.', 'gq-game-admin'), '', ['response' => 403]);
    }
    $before = $input['before'] ?? null;
    if (
        !is_string($before)
        || ($before !== '' && (
            preg_match('/\A[1-9][0-9]{0,9}\z/D', $before) !== 1
            || (strlen($before) === 10 && strcmp($before, '2147483647') > 0)
        ))
    ) {
        return ['error' => __('Invalid player list cursor.', 'gq-game-admin')];
    }
    $search = $input['player_search'] ?? '';
    $actor = $input['actor'] ?? '';
    if (
        !is_string($search) || strlen($search) > 128 || preg_match('//u', $search) !== 1
        || preg_match('/[\x00-\x1f\x7f]/', $search) === 1
        || !in_array($actor, ['', 'human', 'npc_engine'], true)
    ) {
        return ['error' => __('Invalid player search or control-type filter.', 'gq-game-admin')];
    }
    $search = trim(wp_unslash($search));
    $options = [
        'sort' => $input['sort'] ?? 'id', 'order' => $input['order'] ?? 'desc',
        'login' => $input['login'] ?? '', 'admin' => $input['admin'] ?? '',
        'before_value' => $input['before_value'] ?? '',
    ];
    if (isset($input['sort_choice'])) {
        if (!is_string($input['sort_choice']) || substr_count($input['sort_choice'], ':') !== 1) {
            return ['error' => __('Invalid player list sorting.', 'gq-game-admin')];
        }
        [$options['sort'], $options['order']] = explode(':', $input['sort_choice']);
        $before = '';
    }
    if (
        !in_array($options['sort'], ['id', 'username', 'control_type', 'auth_enabled', 'is_admin'], true)
        || !in_array($options['order'], ['asc', 'desc'], true)
        || !in_array($options['login'], ['', '0', '1'], true)
        || !in_array($options['admin'], ['', '0', '1'], true)
        || !is_string($options['before_value']) || strlen($options['before_value']) > 128
        || preg_match('//u', $options['before_value']) !== 1
        || preg_match('/[\x00-\x1f\x7f]/', $options['before_value']) === 1
    ) {
        return ['error' => __('Invalid player list sorting or filters.', 'gq-game-admin')];
    }
    $options['before_value'] = wp_unslash($options['before_value']);
    if ($before !== '' && $options['sort'] !== 'id' && $options['before_value'] === '') {
        return ['error' => __('Invalid player list cursor.', 'gq-game-admin')];
    }
    $target = gq_game_admin_inspection_target($environment);
    if (isset($target['error'])) {
        return $target;
    }
    $result = gq_game_admin_query_players(
        $target['credentials'],
        $target['database'],
        $before,
        $search,
        $actor,
        $options
    );
    if (!isset($result['error'])) {
        $result['database'] = $target['database'];
        $result['observed_at'] = gmdate('Y-m-d H:i:s') . ' UTC';
        $result['player_search'] = $search;
        $result['actor'] = $actor;
        $result['options'] = $options;
    }
    return $result;
}

function gq_game_admin_render_players_form(
    string $environment,
    string $before,
    string $label,
    string $search = '',
    string $actor = '',
    array $options = []
): void {
    $url = admin_url('admin.php?page=gq-game-admin&section=players&environment=' . $environment);
    echo '<form method="post"' . ($before === '' ? ' id="gq-player-controls"' : '')
        . ' action="' . esc_url($url) . '">';
    echo '<input type="hidden" name="action" value="gq_game_admin_players">';
    echo '<input type="hidden" name="environment" value="' . esc_attr($environment) . '">';
    echo '<input type="hidden" name="before" value="' . esc_attr($before) . '">';
    foreach (['sort' => 'id', 'order' => 'desc'] as $key => $default) {
        echo '<input type="hidden" name="' . esc_attr($key) . '" value="'
            . esc_attr($options[$key] ?? $default) . '">';
    }
    if ($before !== '') {
        echo '<input type="hidden" name="player_search" value="' . esc_attr($search) . '">';
        echo '<input type="hidden" name="actor" value="' . esc_attr($actor) . '">';
        foreach (['login', 'admin', 'before_value'] as $key) {
            echo '<input type="hidden" name="' . esc_attr($key) . '" value="'
                . esc_attr($options[$key] ?? '') . '">';
        }
    }
    wp_nonce_field('gq_game_admin_players_' . $environment);
    if ($before !== '') {
        echo '<p><button class="button" type="submit">' . esc_html($label) . '</button></p>';
    }
    echo '</form>';
}

function gq_game_admin_render_players_header(
    string $search,
    string $actor,
    array $options,
    string $environment
): void {
    echo '<thead><tr>';
    foreach (
        [
        'id' => 'ID', 'username' => 'Username', 'control_type' => 'Control type',
        'auth_enabled' => 'Login enabled', 'is_admin' => 'Game admin',
        ] as $key => $label
    ) {
        $active = ($options['sort'] ?? 'id') === $key;
        $direction = $options['order'] ?? 'desc';
        $next = $active && $direction === 'asc' ? 'desc' : 'asc';
        echo '<th scope="col" aria-sort="'
            . ($active ? ($direction === 'asc' ? 'ascending' : 'descending') : 'none') . '">';
        echo '<button type="submit" class="button-link" form="gq-player-controls" name="sort_choice" value="'
            . esc_attr($key . ':' . $next) . '">'
            . esc_html__($label, 'gq-game-admin')
            . ($active ? ($direction === 'asc' ? ' &uarr;' : ' &darr;') : '') . '</button>';
        if ($key === 'username') {
            echo '<br><label class="screen-reader-text" for="gq-player-search">'
                . esc_html__('Username contains', 'gq-game-admin') . '</label>'
                . '<input form="gq-player-controls" id="gq-player-search" name="player_search" type="search"'
                . ' maxlength="128" value="' . esc_attr($search) . '">';
        }
        $filters = match ($key) {
            'control_type' => ['actor', $actor, ['' => 'All actors', 'human' => 'Humans', 'npc_engine' => 'NPCs']],
            'auth_enabled' => ['login', $options['login'] ?? '', ['' => 'All', '1' => 'Yes', '0' => 'No']],
            'is_admin' => ['admin', $options['admin'] ?? '', ['' => 'All', '1' => 'Yes', '0' => 'No']],
            default => null,
        };
        if ($filters !== null) {
            [$name, $value, $choices] = $filters;
            echo '<br><select form="gq-player-controls" name="' . esc_attr($name) . '" aria-label="'
                . esc_attr(__($label, 'gq-game-admin')) . '">';
            foreach ($choices as $choice => $title) {
                echo '<option value="' . esc_attr((string)$choice) . '"'
                    . ($value === (string)$choice ? ' selected' : '') . '>'
                    . esc_html__($title, 'gq-game-admin') . '</option>';
            }
            echo '</select>';
        }
        echo '</th>';
    }
    echo '</tr><tr><th colspan="5"><button class="button" type="submit" form="gq-player-controls">'
        . esc_html__('Apply / load first page', 'gq-game-admin') . '</button> '
        . '<a class="button" href="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=players&environment=' . $environment)) . '">'
        . esc_html__('Reset view', 'gq-game-admin') . '</a> '
        . esc_html__('Sort and filters apply to all matching records.', 'gq-game-admin') . '</th></tr></thead>';
}

function gq_game_admin_render_players(string $environment): void
{
    echo '<h2>' . esc_html__('Players and accounts', 'gq-game-admin') . '</h2><p>' . esc_html__(
        'Read up to 50 non-deleted user records at a time, including NPCs, using the inspection account.'
            . ' Email addresses and credentials are not shown. No game data is changed.',
        'gq-game-admin'
    ) . '</p><p>' . esc_html__(
        'Creating, updating and deleting users still require the separate authenticated GalaxyQuest administration.',
        'gq-game-admin'
    ) . '</p>';
    if (!gq_game_admin_read_transport_allowed($environment)) {
        echo '<p class="notice notice-error">'
            . esc_html__('HTTPS is required for player inspection.', 'gq-game-admin') . '</p>';
        return;
    }
    if (!gq_game_admin_secure_transport()) {
        echo '<p class="notice notice-warning">' . esc_html__(
            'Local staging HTTP override is active. Player data and login cookies are not encrypted;'
                . ' use only an isolated local test installation.',
            'gq-game-admin'
        ) . '</p>';
    }
    $result = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
        ? gq_game_admin_process_players_request($_POST, $environment) : null;
    $search = $result['player_search'] ?? '';
    $actor = $result['actor'] ?? '';
    $options = $result['options'] ?? [];
    gq_game_admin_render_players_form($environment, '', '', $search, $actor, $options);
    echo '<table class="widefat striped" data-gq-player-table>';
    gq_game_admin_render_players_header($search, $actor, $options, $environment);
    echo '<tbody>';
    if (isset($result['error'])) {
        echo '<tr><td colspan="5">' . esc_html($result['error']) . '</td></tr></tbody></table>';
        return;
    }
    if ($result === null) {
        echo '<tr><td colspan="5">' . esc_html__('No player data loaded.', 'gq-game-admin')
            . '</td></tr></tbody></table>';
        return;
    }
    foreach ($result['players'] as $player) {
        echo '<tr>';
        foreach (['id', 'username', 'control_type', 'auth_enabled', 'is_admin'] as $key) {
            $value = in_array($key, ['auth_enabled', 'is_admin'], true)
                ? ($player[$key] === 1 ? __('Yes', 'gq-game-admin') : __('No', 'gq-game-admin'))
                : (string)$player[$key];
            echo '<td>' . esc_html($value) . '</td>';
        }
        echo '</tr>';
    }
    echo '</tbody></table>';
    echo '<p>' . esc_html(sprintf(
        __('Database: %1$s. Observed: %2$s. Results are not stored in WordPress.', 'gq-game-admin'),
        $result['database'],
        $result['observed_at']
    )) . '</p>';
    if ($result['players'] === []) {
        echo '<p>' . esc_html__('No user records on this page.', 'gq-game-admin') . '</p>';
    } elseif ($result['has_more']) {
        $last = end($result['players']);
        $options['before_value'] = (string)$last[$options['sort']];
        gq_game_admin_render_players_form(
            $environment,
            (string)$last['id'],
            __('Load next page', 'gq-game-admin'),
            $search,
            $actor,
            $options
        );
    }
}

function gq_game_admin_render_game_area(string $section): void
{
    $areas = [
        'content' => [
            'Content and assets',
            'Game news is edited through WordPress posts and the separate Game News plugin.'
                . ' Asset administration belongs to GalaxyQuest; it is not integrated here.',
        ],
    ];
    [$title, $description] = $areas[$section];
    echo '<h2>' . esc_html__($title, 'gq-game-admin') . '</h2><p>' . esc_html__($description, 'gq-game-admin')
        . '</p><p>' . esc_html__(
            'This area has no game-management actions in WordPress. A WordPress administrator'
                . ' is not automatically an authenticated GalaxyQuest administrator.',
            'gq-game-admin'
        ) . '</p>';
}

function gq_game_admin_universe_columns(): array
{
    return [
        'id' => 'ID', 'galaxy_index' => 'Galaxy index', 'system_index' => 'System index',
        'name' => 'System name', 'catalog_name' => 'Catalog name', 'planet_count' => 'Catalog planet count',
    ];
}

function gq_game_admin_process_universe_request(array $input, string $environment): array
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_die(esc_html__('Universe inspection requires POST.', 'gq-game-admin'), '', ['response' => 405]);
    }
    if (!gq_game_admin_read_transport_allowed($environment)) {
        wp_die(esc_html__('HTTPS is required for universe inspection.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (
        !in_array($environment, ['staging', 'production'], true)
        || ($input['environment'] ?? null) !== $environment
        || ($input['action'] ?? null) !== 'gq_game_admin_universe'
    ) {
        wp_die(esc_html__('Invalid universe inspection request.', 'gq-game-admin'), '', ['response' => 400]);
    }
    $nonce = $input['_wpnonce'] ?? null;
    if (!is_string($nonce) || wp_verify_nonce(wp_unslash($nonce), 'gq_game_admin_universe_' . $environment) === false) {
        wp_die(esc_html__('Universe inspection security check failed.', 'gq-game-admin'), '', ['response' => 403]);
    }
    $options = [
        'sort' => $input['sort'] ?? 'id', 'order' => $input['order'] ?? 'asc',
        'search' => $input['search'] ?? '', 'galaxy' => $input['galaxy'] ?? '',
        'planets' => $input['planets'] ?? '', 'cursor_id' => $input['cursor_id'] ?? '',
        'cursor_value' => $input['cursor_value'] ?? '',
    ];
    if (isset($input['sort_choice'])) {
        if (!is_string($input['sort_choice']) || substr_count($input['sort_choice'], ':') !== 1) {
            return ['error' => __('Invalid universe sorting.', 'gq-game-admin')];
        }
        [$options['sort'], $options['order']] = explode(':', $input['sort_choice']);
        $options['cursor_id'] = '';
        $options['cursor_value'] = '';
    }
    if (
        !is_string($options['sort']) || !array_key_exists($options['sort'], gq_game_admin_universe_columns())
        || !in_array($options['order'], ['asc', 'desc'], true)
        || !in_array($options['planets'], ['', '0', '1'], true)
        || !is_string($options['galaxy'])
        || ($options['galaxy'] !== '' && (
            preg_match('/\A(?:0|[1-9][0-9]{0,2})\z/D', $options['galaxy']) !== 1 || (int)$options['galaxy'] > 255
        ))
        || !is_string($options['cursor_id'])
        || ($options['cursor_id'] !== '' && (
            preg_match('/\A[1-9][0-9]{0,9}\z/D', $options['cursor_id']) !== 1
            || (strlen($options['cursor_id']) === 10 && strcmp($options['cursor_id'], '2147483647') > 0)
        ))
    ) {
        return ['error' => __('Invalid universe sorting, filters or cursor.', 'gq-game-admin')];
    }
    foreach (['search', 'cursor_value'] as $key) {
        if (
            !is_string($options[$key]) || strlen($options[$key]) > 128 || preg_match('//u', $options[$key]) !== 1
            || preg_match('/[\x00-\x1f\x7f]/', $options[$key]) === 1
        ) {
            return ['error' => __('Invalid universe search or cursor.', 'gq-game-admin')];
        }
        $options[$key] = wp_unslash($options[$key]);
    }
    $options['search'] = trim($options['search']);
    if ($options['cursor_id'] !== '' && $options['sort'] !== 'id') {
        $maximum = match ($options['sort']) {
            'galaxy_index', 'planet_count' => 255,
            'system_index' => 65535,
            default => null,
        };
        if (
            !array_key_exists('cursor_value', $input)
            || ($maximum !== null && (
                preg_match('/\A(?:0|[1-9][0-9]{0,4})\z/D', $options['cursor_value']) !== 1
                || (int)$options['cursor_value'] > $maximum
            ))
        ) {
            return ['error' => __('Invalid universe cursor.', 'gq-game-admin')];
        }
    }
    $target = gq_game_admin_inspection_target($environment);
    if (isset($target['error'])) {
        return $target;
    }
    $result = gq_game_admin_query_universe($target['credentials'], $target['database'], $options);
    if (!isset($result['error'])) {
        $result['options'] = $options;
        $result['database'] = $target['database'];
        $result['observed_at'] = gmdate('Y-m-d H:i:s') . ' UTC';
    }
    return $result;
}

function gq_game_admin_query_universe(array $credentials, string $database, array $options): array
{
    $sort = $options['sort'];
    $order = $options['order'];
    if (
        !is_string($sort) || !array_key_exists($sort, gq_game_admin_universe_columns())
        || !in_array($order, ['asc', 'desc'], true)
    ) {
        return ['error' => __('Invalid universe sorting.', 'gq-game-admin')];
    }
    return gq_game_admin_read_database(
        $credentials,
        $database,
        static function (mysqli $connection) use ($options, $sort, $order): array {
            $conditions = [];
            $parameters = [];
            if ($options['search'] !== '') {
                $conditions[] = '(LOCATE(?, name) > 0 OR LOCATE(?, catalog_name) > 0)';
                $parameters[] = $options['search'];
                $parameters[] = $options['search'];
            }
            if ($options['galaxy'] !== '') {
                $conditions[] = 'galaxy_index = ?';
                $parameters[] = $options['galaxy'];
            }
            if ($options['planets'] !== '') {
                $conditions[] = $options['planets'] === '1' ? 'planet_count > 0' : 'planet_count = 0';
            }
            if ($options['cursor_id'] !== '') {
                $operator = $order === 'asc' ? '>' : '<';
                if ($sort === 'id') {
                    $conditions[] = "id $operator ?";
                } else {
                    $conditions[] = "($sort $operator ? OR ($sort = ? AND id $operator ?))";
                    $parameters[] = $options['cursor_value'];
                    $parameters[] = $options['cursor_value'];
                }
                $parameters[] = $options['cursor_id'];
            }
            $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);
            $statement = $connection->prepare(
                'SELECT id, galaxy_index, system_index, name, catalog_name, planet_count FROM star_systems'
                    . $where . " ORDER BY $sort $order" . ($sort === 'id' ? '' : ", id $order") . ' LIMIT 51'
            );
            if ($statement === false) {
                return ['error' => __('Could not prepare universe inspection.', 'gq-game-admin')];
            }
            try {
                if (
                    ($parameters !== [] && !$statement->bind_param(str_repeat('s', count($parameters)), ...$parameters))
                    || !$statement->execute()
                    || !$statement->bind_result($id, $galaxy, $system, $name, $catalog, $planets)
                ) {
                    return ['error' => __('Could not read the system catalog.', 'gq-game-admin')];
                }
                $rows = [];
                while (($fetched = $statement->fetch()) === true) {
                    if (
                        !is_string($name) || !is_string($catalog)
                        || !ctype_digit((string)$id) || (int)$id < 1
                        || !ctype_digit((string)$galaxy) || !ctype_digit((string)$system)
                        || !ctype_digit((string)$planets)
                    ) {
                        return ['error' => __('The system catalog returned invalid data.', 'gq-game-admin')];
                    }
                    $rows[] = [
                        'id' => (int)$id, 'galaxy_index' => (int)$galaxy, 'system_index' => (int)$system,
                        'name' => $name, 'catalog_name' => $catalog, 'planet_count' => (int)$planets,
                    ];
                }
                if ($fetched === false) {
                    return ['error' => __('Could not read the system catalog.', 'gq-game-admin')];
                }
                $hasMore = count($rows) > 50;
                if ($hasMore) {
                    array_pop($rows);
                }
                return ['systems' => $rows, 'has_more' => $hasMore];
            } finally {
                $statement->close();
            }
        }
    );
}

function gq_game_admin_render_universe_form(string $environment, array $options, array|null $last = null): void
{
    echo '<form method="post"' . ($last === null ? ' id="gq-universe-controls"' : '') . ' action="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=universe&environment=' . $environment)) . '">';
    $fields = [
        'action' => 'gq_game_admin_universe', 'environment' => $environment,
        'sort' => $options['sort'], 'order' => $options['order'],
        'cursor_id' => $last === null ? '' : (string)$last['id'],
        'cursor_value' => $last === null ? '' : (string)$last[$options['sort']],
    ];
    if ($last !== null) {
        foreach (['search', 'galaxy', 'planets'] as $key) {
            $fields[$key] = $options[$key];
        }
    }
    foreach ($fields as $key => $value) {
        echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr($value) . '">';
    }
    wp_nonce_field('gq_game_admin_universe_' . $environment);
    if ($last !== null) {
        echo '<p><button class="button" type="submit">'
            . esc_html__('Load next page', 'gq-game-admin') . '</button></p>';
    }
    echo '</form>';
}

function gq_game_admin_render_universe(string $environment): void
{
    echo '<h2>' . esc_html__('Universe: star systems', 'gq-game-admin') . '</h2><p>' . esc_html__(
        'Read-only catalog inspection, 50 systems per page. Search and sorting apply to all matching systems.'
            . ' Planet counts are stored catalog values, not a live count of planets or colonies.'
            . ' No generation, settlement, fleet resolution or game-state changes are triggered.',
        'gq-game-admin'
    ) . '</p>';
    if (!gq_game_admin_read_transport_allowed($environment)) {
        echo '<p class="notice notice-error">'
            . esc_html__('HTTPS is required for universe inspection.', 'gq-game-admin') . '</p>';
        return;
    }
    if (!gq_game_admin_secure_transport()) {
        echo '<p class="notice notice-warning">' . esc_html__(
            'Local staging HTTP override is active. Use only an isolated local test installation.',
            'gq-game-admin'
        ) . '</p>';
    }
    $result = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
        ? gq_game_admin_process_universe_request($_POST, $environment) : null;
    $options = $result['options'] ?? [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'galaxy' => '', 'planets' => '',
    ];
    gq_game_admin_render_universe_form($environment, $options);
    echo '<table class="widefat striped" data-gq-universe-table><thead><tr>';
    foreach (gq_game_admin_universe_columns() as $key => $label) {
        $active = $options['sort'] === $key;
        $next = $active && $options['order'] === 'asc' ? 'desc' : 'asc';
        echo '<th scope="col" aria-sort="'
            . ($active ? ($options['order'] === 'asc' ? 'ascending' : 'descending') : 'none') . '">';
        echo '<button class="button-link" type="submit" form="gq-universe-controls" name="sort_choice" value="'
            . esc_attr($key . ':' . $next) . '">' . esc_html__($label, 'gq-game-admin')
            . ($active ? ($options['order'] === 'asc' ? ' &uarr;' : ' &darr;') : '') . '</button>';
        if ($key === 'name') {
            echo '<br><label class="screen-reader-text" for="gq-universe-search">'
                . esc_html__('Name or catalog contains', 'gq-game-admin') . '</label>'
                . '<input form="gq-universe-controls" id="gq-universe-search" type="search" name="search"'
                . ' maxlength="128" value="' . esc_attr($options['search']) . '">';
        } elseif ($key === 'galaxy_index') {
            echo '<br><input form="gq-universe-controls" type="number" min="0" max="255" name="galaxy"'
                . ' aria-label="' . esc_attr(__('Galaxy index (empty for all)', 'gq-game-admin'))
                . '" value="' . esc_attr($options['galaxy']) . '">';
        } elseif ($key === 'planet_count') {
            echo '<br><select form="gq-universe-controls" name="planets" aria-label="'
                . esc_attr(__('Catalog planets', 'gq-game-admin')) . '">';
            $planetChoices = ['' => 'All systems', '1' => 'With catalog planets', '0' => 'Without catalog planets'];
            foreach ($planetChoices as $v => $t) {
                echo '<option value="' . esc_attr((string)$v) . '"'
                    . ($options['planets'] === (string)$v ? ' selected' : '') . '>'
                    . esc_html__($t, 'gq-game-admin') . '</option>';
            }
            echo '</select>';
        }
        echo '</th>';
    }
    echo '</tr><tr><th colspan="6"><button class="button" type="submit" form="gq-universe-controls">'
        . esc_html__('Apply / load first page', 'gq-game-admin') . '</button> <a class="button" href="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=universe&environment=' . $environment)) . '">'
        . esc_html__('Reset view', 'gq-game-admin') . '</a></th></tr></thead><tbody>';
    if ($result === null || isset($result['error'])) {
        echo '<tr><td colspan="6">' . esc_html($result['error'] ?? __('No systems loaded.', 'gq-game-admin'))
            . '</td></tr></tbody></table>';
        return;
    }
    foreach ($result['systems'] as $system) {
        echo '<tr>';
        foreach (array_keys(gq_game_admin_universe_columns()) as $key) {
            echo '<td>' . esc_html((string)$system[$key]) . '</td>';
        }
        echo '</tr>';
    }
    echo '</tbody></table><p>' . esc_html(sprintf(
        __('Database: %1$s. Observed: %2$s. Results are not stored in WordPress.', 'gq-game-admin'),
        $result['database'],
        $result['observed_at']
    )) . '</p>';
    if ($result['systems'] === []) {
        echo '<p>' . esc_html__('No matching systems on this page.', 'gq-game-admin') . '</p>';
    } elseif ($result['has_more']) {
        gq_game_admin_render_universe_form($environment, $options, end($result['systems']));
    }
}

function gq_game_admin_planet_columns(): array
{
    return [
        'id' => ['ID', 'id'],
        'galaxy' => ['Galaxy', 'galaxy'],
        'system' => ['System', '`system`'],
        'position' => ['Position', 'position'],
        'type' => ['Type', 'CAST(type AS CHAR)'],
        'planet_class' => ['Class', 'CAST(planet_class AS CHAR)'],
    ];
}

function gq_game_admin_planet_integer(string $value): bool
{
    return preg_match('/\A(?:0|-?[1-9][0-9]{0,9})\z/D', $value) === 1
        && filter_var($value, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => -2147483648, 'max_range' => 2147483647],
        ]) !== false;
}

function gq_game_admin_process_planets_request(array $input, string $environment): array
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_die(esc_html__('Planet inspection requires POST.', 'gq-game-admin'), '', ['response' => 405]);
    }
    if (!gq_game_admin_read_transport_allowed($environment)) {
        wp_die(esc_html__('HTTPS is required for planet inspection.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (
        !in_array($environment, ['staging', 'production'], true)
        || ($input['environment'] ?? null) !== $environment
        || ($input['action'] ?? null) !== 'gq_game_admin_planets'
    ) {
        wp_die(esc_html__('Invalid planet inspection request.', 'gq-game-admin'), '', ['response' => 400]);
    }
    $nonce = $input['_wpnonce'] ?? null;
    if (!is_string($nonce) || wp_verify_nonce(wp_unslash($nonce), 'gq_game_admin_planets_' . $environment) === false) {
        wp_die(esc_html__('Planet inspection security check failed.', 'gq-game-admin'), '', ['response' => 403]);
    }
    $defaults = [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'galaxy' => '', 'system' => '', 'position' => '',
        'cursor_id' => '', 'cursor_value' => '',
    ];
    $options = [];
    foreach ($defaults as $key => $default) {
        $value = $input[$key] ?? $default;
        if (
            !is_string($value) || strlen($value) > 128 || preg_match('//u', $value) !== 1
            || preg_match('/[\x00-\x1f\x7f]/', $value) === 1
        ) {
            return ['error' => __('Invalid planet filters or cursor.', 'gq-game-admin')];
        }
        $options[$key] = wp_unslash($value);
    }
    if (isset($input['sort_choice'])) {
        if (!is_string($input['sort_choice']) || substr_count($input['sort_choice'], ':') !== 1) {
            return ['error' => __('Invalid planet sorting.', 'gq-game-admin')];
        }
        [$options['sort'], $options['order']] = explode(':', $input['sort_choice']);
        $options['cursor_id'] = '';
        $options['cursor_value'] = '';
    }
    if (
        !array_key_exists($options['sort'], gq_game_admin_planet_columns())
        || !in_array($options['order'], ['asc', 'desc'], true)
    ) {
        return ['error' => __('Invalid planet sorting.', 'gq-game-admin')];
    }
    foreach (['galaxy', 'system', 'position'] as $key) {
        if ($options[$key] !== '' && !gq_game_admin_planet_integer($options[$key])) {
            return ['error' => __('Invalid planet coordinates.', 'gq-game-admin')];
        }
    }
    if ($options['cursor_id'] !== '') {
        if (
            !gq_game_admin_planet_integer($options['cursor_id']) || (int)$options['cursor_id'] < 1
            || ($options['sort'] !== 'id' && !array_key_exists('cursor_value', $input))
            || (in_array($options['sort'], ['galaxy', 'system', 'position'], true)
                && !gq_game_admin_planet_integer($options['cursor_value']))
        ) {
            return ['error' => __('Invalid planet cursor.', 'gq-game-admin')];
        }
    }
    $options['search'] = trim($options['search']);
    $target = gq_game_admin_inspection_target($environment);
    if (isset($target['error'])) {
        return $target;
    }
    $result = gq_game_admin_query_planets($target['credentials'], $target['database'], $options);
    if (!isset($result['error'])) {
        $result['options'] = $options;
        $result['database'] = $target['database'];
        $result['observed_at'] = gmdate('Y-m-d H:i:s') . ' UTC';
    }
    return $result;
}

function gq_game_admin_query_planets(array $credentials, string $database, array $options): array
{
    $columns = gq_game_admin_planet_columns();
    $sort = $options['sort'];
    $order = $options['order'];
    if (!is_string($sort) || !isset($columns[$sort]) || !in_array($order, ['asc', 'desc'], true)) {
        return ['error' => __('Invalid planet sorting.', 'gq-game-admin')];
    }
    return gq_game_admin_read_database(
        $credentials,
        $database,
        static function (mysqli $connection) use ($options, $sort, $order, $columns): array {
            $conditions = [];
            $parameters = [];
            if ($options['search'] !== '') {
                $conditions[] = '(LOCATE(?, CAST(type AS CHAR)) > 0 OR LOCATE(?, CAST(planet_class AS CHAR)) > 0)';
                $parameters[] = $options['search'];
                $parameters[] = $options['search'];
            }
            foreach (['galaxy', 'system', 'position'] as $key) {
                if ($options[$key] !== '') {
                    $conditions[] = $columns[$key][1] . ' = ?';
                    $parameters[] = $options[$key];
                }
            }
            $expression = $columns[$sort][1];
            if ($options['cursor_id'] !== '') {
                $operator = $order === 'asc' ? '>' : '<';
                if ($sort === 'id') {
                    $conditions[] = "id $operator ?";
                } else {
                    $conditions[] = "($expression $operator ? OR ($expression = ? AND id $operator ?))";
                    $parameters[] = $options['cursor_value'];
                    $parameters[] = $options['cursor_value'];
                }
                $parameters[] = $options['cursor_id'];
            }
            $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);
            $statement = $connection->prepare(
                'SELECT id, galaxy, `system`, position, CAST(type AS CHAR), CAST(planet_class AS CHAR) FROM planets'
                . $where . " ORDER BY $expression $order" . ($sort === 'id' ? '' : ", id $order") . ' LIMIT 51'
            );
            if ($statement === false) {
                return ['error' => __('Could not prepare planet inspection.', 'gq-game-admin')];
            }
            try {
                if (
                    ($parameters !== [] && !$statement->bind_param(str_repeat('s', count($parameters)), ...$parameters))
                    || !$statement->execute()
                    || !$statement->bind_result($id, $galaxy, $system, $position, $type, $class)
                ) {
                    return ['error' => __('Could not read the planet catalog.', 'gq-game-admin')];
                }
                $rows = [];
                while (($fetched = $statement->fetch()) === true) {
                    if (
                        !gq_game_admin_planet_integer((string)$id) || (int)$id < 1
                        || !gq_game_admin_planet_integer((string)$galaxy)
                        || !gq_game_admin_planet_integer((string)$system)
                        || !gq_game_admin_planet_integer((string)$position)
                        || !is_string($type) || !is_string($class)
                    ) {
                        return ['error' => __('The planet catalog returned invalid data.', 'gq-game-admin')];
                    }
                    $rows[] = [
                        'id' => (int)$id, 'galaxy' => (int)$galaxy, 'system' => (int)$system,
                        'position' => (int)$position, 'type' => $type, 'planet_class' => $class,
                    ];
                }
                if ($fetched === false) {
                    return ['error' => __('Could not read the planet catalog.', 'gq-game-admin')];
                }
                $hasMore = count($rows) > 50;
                if ($hasMore) {
                    array_pop($rows);
                }
                return ['planets' => $rows, 'has_more' => $hasMore];
            } finally {
                $statement->close();
            }
        }
    );
}

function gq_game_admin_render_planets_form(string $environment, array $options, array|null $last = null): void
{
    echo '<form method="post"' . ($last === null ? ' id="gq-planets-controls"' : '') . ' action="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=planets&environment=' . $environment)) . '">';
    $fields = [
        'action' => 'gq_game_admin_planets', 'environment' => $environment,
        'sort' => $options['sort'], 'order' => $options['order'],
        'cursor_id' => $last === null ? '' : (string)$last['id'],
        'cursor_value' => $last === null ? '' : (string)$last[$options['sort']],
    ];
    if ($last !== null) {
        foreach (['search', 'galaxy', 'system', 'position'] as $key) {
            $fields[$key] = $options[$key];
        }
    }
    foreach ($fields as $key => $value) {
        echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr($value) . '">';
    }
    wp_nonce_field('gq_game_admin_planets_' . $environment);
    if ($last !== null) {
        echo '<p><button class="button" type="submit">'
            . esc_html__('Load next page', 'gq-game-admin') . '</button></p>';
    }
    echo '</form>';
}

function gq_game_admin_render_planets(string $environment): void
{
    echo '<h2>' . esc_html__('Universe: persisted planets', 'gq-game-admin') . '</h2><p>' . esc_html__(
        'Read-only persisted planet records, 50 per page. Procedurally displayed bodies without a database record'
            . ' are not included. No generation, settlement or game-state changes are triggered.',
        'gq-game-admin'
    ) . '</p>';
    if (!gq_game_admin_read_transport_allowed($environment)) {
        echo '<p class="notice notice-error">'
            . esc_html__('HTTPS is required for planet inspection.', 'gq-game-admin') . '</p>';
        return;
    }
    if (!gq_game_admin_secure_transport()) {
        echo '<p class="notice notice-warning">' . esc_html__(
            'Local staging HTTP override is active. Use only an isolated local test installation.',
            'gq-game-admin'
        ) . '</p>';
    }
    $result = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
        ? gq_game_admin_process_planets_request($_POST, $environment) : null;
    $options = $result['options'] ?? [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'galaxy' => '', 'system' => '', 'position' => '',
    ];
    gq_game_admin_render_planets_form($environment, $options);
    echo '<table class="widefat striped" data-gq-planets-table><thead><tr>';
    foreach (gq_game_admin_planet_columns() as $key => [$label]) {
        $active = $options['sort'] === $key;
        $next = $active && $options['order'] === 'asc' ? 'desc' : 'asc';
        echo '<th scope="col" aria-sort="'
            . ($active ? ($options['order'] === 'asc' ? 'ascending' : 'descending') : 'none') . '">';
        echo '<button class="button-link" type="submit" form="gq-planets-controls" name="sort_choice" value="'
            . esc_attr($key . ':' . $next) . '">' . esc_html__($label, 'gq-game-admin')
            . ($active ? ($options['order'] === 'asc' ? ' &uarr;' : ' &darr;') : '') . '</button>';
        if (in_array($key, ['galaxy', 'system', 'position'], true)) {
            echo '<br><input form="gq-planets-controls" type="number" min="-2147483648" max="2147483647" name="'
                . esc_attr($key) . '" aria-label="' . esc_attr(sprintf(
                    __('Filter %s (empty for all)', 'gq-game-admin'),
                    __($label, 'gq-game-admin')
                )) . '" value="' . esc_attr($options[$key]) . '">';
        } elseif ($key === 'type') {
            echo '<br><input form="gq-planets-controls" type="search" name="search" maxlength="128" aria-label="'
                . esc_attr(__('Type or class contains', 'gq-game-admin'))
                . '" value="' . esc_attr($options['search']) . '">';
        }
        echo '</th>';
    }
    echo '</tr><tr><th colspan="6"><button class="button" type="submit" form="gq-planets-controls">'
        . esc_html__('Apply / load first page', 'gq-game-admin') . '</button> <a class="button" href="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=planets&environment=' . $environment)) . '">'
        . esc_html__('Reset view', 'gq-game-admin') . '</a></th></tr></thead><tbody>';
    if ($result === null || isset($result['error'])) {
        echo '<tr><td colspan="6">' . esc_html($result['error'] ?? __('No planets loaded.', 'gq-game-admin'))
            . '</td></tr></tbody></table>';
        return;
    }
    foreach ($result['planets'] as $planet) {
        echo '<tr>';
        foreach (array_keys(gq_game_admin_planet_columns()) as $key) {
            echo '<td>' . esc_html((string)$planet[$key]) . '</td>';
        }
        echo '</tr>';
    }
    echo '</tbody></table><p>' . esc_html(sprintf(
        __('Database: %1$s. Observed: %2$s. Results are not stored in WordPress.', 'gq-game-admin'),
        $result['database'],
        $result['observed_at']
    )) . '</p>';
    if ($result['planets'] === []) {
        echo '<p>' . esc_html__('No matching planets on this page.', 'gq-game-admin') . '</p>';
    } elseif ($result['has_more']) {
        gq_game_admin_render_planets_form($environment, $options, end($result['planets']));
    }
}

function gq_game_admin_colony_columns(): array
{
    return [
        'id' => ['ID', 'id'],
        'user_id' => ['Owner ID', 'user_id'],
        'name' => ['Name', 'name'],
        'colony_type' => ['Type', 'CAST(colony_type AS CHAR)'],
        'population' => ['Stored population', 'population'],
        'last_update' => ['Last economy update (database time)', 'last_update'],
    ];
}

function gq_game_admin_colony_types(): array
{
    return ['balanced', 'mining', 'industrial', 'research', 'agricultural', 'military'];
}

function gq_game_admin_colony_population_valid(string $value): bool
{
    return preg_match('/\A(?:0|[1-9][0-9]{0,9})\z/D', $value) === 1
        && (strlen($value) < 10 || strcmp($value, '4294967295') <= 0);
}

function gq_game_admin_process_colonies_request(array $input, string $environment): array
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_die(esc_html__('Colony inspection requires POST.', 'gq-game-admin'), '', ['response' => 405]);
    }
    if (!gq_game_admin_read_transport_allowed($environment)) {
        wp_die(esc_html__('HTTPS is required for colony inspection.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (
        !in_array($environment, ['staging', 'production'], true)
        || ($input['environment'] ?? null) !== $environment
        || ($input['action'] ?? null) !== 'gq_game_admin_colonies'
    ) {
        wp_die(esc_html__('Invalid colony inspection request.', 'gq-game-admin'), '', ['response' => 400]);
    }
    $nonce = $input['_wpnonce'] ?? null;
    if (!is_string($nonce) || wp_verify_nonce(wp_unslash($nonce), 'gq_game_admin_colonies_' . $environment) === false) {
        wp_die(esc_html__('Colony inspection security check failed.', 'gq-game-admin'), '', ['response' => 403]);
    }
    $defaults = [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'owner' => '', 'type_filter' => '',
        'cursor_id' => '', 'cursor_value' => '',
    ];
    $options = [];
    foreach ($defaults as $key => $default) {
        $value = $input[$key] ?? $default;
        if (
            !is_string($value) || strlen($value) > 512 || preg_match('//u', $value) !== 1
            || preg_match('/[\x00-\x1f\x7f]/', $value) === 1
        ) {
            return ['error' => __('Invalid colony filters or cursor.', 'gq-game-admin')];
        }
        $options[$key] = wp_unslash($value);
    }
    if (isset($input['sort_choice'])) {
        if (!is_string($input['sort_choice']) || substr_count($input['sort_choice'], ':') !== 1) {
            return ['error' => __('Invalid colony sorting.', 'gq-game-admin')];
        }
        [$options['sort'], $options['order']] = explode(':', $input['sort_choice']);
        $options['cursor_id'] = '';
        $options['cursor_value'] = '';
    }
    if (
        !array_key_exists($options['sort'], gq_game_admin_colony_columns())
        || !in_array($options['order'], ['asc', 'desc'], true)
        || ($options['type_filter'] !== '' && !in_array($options['type_filter'], gq_game_admin_colony_types(), true))
        || strlen($options['search']) > 128 || strlen($options['cursor_value']) > 256
        || ($options['owner'] !== ''
            && (!gq_game_admin_planet_integer($options['owner']) || (int)$options['owner'] < 1))
    ) {
        return ['error' => __('Invalid colony sorting or filters.', 'gq-game-admin')];
    }
    if ($options['cursor_id'] !== '') {
        $value = $options['cursor_value'];
        if (
            !gq_game_admin_planet_integer($options['cursor_id']) || (int)$options['cursor_id'] < 1
            || ($options['sort'] !== 'id' && !array_key_exists('cursor_value', $input))
            || ($options['sort'] === 'user_id' && (!gq_game_admin_planet_integer($value) || (int)$value < 1))
            || ($options['sort'] === 'population' && !gq_game_admin_colony_population_valid($value))
            || ($options['sort'] === 'last_update'
                && preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\z/D', $value) !== 1)
        ) {
            return ['error' => __('Invalid colony cursor.', 'gq-game-admin')];
        }
    }
    $options['search'] = trim($options['search']);
    $target = gq_game_admin_inspection_target($environment);
    if (isset($target['error'])) {
        return $target;
    }
    $result = gq_game_admin_query_colonies($target['credentials'], $target['database'], $options);
    if (!isset($result['error'])) {
        $result['options'] = $options;
        $result['database'] = $target['database'];
        $result['observed_at'] = gmdate('Y-m-d H:i:s') . ' UTC';
    }
    return $result;
}

function gq_game_admin_query_colonies(array $credentials, string $database, array $options): array
{
    $columns = gq_game_admin_colony_columns();
    $sort = $options['sort'];
    $order = $options['order'];
    if (!is_string($sort) || !isset($columns[$sort]) || !in_array($order, ['asc', 'desc'], true)) {
        return ['error' => __('Invalid colony sorting.', 'gq-game-admin')];
    }
    return gq_game_admin_read_database(
        $credentials,
        $database,
        static function (mysqli $connection) use ($options, $sort, $order, $columns): array {
            $conditions = [];
            $parameters = [];
            if ($options['search'] !== '') {
                $conditions[] = 'LOCATE(?, name) > 0';
                $parameters[] = $options['search'];
            }
            if ($options['owner'] !== '') {
                $conditions[] = 'user_id = ?';
                $parameters[] = $options['owner'];
            }
            if ($options['type_filter'] !== '') {
                $conditions[] = 'CAST(colony_type AS CHAR) = ?';
                $parameters[] = $options['type_filter'];
            }
            $expression = $columns[$sort][1];
            if ($options['cursor_id'] !== '') {
                $operator = $order === 'asc' ? '>' : '<';
                if ($sort === 'id') {
                    $conditions[] = "id $operator ?";
                } else {
                    $conditions[] = "($expression $operator ? OR ($expression = ? AND id $operator ?))";
                    $parameters[] = $options['cursor_value'];
                    $parameters[] = $options['cursor_value'];
                }
                $parameters[] = $options['cursor_id'];
            }
            $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);
            $statement = $connection->prepare(
                'SELECT id, user_id, name, CAST(colony_type AS CHAR), population, last_update FROM colonies'
                . $where . " ORDER BY $expression $order" . ($sort === 'id' ? '' : ", id $order") . ' LIMIT 51'
            );
            if ($statement === false) {
                return ['error' => __('Could not prepare colony inspection.', 'gq-game-admin')];
            }
            try {
                if (
                    ($parameters !== [] && !$statement->bind_param(str_repeat('s', count($parameters)), ...$parameters))
                    || !$statement->execute()
                    || !$statement->bind_result($id, $owner, $name, $type, $population, $lastUpdate)
                ) {
                    return ['error' => __('Could not read the colony catalog.', 'gq-game-admin')];
                }
                $rows = [];
                while (($fetched = $statement->fetch()) === true) {
                    if (
                        !gq_game_admin_planet_integer((string)$id) || (int)$id < 1
                        || !gq_game_admin_planet_integer((string)$owner) || (int)$owner < 1
                        || !is_string($name) || !is_string($type)
                        || !gq_game_admin_colony_population_valid((string)$population)
                        || !is_string($lastUpdate)
                        || preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\z/D', $lastUpdate) !== 1
                    ) {
                        return ['error' => __('The colony catalog returned invalid data.', 'gq-game-admin')];
                    }
                    $rows[] = [
                        'id' => (int)$id, 'user_id' => (int)$owner, 'name' => $name, 'colony_type' => $type,
                        'population' => (string)$population, 'last_update' => $lastUpdate,
                    ];
                }
                if ($fetched === false) {
                    return ['error' => __('Could not read the colony catalog.', 'gq-game-admin')];
                }
                $hasMore = count($rows) > 50;
                if ($hasMore) {
                    array_pop($rows);
                }
                return ['colonies' => $rows, 'has_more' => $hasMore];
            } finally {
                $statement->close();
            }
        }
    );
}

function gq_game_admin_render_colonies_form(string $environment, array $options, array|null $last = null): void
{
    echo '<form method="post"' . ($last === null ? ' id="gq-colonies-controls"' : '') . ' action="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=colonies&environment=' . $environment)) . '">';
    $fields = [
        'action' => 'gq_game_admin_colonies', 'environment' => $environment,
        'sort' => $options['sort'], 'order' => $options['order'],
        'cursor_id' => $last === null ? '' : (string)$last['id'],
        'cursor_value' => $last === null ? '' : (string)$last[$options['sort']],
    ];
    if ($last !== null) {
        foreach (['search', 'owner', 'type_filter'] as $key) {
            $fields[$key] = $options[$key];
        }
    }
    foreach ($fields as $key => $value) {
        echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr($value) . '">';
    }
    wp_nonce_field('gq_game_admin_colonies_' . $environment);
    if ($last !== null) {
        echo '<p><button class="button" type="submit">'
            . esc_html__('Load next page', 'gq-game-admin') . '</button></p>';
    }
    echo '</form>';
}

function gq_game_admin_render_colonies(string $environment): void
{
    echo '<h2>' . esc_html__('Colonies', 'gq-game-admin') . '</h2><p>' . esc_html__(
        'Read-only stored colony records, 50 per page. Population is the stored value at the last economy update,'
            . ' not a live calculation. The timestamp is database time. This view does not settle the economy'
            . ' or change game state.',
        'gq-game-admin'
    ) . '</p>';
    if (!gq_game_admin_read_transport_allowed($environment)) {
        echo '<p class="notice notice-error">'
            . esc_html__('HTTPS is required for colony inspection.', 'gq-game-admin') . '</p>';
        return;
    }
    if (!gq_game_admin_secure_transport()) {
        echo '<p class="notice notice-warning">' . esc_html__(
            'Local staging HTTP override is active. Colony data and login cookies are not encrypted;'
                . ' use only an isolated local test installation.',
            'gq-game-admin'
        ) . '</p>';
    }
    $result = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
        ? gq_game_admin_process_colonies_request($_POST, $environment) : null;
    $options = $result['options'] ?? [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'owner' => '', 'type_filter' => '',
    ];
    gq_game_admin_render_colonies_form($environment, $options);
    echo '<table class="widefat striped" data-gq-colonies-table><thead><tr>';
    foreach (gq_game_admin_colony_columns() as $key => [$label]) {
        $active = $options['sort'] === $key;
        $next = $active && $options['order'] === 'asc' ? 'desc' : 'asc';
        echo '<th scope="col" aria-sort="'
            . ($active ? ($options['order'] === 'asc' ? 'ascending' : 'descending') : 'none') . '">';
        echo '<button class="button-link" type="submit" form="gq-colonies-controls" name="sort_choice" value="'
            . esc_attr($key . ':' . $next) . '">' . esc_html__($label, 'gq-game-admin')
            . ($active ? ($options['order'] === 'asc' ? ' &uarr;' : ' &darr;') : '') . '</button>';
        if ($key === 'user_id') {
            echo '<br><input form="gq-colonies-controls" type="number" min="1" max="2147483647" name="owner"'
                . ' aria-label="' . esc_attr(__('Owner ID (empty for all)', 'gq-game-admin'))
                . '" value="' . esc_attr($options['owner']) . '">';
        } elseif ($key === 'name') {
            echo '<br><input form="gq-colonies-controls" type="search" name="search" maxlength="128" aria-label="'
                . esc_attr(__('Name contains', 'gq-game-admin')) . '" value="' . esc_attr($options['search']) . '">';
        } elseif ($key === 'colony_type') {
            echo '<br><select form="gq-colonies-controls" name="type_filter" aria-label="'
                . esc_attr(__('Colony type', 'gq-game-admin')) . '"><option value="">'
                . esc_html__('All types', 'gq-game-admin') . '</option>';
            foreach (gq_game_admin_colony_types() as $type) {
                echo '<option value="' . esc_attr($type) . '"' . ($type === $options['type_filter'] ? ' selected' : '')
                    . '>' . esc_html__($type, 'gq-game-admin') . '</option>';
            }
            echo '</select>';
        }
        echo '</th>';
    }
    echo '</tr><tr><th colspan="6"><button class="button" type="submit" form="gq-colonies-controls">'
        . esc_html__('Apply / load first page', 'gq-game-admin') . '</button> <a class="button" href="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=colonies&environment=' . $environment)) . '">'
        . esc_html__('Reset view', 'gq-game-admin') . '</a></th></tr></thead><tbody>';
    if ($result === null || isset($result['error'])) {
        echo '<tr><td colspan="6">' . esc_html($result['error'] ?? __('No colonies loaded.', 'gq-game-admin'))
            . '</td></tr></tbody></table>';
        return;
    }
    foreach ($result['colonies'] as $colony) {
        echo '<tr>';
        foreach (array_keys(gq_game_admin_colony_columns()) as $key) {
            echo '<td>' . esc_html((string)$colony[$key]) . '</td>';
        }
        echo '</tr>';
    }
    echo '</tbody></table><p>' . esc_html(sprintf(
        __('Database: %1$s. Observed: %2$s. Results are not stored in WordPress.', 'gq-game-admin'),
        $result['database'],
        $result['observed_at']
    )) . '</p>';
    if ($result['colonies'] === []) {
        echo '<p>' . esc_html__('No matching colonies on this page.', 'gq-game-admin') . '</p>';
    } elseif ($result['has_more']) {
        gq_game_admin_render_colonies_form($environment, $options, end($result['colonies']));
    }
}

function gq_game_admin_fleet_columns(): array
{
    return [
        'id' => ['ID', 'id'],
        'user_id' => ['Owner ID', 'user_id'],
        'mission' => ['Mission', 'CAST(mission AS CHAR)'],
        'returning' => ['Returning flag', '`returning`'],
        'target_galaxy' => ['Target galaxy', 'target_galaxy'],
        'target_system' => ['Target system', 'target_system'],
        'target_position' => ['Target position', 'target_position'],
        'arrival_time' => ['Arrival (database time)', 'arrival_time'],
    ];
}

function gq_game_admin_process_fleets_request(array $input, string $environment): array
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_die(esc_html__('Fleet inspection requires POST.', 'gq-game-admin'), '', ['response' => 405]);
    }
    if (!gq_game_admin_read_transport_allowed($environment)) {
        wp_die(esc_html__('HTTPS is required for fleet inspection.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (
        !in_array($environment, ['staging', 'production'], true)
        || ($input['environment'] ?? null) !== $environment
        || ($input['action'] ?? null) !== 'gq_game_admin_fleets'
    ) {
        wp_die(esc_html__('Invalid fleet inspection request.', 'gq-game-admin'), '', ['response' => 400]);
    }
    $nonce = $input['_wpnonce'] ?? null;
    if (!is_string($nonce) || wp_verify_nonce(wp_unslash($nonce), 'gq_game_admin_fleets_' . $environment) === false) {
        wp_die(esc_html__('Fleet inspection security check failed.', 'gq-game-admin'), '', ['response' => 403]);
    }
    $defaults = [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'owner' => '', 'returning' => '',
        'cursor_id' => '', 'cursor_value' => '',
    ];
    $options = [];
    foreach ($defaults as $key => $default) {
        $value = $input[$key] ?? $default;
        if (
            !is_string($value) || strlen($value) > 256 || preg_match('//u', $value) !== 1
            || preg_match('/[\x00-\x1f\x7f]/', $value) === 1
        ) {
            return ['error' => __('Invalid fleet filters or cursor.', 'gq-game-admin')];
        }
        $options[$key] = wp_unslash($value);
    }
    if (isset($input['sort_choice'])) {
        if (!is_string($input['sort_choice']) || substr_count($input['sort_choice'], ':') !== 1) {
            return ['error' => __('Invalid fleet sorting.', 'gq-game-admin')];
        }
        [$options['sort'], $options['order']] = explode(':', $input['sort_choice']);
        $options['cursor_id'] = '';
        $options['cursor_value'] = '';
    }
    if (
        !array_key_exists($options['sort'], gq_game_admin_fleet_columns())
        || !in_array($options['order'], ['asc', 'desc'], true)
        || !in_array($options['returning'], ['', '0', '1'], true)
        || strlen($options['search']) > 128 || strlen($options['cursor_value']) > 128
        || ($options['owner'] !== ''
            && (!gq_game_admin_planet_integer($options['owner']) || (int)$options['owner'] < 1))
    ) {
        return ['error' => __('Invalid fleet sorting or filters.', 'gq-game-admin')];
    }
    if ($options['cursor_id'] !== '') {
        $value = $options['cursor_value'];
        if (
            !gq_game_admin_planet_integer($options['cursor_id']) || (int)$options['cursor_id'] < 1
            || ($options['sort'] !== 'id' && !array_key_exists('cursor_value', $input))
            || ($options['sort'] === 'user_id' && (!gq_game_admin_planet_integer($value) || (int)$value < 1))
            || (in_array($options['sort'], ['target_galaxy', 'target_system', 'target_position'], true)
                && !gq_game_admin_planet_integer($value))
            || ($options['sort'] === 'returning' && !in_array($value, ['0', '1'], true))
            || ($options['sort'] === 'arrival_time'
                && preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\z/D', $value) !== 1)
        ) {
            return ['error' => __('Invalid fleet cursor.', 'gq-game-admin')];
        }
    }
    $options['search'] = trim($options['search']);
    $target = gq_game_admin_inspection_target($environment);
    if (isset($target['error'])) {
        return $target;
    }
    $result = gq_game_admin_query_fleets($target['credentials'], $target['database'], $options);
    if (!isset($result['error'])) {
        $result['options'] = $options;
        $result['database'] = $target['database'];
        $result['observed_at'] = gmdate('Y-m-d H:i:s') . ' UTC';
    }
    return $result;
}

function gq_game_admin_query_fleets(array $credentials, string $database, array $options): array
{
    $columns = gq_game_admin_fleet_columns();
    $sort = $options['sort'];
    $order = $options['order'];
    if (!is_string($sort) || !isset($columns[$sort]) || !in_array($order, ['asc', 'desc'], true)) {
        return ['error' => __('Invalid fleet sorting.', 'gq-game-admin')];
    }
    return gq_game_admin_read_database(
        $credentials,
        $database,
        static function (mysqli $connection) use ($options, $sort, $order, $columns): array {
            $conditions = [];
            $parameters = [];
            if ($options['search'] !== '') {
                $conditions[] = 'LOCATE(?, CAST(mission AS CHAR)) > 0';
                $parameters[] = $options['search'];
            }
            if ($options['owner'] !== '') {
                $conditions[] = 'user_id = ?';
                $parameters[] = $options['owner'];
            }
            if ($options['returning'] !== '') {
                $conditions[] = '`returning` = ?';
                $parameters[] = $options['returning'];
            }
            $expression = $columns[$sort][1];
            if ($options['cursor_id'] !== '') {
                $operator = $order === 'asc' ? '>' : '<';
                if ($sort === 'id') {
                    $conditions[] = "id $operator ?";
                } else {
                    $conditions[] = "($expression $operator ? OR ($expression = ? AND id $operator ?))";
                    $parameters[] = $options['cursor_value'];
                    $parameters[] = $options['cursor_value'];
                }
                $parameters[] = $options['cursor_id'];
            }
            $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);
            $statement = $connection->prepare(
                'SELECT id, user_id, CAST(mission AS CHAR), `returning`, target_galaxy, target_system,'
                . ' target_position, arrival_time FROM fleets' . $where . " ORDER BY $expression $order"
                . ($sort === 'id' ? '' : ", id $order") . ' LIMIT 51'
            );
            if ($statement === false) {
                return ['error' => __('Could not prepare fleet inspection.', 'gq-game-admin')];
            }
            try {
                if (
                    ($parameters !== [] && !$statement->bind_param(str_repeat('s', count($parameters)), ...$parameters))
                    || !$statement->execute()
                    || !$statement->bind_result(
                        $id,
                        $owner,
                        $mission,
                        $returning,
                        $galaxy,
                        $system,
                        $position,
                        $arrival
                    )
                ) {
                    return ['error' => __('Could not read fleet records.', 'gq-game-admin')];
                }
                $rows = [];
                while (($fetched = $statement->fetch()) === true) {
                    if (
                        !gq_game_admin_planet_integer((string)$id) || (int)$id < 1
                        || !gq_game_admin_planet_integer((string)$owner) || (int)$owner < 1
                        || !is_string($mission) || !in_array((string)$returning, ['0', '1'], true)
                        || !gq_game_admin_planet_integer((string)$galaxy)
                        || !gq_game_admin_planet_integer((string)$system)
                        || !gq_game_admin_planet_integer((string)$position)
                        || !is_string($arrival)
                        || preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\z/D', $arrival) !== 1
                    ) {
                        return ['error' => __('Fleet records contained invalid data.', 'gq-game-admin')];
                    }
                    $rows[] = [
                        'id' => (int)$id, 'user_id' => (int)$owner, 'mission' => $mission,
                        'returning' => (int)$returning, 'target_galaxy' => (int)$galaxy,
                        'target_system' => (int)$system, 'target_position' => (int)$position,
                        'arrival_time' => $arrival,
                    ];
                }
                if ($fetched === false) {
                    return ['error' => __('Could not read fleet records.', 'gq-game-admin')];
                }
                $hasMore = count($rows) > 50;
                if ($hasMore) {
                    array_pop($rows);
                }
                return ['fleets' => $rows, 'has_more' => $hasMore];
            } finally {
                $statement->close();
            }
        }
    );
}

function gq_game_admin_render_fleets_form(string $environment, array $options, array|null $last = null): void
{
    echo '<form method="post"' . ($last === null ? ' id="gq-fleets-controls"' : '') . ' action="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=fleets&environment=' . $environment)) . '">';
    $fields = [
        'action' => 'gq_game_admin_fleets', 'environment' => $environment,
        'sort' => $options['sort'], 'order' => $options['order'],
        'cursor_id' => $last === null ? '' : (string)$last['id'],
        'cursor_value' => $last === null ? '' : (string)$last[$options['sort']],
    ];
    if ($last !== null) {
        foreach (['search', 'owner', 'returning'] as $key) {
            $fields[$key] = $options[$key];
        }
    }
    foreach ($fields as $key => $value) {
        echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr($value) . '">';
    }
    wp_nonce_field('gq_game_admin_fleets_' . $environment);
    if ($last !== null) {
        echo '<p><button class="button" type="submit">'
            . esc_html__('Load next page', 'gq-game-admin') . '</button></p>';
    }
    echo '</form>';
}

function gq_game_admin_render_fleets(string $environment): void
{
    echo '<h2>' . esc_html__('Fleets in motion', 'gq-game-admin') . '</h2><p>' . esc_html__(
        'Read-only stored fleet records, 50 per page. Arrival and returning flag are stored values, not live status;'
            . ' arrival is shown in database time. This view does not resolve arrivals, battles or change game state.',
        'gq-game-admin'
    ) . '</p>';
    if (!gq_game_admin_read_transport_allowed($environment)) {
        echo '<p class="notice notice-error">'
            . esc_html__('HTTPS is required for fleet inspection.', 'gq-game-admin') . '</p>';
        return;
    }
    if (!gq_game_admin_secure_transport()) {
        echo '<p class="notice notice-warning">' . esc_html__(
            'Local staging HTTP override is active. Fleet data and login cookies are not encrypted;'
                . ' use only an isolated local test installation.',
            'gq-game-admin'
        ) . '</p>';
    }
    $result = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
        ? gq_game_admin_process_fleets_request($_POST, $environment) : null;
    $options = $result['options'] ?? [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'owner' => '', 'returning' => '',
    ];
    gq_game_admin_render_fleets_form($environment, $options);
    echo '<table class="widefat striped" data-gq-fleets-table><thead><tr>';
    foreach (gq_game_admin_fleet_columns() as $key => [$label]) {
        $active = $options['sort'] === $key;
        $next = $active && $options['order'] === 'asc' ? 'desc' : 'asc';
        echo '<th scope="col" aria-sort="'
            . ($active ? ($options['order'] === 'asc' ? 'ascending' : 'descending') : 'none') . '">';
        echo '<button class="button-link" type="submit" form="gq-fleets-controls" name="sort_choice" value="'
            . esc_attr($key . ':' . $next) . '">' . esc_html__($label, 'gq-game-admin')
            . ($active ? ($options['order'] === 'asc' ? ' &uarr;' : ' &darr;') : '') . '</button>';
        if ($key === 'user_id') {
            echo '<br><input form="gq-fleets-controls" type="number" min="1" max="2147483647" name="owner"'
                . ' aria-label="' . esc_attr(__('Owner ID (empty for all)', 'gq-game-admin'))
                . '" value="' . esc_attr($options['owner']) . '">';
        } elseif ($key === 'mission') {
            echo '<br><input form="gq-fleets-controls" type="search" name="search" maxlength="128" aria-label="'
                . esc_attr(__('Mission contains', 'gq-game-admin')) . '" value="' . esc_attr($options['search']) . '">';
        } elseif ($key === 'returning') {
            echo '<br><select form="gq-fleets-controls" name="returning" aria-label="'
                . esc_attr(__('Returning flag', 'gq-game-admin')) . '">';
            foreach (['' => 'All fleets', '0' => 'Flag 0', '1' => 'Flag 1'] as $value => $text) {
                echo '<option value="' . esc_attr((string)$value) . '"'
                    . ($options['returning'] === (string)$value ? ' selected' : '') . '>'
                    . esc_html__($text, 'gq-game-admin') . '</option>';
            }
            echo '</select>';
        }
        echo '</th>';
    }
    echo '</tr><tr><th colspan="8"><button class="button" type="submit" form="gq-fleets-controls">'
        . esc_html__('Apply / load first page', 'gq-game-admin') . '</button> <a class="button" href="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=fleets&environment=' . $environment)) . '">'
        . esc_html__('Reset view', 'gq-game-admin') . '</a></th></tr></thead><tbody>';
    if ($result === null || isset($result['error'])) {
        echo '<tr><td colspan="8">' . esc_html($result['error'] ?? __('No fleets loaded.', 'gq-game-admin'))
            . '</td></tr></tbody></table>';
        return;
    }
    foreach ($result['fleets'] as $fleet) {
        echo '<tr>';
        foreach (array_keys(gq_game_admin_fleet_columns()) as $key) {
            echo '<td>' . esc_html((string)$fleet[$key]) . '</td>';
        }
        echo '</tr>';
    }
    echo '</tbody></table><p>' . esc_html(sprintf(
        __('Database: %1$s. Observed: %2$s. Results are not stored in WordPress.', 'gq-game-admin'),
        $result['database'],
        $result['observed_at']
    )) . '</p>';
    if ($result['fleets'] === []) {
        echo '<p>' . esc_html__('No matching fleets on this page.', 'gq-game-admin') . '</p>';
    } elseif ($result['has_more']) {
        gq_game_admin_render_fleets_form($environment, $options, end($result['fleets']));
    }
}

function gq_game_admin_ship_inventory_columns(): array
{
    return [
        'id' => ['ID', 'id'],
        'colony_id' => ['Colony ID', 'colony_id'],
        'type' => ['Ship type', 'type'],
        'count' => ['Stored count', '`count`'],
    ];
}

function gq_game_admin_process_ship_inventory_request(array $input, string $environment): array
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_die(esc_html__('Ship inventory inspection requires POST.', 'gq-game-admin'), '', ['response' => 405]);
    }
    if (!gq_game_admin_read_transport_allowed($environment)) {
        wp_die(
            esc_html__('HTTPS is required for ship inventory inspection.', 'gq-game-admin'),
            '',
            ['response' => 403]
        );
    }
    if (
        !in_array($environment, ['staging', 'production'], true)
        || ($input['environment'] ?? null) !== $environment
        || ($input['action'] ?? null) !== 'gq_game_admin_ship_inventory'
    ) {
        wp_die(esc_html__('Invalid ship inventory inspection request.', 'gq-game-admin'), '', ['response' => 400]);
    }
    $nonce = $input['_wpnonce'] ?? null;
    if (
        !is_string($nonce)
        || wp_verify_nonce(wp_unslash($nonce), 'gq_game_admin_ship_inventory_' . $environment) === false
    ) {
        wp_die(esc_html__('Ship inventory security check failed.', 'gq-game-admin'), '', ['response' => 403]);
    }
    $defaults = [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'colony' => '', 'count_filter' => '',
        'cursor_id' => '', 'cursor_value' => '',
    ];
    $options = [];
    foreach ($defaults as $key => $default) {
        $value = $input[$key] ?? $default;
        if (
            !is_string($value) || strlen($value) > 512 || preg_match('//u', $value) !== 1
            || preg_match('/[\x00-\x1f\x7f]/', $value) === 1
        ) {
            return ['error' => __('Invalid ship inventory filters or cursor.', 'gq-game-admin')];
        }
        $options[$key] = wp_unslash($value);
    }
    if (isset($input['sort_choice'])) {
        if (!is_string($input['sort_choice']) || substr_count($input['sort_choice'], ':') !== 1) {
            return ['error' => __('Invalid ship inventory sorting.', 'gq-game-admin')];
        }
        [$options['sort'], $options['order']] = explode(':', $input['sort_choice']);
        $options['cursor_id'] = '';
        $options['cursor_value'] = '';
    }
    if (
        !array_key_exists($options['sort'], gq_game_admin_ship_inventory_columns())
        || !in_array($options['order'], ['asc', 'desc'], true)
        || !in_array($options['count_filter'], ['', 'positive', 'zero', 'negative'], true)
        || strlen($options['search']) > 128 || strlen($options['cursor_value']) > 256
        || ($options['colony'] !== ''
            && (!gq_game_admin_planet_integer($options['colony']) || (int)$options['colony'] < 1))
    ) {
        return ['error' => __('Invalid ship inventory sorting or filters.', 'gq-game-admin')];
    }
    if ($options['cursor_id'] !== '') {
        $value = $options['cursor_value'];
        if (
            !gq_game_admin_planet_integer($options['cursor_id']) || (int)$options['cursor_id'] < 1
            || ($options['sort'] !== 'id' && !array_key_exists('cursor_value', $input))
            || ($options['sort'] === 'colony_id' && (!gq_game_admin_planet_integer($value) || (int)$value < 1))
            || ($options['sort'] === 'count' && !gq_game_admin_planet_integer($value))
        ) {
            return ['error' => __('Invalid ship inventory cursor.', 'gq-game-admin')];
        }
    }
    $options['search'] = trim($options['search']);
    $target = gq_game_admin_inspection_target($environment);
    if (isset($target['error'])) {
        return $target;
    }
    $result = gq_game_admin_query_ship_inventory($target['credentials'], $target['database'], $options);
    if (!isset($result['error'])) {
        $result['options'] = $options;
        $result['database'] = $target['database'];
        $result['observed_at'] = gmdate('Y-m-d H:i:s') . ' UTC';
    }
    return $result;
}

function gq_game_admin_query_ship_inventory(array $credentials, string $database, array $options): array
{
    $columns = gq_game_admin_ship_inventory_columns();
    $sort = $options['sort'];
    $order = $options['order'];
    if (
        !is_string($sort) || !isset($columns[$sort]) || !in_array($order, ['asc', 'desc'], true)
        || !in_array($options['count_filter'], ['', 'positive', 'zero', 'negative'], true)
    ) {
        return ['error' => __('Invalid ship inventory sorting.', 'gq-game-admin')];
    }
    return gq_game_admin_read_database(
        $credentials,
        $database,
        static function (mysqli $connection) use ($options, $sort, $order, $columns): array {
            $conditions = [];
            $parameters = [];
            if ($options['search'] !== '') {
                $conditions[] = 'LOCATE(?, type) > 0';
                $parameters[] = $options['search'];
            }
            if ($options['colony'] !== '') {
                $conditions[] = 'colony_id = ?';
                $parameters[] = $options['colony'];
            }
            $countCondition = match ($options['count_filter']) {
                'positive' => '`count` > 0',
                'zero' => '`count` = 0',
                'negative' => '`count` < 0',
                default => '',
            };
            if ($countCondition !== '') {
                $conditions[] = $countCondition;
            }
            $expression = $columns[$sort][1];
            if ($options['cursor_id'] !== '') {
                $operator = $order === 'asc' ? '>' : '<';
                if ($sort === 'id') {
                    $conditions[] = "id $operator ?";
                } else {
                    $conditions[] = "($expression $operator ? OR ($expression = ? AND id $operator ?))";
                    $parameters[] = $options['cursor_value'];
                    $parameters[] = $options['cursor_value'];
                }
                $parameters[] = $options['cursor_id'];
            }
            $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);
            $statement = $connection->prepare(
                'SELECT id, colony_id, type, `count` FROM ships' . $where . " ORDER BY $expression $order"
                . ($sort === 'id' ? '' : ", id $order") . ' LIMIT 51'
            );
            if ($statement === false) {
                return ['error' => __('Could not prepare ship inventory inspection.', 'gq-game-admin')];
            }
            try {
                if (
                    ($parameters !== [] && !$statement->bind_param(str_repeat('s', count($parameters)), ...$parameters))
                    || !$statement->execute()
                    || !$statement->bind_result($id, $colony, $type, $count)
                ) {
                    return ['error' => __('Could not read ship inventory.', 'gq-game-admin')];
                }
                $rows = [];
                while (($fetched = $statement->fetch()) === true) {
                    if (
                        !gq_game_admin_planet_integer((string)$id) || (int)$id < 1
                        || !gq_game_admin_planet_integer((string)$colony) || (int)$colony < 1
                        || !is_string($type) || !gq_game_admin_planet_integer((string)$count)
                    ) {
                        return ['error' => __('Ship inventory contained invalid data.', 'gq-game-admin')];
                    }
                    $rows[] = ['id' => (int)$id, 'colony_id' => (int)$colony, 'type' => $type, 'count' => (int)$count];
                }
                if ($fetched === false) {
                    return ['error' => __('Could not read ship inventory.', 'gq-game-admin')];
                }
                $hasMore = count($rows) > 50;
                if ($hasMore) {
                    array_pop($rows);
                }
                return ['ships' => $rows, 'has_more' => $hasMore];
            } finally {
                $statement->close();
            }
        }
    );
}

function gq_game_admin_render_ship_inventory_form(string $environment, array $options, array|null $last = null): void
{
    echo '<form method="post"' . ($last === null ? ' id="gq-ship-inventory-controls"' : '') . ' action="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=ship_inventory&environment=' . $environment)) . '">';
    $fields = [
        'action' => 'gq_game_admin_ship_inventory', 'environment' => $environment,
        'sort' => $options['sort'], 'order' => $options['order'],
        'cursor_id' => $last === null ? '' : (string)$last['id'],
        'cursor_value' => $last === null ? '' : (string)$last[$options['sort']],
    ];
    if ($last !== null) {
        foreach (['search', 'colony', 'count_filter'] as $key) {
            $fields[$key] = $options[$key];
        }
    }
    foreach ($fields as $key => $value) {
        echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr($value) . '">';
    }
    wp_nonce_field('gq_game_admin_ship_inventory_' . $environment);
    if ($last !== null) {
        echo '<p><button class="button" type="submit">'
            . esc_html__('Load next page', 'gq-game-admin') . '</button></p>';
    }
    echo '</form>';
}

function gq_game_admin_render_ship_inventory(string $environment): void
{
    echo '<h2>' . esc_html__('Colony ship inventory', 'gq-game-admin') . '</h2><p>' . esc_html__(
        'Read-only stored ship counts, 50 per page. This view only reads colony ship records;'
            . ' fleets in transit and individual built-vessel records are not included.'
            . ' No construction, fleet processing or game-state changes are triggered.',
        'gq-game-admin'
    ) . '</p>';
    if (!gq_game_admin_read_transport_allowed($environment)) {
        echo '<p class="notice notice-error">'
            . esc_html__('HTTPS is required for ship inventory inspection.', 'gq-game-admin') . '</p>';
        return;
    }
    if (!gq_game_admin_secure_transport()) {
        echo '<p class="notice notice-warning">' . esc_html__(
            'Local staging HTTP override is active. Ship data and login cookies are not encrypted;'
                . ' use only an isolated local test installation.',
            'gq-game-admin'
        ) . '</p>';
    }
    $result = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
        ? gq_game_admin_process_ship_inventory_request($_POST, $environment) : null;
    $options = $result['options'] ?? [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'colony' => '', 'count_filter' => '',
    ];
    gq_game_admin_render_ship_inventory_form($environment, $options);
    echo '<table class="widefat striped" data-gq-ship-inventory-table><thead><tr>';
    foreach (gq_game_admin_ship_inventory_columns() as $key => [$label]) {
        $active = $options['sort'] === $key;
        $next = $active && $options['order'] === 'asc' ? 'desc' : 'asc';
        echo '<th scope="col" aria-sort="'
            . ($active ? ($options['order'] === 'asc' ? 'ascending' : 'descending') : 'none') . '">';
        echo '<button class="button-link" type="submit" form="gq-ship-inventory-controls" name="sort_choice" value="'
            . esc_attr($key . ':' . $next) . '">' . esc_html__($label, 'gq-game-admin')
            . ($active ? ($options['order'] === 'asc' ? ' &uarr;' : ' &darr;') : '') . '</button>';
        if ($key === 'colony_id') {
            echo '<br><input form="gq-ship-inventory-controls" type="number" min="1" max="2147483647" name="colony"'
                . ' aria-label="' . esc_attr(__('Colony ID (empty for all)', 'gq-game-admin'))
                . '" value="' . esc_attr($options['colony']) . '">';
        } elseif ($key === 'type') {
            echo '<br><input form="gq-ship-inventory-controls" type="search" name="search" maxlength="128"'
                . ' aria-label="'
                . esc_attr(__('Ship type contains', 'gq-game-admin'))
                . '" value="' . esc_attr($options['search']) . '">';
        } elseif ($key === 'count') {
            echo '<br><select form="gq-ship-inventory-controls" name="count_filter" aria-label="'
                . esc_attr(__('Stored count', 'gq-game-admin')) . '">';
            $choices = ['' => 'All counts', 'positive' => 'Positive', 'zero' => 'Zero', 'negative' => 'Negative'];
            foreach ($choices as $value => $text) {
                echo '<option value="' . esc_attr($value) . '"'
                    . ($options['count_filter'] === $value ? ' selected' : '') . '>'
                    . esc_html__($text, 'gq-game-admin') . '</option>';
            }
            echo '</select>';
        }
        echo '</th>';
    }
    echo '</tr><tr><th colspan="4"><button class="button" type="submit" form="gq-ship-inventory-controls">'
        . esc_html__('Apply / load first page', 'gq-game-admin') . '</button> <a class="button" href="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=ship_inventory&environment=' . $environment)) . '">'
        . esc_html__('Reset view', 'gq-game-admin') . '</a></th></tr></thead><tbody>';
    if ($result === null || isset($result['error'])) {
        echo '<tr><td colspan="4">' . esc_html($result['error'] ?? __('No ship inventory loaded.', 'gq-game-admin'))
            . '</td></tr></tbody></table>';
        return;
    }
    foreach ($result['ships'] as $ship) {
        echo '<tr>';
        foreach (array_keys(gq_game_admin_ship_inventory_columns()) as $key) {
            echo '<td>' . esc_html((string)$ship[$key]) . '</td>';
        }
        echo '</tr>';
    }
    echo '</tbody></table><p>' . esc_html(sprintf(
        __('Database: %1$s. Observed: %2$s. Results are not stored in WordPress.', 'gq-game-admin'),
        $result['database'],
        $result['observed_at']
    )) . '</p>';
    if ($result['ships'] === []) {
        echo '<p>' . esc_html__('No matching ship inventory on this page.', 'gq-game-admin') . '</p>';
    } elseif ($result['has_more']) {
        gq_game_admin_render_ship_inventory_form($environment, $options, end($result['ships']));
    }
}

function gq_game_admin_vessel_columns(): array
{
    return [
        'id' => ['ID', 'id'],
        'owner_user_id' => ['Owner ID', 'owner_user_id'],
        'colony_id' => ['Colony ID', 'colony_id'],
        'blueprint_id' => ['Blueprint ID', 'blueprint_id'],
        'name' => ['Name', "COALESCE(name, '')"],
        'status' => ['Stored status', 'CAST(status AS CHAR)'],
    ];
}

function gq_game_admin_positive_bigint(string $value): bool
{
    return preg_match('/\A[1-9][0-9]{0,18}\z/D', $value) === 1
        && (strlen($value) < 19 || strcmp($value, '9223372036854775807') <= 0);
}

function gq_game_admin_process_vessels_request(array $input, string $environment): array
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_die(esc_html__('Vessel inspection requires POST.', 'gq-game-admin'), '', ['response' => 405]);
    }
    if (!gq_game_admin_read_transport_allowed($environment)) {
        wp_die(esc_html__('HTTPS is required for vessel inspection.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (
        !in_array($environment, ['staging', 'production'], true)
        || ($input['environment'] ?? null) !== $environment
        || ($input['action'] ?? null) !== 'gq_game_admin_vessels'
    ) {
        wp_die(esc_html__('Invalid vessel inspection request.', 'gq-game-admin'), '', ['response' => 400]);
    }
    $nonce = $input['_wpnonce'] ?? null;
    if (!is_string($nonce) || wp_verify_nonce(wp_unslash($nonce), 'gq_game_admin_vessels_' . $environment) === false) {
        wp_die(esc_html__('Vessel inspection security check failed.', 'gq-game-admin'), '', ['response' => 403]);
    }
    $defaults = [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'owner' => '', 'colony' => '', 'status_filter' => '',
        'cursor_id' => '', 'cursor_value' => '',
    ];
    $options = [];
    foreach ($defaults as $key => $default) {
        $value = $input[$key] ?? $default;
        if (
            !is_string($value) || strlen($value) > 800 || preg_match('//u', $value) !== 1
            || preg_match('/[\x00-\x1f\x7f]/', $value) === 1
        ) {
            return ['error' => __('Invalid vessel filters or cursor.', 'gq-game-admin')];
        }
        $options[$key] = wp_unslash($value);
    }
    if (isset($input['sort_choice'])) {
        if (!is_string($input['sort_choice']) || substr_count($input['sort_choice'], ':') !== 1) {
            return ['error' => __('Invalid vessel sorting.', 'gq-game-admin')];
        }
        [$options['sort'], $options['order']] = explode(':', $input['sort_choice']);
        $options['cursor_id'] = '';
        $options['cursor_value'] = '';
    }
    if (
        !array_key_exists($options['sort'], gq_game_admin_vessel_columns())
        || !in_array($options['order'], ['asc', 'desc'], true)
        || !in_array($options['status_filter'], ['', 'docked', 'assigned', 'destroyed'], true)
        || strlen($options['search']) > 128
    ) {
        return ['error' => __('Invalid vessel sorting or filters.', 'gq-game-admin')];
    }
    foreach (['owner', 'colony'] as $key) {
        if ($options[$key] !== '' && (!gq_game_admin_planet_integer($options[$key]) || (int)$options[$key] < 1)) {
            return ['error' => __('Invalid vessel owner or colony.', 'gq-game-admin')];
        }
    }
    if ($options['cursor_id'] !== '') {
        $value = $options['cursor_value'];
        if (
            !gq_game_admin_positive_bigint($options['cursor_id'])
            || ($options['sort'] !== 'id' && !array_key_exists('cursor_value', $input))
            || (in_array($options['sort'], ['owner_user_id', 'colony_id'], true)
                && (!gq_game_admin_planet_integer($value) || (int)$value < 1))
            || ($options['sort'] === 'blueprint_id' && !gq_game_admin_positive_bigint($value))
            || ($options['sort'] === 'status' && !in_array($value, ['docked', 'assigned', 'destroyed'], true))
        ) {
            return ['error' => __('Invalid vessel cursor.', 'gq-game-admin')];
        }
        if ($options['sort'] === 'name') {
            $decoded = base64_decode($value, true);
            if (
                $decoded === false || base64_encode($decoded) !== $value || strlen($decoded) > 400
                || preg_match('//u', $decoded) !== 1
            ) {
                return ['error' => __('Invalid vessel cursor.', 'gq-game-admin')];
            }
            $options['cursor_value'] = $decoded;
        }
    }
    $options['search'] = trim($options['search']);
    $target = gq_game_admin_inspection_target($environment);
    if (isset($target['error'])) {
        return $target;
    }
    $result = gq_game_admin_query_vessels($target['credentials'], $target['database'], $options);
    if (!isset($result['error'])) {
        $result['options'] = $options;
        $result['database'] = $target['database'];
        $result['observed_at'] = gmdate('Y-m-d H:i:s') . ' UTC';
    }
    return $result;
}

function gq_game_admin_query_vessels(array $credentials, string $database, array $options): array
{
    $columns = gq_game_admin_vessel_columns();
    $sort = $options['sort'];
    $order = $options['order'];
    if (!is_string($sort) || !isset($columns[$sort]) || !in_array($order, ['asc', 'desc'], true)) {
        return ['error' => __('Invalid vessel sorting.', 'gq-game-admin')];
    }
    return gq_game_admin_read_database(
        $credentials,
        $database,
        static function (mysqli $connection) use ($options, $sort, $order, $columns): array {
            $conditions = [];
            $parameters = [];
            if ($options['search'] !== '') {
                $conditions[] = 'LOCATE(?, COALESCE(name, \'\')) > 0';
                $parameters[] = $options['search'];
            }
            foreach (['owner' => 'owner_user_id', 'colony' => 'colony_id'] as $key => $column) {
                if ($options[$key] !== '') {
                    $conditions[] = $column . ' = ?';
                    $parameters[] = $options[$key];
                }
            }
            if ($options['status_filter'] !== '') {
                $conditions[] = 'CAST(status AS CHAR) = ?';
                $parameters[] = $options['status_filter'];
            }
            $expression = $columns[$sort][1];
            if ($options['cursor_id'] !== '') {
                $operator = $order === 'asc' ? '>' : '<';
                if ($sort === 'id') {
                    $conditions[] = "id $operator CAST(? AS SIGNED)";
                } else {
                    $valueExpression = $sort === 'blueprint_id' ? 'CAST(? AS SIGNED)' : '?';
                    $conditions[] = "($expression $operator $valueExpression OR"
                        . " ($expression = $valueExpression AND id $operator CAST(? AS SIGNED)))";
                    $parameters[] = $options['cursor_value'];
                    $parameters[] = $options['cursor_value'];
                }
                $parameters[] = $options['cursor_id'];
            }
            $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);
            $statement = $connection->prepare(
                'SELECT id, owner_user_id, colony_id, blueprint_id, name, CAST(status AS CHAR) FROM built_vessels'
                . $where . " ORDER BY $expression $order" . ($sort === 'id' ? '' : ", id $order") . ' LIMIT 51'
            );
            if ($statement === false) {
                return ['error' => __('Could not prepare vessel inspection.', 'gq-game-admin')];
            }
            try {
                if (
                    ($parameters !== [] && !$statement->bind_param(str_repeat('s', count($parameters)), ...$parameters))
                    || !$statement->execute()
                    || !$statement->bind_result($id, $owner, $colony, $blueprint, $name, $status)
                ) {
                    return ['error' => __('Could not read vessel records.', 'gq-game-admin')];
                }
                $rows = [];
                while (($fetched = $statement->fetch()) === true) {
                    if (
                        !gq_game_admin_positive_bigint((string)$id)
                        || !gq_game_admin_positive_bigint((string)$blueprint)
                        || !gq_game_admin_planet_integer((string)$owner) || (int)$owner < 1
                        || !gq_game_admin_planet_integer((string)$colony) || (int)$colony < 1
                        || ($name !== null && !is_string($name))
                        || !in_array($status, ['docked', 'assigned', 'destroyed'], true)
                    ) {
                        return ['error' => __('Vessel records contained invalid data.', 'gq-game-admin')];
                    }
                    $rows[] = [
                        'id' => (string)$id, 'owner_user_id' => (int)$owner, 'colony_id' => (int)$colony,
                        'blueprint_id' => (string)$blueprint, 'name' => $name, 'status' => $status,
                    ];
                }
                if ($fetched === false) {
                    return ['error' => __('Could not read vessel records.', 'gq-game-admin')];
                }
                $hasMore = count($rows) > 50;
                if ($hasMore) {
                    array_pop($rows);
                }
                return ['vessels' => $rows, 'has_more' => $hasMore];
            } finally {
                $statement->close();
            }
        }
    );
}

function gq_game_admin_render_vessels_form(string $environment, array $options, array|null $last = null): void
{
    echo '<form method="post"' . ($last === null ? ' id="gq-vessels-controls"' : '') . ' action="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=vessels&environment=' . $environment)) . '">';
    $cursorValue = $last === null ? '' : (string)$last[$options['sort']];
    if ($last !== null && $options['sort'] === 'name') {
        $cursorValue = base64_encode($cursorValue);
    }
    $fields = [
        'action' => 'gq_game_admin_vessels', 'environment' => $environment,
        'sort' => $options['sort'], 'order' => $options['order'],
        'cursor_id' => $last === null ? '' : (string)$last['id'], 'cursor_value' => $cursorValue,
    ];
    if ($last !== null) {
        foreach (['search', 'owner', 'colony', 'status_filter'] as $key) {
            $fields[$key] = $options[$key];
        }
    }
    foreach ($fields as $key => $value) {
        echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr($value) . '">';
    }
    wp_nonce_field('gq_game_admin_vessels_' . $environment);
    if ($last !== null) {
        echo '<p><button class="button" type="submit">'
            . esc_html__('Load next page', 'gq-game-admin') . '</button></p>';
    }
    echo '</form>';
}

function gq_game_admin_render_vessels(string $environment): void
{
    echo '<h2>' . esc_html__('Built vessels', 'gq-game-admin') . '</h2><p>' . esc_html__(
        'Read-only individual built-vessel records, including destroyed entries, 50 per page.'
            . ' Status is stored data; fleet assignments and ship-count records are not included.'
            . ' This view does not create, assign or change vessels.',
        'gq-game-admin'
    ) . '</p>';
    if (!gq_game_admin_read_transport_allowed($environment)) {
        echo '<p class="notice notice-error">'
            . esc_html__('HTTPS is required for vessel inspection.', 'gq-game-admin') . '</p>';
        return;
    }
    if (!gq_game_admin_secure_transport()) {
        echo '<p class="notice notice-warning">' . esc_html__(
            'Local staging HTTP override is active. Vessel data and login cookies are not encrypted;'
                . ' use only an isolated local test installation.',
            'gq-game-admin'
        ) . '</p>';
    }
    $result = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
        ? gq_game_admin_process_vessels_request($_POST, $environment) : null;
    $options = $result['options'] ?? [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'owner' => '', 'colony' => '', 'status_filter' => '',
    ];
    gq_game_admin_render_vessels_form($environment, $options);
    echo '<table class="widefat striped" data-gq-vessels-table><thead><tr>';
    foreach (gq_game_admin_vessel_columns() as $key => [$label]) {
        $active = $options['sort'] === $key;
        $next = $active && $options['order'] === 'asc' ? 'desc' : 'asc';
        echo '<th scope="col" aria-sort="'
            . ($active ? ($options['order'] === 'asc' ? 'ascending' : 'descending') : 'none') . '">';
        echo '<button class="button-link" type="submit" form="gq-vessels-controls" name="sort_choice" value="'
            . esc_attr($key . ':' . $next) . '">' . esc_html__($label, 'gq-game-admin')
            . ($active ? ($options['order'] === 'asc' ? ' &uarr;' : ' &darr;') : '') . '</button>';
        if ($key === 'owner_user_id' || $key === 'colony_id') {
            $field = $key === 'owner_user_id' ? 'owner' : 'colony';
            echo '<br><input form="gq-vessels-controls" type="number" min="1" max="2147483647" name="'
                . esc_attr($field) . '" aria-label="' . esc_attr(sprintf(
                    __('%s (empty for all)', 'gq-game-admin'),
                    __($label, 'gq-game-admin')
                )) . '" value="' . esc_attr($options[$field]) . '">';
        } elseif ($key === 'name') {
            echo '<br><input form="gq-vessels-controls" type="search" name="search" maxlength="128" aria-label="'
                . esc_attr(__('Name contains', 'gq-game-admin')) . '" value="' . esc_attr($options['search']) . '">';
        } elseif ($key === 'status') {
            echo '<br><select form="gq-vessels-controls" name="status_filter" aria-label="'
                . esc_attr(__('Stored status', 'gq-game-admin')) . '">';
            $choices = [
                '' => 'All statuses', 'docked' => 'docked', 'assigned' => 'assigned', 'destroyed' => 'destroyed',
            ];
            foreach ($choices as $value => $text) {
                echo '<option value="' . esc_attr($value) . '"'
                    . ($options['status_filter'] === $value ? ' selected' : '') . '>'
                    . esc_html__($text, 'gq-game-admin') . '</option>';
            }
            echo '</select>';
        }
        echo '</th>';
    }
    echo '</tr><tr><th colspan="6"><button class="button" type="submit" form="gq-vessels-controls">'
        . esc_html__('Apply / load first page', 'gq-game-admin') . '</button> <a class="button" href="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=vessels&environment=' . $environment)) . '">'
        . esc_html__('Reset view', 'gq-game-admin') . '</a></th></tr></thead><tbody>';
    if ($result === null || isset($result['error'])) {
        echo '<tr><td colspan="6">' . esc_html($result['error'] ?? __('No vessels loaded.', 'gq-game-admin'))
            . '</td></tr></tbody></table>';
        return;
    }
    foreach ($result['vessels'] as $vessel) {
        echo '<tr>';
        foreach (array_keys(gq_game_admin_vessel_columns()) as $key) {
            echo '<td>' . esc_html($vessel[$key] === null ? '-' : (string)$vessel[$key]) . '</td>';
        }
        echo '</tr>';
    }
    echo '</tbody></table><p>' . esc_html(sprintf(
        __('Database: %1$s. Observed: %2$s. Results are not stored in WordPress.', 'gq-game-admin'),
        $result['database'],
        $result['observed_at']
    )) . '</p>';
    if ($result['vessels'] === []) {
        echo '<p>' . esc_html__('No matching vessels on this page.', 'gq-game-admin') . '</p>';
    } elseif ($result['has_more']) {
        gq_game_admin_render_vessels_form($environment, $options, end($result['vessels']));
    }
}

function gq_game_admin_blueprint_columns(): array
{
    return [
        'id' => ['ID', 'id', 'bigint'],
        'user_id' => ['Owner ID', 'COALESCE(user_id, -2147483649)', 'owner'],
        'code' => ['Code', 'code', 'text'],
        'name' => ['Name', 'name', 'text'],
        'hull_id' => ['Hull ID', 'hull_id', 'bigint'],
        'doctrine_tag' => ['Doctrine tag', 'doctrine_tag', 'text'],
        'source_type' => ['Source type', 'source_type', 'text'],
        'is_public' => ['Public flag', '(is_public <> 0)', 'flag'],
        'version' => ['Version', 'version', 'version'],
        'updated_at' => ['Updated at', 'updated_at', 'datetime'],
    ];
}

function gq_game_admin_blueprint_datetime(string $value): bool
{
    return preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\z/D', $value) === 1;
}

function gq_game_admin_blueprint_cursor_value(string $sort, string $value): string|null
{
    $type = gq_game_admin_blueprint_columns()[$sort][2];
    if ($type === 'text') {
        $decoded = base64_decode($value, true);
        return $decoded === false || base64_encode($decoded) !== $value || strlen($decoded) > 512
            || preg_match('//u', $decoded) !== 1 ? null : $decoded;
    }
    if ($type === 'owner') {
        if ($value === 'none') {
            return '-2147483649';
        }
        return gq_game_admin_planet_integer($value) && (int)$value >= 1 ? $value : null;
    }
    $valid = match ($type) {
        'bigint' => gq_game_admin_positive_bigint($value),
        'flag' => $value === '0' || $value === '1',
        'version' => preg_match('/\A(?:0|[1-9][0-9]{0,9})\z/D', $value) === 1 && (int)$value <= 4294967295,
        default => gq_game_admin_blueprint_datetime($value),
    };
    return $valid ? $value : null;
}

function gq_game_admin_process_blueprints_request(array $input, string $environment): array
{
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_die(esc_html__('Blueprint inspection requires POST.', 'gq-game-admin'), '', ['response' => 405]);
    }
    if (!gq_game_admin_read_transport_allowed($environment)) {
        wp_die(esc_html__('HTTPS is required for blueprint inspection.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (
        !in_array($environment, ['staging', 'production'], true)
        || ($input['environment'] ?? null) !== $environment
        || ($input['action'] ?? null) !== 'gq_game_admin_blueprints'
    ) {
        wp_die(esc_html__('Invalid blueprint inspection request.', 'gq-game-admin'), '', ['response' => 400]);
    }
    $nonce = $input['_wpnonce'] ?? null;
    if (
        !is_string($nonce)
        || wp_verify_nonce(wp_unslash($nonce), 'gq_game_admin_blueprints_' . $environment) === false
    ) {
        wp_die(esc_html__('Blueprint inspection security check failed.', 'gq-game-admin'), '', ['response' => 403]);
    }
    $defaults = [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'owner' => '', 'hull' => '', 'doctrine' => '',
        'source' => '', 'public' => '', 'cursor_id' => '', 'cursor_value' => '',
    ];
    $options = [];
    foreach ($defaults as $key => $default) {
        $value = $input[$key] ?? $default;
        if (
            !is_string($value) || strlen($value) > 800 || preg_match('//u', $value) !== 1
            || preg_match('/[\x00-\x1f\x7f]/', $value) === 1
        ) {
            return ['error' => __('Invalid blueprint filters or cursor.', 'gq-game-admin')];
        }
        $options[$key] = wp_unslash($value);
    }
    if (isset($input['sort_choice'])) {
        if (!is_string($input['sort_choice']) || substr_count($input['sort_choice'], ':') !== 1) {
            return ['error' => __('Invalid blueprint sorting.', 'gq-game-admin')];
        }
        [$options['sort'], $options['order']] = explode(':', $input['sort_choice']);
        $options['cursor_id'] = '';
        $options['cursor_value'] = '';
    }
    if (
        !array_key_exists($options['sort'], gq_game_admin_blueprint_columns())
        || !in_array($options['order'], ['asc', 'desc'], true)
        || !in_array($options['public'], ['', 'public', 'not_public'], true)
        || preg_match('/\A.{0,128}\z/su', $options['search']) !== 1
        || preg_match('/\A.{0,64}\z/su', $options['doctrine']) !== 1
        || preg_match('/\A.{0,32}\z/su', $options['source']) !== 1
        || ($options['hull'] !== '' && !gq_game_admin_positive_bigint($options['hull']))
        || (!in_array($options['owner'], ['', 'none'], true)
            && (!gq_game_admin_planet_integer($options['owner']) || (int)$options['owner'] < 1))
    ) {
        return ['error' => __('Invalid blueprint sorting or filters.', 'gq-game-admin')];
    }
    if ($options['cursor_id'] !== '') {
        if (
            !gq_game_admin_positive_bigint($options['cursor_id'])
            || ($options['sort'] !== 'id' && !array_key_exists('cursor_value', $input))
        ) {
            return ['error' => __('Invalid blueprint cursor.', 'gq-game-admin')];
        }
        if ($options['sort'] !== 'id') {
            $value = gq_game_admin_blueprint_cursor_value($options['sort'], $options['cursor_value']);
            if ($value === null) {
                return ['error' => __('Invalid blueprint cursor.', 'gq-game-admin')];
            }
            $options['cursor_value'] = $value;
        }
    }
    $options['search'] = trim($options['search']);
    $target = gq_game_admin_inspection_target($environment);
    if (isset($target['error'])) {
        return $target;
    }
    $result = gq_game_admin_query_blueprints($target['credentials'], $target['database'], $options);
    if (!isset($result['error'])) {
        $result['options'] = $options;
        $result['database'] = $target['database'];
        $result['observed_at'] = gmdate('Y-m-d H:i:s') . ' UTC';
    }
    return $result;
}

function gq_game_admin_query_blueprints(array $credentials, string $database, array $options): array
{
    $columns = gq_game_admin_blueprint_columns();
    $sort = $options['sort'];
    $order = $options['order'];
    if (!is_string($sort) || !isset($columns[$sort]) || !in_array($order, ['asc', 'desc'], true)) {
        return ['error' => __('Invalid blueprint sorting.', 'gq-game-admin')];
    }
    return gq_game_admin_read_database(
        $credentials,
        $database,
        static function (mysqli $connection) use ($options, $sort, $order, $columns): array {
            $conditions = [];
            $parameters = [];
            if ($options['search'] !== '') {
                $conditions[] = '(LOCATE(?, code) > 0 OR LOCATE(?, name) > 0)';
                array_push($parameters, $options['search'], $options['search']);
            }
            if ($options['owner'] === 'none') {
                $conditions[] = 'user_id IS NULL';
            } elseif ($options['owner'] !== '') {
                $conditions[] = 'user_id = CAST(? AS SIGNED)';
                $parameters[] = $options['owner'];
            }
            if ($options['hull'] !== '') {
                $conditions[] = 'hull_id = CAST(? AS SIGNED)';
                $parameters[] = $options['hull'];
            }
            foreach (['doctrine' => 'doctrine_tag', 'source' => 'source_type'] as $key => $column) {
                if ($options[$key] !== '') {
                    $conditions[] = "CAST($column AS BINARY) = CAST(? AS BINARY)";
                    $parameters[] = $options[$key];
                }
            }
            if ($options['public'] !== '') {
                $conditions[] = $options['public'] === 'public' ? 'is_public <> 0' : 'is_public = 0';
            }
            $expression = $columns[$sort][1];
            if ($options['cursor_id'] !== '') {
                $operator = $order === 'asc' ? '>' : '<';
                if ($sort === 'id') {
                    $conditions[] = "id $operator CAST(? AS SIGNED)";
                } else {
                    $valueExpression = match ($columns[$sort][2]) {
                        'owner', 'bigint', 'flag' => 'CAST(? AS SIGNED)',
                        'version' => 'CAST(? AS UNSIGNED)',
                        'datetime' => 'CAST(? AS DATETIME)',
                        default => '?',
                    };
                    $conditions[] = "($expression $operator $valueExpression OR"
                        . " ($expression = $valueExpression AND id $operator CAST(? AS SIGNED)))";
                    $parameters[] = $options['cursor_value'];
                    $parameters[] = $options['cursor_value'];
                }
                $parameters[] = $options['cursor_id'];
            }
            $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);
            $statement = $connection->prepare(
                'SELECT id, user_id, code, name, hull_id, doctrine_tag, source_type, is_public, version,'
                . " DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') FROM vessel_blueprints"
                . $where . " ORDER BY $expression $order" . ($sort === 'id' ? '' : ", id $order") . ' LIMIT 51'
            );
            if ($statement === false) {
                return ['error' => __('Could not prepare blueprint inspection.', 'gq-game-admin')];
            }
            try {
                if (
                    ($parameters !== [] && !$statement->bind_param(str_repeat('s', count($parameters)), ...$parameters))
                    || !$statement->execute()
                    || !$statement->bind_result(
                        $id,
                        $owner,
                        $code,
                        $name,
                        $hull,
                        $doctrine,
                        $source,
                        $public,
                        $version,
                        $updated
                    )
                ) {
                    return ['error' => __('Could not read blueprint records.', 'gq-game-admin')];
                }
                $rows = [];
                while (($fetched = $statement->fetch()) === true) {
                    if (
                        !gq_game_admin_positive_bigint((string)$id)
                        || !gq_game_admin_positive_bigint((string)$hull)
                        || ($owner !== null
                            && (!gq_game_admin_planet_integer((string)$owner) || (int)$owner < 1))
                        || !is_string($code) || !is_string($name) || !is_string($doctrine) || !is_string($source)
                        || !gq_game_admin_planet_integer((string)$public)
                        || preg_match('/\A(?:0|[1-9][0-9]{0,9})\z/D', (string)$version) !== 1
                        || !is_string($updated) || !gq_game_admin_blueprint_datetime($updated)
                    ) {
                        return ['error' => __('Blueprint records contained invalid data.', 'gq-game-admin')];
                    }
                    $rows[] = [
                        'id' => (string)$id, 'user_id' => $owner === null ? null : (int)$owner,
                        'code' => $code, 'name' => $name, 'hull_id' => (string)$hull,
                        'doctrine_tag' => $doctrine, 'source_type' => $source,
                        'is_public' => (int)$public !== 0, 'version' => (int)$version, 'updated_at' => $updated,
                    ];
                }
                if ($fetched === false) {
                    return ['error' => __('Could not read blueprint records.', 'gq-game-admin')];
                }
                $hasMore = count($rows) > 50;
                if ($hasMore) {
                    array_pop($rows);
                }
                return ['blueprints' => $rows, 'has_more' => $hasMore];
            } finally {
                $statement->close();
            }
        }
    );
}

function gq_game_admin_blueprint_cursor_field(array $row, string $sort): string
{
    $value = $row[$sort];
    return match (gq_game_admin_blueprint_columns()[$sort][2]) {
        'text' => base64_encode((string)$value),
        'owner' => $value === null ? 'none' : (string)$value,
        'flag' => $value ? '1' : '0',
        default => (string)$value,
    };
}

function gq_game_admin_render_blueprints_form(string $environment, array $options, array|null $last = null): void
{
    echo '<form method="post"' . ($last === null ? ' id="gq-blueprints-controls"' : '') . ' action="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=blueprints&environment=' . $environment)) . '">';
    $fields = [
        'action' => 'gq_game_admin_blueprints', 'environment' => $environment,
        'sort' => $options['sort'], 'order' => $options['order'],
        'cursor_id' => $last === null ? '' : (string)$last['id'],
        'cursor_value' => $last === null ? '' : gq_game_admin_blueprint_cursor_field($last, $options['sort']),
    ];
    if ($last !== null) {
        foreach (['search', 'owner', 'hull', 'doctrine', 'source', 'public'] as $key) {
            $fields[$key] = $options[$key];
        }
    }
    foreach ($fields as $key => $value) {
        echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr($value) . '">';
    }
    wp_nonce_field('gq_game_admin_blueprints_' . $environment);
    if ($last !== null) {
        echo '<p><button class="button" type="submit">'
            . esc_html__('Load next page', 'gq-game-admin') . '</button></p>';
    }
    echo '</form>';
}

function gq_game_admin_render_blueprint_filter(string $key, array $options): void
{
    $text = [
        'user_id' => ['owner', 'text', 'Owner ID or "none" (empty for all)', 10],
        'name' => ['search', 'search', 'Code or name contains', 128],
        'hull_id' => ['hull', 'text', 'Exact hull ID (empty for all)', 19],
        'doctrine_tag' => ['doctrine', 'text', 'Exact doctrine tag (empty for all)', 64],
        'source_type' => ['source', 'text', 'Exact source type (empty for all)', 32],
    ];
    if (isset($text[$key])) {
        [$field, $type, $label, $length] = $text[$key];
        echo '<br><input form="gq-blueprints-controls" type="' . $type . '" name="' . esc_attr($field)
            . '" maxlength="' . $length . '" aria-label="' . esc_attr(__($label, 'gq-game-admin'))
            . '" value="' . esc_attr($options[$field]) . '">';
    } elseif ($key === 'is_public') {
        echo '<br><select form="gq-blueprints-controls" name="public" aria-label="'
            . esc_attr(__('Public flag', 'gq-game-admin')) . '">';
        $choices = ['' => 'All blueprints', 'public' => 'Public', 'not_public' => 'Not public'];
        foreach ($choices as $value => $label) {
            echo '<option value="' . esc_attr($value) . '"' . ($options['public'] === $value ? ' selected' : '')
                . '>' . esc_html__($label, 'gq-game-admin') . '</option>';
        }
        echo '</select>';
    }
}

function gq_game_admin_render_blueprints(string $environment): void
{
    echo '<h2>' . esc_html__('Vessel blueprints', 'gq-game-admin') . '</h2><p>' . esc_html__(
        'Read-only stored vessel blueprints, 50 per page. Blueprints without an owner are shared.'
            . ' The public flag is shown as stored; compiled stats, costs and modules are not included.'
            . ' This view does not create, compile or change blueprints.',
        'gq-game-admin'
    ) . '</p>';
    if (!gq_game_admin_read_transport_allowed($environment)) {
        echo '<p class="notice notice-error">'
            . esc_html__('HTTPS is required for blueprint inspection.', 'gq-game-admin') . '</p>';
        return;
    }
    if (!gq_game_admin_secure_transport()) {
        echo '<p class="notice notice-warning">' . esc_html__(
            'Local staging HTTP override is active. Blueprint data and login cookies are not encrypted;'
                . ' use only an isolated local test installation.',
            'gq-game-admin'
        ) . '</p>';
    }
    $result = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
        ? gq_game_admin_process_blueprints_request($_POST, $environment) : null;
    $options = $result['options'] ?? [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'owner' => '', 'hull' => '', 'doctrine' => '',
        'source' => '', 'public' => '',
    ];
    $columns = gq_game_admin_blueprint_columns();
    gq_game_admin_render_blueprints_form($environment, $options);
    echo '<table class="widefat striped" data-gq-blueprints-table><thead><tr>';
    foreach ($columns as $key => [$label]) {
        $active = $options['sort'] === $key;
        $next = $active && $options['order'] === 'asc' ? 'desc' : 'asc';
        echo '<th scope="col" aria-sort="'
            . ($active ? ($options['order'] === 'asc' ? 'ascending' : 'descending') : 'none') . '">';
        echo '<button class="button-link" type="submit" form="gq-blueprints-controls" name="sort_choice" value="'
            . esc_attr($key . ':' . $next) . '">' . esc_html__($label, 'gq-game-admin')
            . ($active ? ($options['order'] === 'asc' ? ' &uarr;' : ' &darr;') : '') . '</button>';
        gq_game_admin_render_blueprint_filter($key, $options);
        echo '</th>';
    }
    $span = count($columns);
    echo '</tr><tr><th colspan="' . $span . '"><button class="button" type="submit" form="gq-blueprints-controls">'
        . esc_html__('Apply / load first page', 'gq-game-admin') . '</button> <a class="button" href="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=blueprints&environment=' . $environment)) . '">'
        . esc_html__('Reset view', 'gq-game-admin') . '</a></th></tr></thead><tbody>';
    if ($result === null || isset($result['error'])) {
        echo '<tr><td colspan="' . $span . '">'
            . esc_html($result['error'] ?? __('No blueprints loaded.', 'gq-game-admin')) . '</td></tr></tbody></table>';
        return;
    }
    foreach ($result['blueprints'] as $blueprint) {
        echo '<tr>';
        foreach (array_keys($columns) as $key) {
            $value = $blueprint[$key];
            if ($key === 'user_id' && $value === null) {
                $value = __('None (shared)', 'gq-game-admin');
            } elseif ($key === 'is_public') {
                $value = $value ? __('Public', 'gq-game-admin') : __('Not public', 'gq-game-admin');
            }
            echo '<td>' . esc_html((string)$value) . '</td>';
        }
        echo '</tr>';
    }
    echo '</tbody></table><p>' . esc_html(sprintf(
        __('Database: %1$s. Observed: %2$s. Results are not stored in WordPress.', 'gq-game-admin'),
        $result['database'],
        $result['observed_at']
    )) . '</p>';
    if ($result['blueprints'] === []) {
        echo '<p>' . esc_html__('No matching blueprints on this page.', 'gq-game-admin') . '</p>';
    } elseif ($result['has_more']) {
        gq_game_admin_render_blueprints_form($environment, $options, end($result['blueprints']));
    }
}
function gq_game_admin_upgrade_catalog(string $kind): array
{
    return match ($kind) {
        'research' => [
            'parent' => 'user_id', 'end' => 'research_end', 'parent_label' => 'Owner ID',
            'search_label' => 'Technology', 'title' => 'Research',
            'description' => 'Read-only stored research records, 50 per page. Recorded end times are database time;'
                . ' an end time may have passed without completion. Levels are stored values.'
                . ' This view does not finish research or change game state.',
            'transport_error' => 'HTTPS is required for research inspection.',
            'post_error' => 'Research inspection requires POST.',
            'request_error' => 'Invalid research inspection request.',
            'nonce_error' => 'Research inspection security check failed.',
            'filter_error' => 'Invalid research filters or cursor.',
            'sorting_error' => 'Invalid research sorting.',
            'options_error' => 'Invalid research sorting or filters.',
            'cursor_error' => 'Invalid research cursor.',
            'prepare_error' => 'Could not prepare research inspection.',
            'read_error' => 'Could not read research records.',
            'data_error' => 'Research records contained invalid data.',
            'empty' => 'No research loaded.', 'no_matching' => 'No matching research on this page.',
            'warning' => 'Local staging HTTP override is active. Research data and login cookies are not encrypted;'
                . ' use only an isolated local test installation.',
        ],
        'buildings' => [
            'parent' => 'colony_id', 'end' => 'upgrade_end', 'parent_label' => 'Colony ID',
            'search_label' => 'Building type', 'title' => 'Buildings',
            'description' => 'Read-only stored buildings, 50 per page. End times are database time and may have'
                . ' passed without completion. Queued upgrades are not included. Levels are stored values.'
                . ' This view does not finish or start upgrades, settle the economy or change game state.',
            'transport_error' => 'HTTPS is required for building inspection.',
            'post_error' => 'Building inspection requires POST.',
            'request_error' => 'Invalid building inspection request.',
            'nonce_error' => 'Building inspection security check failed.',
            'filter_error' => 'Invalid building filters or cursor.',
            'sorting_error' => 'Invalid building sorting.',
            'options_error' => 'Invalid building sorting or filters.',
            'cursor_error' => 'Invalid building cursor.',
            'prepare_error' => 'Could not prepare building inspection.',
            'read_error' => 'Could not read building records.',
            'data_error' => 'Building records contained invalid data.',
            'empty' => 'No buildings loaded.', 'no_matching' => 'No matching buildings on this page.',
            'warning' => 'Local staging HTTP override is active. Building data and login cookies are not encrypted;'
                . ' use only an isolated local test installation.',
        ],
        'building_queue' => [
            'table' => 'building_upgrade_queue', 'parent' => 'colony_id', 'end' => 'eta',
            'queue' => true, 'level_label' => 'Target level',
            'type_column' => 'building_type', 'level_column' => 'target_level', 'parent_label' => 'Colony ID',
            'search_label' => 'Building type', 'title' => 'Building upgrade queue',
            'description' => 'Read-only stored queue entries, including completed and cancelled entries,'
                . ' 50 per page. Status and ETA are stored values, not live completion; ETA is database time.'
                . ' This view does not start or finish upgrades, settle the economy or change game state.',
            'transport_error' => 'HTTPS is required for building queue inspection.',
            'post_error' => 'Building queue inspection requires POST.',
            'request_error' => 'Invalid building queue inspection request.',
            'nonce_error' => 'Building queue inspection security check failed.',
            'filter_error' => 'Invalid building queue filters or cursor.',
            'sorting_error' => 'Invalid building queue sorting.',
            'options_error' => 'Invalid building queue sorting or filters.',
            'cursor_error' => 'Invalid building queue cursor.',
            'prepare_error' => 'Could not prepare building queue inspection.',
            'read_error' => 'Could not read building queue records.',
            'data_error' => 'Building queue records contained invalid data.',
            'empty' => 'No building queue entries loaded.',
            'no_matching' => 'No matching building queue entries on this page.',
            'warning' => 'Local staging HTTP override is active. Queue data and login cookies are not encrypted;'
                . ' use only an isolated local test installation.',
        ],
        'ship_queue' => [
            'table' => 'ship_build_queue', 'parent' => 'colony_id', 'end' => 'eta',
            'queue' => true, 'level_label' => 'Quantity',
            'type_column' => 'ship_type', 'level_column' => 'quantity', 'parent_label' => 'Colony ID',
            'search_label' => 'Ship type', 'title' => 'Ship build queue',
            'description' => 'Read-only stored ship build queue entries, including completed and cancelled entries,'
                . ' 50 per page. Status and ETA are stored values, not live completion; ETA is database time.'
                . ' This view does not start or finish construction, settle the economy or change game state.',
            'transport_error' => 'HTTPS is required for ship queue inspection.',
            'post_error' => 'Ship queue inspection requires POST.',
            'request_error' => 'Invalid ship queue inspection request.',
            'nonce_error' => 'Ship queue inspection security check failed.',
            'filter_error' => 'Invalid ship queue filters or cursor.',
            'sorting_error' => 'Invalid ship queue sorting.',
            'options_error' => 'Invalid ship queue sorting or filters.',
            'cursor_error' => 'Invalid ship queue cursor.',
            'prepare_error' => 'Could not prepare ship queue inspection.',
            'read_error' => 'Could not read ship queue records.',
            'data_error' => 'Ship queue records contained invalid data.',
            'empty' => 'No ship queue entries loaded.',
            'no_matching' => 'No matching ship queue entries on this page.',
            'warning' => 'Local staging HTTP override is active. Queue data and login cookies are not encrypted;'
                . ' use only an isolated local test installation.',
        ],
        default => throw new InvalidArgumentException('Unknown upgrade catalog.'),
    };
}

function gq_game_admin_upgrade_columns(string $kind): array
{
    $catalog = gq_game_admin_upgrade_catalog($kind);
    $typeColumn = $catalog['type_column'] ?? 'type';
    $levelColumn = $catalog['level_column'] ?? 'level';
    $columns = [
        'id' => ['ID', 'id'],
        $catalog['parent'] => [$catalog['parent_label'], $catalog['parent']],
        $typeColumn => [$catalog['search_label'], $typeColumn],
        $levelColumn => [$catalog['level_label'] ?? 'Stored level', $levelColumn],
        $catalog['end'] => ['Recorded end (database time)', "COALESCE(CAST({$catalog['end']} AS CHAR), '')"],
    ];
    if ($catalog['queue'] ?? false) {
        $columns['status'] = ['Stored status', 'CAST(status AS CHAR)'];
    }
    return $columns;
}

function gq_game_admin_research_columns(): array
{
    return gq_game_admin_upgrade_columns('research');
}

function gq_game_admin_process_research_request(array $input, string $environment): array
{
    return gq_game_admin_process_upgrade_request($input, $environment, 'research');
}

function gq_game_admin_process_upgrade_request(array $input, string $environment, string $kind): array
{
    $catalog = gq_game_admin_upgrade_catalog($kind);
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to administer GalaxyQuest.', 'gq-game-admin'), '', ['response' => 403]);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        wp_die(esc_html__($catalog['post_error'], 'gq-game-admin'), '', ['response' => 405]);
    }
    if (!gq_game_admin_read_transport_allowed($environment)) {
        wp_die(esc_html__($catalog['transport_error'], 'gq-game-admin'), '', ['response' => 403]);
    }
    if (
        !in_array($environment, ['staging', 'production'], true)
        || ($input['environment'] ?? null) !== $environment
        || ($input['action'] ?? null) !== 'gq_game_admin_' . $kind
    ) {
        wp_die(esc_html__($catalog['request_error'], 'gq-game-admin'), '', ['response' => 400]);
    }
    $nonce = $input['_wpnonce'] ?? null;
    if (
        !is_string($nonce)
        || wp_verify_nonce(wp_unslash($nonce), 'gq_game_admin_' . $kind . '_' . $environment) === false
    ) {
        wp_die(esc_html__($catalog['nonce_error'], 'gq-game-admin'), '', ['response' => 403]);
    }
    $defaults = [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'owner' => '', 'scheduled' => '',
        'cursor_id' => '', 'cursor_value' => '',
    ];
    if ($catalog['queue'] ?? false) {
        $defaults['status_filter'] = '';
    }
    $options = [];
    foreach ($defaults as $key => $default) {
        $value = $input[$key] ?? $default;
        if (
            !is_string($value) || strlen($value) > 512 || preg_match('//u', $value) !== 1
            || preg_match('/[\x00-\x1f\x7f]/', $value) === 1
        ) {
            return ['error' => __($catalog['filter_error'], 'gq-game-admin')];
        }
        $options[$key] = wp_unslash($value);
    }
    if (isset($input['sort_choice'])) {
        if (!is_string($input['sort_choice']) || substr_count($input['sort_choice'], ':') !== 1) {
            return ['error' => __($catalog['sorting_error'], 'gq-game-admin')];
        }
        [$options['sort'], $options['order']] = explode(':', $input['sort_choice']);
        $options['cursor_id'] = '';
        $options['cursor_value'] = '';
    }
    if (
        !array_key_exists($options['sort'], gq_game_admin_upgrade_columns($kind))
        || !in_array($options['order'], ['asc', 'desc'], true)
        || !in_array($options['scheduled'], ['', '0', '1'], true)
        || (($catalog['queue'] ?? false)
            && !in_array($options['status_filter'], ['', 'queued', 'running', 'done', 'cancelled'], true))
        || strlen($options['search']) > 128 || strlen($options['cursor_value']) > 256
        || ($options['owner'] !== ''
            && (!gq_game_admin_planet_integer($options['owner']) || (int)$options['owner'] < 1))
    ) {
        return ['error' => __($catalog['options_error'], 'gq-game-admin')];
    }
    if ($options['cursor_id'] !== '') {
        $value = $options['cursor_value'];
        if (
            !gq_game_admin_planet_integer($options['cursor_id']) || (int)$options['cursor_id'] < 1
            || ($options['sort'] !== 'id' && !array_key_exists('cursor_value', $input))
            || ($options['sort'] === $catalog['parent'] && (!gq_game_admin_planet_integer($value) || (int)$value < 1))
            || ($options['sort'] === ($catalog['level_column'] ?? 'level') && !gq_game_admin_planet_integer($value))
            || (($catalog['queue'] ?? false) && $options['sort'] === 'status'
                && !in_array($value, ['queued', 'running', 'done', 'cancelled'], true))
            || ($options['sort'] === $catalog['end'] && $value !== ''
                && preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\z/D', $value) !== 1)
        ) {
            return ['error' => __($catalog['cursor_error'], 'gq-game-admin')];
        }
    }
    $options['search'] = trim($options['search']);
    $target = gq_game_admin_inspection_target($environment);
    if (isset($target['error'])) {
        return $target;
    }
    $result = gq_game_admin_query_upgrade_records($target['credentials'], $target['database'], $options, $kind);
    if (!isset($result['error'])) {
        $result['options'] = $options;
        $result['database'] = $target['database'];
        $result['observed_at'] = gmdate('Y-m-d H:i:s') . ' UTC';
    }
    return $result;
}

function gq_game_admin_query_research(array $credentials, string $database, array $options): array
{
    return gq_game_admin_query_upgrade_records($credentials, $database, $options, 'research');
}

function gq_game_admin_query_upgrade_records(
    array $credentials,
    string $database,
    array $options,
    string $kind
): array {
    $catalog = gq_game_admin_upgrade_catalog($kind);
    $columns = gq_game_admin_upgrade_columns($kind);
    $sort = $options['sort'];
    $order = $options['order'];
    if (!is_string($sort) || !isset($columns[$sort]) || !in_array($order, ['asc', 'desc'], true)) {
        return ['error' => __($catalog['sorting_error'], 'gq-game-admin')];
    }
    return gq_game_admin_read_database(
        $credentials,
        $database,
        static function (mysqli $connection) use ($options, $sort, $order, $columns, $catalog, $kind): array {
            $conditions = [];
            $parameters = [];
            $typeColumn = $catalog['type_column'] ?? 'type';
            $levelColumn = $catalog['level_column'] ?? 'level';
            if ($options['search'] !== '') {
                $conditions[] = 'LOCATE(?, ' . $typeColumn . ') > 0';
                $parameters[] = $options['search'];
            }
            if ($options['owner'] !== '') {
                $conditions[] = $catalog['parent'] . ' = ?';
                $parameters[] = $options['owner'];
            }
            if ($options['scheduled'] !== '') {
                $conditions[] = $catalog['end'] . ($options['scheduled'] === '1' ? ' IS NOT NULL' : ' IS NULL');
            }
            if (($catalog['queue'] ?? false) && $options['status_filter'] !== '') {
                $conditions[] = 'CAST(status AS CHAR) = ?';
                $parameters[] = $options['status_filter'];
            }
            $expression = $columns[$sort][1];
            if ($options['cursor_id'] !== '') {
                $operator = $order === 'asc' ? '>' : '<';
                if ($sort === 'id') {
                    $conditions[] = "id $operator ?";
                } else {
                    $conditions[] = "($expression $operator ? OR ($expression = ? AND id $operator ?))";
                    $parameters[] = $options['cursor_value'];
                    $parameters[] = $options['cursor_value'];
                }
                $parameters[] = $options['cursor_id'];
            }
            $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);
            $statement = $connection->prepare(
                'SELECT id, ' . $catalog['parent'] . ', ' . $typeColumn . ', ' . $levelColumn . ', ' . $catalog['end']
                . (($catalog['queue'] ?? false) ? ', CAST(status AS CHAR)' : ', NULL')
                . ' FROM ' . ($catalog['table'] ?? $kind) . $where . " ORDER BY $expression $order"
                . ($sort === 'id' ? '' : ", id $order") . ' LIMIT 51'
            );
            if ($statement === false) {
                return ['error' => __($catalog['prepare_error'], 'gq-game-admin')];
            }
            try {
                if (
                    ($parameters !== [] && !$statement->bind_param(str_repeat('s', count($parameters)), ...$parameters))
                    || !$statement->execute()
                    || !$statement->bind_result($id, $owner, $type, $level, $end, $status)
                ) {
                    return ['error' => __($catalog['read_error'], 'gq-game-admin')];
                }
                $rows = [];
                while (($fetched = $statement->fetch()) === true) {
                    if (
                        !gq_game_admin_planet_integer((string)$id) || (int)$id < 1
                        || !gq_game_admin_planet_integer((string)$owner) || (int)$owner < 1
                        || !is_string($type) || !gq_game_admin_planet_integer((string)$level)
                        || (($catalog['queue'] ?? false)
                            && !in_array($status, ['queued', 'running', 'done', 'cancelled'], true))
                        || ($end !== null && (!is_string($end)
                            || preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\z/D', $end) !== 1))
                    ) {
                        return ['error' => __($catalog['data_error'], 'gq-game-admin')];
                    }
                    $row = [
                        'id' => (int)$id, $catalog['parent'] => (int)$owner, $typeColumn => $type,
                        $levelColumn => (int)$level,
                        $catalog['end'] => $end,
                    ];
                    if ($catalog['queue'] ?? false) {
                        $row['status'] = $status;
                    }
                    $rows[] = $row;
                }
                if ($fetched === false) {
                    return ['error' => __($catalog['read_error'], 'gq-game-admin')];
                }
                $hasMore = count($rows) > 50;
                if ($hasMore) {
                    array_pop($rows);
                }
                return [$kind => $rows, 'has_more' => $hasMore];
            } finally {
                $statement->close();
            }
        }
    );
}

function gq_game_admin_render_research_form(string $environment, array $options, array|null $last = null): void
{
    gq_game_admin_render_upgrade_form($environment, $options, 'research', $last);
}

function gq_game_admin_render_upgrade_form(
    string $environment,
    array $options,
    string $kind,
    array|null $last = null
): void {
    $catalog = gq_game_admin_upgrade_catalog($kind);
    echo '<form method="post"' . ($last === null ? ' id="gq-' . esc_attr($kind) . '-controls"' : '') . ' action="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=' . $kind . '&environment=' . $environment)) . '">';
    $fields = [
        'action' => 'gq_game_admin_' . $kind, 'environment' => $environment,
        'sort' => $options['sort'], 'order' => $options['order'],
        'cursor_id' => $last === null ? '' : (string)$last['id'],
        'cursor_value' => $last === null ? '' : (string)$last[$options['sort']],
    ];
    if ($last !== null) {
        foreach (['search', 'owner', 'scheduled'] as $key) {
            $fields[$key] = $options[$key];
        }
        if ($catalog['queue'] ?? false) {
            $fields['status_filter'] = $options['status_filter'];
        }
    }
    foreach ($fields as $key => $value) {
        echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr($value) . '">';
    }
    wp_nonce_field('gq_game_admin_' . $kind . '_' . $environment);
    if ($last !== null) {
        echo '<p><button class="button" type="submit">'
            . esc_html__('Load next page', 'gq-game-admin') . '</button></p>';
    }
    echo '</form>';
}

function gq_game_admin_render_research(string $environment): void
{
    gq_game_admin_render_upgrade_records($environment, 'research');
}

function gq_game_admin_render_buildings(string $environment): void
{
    gq_game_admin_render_upgrade_records($environment, 'buildings');
}

function gq_game_admin_render_upgrade_records(string $environment, string $kind): void
{
    $catalog = gq_game_admin_upgrade_catalog($kind);
    echo '<h2>' . esc_html__($catalog['title'], 'gq-game-admin') . '</h2><p>'
        . esc_html__($catalog['description'], 'gq-game-admin') . '</p>';
    if (!gq_game_admin_read_transport_allowed($environment)) {
        echo '<p class="notice notice-error">'
            . esc_html__($catalog['transport_error'], 'gq-game-admin') . '</p>';
        return;
    }
    if (!gq_game_admin_secure_transport()) {
        echo '<p class="notice notice-warning">' . esc_html__($catalog['warning'], 'gq-game-admin') . '</p>';
    }
    $result = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
        ? gq_game_admin_process_upgrade_request($_POST, $environment, $kind) : null;
    $options = $result['options'] ?? [
        'sort' => 'id', 'order' => 'asc', 'search' => '', 'owner' => '', 'scheduled' => '',
    ];
    if (($catalog['queue'] ?? false) && !isset($options['status_filter'])) {
        $options['status_filter'] = '';
    }
    gq_game_admin_render_upgrade_form($environment, $options, $kind);
    echo '<table class="widefat striped" data-gq-' . esc_attr($kind) . '-table><thead><tr>';
    $columns = gq_game_admin_upgrade_columns($kind);
    foreach ($columns as $key => [$label]) {
        $active = $options['sort'] === $key;
        $next = $active && $options['order'] === 'asc' ? 'desc' : 'asc';
        echo '<th scope="col" aria-sort="'
            . ($active ? ($options['order'] === 'asc' ? 'ascending' : 'descending') : 'none') . '">';
        echo '<button class="button-link" type="submit" form="gq-' . esc_attr($kind)
            . '-controls" name="sort_choice" value="'
            . esc_attr($key . ':' . $next) . '">' . esc_html__($label, 'gq-game-admin')
            . ($active ? ($options['order'] === 'asc' ? ' &uarr;' : ' &darr;') : '') . '</button>';
        if ($key === $catalog['parent']) {
            echo '<br><input form="gq-' . esc_attr($kind)
                . '-controls" type="number" min="1" max="2147483647" name="owner"'
                . ' aria-label="' . esc_attr(sprintf(
                    __('%s (empty for all)', 'gq-game-admin'),
                    __($catalog['parent_label'], 'gq-game-admin')
                ))
                . '" value="' . esc_attr($options['owner']) . '">';
        } elseif ($key === ($catalog['type_column'] ?? 'type')) {
            echo '<br><input form="gq-' . esc_attr($kind)
                . '-controls" type="search" name="search" maxlength="128" aria-label="'
                . esc_attr(sprintf(__('%s contains', 'gq-game-admin'), __($catalog['search_label'], 'gq-game-admin')))
                . '" value="' . esc_attr($options['search']) . '">';
        } elseif ($key === $catalog['end']) {
            echo '<br><select form="gq-' . esc_attr($kind) . '-controls" name="scheduled" aria-label="'
                . esc_attr(__('Recorded end', 'gq-game-admin')) . '">';
            foreach (['' => 'All records', '0' => 'No end recorded', '1' => 'End recorded'] as $value => $text) {
                echo '<option value="' . esc_attr((string)$value) . '"'
                    . ($options['scheduled'] === (string)$value ? ' selected' : '') . '>'
                    . esc_html__($text, 'gq-game-admin') . '</option>';
            }
            echo '</select>';
        } elseif (($catalog['queue'] ?? false) && $key === 'status') {
            echo '<br><select form="gq-' . esc_attr($kind) . '-controls" name="status_filter" aria-label="'
                . esc_attr(__('Stored status', 'gq-game-admin')) . '">';
            $statuses = [
                '' => 'All statuses', 'queued' => 'queued', 'running' => 'running',
                'done' => 'done', 'cancelled' => 'cancelled',
            ];
            foreach ($statuses as $value => $text) {
                echo '<option value="' . esc_attr($value) . '"'
                    . ($options['status_filter'] === $value ? ' selected' : '') . '>'
                    . esc_html__($text, 'gq-game-admin') . '</option>';
            }
            echo '</select>';
        }
        echo '</th>';
    }
    $colspan = count($columns);
    echo '</tr><tr><th colspan="' . $colspan . '"><button class="button" type="submit" form="gq-'
        . esc_attr($kind) . '-controls">'
        . esc_html__('Apply / load first page', 'gq-game-admin') . '</button> <a class="button" href="'
        . esc_url(admin_url('admin.php?page=gq-game-admin&section=' . $kind . '&environment=' . $environment)) . '">'
        . esc_html__('Reset view', 'gq-game-admin') . '</a></th></tr></thead><tbody>';
    if ($result === null || isset($result['error'])) {
        echo '<tr><td colspan="' . $colspan . '">'
            . esc_html($result['error'] ?? __($catalog['empty'], 'gq-game-admin'))
            . '</td></tr></tbody></table>';
        return;
    }
    foreach ($result[$kind] as $record) {
        echo '<tr>';
        foreach (array_keys($columns) as $key) {
            echo '<td>' . esc_html($record[$key] === null ? '-' : (string)$record[$key]) . '</td>';
        }
        echo '</tr>';
    }
    echo '</tbody></table><p>' . esc_html(sprintf(
        __('Database: %1$s. Observed: %2$s. Results are not stored in WordPress.', 'gq-game-admin'),
        $result['database'],
        $result['observed_at']
    )) . '</p>';
    if ($result[$kind] === []) {
        echo '<p>' . esc_html__($catalog['no_matching'], 'gq-game-admin') . '</p>';
    } elseif ($result['has_more']) {
        gq_game_admin_render_upgrade_form($environment, $options, $kind, end($result[$kind]));
    }
}

function gq_game_admin_render_operations(): void
{
    echo '<h2>' . esc_html__('Controlled game operations', 'gq-game-admin') . '</h2><p>';
    echo esc_html__(
        'Execution is locked. The CLI inspection is not a setup or migration executor.'
            . ' Release approval, verified backup/restore, writer coordination'
            . ' and an authorized job runner must be implemented first.'
            . ' MySQL DDL may commit implicitly; switching PHP files back does not restore the database.',
        'gq-game-admin'
    );
    echo '</p>';
    $operations = [
        'Edit game configuration', 'Run initial setup', 'Apply migrations', 'Create backup', 'Restore database',
    ];
    foreach ($operations as $label) {
        echo '<button type="button" class="button" disabled>' . esc_html__($label, 'gq-game-admin') . '</button> ';
    }
}

function gq_game_admin_render_plugin_updates(): void
{
    echo '<h2>' . esc_html__('Plugin updates', 'gq-game-admin') . '</h2><p>';
    echo esc_html__(
        'This plugin uses its own stable GitHub releases (gq-game-admin-vX.Y.Z),'
            . ' independently of deployment and game releases. WordPress controls installation and auto-updates.',
        'gq-game-admin'
    );
    echo '</p><p><a class="button" href="' . esc_url(admin_url('plugins.php')) . '">'
        . esc_html__('Manage plugin updates in WordPress', 'gq-game-admin') . '</a></p>';
}
