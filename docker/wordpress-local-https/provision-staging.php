<?php

declare(strict_types=1);

// Explicit one-time operator action; never run automatically on restart.
if (PHP_SAPI !== 'cli' || ($argv[1] ?? '') !== '--from-existing-local-staging') {
    exit(1);
}
require __DIR__ . '/runtime-constants.php';
$_SERVER['HTTPS'] = 'on';
$_SERVER['HTTP_HOST'] = 'localhost:8443';
$_SERVER['DOCUMENT_ROOT'] = '/var/www/html';
$_SERVER['REQUEST_URI'] = '/wordpress/';
ob_start();
require '/var/lib/gq-local-config/wp-config.php';
ob_end_clean();
if (!function_exists('gq_game_admin_database_credentials')) {
    throw new RuntimeException('The local administration plugin must already be active.');
}
$file = '/var/lib/gq-inspection/staging-inspection-db.json';
if (file_exists($file) || !gq_game_admin_safe_profile_path($file)) {
    throw new RuntimeException('Staging provisioning requires a safe, absent profile.');
}
$settings = gq_game_admin_database_settings('staging');
$credentials = gq_game_admin_database_credentials('staging');
if (isset($settings['error']) || isset($credentials['error']) || empty($settings['name'])) {
    throw new RuntimeException('Existing local staging configuration is incomplete.');
}
$body = json_encode([
    'environment' => 'staging',
    'host' => $credentials['host'],
    'port' => $credentials['port'],
    'database' => $settings['name'],
    'username' => $credentials['user'],
    'password' => $credentials['password'],
], JSON_THROW_ON_ERROR);
umask(0077);
$temporary = dirname($file) . '/.gq-provision-' . bin2hex(random_bytes(16));
$stream = @fopen($temporary, 'x');
if ($stream === false) {
    throw new RuntimeException('Staging profile could not be created exclusively.');
}
try {
    if (fwrite($stream, $body) !== strlen($body) || !fflush($stream) || !chmod($temporary, 0600)) {
        throw new RuntimeException('Staging profile write failed.');
    }
    if (isset(gq_game_admin_read_database_configuration($temporary, 'staging')['error'])) {
        throw new RuntimeException('Existing staging configuration is incompatible with private profiles.');
    }
    // Same-filesystem hard link publishes a complete file and refuses replacement.
    if (!link($temporary, $file)) {
        throw new RuntimeException('Staging profile publication failed.');
    }
} finally {
    fclose($stream);
    unlink($temporary);
}
fwrite(STDOUT, "Private staging profile provisioned; no credentials displayed.\n");
