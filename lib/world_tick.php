<?php

declare(strict_types=1);

use GalaxyQuest\Economy\WorldEvents;
use GalaxyQuest\Simulation\HourlyWindow;

require_once __DIR__ . '/../src/Economy/WorldEvents.php';
require_once __DIR__ . '/Mailer.php';
require_once __DIR__ . '/mail_outbox.php';

/**
 * Hourly world tick step: roll world events once per window and notify
 * affected players (in-game message + one digest mail per user and window).
 * Missed windows are never replayed; time-based state catches up on demand.
 *
 * @return array<string, mixed>
 */
function world_events_tick_global(PDO $db, ?int $now = null, ?int $maxActive = null): array
{
    $now ??= time();
    $window = HourlyWindow::id($now);
    $stateKey = 'world_events:last_window';
    if (app_state_get_int($db, $stateKey, -1) >= $window) {
        return ['processed' => false, 'reason' => 'window_already_generated', 'window_id' => $window];
    }
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) {
        $db->beginTransaction();
    }
    try {
        $events = (new WorldEvents($db))->generate($now, $maxActive ?? max(0, (int)WORLD_EVENTS_MAX_ACTIVE));
        $digests = world_events_enqueue_digests($db, $window, $events, $now);
        app_state_set_int($db, $stateKey, $window);
        if ($ownsTransaction) {
            $db->commit();
        }
    } catch (PDOException $error) {
        // PHPStan only sees commit() as a throw point; generate()/enqueue can throw too.
        if ($ownsTransaction && $db->inTransaction()) { // @phpstan-ignore booleanAnd.leftAlwaysTrue
            $db->rollBack();
        }
        if (WorldEvents::missingTable($error)) {
            return ['processed' => false, 'reason' => 'world_events_unavailable', 'window_id' => $window];
        }
        throw $error;
    }
    return [
        'processed' => true, 'window_id' => $window,
        'events' => count($events), 'digests' => $digests,
    ];
}

/**
 * @param list<array<string, mixed>> $events
 * @return array<int, list<array<string, mixed>>> user id => affecting events
 */
function world_events_affected_users(PDO $db, array $events): array
{
    $byUser = [];
    foreach ($events as $event) {
        $sql = 'SELECT DISTINCT c.user_id FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id '
            . 'JOIN users u ON u.id = c.user_id '
            . "WHERE u.control_type = 'human' AND u.auth_enabled = 1 AND u.deleted_at IS NULL AND cb.galaxy_index = ?";
        $params = [(int)$event['galaxy_index']];
        if ($event['scope_type'] === 'system') {
            $sql .= ' AND cb.system_index = ?';
            $params[] = (int)$event['system_index'];
        }
        $stmt = $db->prepare($sql . ' ORDER BY c.user_id');
        $stmt->execute($params);
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $userId) {
            $byUser[(int)$userId][] = $event;
        }
    }
    ksort($byUser);
    return $byUser;
}

/** @param list<array<string, mixed>> $events */
function world_events_enqueue_digests(PDO $db, int $window, array $events, int $now): int
{
    if ($events === []) {
        return 0;
    }
    $count = 0;
    $message = $db->prepare('INSERT INTO messages (receiver_id, subject, body) VALUES (?, ?, ?)');
    foreach (world_events_affected_users($db, $events) as $userId => $userEvents) {
        $subject = 'GalaxyQuest: Neue Weltereignisse in deinen Systemen';
        $summary = world_events_digest_lines($userEvents);
        $mailBody = "Hallo,\n\nin Regionen mit deinen Kolonien sind neue Weltereignisse eingetreten:\n\n"
            . $summary . "\n\nDie Marktpreise und betroffene Produktion passen sich während der Laufzeit an.\n\n-- \n"
            . MAIL_OUTBOX_SETTINGS_HINT . "\n";
        $dedupeKey = 'digest:' . $window . ':' . $userId;
        if (mail_outbox_enqueue($db, $userId, 'world_digest', $dedupeKey, $subject, $mailBody, $now)) {
            $message->execute([$userId, 'Weltereignisse', $summary]);
            $count++;
        }
    }
    return $count;
}

/** @param list<array<string, mixed>> $events */
function world_events_digest_lines(array $events): string
{
    $lines = [];
    foreach ($events as $event) {
        $described = WorldEvents::describe($event);
        $where = $described['system'] === null
            ? 'Galaxie ' . $described['galaxy']
            : 'System ' . $described['galaxy'] . ':' . $described['system'];
        $effects = [];
        foreach ($described['modifiers'] as $key => $value) {
            $effects[] = ['production' => 'Produktion', 'price' => 'Preis', 'demand' => 'Nachfrage'][$key]
                . ' ' . ($value >= 1 ? '+' : '') . round(((float)$value - 1) * 100) . ' %';
        }
        $lines[] = '- ' . $described['label'] . ' (' . $where . ', '
            . ($described['good_type'] === null ? 'alle Waren' : str_replace('_', ' ', $described['good_type']))
            . '): ' . implode(', ', $effects) . ', bis ' . gmdate('d.m.Y H:i', $described['ends_at']) . ' UTC';
    }
    return implode("\n", $lines);
}
