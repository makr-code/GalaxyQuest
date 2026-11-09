<?php

declare(strict_types=1);

use GalaxyQuest\Combat\LiveBattleJournal;

if (
    PHP_SAPI !== 'cli' || !in_array($argc, [3, 4], true)
    || !in_array($argv[1], ['create', 'begin', 'arm', 'inspect', 'drop'], true)
    || ($argc === 4 && ($argv[1] !== 'inspect' || !preg_match('/\A[1-9][0-9]*\z/D', $argv[3])))
    || !preg_match('/\Agq_live_e2e_[a-f0-9]{16}\z/D', $argv[2])
) {
    fwrite(STDERR, "Invalid isolated live battle fixture invocation.\n");
    exit(1);
}
require_once __DIR__ . '/../../src/Combat/LiveBattleRules.php';
require_once __DIR__ . '/../../src/Combat/LiveBattleJournal.php';
$name = $argv[2];
$sessionDir = sys_get_temp_dir() . '/' . $name;
$db = new PDO(
    'mysql:host=' . getenv('DB_HOST') . ';port=' . getenv('DB_PORT'),
    getenv('DB_USER'),
    getenv('DB_PASS'),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
);
$begin = static function (PDO $db): int {
    $db->beginTransaction();
    try {
        $id = (new LiveBattleJournal($db))->begin([
            'attacker' => ['fighter' => ['count' => 2, 'attack' => 150, 'shield' => 0, 'hull' => 100]],
            'defender' => ['cruiser' => ['count' => 2, 'attack' => 0, 'shield' => 0, 'hull' => 10]],
        ], ['attacker' => 10, 'defender' => 20]);
        $db->commit();
        return $id;
    } finally {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
    }
};
if ($argv[1] === 'drop') {
    $db->exec('DROP DATABASE IF EXISTS `' . $name . '`');
    foreach (glob($sessionDir . '/sess_*') ?: [] as $sessionFile) {
        if (!unlink($sessionFile)) {
            throw new RuntimeException('Cannot delete isolated fixture session.');
        }
    }
    if (is_dir($sessionDir) && !rmdir($sessionDir)) {
        throw new RuntimeException('Cannot delete isolated fixture session directory.');
    }
    exit;
}
if ($argv[1] === 'inspect') {
    $db->exec('USE `' . $name . '`');
    $id = $argc === 4 ? (int)$argv[3] : 1;
    $query = $db->prepare('SELECT tick,status,next_tick_at FROM live_battle_journals WHERE id=?');
    $query->execute([$id]);
    $journal = $query->fetch(PDO::FETCH_ASSOC);
    if ($journal === false) {
        throw new RuntimeException('Fixture journal not found.');
    }
    $query = $db->prepare(
        'SELECT tick,events_json,processed_at FROM live_battle_journal_ticks WHERE journal_id=? ORDER BY tick'
    );
    $query->execute([$id]);
    $ticks = $query->fetchAll(PDO::FETCH_ASSOC);
    foreach ($ticks as &$tick) {
        $tick['events'] = json_decode($tick['events_json'], true, 512, JSON_THROW_ON_ERROR);
        unset($tick['events_json']);
    }
    unset($tick);
    fwrite(STDOUT, json_encode(['journal' => $journal, 'ticks' => $ticks], JSON_THROW_ON_ERROR));
    exit;
}
if ($argv[1] === 'begin') {
    $db->exec('USE `' . $name . '`');
    fwrite(STDOUT, json_encode(['id' => $begin($db)], JSON_THROW_ON_ERROR));
    exit;
}
if ($argv[1] === 'arm') {
    $db->exec('USE `' . $name . '`');
    $changed = $db->exec(
        "UPDATE live_battle_journals SET next_tick_at=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 3 SECOND)
         WHERE tick=0 AND status='active'
         AND NOT EXISTS (SELECT 1 FROM live_battle_journal_ticks)"
    );
    if ($changed !== 1) {
        throw new RuntimeException('Fixture must contain exactly one unprocessed active journal.');
    }
    exit;
}
$created = false;
$sessionDirCreated = false;
try {
    $db->exec('CREATE DATABASE `' . $name . '`');
    $created = true;
    $db->exec('USE `' . $name . '`');
    foreach (['migrate_live_battle_journal_v1.sql', 'migrate_live_battle_journal_participants_v1.sql'] as $file) {
        $sql = file_get_contents(__DIR__ . '/../../sql/' . $file);
        if ($sql === false) {
            throw new RuntimeException('Cannot read fixture migration.');
        }
        $sql = preg_replace('/^USE galaxyquest;\s*$/m', '', $sql);
        if ($sql === null) {
            throw new RuntimeException('Cannot prepare fixture migration.');
        }
        $db->exec($sql);
    }
    $id = $begin($db);
    if (!mkdir($sessionDir, 0700)) {
        throw new RuntimeException('Cannot create isolated fixture session directory.');
    }
    $sessionDirCreated = true;
    $sessions = [];
    foreach ([10, 99] as $user) {
        $sessionId = bin2hex(random_bytes(16));
        $session = fopen($sessionDir . '/sess_' . $sessionId, 'x');
        if ($session === false) {
            throw new RuntimeException('Cannot create isolated fixture session.');
        }
        chmod($sessionDir . '/sess_' . $sessionId, 0600);
        $data = 'user_id|i:' . $user . ';';
        $written = fwrite($session, $data);
        $closed = fclose($session);
        if ($written !== strlen($data) || !$closed) {
            throw new RuntimeException('Cannot write isolated fixture session.');
        }
        $sessions[$user] = $sessionId;
    }
    fwrite(
        STDOUT,
        json_encode(['id' => $id, 'session' => $sessions[10], 'outsider' => $sessions[99]], JSON_THROW_ON_ERROR)
    );
} catch (Throwable $error) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    if ($created) {
        $db->exec('DROP DATABASE `' . $name . '`');
    }
    if ($sessionDirCreated) {
        foreach (glob($sessionDir . '/sess_*') ?: [] as $sessionFile) {
            unlink($sessionFile);
        }
        rmdir($sessionDir);
    }
    throw $error;
}
