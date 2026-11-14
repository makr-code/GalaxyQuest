<?php

declare(strict_types=1);

/* phpcs:disable PSR1.Files.SideEffects.FoundWithSymbols -- Local WordPress bootstrap. */

require '/usr/local/lib/gq-local-https/runtime-constants.php';
define('GQ_GAME_ADMIN_STAGING_DB_CONFIG_FILE', '/var/lib/gq-inspection/staging-inspection-db.json');
define('GQ_GAME_ADMIN_PRODUCTION_DB_CONFIG_FILE', '/var/lib/gq-inspection/production-inspection-db.json');

require '/var/lib/gq-local-config/wp-config.php';
