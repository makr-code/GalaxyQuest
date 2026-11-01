<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/config/config.php';
require_once dirname(__DIR__) . '/lib/MigrationRunner.php';
require_once dirname(__DIR__) . '/lib/HealthProbe.php';

$response = \GalaxyQuest\Health\HealthProbe::response('/health/ready', 'GET', static function (): void {
    \GalaxyQuest\Health\HealthProbe::assertReady(
        \GalaxyQuest\Health\HealthProbe::connect(),
        dirname(__DIR__) . '/sql'
    );
});
exit($response['code'] === 200 ? 0 : 1);
