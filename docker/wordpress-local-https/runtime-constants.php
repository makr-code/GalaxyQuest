<?php

declare(strict_types=1);

define('WP_HOME', 'https://localhost:8443/wordpress');
define('WP_SITEURL', 'https://localhost:8443/wordpress');
if (!defined('ABSPATH')) {
    define('ABSPATH', '/var/www/html/wordpress/');
}
define('FORCE_SSL_ADMIN', true);
define('DISABLE_WP_CRON', true);
define('DISALLOW_FILE_MODS', true);
