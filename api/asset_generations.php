<?php

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    json_error('This legacy endpoint is retired. Use /api/asset_generations/{id}.', 410);
}
