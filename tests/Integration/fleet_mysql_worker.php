<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration\FleetMySql;

use DomainException;
use RuntimeException;
use Throwable;

require_once __DIR__ . '/fleet_mysql_fixture.php';

$database = getenv('GQ_FLEET_TEST_DATABASE');
$scenario = getenv('GQ_FLEET_TEST_SCENARIO');
$hold = getenv('GQ_FLEET_TEST_HOLD') === '1';
if (
    !$database || !preg_match('/^gq_fleet_test_[a-f0-9]{16}$/D', $database)
    || !in_array($scenario, ['launch', 'cooldown', 'arrival', 'keyed-launch'], true)
) {
    throw new RuntimeException('Invalid isolated fleet worker configuration.');
}
load_fleet_functions();
$db = mysql_connection();
$db->exec('USE `' . $database . '`');
$db->exec('SET SESSION innodb_lock_wait_timeout = 10');
fwrite(STDOUT, "READY\n");
fflush(STDOUT);
if (fgets(STDIN) !== "GO\n") {
    throw new RuntimeException('Worker launch barrier was not released.');
}
fwrite(STDOUT, 'STARTING:' . $db->query('SELECT CONNECTION_ID()')->fetchColumn() . "\n");
fflush(STDOUT);
$db->beginTransaction();
try {
    if ($scenario === 'arrival') {
        process_fleet_arrival_locked($db, (int)getenv('GQ_FLEET_TEST_FLEET_ID'));
    } else {
        $request = launch_request($scenario === 'cooldown' ? 10 : 40);
        if ($scenario === 'keyed-launch') {
            $request['request_id'] = 'fleet-mysql-race-request-1';
        }
        launch_fleet_dispatch($db, 10, $request);
    }
    if ($hold) {
        fwrite(STDOUT, "LOCKED\n");
        fflush(STDOUT);
        $command = fgets(STDIN);
        if ($command === "ABORT\n") {
            // Close without commit/rollback: MySQL must discard the in-flight mutation.
            exit(17);
        }
        if ($command !== "COMMIT\n") {
            throw new RuntimeException('Worker commit barrier was not released.');
        }
    }
    $db->commit();
    fwrite(STDOUT, json_encode(['status' => 'committed'], JSON_THROW_ON_ERROR) . "\n");
} catch (DomainException $error) {
    $db->rollBack();
    fwrite(STDOUT, json_encode(['status' => 'rejected', 'reason' => $error->getMessage()], JSON_THROW_ON_ERROR) . "\n");
} catch (Throwable $error) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    throw $error;
}
fflush(STDOUT);
