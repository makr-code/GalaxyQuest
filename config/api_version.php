<?php
/**
 * API versioning configuration.
 *
 * API_VERSION drives canonical endpoint prefix, e.g. /api/v1/...
 * API_ALLOW_LEGACY controls whether old /api/*.php routes remain accepted.
 */

if (!defined('API_VERSION')) {
    define('API_VERSION', trim((string)env_value('API_VERSION', 'v1'), '/'));
}

if (!defined('API_ALLOW_LEGACY')) {
    define('API_ALLOW_LEGACY', ((int)env_value('API_ALLOW_LEGACY', 1)) === 1);
}

if (!defined('API_VERSION_PREFIX')) {
    define('API_VERSION_PREFIX', '/api/' . API_VERSION . '/');
}
