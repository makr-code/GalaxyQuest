<?php

declare(strict_types=1);

use GalaxyQuest\Economy\ResourceLedger;

require_once __DIR__ . '/../../src/Economy/ResourceLedger.php';

$dsn = getenv('GQ_RESOURCE_LEDGER_TEST_DSN');
$database = getenv('GQ_RESOURCE_LEDGER_TEST_DATABASE');
$workerId = getenv('GQ_RESOURCE_LEDGER_TEST_WORKER');
if ($dsn === false || $database === false || $workerId === false) {
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

try {
    (new ResourceLedger($db))->spend(11, 7, ['metal' => 80], function () use ($db, $workerId): void {
        $db->prepare('INSERT INTO resource_ledger_commits (worker_id) VALUES (?)')->execute([$workerId]);
    });
    fwrite(STDOUT, json_encode(['status' => 'committed'], JSON_THROW_ON_ERROR) . "\n");
} catch (DomainException $error) {
    fwrite(STDOUT, json_encode(['status' => 'rejected', 'code' => $error->getCode()], JSON_THROW_ON_ERROR) . "\n");
}
fflush(STDOUT);
