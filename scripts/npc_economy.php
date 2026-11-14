#!/usr/bin/env php
<?php

declare(strict_types=1);

use GalaxyQuest\Economy\NpcStandingOrders;
use GalaxyQuest\Economy\StandingOrders;

if (PHP_SAPI !== 'cli') {
    http_response_code(405);
    exit;
}

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../src/Economy/NpcStandingOrders.php';

try {
    $command = $argv[1] ?? '';
    $options = [];
    foreach (array_slice($argv, 2) as $arg) {
        if (!preg_match('/^--(actor|colony|profile|budget|expected-db|apply)(?:=(.+))?$/D', $arg, $match)
            || isset($options[$match[1]])) {
            throw new InvalidArgumentException('Unknown or duplicate option: ' . $arg);
        }
        $options[$match[1]] = $match[2] ?? true;
    }
    if (!in_array($command, ['bind', 'preview', 'status'], true) || !isset($options['actor'], $options['expected-db'])) {
        throw new InvalidArgumentException(
            'Usage: npc_economy.php bind|preview|status --actor=N --expected-db=NAME '
            . '[--colony=N --profile=subsistence|agriculture|industry|trade --budget=CREDITS] [--apply]'
        );
    }
    if (isset($options['apply']) && ($command !== 'bind' || $options['apply'] !== true)) {
        throw new InvalidArgumentException('--apply is permitted only for an explicit bind.');
    }
    foreach (['actor', 'colony'] as $key) {
        if (isset($options[$key]) && (!is_string($options[$key]) || !ctype_digit($options[$key])
            || (int)$options[$key] < 1 || (int)$options[$key] > 2147483647)) {
            throw new InvalidArgumentException('Explicit positive integer required: ' . $key);
        }
    }
    $dsn = getenv('GQ_NPC_ECONOMY_DSN');
    if (!$dsn || !str_starts_with($dsn, 'mysql:')) {
        throw new InvalidArgumentException('Explicit GQ_NPC_ECONOMY_DSN required; application DB defaults are never used.');
    }
    $db = new PDO($dsn, getenv('GQ_NPC_ECONOMY_USER') ?: '', getenv('GQ_NPC_ECONOMY_PASSWORD') ?: '', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    if ($db->query('SELECT DATABASE()')->fetchColumn() !== $options['expected-db']) {
        throw new RuntimeException('Connected database does not match --expected-db.');
    }
    if (!NpcStandingOrders::available($db)) {
        throw new RuntimeException('Apply canonical NPC economy migration first.');
    }
    $controller = new NpcStandingOrders($db);
    $uid = (int)$options['actor'];
    $result = match ($command) {
        'bind' => $controller->bind(
            $uid,
            (int)($options['colony'] ?? 0),
            (string)($options['profile'] ?? ''),
            StandingOrders::priceCents($options['budget'] ?? ''),
            !isset($options['apply'])
        ),
        'preview' => $controller->decide($uid, null, true),
        'status' => $controller->diagnostics($uid),
    };
    fwrite(STDOUT, json_encode($result, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . PHP_EOL);
} catch (Throwable $error) {
    fwrite(STDERR, json_encode(['status' => 'error', 'error' => $error->getMessage()], JSON_THROW_ON_ERROR) . PHP_EOL);
    exit(1);
}
