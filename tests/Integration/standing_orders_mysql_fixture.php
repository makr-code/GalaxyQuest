<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration\StandingOrdersMySql;

use PDO;
use RuntimeException;

if (!defined('TRADERS_LIB_MODE')) {
    define('TRADERS_LIB_MODE', true);
}
require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../../api/traders.php';

function connection(string $database = ''): PDO
{
    $dsn = getenv('GQ_RESOURCE_LEDGER_TEST_DSN');
    if (!$dsn) {
        throw new RuntimeException('Missing isolated MySQL test DSN.');
    }
    $db = new PDO($dsn, getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
        getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    if ($database !== '') {
        if (!preg_match('/^gq_standing_mysql_[a-f0-9]+$/D', $database)) {
            throw new RuntimeException('Refusing a non-fixture database.');
        }
        $db->exec('USE `' . $database . '`');
        if ($db->query('SELECT DATABASE()')->fetchColumn() !== $database) {
            throw new RuntimeException('Wrong test database.');
        }
    }
    $db->exec('SET SESSION innodb_lock_wait_timeout=8');
    return $db;
}

/** Run the real ordinary-arrival claim/exclusion without unrelated combat/cache IO. */
function ordinary_arrival(PDO $db, int $fleetId): void
{
    if (!function_exists(__NAMESPACE__ . '\\process_fleet_arrival_locked')) {
        $source = file_get_contents(__DIR__ . '/../../api/fleet.php');
        if ($source === false) {
            throw new RuntimeException('Missing fleet source.');
        }
        foreach (['process_fleet_arrival_locked', 'fleet_trader_route_table_exists'] as $name) {
            $start = strpos($source, 'function ' . $name . '(');
            $end = $start === false ? false : strpos($source, "\nfunction ", $start + 1);
            if ($start === false || $end === false) {
                throw new RuntimeException('Missing arrival fixture function.');
            }
            eval('namespace ' . __NAMESPACE__ . '; use PDO; use PDOException; '
                . substr($source, $start, $end - $start));
        }
    }
    $db->beginTransaction();
    try {
        process_fleet_arrival_locked($db, $fleetId);
        $db->commit();
    } catch (\Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function handle_fleet_arrival(PDO $db, array $fleet): void
{
    throw new RuntimeException('Ordinary arrival must not claim trader cargo.');
}
