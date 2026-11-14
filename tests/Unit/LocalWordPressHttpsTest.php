<?php

declare(strict_types=1);

/* phpcs:disable PSR1.Files.SideEffects.FoundWithSymbols, PSR1.Classes.ClassDeclaration -- PHPUnit bootstrap. */

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/docker/wordpress-local-https/transform-config.php';

final class LocalWordPressHttpsTest extends TestCase
{
    public function testRemovesOnlyLocalOverrideDefinitionsAndKeepsDatabaseConfiguration(): void
    {
        $source = <<<'PHP'
<?php
define('DB_NAME', 'wordpress');
define('WP_HOME', getenv('HOME_URL') ?: 'http://example.test');
if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}
define('GQ_GAME_ADMIN_STAGING_DB_CONFIG_FILE', '/old/path');
define('GQ_GAME_ADMIN_STAGING_DB_USER', 'inspection_user');
require_once ABSPATH . 'wp-settings.php';
PHP;
        $expected = <<<'PHP'
<?php
define('DB_NAME', 'wordpress');
true;
if (!defined('ABSPATH')) {
    true;
}
true;
define('GQ_GAME_ADMIN_STAGING_DB_USER', 'inspection_user');
require_once ABSPATH . 'wp-settings.php';
PHP;
        self::assertSame($expected, gq_local_https_transform_configuration($source));
    }

    public function testRejectsUnterminatedOverrideDefinition(): void
    {
        $this->expectException(RuntimeException::class);
        gq_local_https_transform_configuration("<?php define('WP_HOME', getenv('URL');");
    }
}
