<?php

declare(strict_types=1);

// Transactional mail outbox. Rows are enqueued in the same transaction as the
// game event that causes them and delivered later by mail_outbox_flush(), so a
// mail failure can never roll back game state. Callers load lib/Mailer.php first.

const MAIL_OUTBOX_SETTINGS_HINT = 'Du erhältst diese E-Mail, weil E-Mail-Benachrichtigungen in deinem Konto '
    . 'aktiv sind. Abmelden: im Spiel im Kommandanten-Menü „E-Mail-Benachrichtigungen umschalten“ wählen.';

/**
 * Recipient eligibility. NPC/engine actors and disabled or deleted accounts are
 * never mailed; opted-out users and invalid addresses are recorded as skipped.
 *
 * @return 'eligible'|'skip'|'never'
 */
function mail_outbox_recipient_status(PDO $db, int $userId): string
{
    $stmt = $db->prepare(
        'SELECT email, control_type, auth_enabled, deleted_at, email_notifications FROM users WHERE id = ?'
    );
    $stmt->execute([$userId]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    if (
        !$user || $user['control_type'] !== 'human' || (int)$user['auth_enabled'] !== 1
        || $user['deleted_at'] !== null
    ) {
        return 'never';
    }
    if ((int)$user['email_notifications'] !== 1 || !mailer_valid_address((string)$user['email'])) {
        return 'skip';
    }
    return 'eligible';
}

/**
 * Idempotent enqueue keyed by $dedupeKey. Returns true only when a new row
 * (pending or skipped) was written.
 */
function mail_outbox_enqueue(
    PDO $db,
    int $userId,
    string $kind,
    string $dedupeKey,
    string $subject,
    string $body,
    int $now
): bool {
    $recipient = mail_outbox_recipient_status($db, $userId);
    if ($recipient === 'never') {
        return false;
    }
    $insert = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
    $stmt = $db->prepare(
        "$insert INTO mail_outbox (user_id, kind, dedupe_key, subject, body_text, status, attempts, next_attempt_at, "
            . 'last_error) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)'
    );
    $stmt->execute([
        $userId, $kind, $dedupeKey, $subject, $body,
        $recipient === 'eligible' ? 'pending' : 'skipped', $now,
        $recipient === 'eligible' ? null : 'recipient_opted_out_or_invalid',
    ]);
    return $stmt->rowCount() === 1;
}

function mail_outbox_backoff_seconds(int $attempts): int
{
    return (int)min(21600, 300 * 2 ** max(0, $attempts - 1));
}

/**
 * Deliver up to $batch due rows. Each row is claimed and finalized with its own
 * autocommitted statement; transport errors only change that row's status.
 *
 * @param (callable(string, string, string, ?string): ?string)|null $transport fn(to, subject, text, html) => error|null
 * @return array{processed: bool, sent: int, retried: int, failed: int, skipped: int}
 */
function mail_outbox_flush(PDO $db, int $now, int $batch, int $maxAttempts, ?callable $transport): array
{
    $stats = ['processed' => true, 'sent' => 0, 'retried' => 0, 'failed' => 0, 'skipped' => 0];
    $due = $db->prepare(
        "SELECT id FROM mail_outbox WHERE status = 'pending' AND next_attempt_at <= ? "
            . 'ORDER BY next_attempt_at, id LIMIT ' . max(1, $batch)
    );
    $due->execute([$now]);
    $ids = array_map('intval', $due->fetchAll(PDO::FETCH_COLUMN));
    $finish = $db->prepare(
        'UPDATE mail_outbox SET status = ?, next_attempt_at = ?, last_error = ?, '
            . "sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END WHERE id = ?"
    );
    foreach ($ids as $id) {
        // Claim with a lease so a concurrent flusher cannot send the same row.
        $claim = $db->prepare(
            "UPDATE mail_outbox SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ? AND status = 'pending' "
                . 'AND next_attempt_at <= ?'
        );
        $claim->execute([$now + 600, $id, $now]);
        if ($claim->rowCount() !== 1) {
            continue;
        }
        $row = $db->prepare(
            'SELECT o.user_id, o.subject, o.body_text, o.body_html, o.attempts, u.email FROM mail_outbox o '
                . 'JOIN users u ON u.id = o.user_id WHERE o.id = ?'
        );
        $row->execute([$id]);
        $mail = $row->fetch(PDO::FETCH_ASSOC);
        if (!$mail || mail_outbox_recipient_status($db, (int)$mail['user_id']) !== 'eligible') {
            $finish->execute(['skipped', $now, 'recipient_opted_out_or_invalid', 'skipped', $id]);
            $stats['skipped']++;
            continue;
        }
        if ($transport === null) {
            $finish->execute(['skipped', $now, 'mail_transport_not_configured', 'skipped', $id]);
            $stats['skipped']++;
            continue;
        }
        try {
            $error = $transport((string)$mail['email'], (string)$mail['subject'], (string)$mail['body_text'], $mail['body_html']);
        } catch (RuntimeException | InvalidArgumentException | JsonException $exception) {
            $error = get_class($exception);
        }
        if ($error === null) {
            $finish->execute(['sent', $now, null, 'sent', $id]);
            $stats['sent']++;
            continue;
        }
        $attempts = (int)$mail['attempts'];
        $error = substr($error, 0, 255);
        if ($attempts >= $maxAttempts) {
            $finish->execute(['failed', $now, $error, 'failed', $id]);
            $stats['failed']++;
        } else {
            $finish->execute(['pending', $now + mail_outbox_backoff_seconds($attempts), $error, 'pending', $id]);
            $stats['retried']++;
        }
    }
    if ($transport === null && $stats['skipped'] > 0) {
        error_log('[mail_outbox] transport_not_configured skipped=' . $stats['skipped']);
    }
    return $stats;
}

/**
 * Global-tick adapter: never throws for mail problems, reports instead.
 *
 * @return array<string, mixed>
 */
function mail_outbox_tick_global(PDO $db, ?int $now = null): array
{
    $now ??= time();
    try {
        return mail_outbox_flush(
            $db,
            $now,
            max(1, (int)MAIL_OUTBOX_BATCH),
            max(1, (int)MAIL_OUTBOX_MAX_ATTEMPTS),
            mailer_default_transport()
        );
    } catch (PDOException $error) {
        if (str_contains($error->getMessage(), 'mail_outbox') || $error->getCode() === '42S02') {
            return ['processed' => false, 'reason' => 'outbox_unavailable'];
        }
        throw $error;
    }
}
