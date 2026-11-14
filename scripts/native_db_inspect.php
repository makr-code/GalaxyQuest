#!/usr/bin/env php
<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}

if ($argc !== 3 || !preg_match('/^--database=([A-Za-z0-9_]{1,64})$/D', $argv[1], $databaseArg)
    || !preg_match('/^--user=([A-Za-z0-9_.-]{1,80})$/D', $argv[2], $userArg)) {
    fwrite(STDERR, "Usage: php scripts/native_db_inspect.php --database=NAME --user=NAME\n");
    exit(1);
}
foreach (['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'] as $name) {
    if (getenv($name) === false || getenv($name) === '') {
        fwrite(STDERR, "Missing explicit database configuration: $name\n");
        exit(1);
    }
}
if (getenv('DB_NAME') !== $databaseArg[1] || getenv('DB_USER') !== $userArg[1]
    || !preg_match('/^[A-Za-z0-9_.:-]+$/D', (string)getenv('DB_HOST'))) {
    fwrite(STDERR, "Database configuration does not match the requested identity.\n");
    exit(1);
}
$port = getenv('DB_PORT');
if ($port !== false && (!ctype_digit($port) || (int)$port < 1 || (int)$port > 65535)) {
    fwrite(STDERR, "Invalid database port.\n");
    exit(1);
}

require_once dirname(__DIR__) . '/config/db.php';

try {
    $db = get_db();
    $identity = $db->query('SELECT DATABASE() AS db_name, CURRENT_USER() AS account, VERSION() AS version')
        ->fetch(PDO::FETCH_ASSOC);
    if (!is_array($identity) || $identity['db_name'] !== $databaseArg[1]
        || !str_starts_with((string)$identity['account'], $userArg[1] . '@')) {
        throw new RuntimeException('Connected database or authenticated account does not match the requested identity.');
    }
    $queries = [
        'tables_and_views' => 'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
        'routines' => 'SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()',
        'events' => 'SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()',
        'triggers' => 'SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()',
    ];
    $objects = [];
    foreach ($queries as $name => $sql) {
        $objects[$name] = (int)$db->query($sql)->fetchColumn();
    }
    $engines = [];
    $rows = $db->query(
        "SELECT ENGINE, COUNT(*) AS table_count FROM information_schema.TABLES "
        . "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' GROUP BY ENGINE ORDER BY ENGINE"
    );
    foreach ($rows as $row) {
        $engines[] = ['engine' => $row['ENGINE'], 'table_count' => (int)$row['table_count']];
    }
    echo json_encode([
        'database' => $identity['db_name'],
        'account' => $identity['account'],
        'server_version' => $identity['version'],
        'visible_objects' => $objects,
        'empty_visible' => array_sum($objects) === 0,
        'visible_base_table_engines' => $engines,
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . "\n";
} catch (PDOException | RuntimeException | JsonException $error) {
    fwrite(STDERR, "[native-db-inspect] Failed: " . $error->getMessage() . "\n");
    exit(1);
}
