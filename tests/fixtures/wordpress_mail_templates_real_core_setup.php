<?php

/*
 * Boots the read-only local WordPress core against disposable MariaDB. The
 * only stubbed behavior is suppressing the synthetic install welcome email.
 */

declare(strict_types=1);

const GQ_FIXTURE_ROOT = '/run/gq-wp-site/';
const GQ_FIXTURE_ADMIN_LOGIN = 'gqfixtureadmin';
const GQ_FIXTURE_READER_LOGIN = 'gqmailreader';

function gq_fixture_fail(string $message): never
{
    fwrite(STDERR, $message . PHP_EOL);
    exit(1);
}

function gq_fixture_check(bool $condition, string $message): void
{
    if (!$condition) {
        gq_fixture_fail($message);
    }
}

function gq_fixture_bootstrap(): void
{
    $config = GQ_FIXTURE_ROOT . 'wp-config.php';
    gq_fixture_check(!file_exists($config), 'Refusing to overwrite an existing WordPress config.');
    gq_fixture_check(is_file(GQ_FIXTURE_ROOT . 'wp-includes/version.php'), 'WordPress core is not mounted.');

    $pluginDirectory = GQ_FIXTURE_ROOT . 'wp-content/plugins/gq-game-news';
    $themeDirectory = GQ_FIXTURE_ROOT . 'wp-content/themes/gq-fixture';
    gq_fixture_check(is_dir($pluginDirectory), 'The isolated plugin directory is missing.');
    gq_fixture_check(is_file($pluginDirectory . '/gq-game-news.php'), 'The real GalaxyQuest plugin is missing.');
    gq_fixture_check(is_dir($themeDirectory), 'The isolated fixture theme is missing.');

    $adminPassword = bin2hex(random_bytes(24)) . '!a';
    $configContents = <<<'PHP'
<?php
define('DB_NAME', 'gq_fixture');
define('DB_USER', 'gq_fixture');
define('DB_PASSWORD', 'gq_fixture_only');
define('DB_HOST', 'gq-mail-db');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');
define('WP_HOME', 'https://wp.fixture.invalid');
define('WP_SITEURL', 'https://wp.fixture.invalid');
define('WP_DEFAULT_THEME', 'gq-fixture');
define('WP_ENVIRONMENT_TYPE', 'local');
define('WP_DEBUG', true);
define('WP_DEBUG_DISPLAY', false);
define('WP_DEBUG_LOG', false);
define('DISABLE_WP_CRON', true);
define('AUTOMATIC_UPDATER_DISABLED', true);
define('WP_HTTP_BLOCK_EXTERNAL', true);
define('AUTH_KEY', '__AUTH_KEY__');
define('SECURE_AUTH_KEY', '__SECURE_AUTH_KEY__');
define('LOGGED_IN_KEY', '__LOGGED_IN_KEY__');
define('NONCE_KEY', '__NONCE_KEY__');
define('AUTH_SALT', '__AUTH_SALT__');
define('SECURE_AUTH_SALT', '__SECURE_AUTH_SALT__');
define('LOGGED_IN_SALT', '__LOGGED_IN_SALT__');
define('NONCE_SALT', '__NONCE_SALT__');
$table_prefix = 'wp_';
if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}
require_once ABSPATH . 'wp-settings.php';
PHP;
    foreach ([
        '__AUTH_KEY__', '__SECURE_AUTH_KEY__', '__LOGGED_IN_KEY__', '__NONCE_KEY__',
        '__AUTH_SALT__', '__SECURE_AUTH_SALT__', '__LOGGED_IN_SALT__', '__NONCE_SALT__',
    ] as $placeholder) {
        $configContents = str_replace($placeholder, bin2hex(random_bytes(32)), $configContents);
    }
    gq_fixture_check(file_put_contents($config, $configContents, LOCK_EX) === strlen($configContents),
        'Could not create the disposable WordPress configuration.');

    $_SERVER['HTTPS'] = 'on';
    $_SERVER['SERVER_PORT'] = '443';
    $_SERVER['HTTP_HOST'] = 'wp.fixture.invalid';
    $_SERVER['SCRIPT_NAME'] = '/wp-admin/install.php';
    define('WP_INSTALLING', true);
    require GQ_FIXTURE_ROOT . 'wp-load.php';
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
    add_filter('pre_wp_mail', static fn(): bool => true);

    $installed = wp_install(
        'GalaxyQuest Isolated Mail Fixture',
        GQ_FIXTURE_ADMIN_LOGIN,
        'admin@example.invalid',
        false,
        '',
        $adminPassword
    );
    gq_fixture_check(is_array($installed) && is_int($installed['user_id'] ?? null), 'WordPress core installation failed.');

    $activated = activate_plugin('gq-game-news/gq-game-news.php');
    gq_fixture_check($activated === null, 'The GalaxyQuest plugin could not be activated.');
    gq_fixture_check(function_exists('gq_mail_templates_register_post_type'), 'The real plugin was not loaded.');
    gq_mail_templates_register_post_type();

    $postType = get_post_type_object('gq_mail_template');
    gq_fixture_check($postType instanceof WP_Post_Type, 'WordPress did not register the real mail-template CPT.');
    foreach (['public', 'publicly_queryable', 'show_in_rest', 'rewrite', 'query_var', 'has_archive', 'show_in_nav_menus'] as $flag) {
        gq_fixture_check($postType->{$flag} === false, "The registered CPT exposes {$flag}.");
    }
    gq_fixture_check($postType->show_ui === true && $postType->map_meta_cap === true,
        'The registered CPT does not have the expected editorial or capability settings.');

    add_role('gq_fixture_mail_reader', 'GQ fixture mail reader', ['read' => true]);
    $readerId = wp_insert_user([
        'user_login' => GQ_FIXTURE_READER_LOGIN,
        'user_pass' => bin2hex(random_bytes(24)) . '!a',
        'user_email' => 'reader@example.invalid',
        'role' => 'gq_fixture_mail_reader',
    ]);
    gq_fixture_check(!is_wp_error($readerId), 'Could not create the no-edit fixture user.');

    $draftId = wp_insert_post([
        'post_type' => 'gq_mail_template',
        'post_status' => 'draft',
        'post_author' => (int)$installed['user_id'],
        'post_title' => 'Grüße an {{username}} & Crew',
        'post_name' => 'gq-mail-real-http-fixture',
        'post_content' => '<!-- wp:paragraph --><p>Hallo {{username}}, deine Flotte wartet.</p><!-- /wp:paragraph -->'
            . '<script>steal()</script><p onclick="evil()" style="color:red">Unsicher</p>'
            . '<a href="javascript:steal()">Böse</a>'
            . '<p><a href="https://game.example.invalid/#fleet">Zur Flotte</a></p>',
    ], true);
    gq_fixture_check(!is_wp_error($draftId) && is_int($draftId) && $draftId > 0,
        'Could not create the draft template through WordPress core.');

    update_option('permalink_structure', '/%postname%/');
    flush_rewrite_rules(false);
    $adminApplicationPassword = WP_Application_Passwords::create_new_application_password(
        (int)$installed['user_id'],
        ['name' => 'GQ isolated E2E admin']
    );
    $readerApplicationPassword = WP_Application_Passwords::create_new_application_password(
        (int)$readerId,
        ['name' => 'GQ isolated E2E no-edit reader']
    );
    gq_fixture_check(is_array($adminApplicationPassword) && is_string($adminApplicationPassword[0] ?? null),
        'Could not create the synthetic admin application password.');
    gq_fixture_check(is_array($readerApplicationPassword) && is_string($readerApplicationPassword[0] ?? null),
        'Could not create the synthetic no-edit application password.');

    echo json_encode([
        'template_id' => $draftId,
        'admin_user' => GQ_FIXTURE_ADMIN_LOGIN,
        'reader_user' => GQ_FIXTURE_READER_LOGIN,
        'admin_app_password' => $adminApplicationPassword[0],
        'reader_app_password' => $readerApplicationPassword[0],
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE) . PHP_EOL;
}

function gq_fixture_approve(int $postId): void
{
    require GQ_FIXTURE_ROOT . 'wp-load.php';
    gq_fixture_check(function_exists('gq_mail_templates_register_post_type'), 'The real plugin was not activated.');

    $post = get_post($postId);
    gq_fixture_check($post instanceof WP_Post && $post->post_type === 'gq_mail_template'
        && $post->post_status === 'draft', 'Only the fixture draft can be approved.');
    $admin = get_user_by('login', GQ_FIXTURE_ADMIN_LOGIN);
    gq_fixture_check($admin instanceof WP_User, 'The fixture editor is missing.');
    wp_set_current_user($admin->ID);
    gq_fixture_check(current_user_can('edit_post', $postId), 'The fixture editor cannot approve its template.');

    $updated = wp_update_post(['ID' => $postId, 'post_status' => 'publish'], true);
    gq_fixture_check(!is_wp_error($updated) && (int)$updated === $postId, 'WordPress could not approve the template.');
    gq_fixture_check(get_post_status($postId) === 'publish', 'WordPress did not persist editorial approval.');
    echo json_encode(['approved' => true, 'template_id' => $postId], JSON_THROW_ON_ERROR) . PHP_EOL;
}

try {
    $action = $argv[1] ?? '';
    if ($action === 'bootstrap' && count($argv) === 2) {
        gq_fixture_bootstrap();
    } elseif ($action === 'approve' && count($argv) === 3 && ctype_digit($argv[2])) {
        gq_fixture_approve((int)$argv[2]);
    } else {
        gq_fixture_fail('Expected bootstrap or approve <fixture-post-id>.');
    }
} catch (Throwable $error) {
    fwrite(STDERR, 'WordPress core setup failed: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
