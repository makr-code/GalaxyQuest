<?php

declare(strict_types=1);

use GalaxyQuest\Economy\ResourceLedger;

require_once __DIR__ . '/../../src/Economy/ResourceLedger.php';

$dsn = getenv('GQ_RESOURCE_LEDGER_TEST_DSN');
$database = getenv('GQ_RESOURCE_LEDGER_TEST_DATABASE');
$workerId = getenv('GQ_RESOURCE_LEDGER_TEST_WORKER');
$holdCallback = getenv('GQ_RESOURCE_LEDGER_TEST_HOLD_CALLBACK') === '1';
$scenario = getenv('GQ_RESOURCE_LEDGER_TEST_SCENARIO') ?: 'spend';
$colonyId = (int)(getenv('GQ_RESOURCE_LEDGER_TEST_COLONY') ?: 11);
if ($dsn === false || $database === false || $workerId === false || !in_array($scenario, ['spend', 'research'], true)) {
    fwrite(STDERR, "Missing resource ledger test configuration.\n");
    exit(2);
}

$db = new PDO(
    $dsn,
    getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
    getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
);
$db->exec('USE `' . $database . '`');
fwrite(STDOUT, "READY\n");
fflush(STDOUT);
if (fgets(STDIN) !== "GO\n") {
    fwrite(STDERR, "Worker was not released by the test barrier.\n");
    exit(2);
}

fwrite(STDOUT, "STARTING:" . $db->query('SELECT CONNECTION_ID()')->fetchColumn() . "\n");
fflush(STDOUT);

try {
    $cost = $scenario === 'research' ? 10 : 80;
    (new ResourceLedger($db))->spend(
        $colonyId,
        7,
        ['metal' => $cost],
        function () use ($db, $workerId, $holdCallback, $scenario, $colonyId): void {
            if ($holdCallback) {
                fwrite(STDOUT, "LOCKED\n");
                fflush(STDOUT);
                if (fgets(STDIN) !== "COMMIT\n") {
                    throw new RuntimeException('Worker was not released to commit.');
                }
            }

            if ($scenario === 'research') {
                $active = $db->prepare('SELECT user_id FROM active_research WHERE user_id = ?');
                $active->execute([7]);
                if ($active->fetchColumn() !== false) {
                    throw new DomainException('Another research is already in progress.', 409);
                }
                $db->prepare('INSERT INTO active_research (user_id, colony_id) VALUES (?, ?)')
                    ->execute([7, $colonyId]);
            } else {
                $db->prepare('INSERT INTO resource_ledger_commits (worker_id) VALUES (?)')->execute([$workerId]);
            }
        }
    );
    fwrite(STDOUT, json_encode(['status' => 'committed'], JSON_THROW_ON_ERROR) . "\n");
} catch (DomainException $error) {
    fwrite(STDOUT, json_encode(['status' => 'rejected', 'code' => $error->getCode()], JSON_THROW_ON_ERROR) . "\n");
}
fflush(STDOUT);
