<?php

declare(strict_types=1);

use GalaxyQuest\Economy\OnDemandEconomy;
use GalaxyQuest\Economy\StandingOrders;
use GalaxyQuest\Economy\NpcStandingOrders;
use GalaxyQuest\Economy\EconomicRequests;
use function GalaxyQuest\Tests\Integration\StandingOrdersMySql\connection;
use function GalaxyQuest\Tests\Integration\StandingOrdersMySql\ordinary_arrival;

require_once __DIR__ . '/standing_orders_mysql_fixture.php';
require_once __DIR__ . '/../../src/Economy/EconomicRequests.php';

$arguments = json_decode($argv[1], true, flags: JSON_THROW_ON_ERROR);
$db = connection($arguments['database']);
$orders = new StandingOrders($db);
$economy = new OnDemandEconomy($db);
if ($arguments['outer'] ?? false) {
    $db->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    $db->beginTransaction();
    // Establish a snapshot before the parent commits a competing ledger write.
    $db->query('SELECT * FROM economy_processed_goods')->fetchAll();
    $db->query('SELECT * FROM colonies')->fetchAll();
    $db->query('SELECT * FROM colony_economy_state')->fetchAll();
}
fwrite(STDOUT, "READY\n");
fflush(STDOUT);
if (fgets(STDIN) !== "GO\n") {
    exit(2);
}
fwrite(STDOUT, 'STARTING:' . $db->query('SELECT CONNECTION_ID()')->fetchColumn() . "\n");
fflush(STDOUT);
try {
    $result = match ($arguments['action']) {
        'create' => $orders->create($arguments['uid'], $arguments['cid'], $arguments['side'],
            'steel_alloy', $arguments['quantity'] ?? 80, $arguments['price'] ?? '1.00'),
        'cancel' => $orders->cancel($arguments['uid'], $arguments['id']),
        'route' => process_single_route_transition($db, ['id' => $arguments['id'], 'status' => 'planning']),
        'spend' => $economy->spend(11, 7, ['steel_alloy' => 80], static fn(): bool => true),
        'receive' => $economy->receive(12, ['steel_alloy' => 3]),
        'arrival' => ordinary_arrival($db, $arguments['id']),
        'npc_decide' => (new NpcStandingOrders($db))->decide($arguments['uid'], $arguments['now'] ?? null),
        'request_accept' => (new EconomicRequests($db))->respond($arguments['uid'], $arguments['id'],
            'accept', $arguments['now'] ?? time()),
    };
    if ($db->inTransaction()) {
        $db->commit();
    }
    fwrite(STDOUT, json_encode(['status' => 'committed', 'result' => $result], JSON_THROW_ON_ERROR) . "\n");
} catch (Throwable $error) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    fwrite(STDOUT, json_encode([
        'status' => 'rejected', 'code' => $error->getCode(), 'message' => $error->getMessage(),
    ], JSON_THROW_ON_ERROR) . "\n");
}
fflush(STDOUT);
