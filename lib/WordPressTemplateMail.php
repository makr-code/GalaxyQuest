<?php

declare(strict_types=1);

require_once __DIR__ . '/Mailer.php';
require_once __DIR__ . '/mail_outbox.php';

/**
 * Queues one notification from a previously approved WordPress template.
 * The rendered subject and both bodies are persisted; later edits cannot change queued mail.
 */
function mail_template_enqueue(PDO $db, int $userId, array $template, string $requestKey, int $now): bool
{
    if (
        $userId < 1 || !preg_match('/^[a-zA-Z0-9_-]{1,64}$/D', $requestKey)
        || !is_int($template['id'] ?? null) || $template['id'] < 1
        || !is_string($template['revision'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $template['revision'])
        || !is_string($template['subject'] ?? null) || !is_string($template['html'] ?? null)
    ) {
        throw new InvalidArgumentException('Ungültige Vorlagen- oder Auftragsdaten.');
    }
    if (mail_outbox_recipient_status($db, $userId) === 'never') {
        throw new InvalidArgumentException('Empfänger ist nicht berechtigt.');
    }
    $stmt = $db->prepare('SELECT username FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $username = $stmt->fetchColumn();
    if (!is_string($username) || trim($username) === '' || preg_match('/[\r\n]/', $username)) {
        throw new InvalidArgumentException('Ungültiger Benutzername.');
    }
    $subject = str_replace('{{username}}', $username, $template['subject']);
    $parts = preg_split('/(<(?:[^>"\']|"[^"]*"|\'[^\']*\')*>)/u', $template['html'], -1, PREG_SPLIT_DELIM_CAPTURE);
    if ($parts === false) {
        throw new InvalidArgumentException('Ungültiges HTML.');
    }
    foreach ($parts as &$part) {
        if (str_starts_with($part, '<') && str_contains($part, '{{')) {
            throw new InvalidArgumentException('Platzhalter in HTML-Tags sind nicht erlaubt.');
        }
        if (!str_starts_with($part, '<')) {
            $part = str_replace(
                '{{username}}',
                htmlspecialchars($username, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'),
                $part
            );
        }
    }
    unset($part);
    $html = implode('', $parts);
    if (
        trim($subject) === '' || mb_strlen($subject) > 200 || preg_match('/[\r\n]/', $subject)
        || str_contains($subject, '{{') || str_contains($html, '{{')
    ) {
        throw new InvalidArgumentException('Ungültiger Betreff oder unbekannter Platzhalter.');
    }
    $textHtml = preg_replace_callback(
        '/<a\b((?:[^>"\']|"[^"]*"|\'[^\']*\')*)>(.*?)<\/a\s*>/is',
        static function (array $match): string {
            if (
                !preg_match(
                    '/(?:^|\s)href\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))/i',
                    $match[1],
                    $href,
                    PREG_UNMATCHED_AS_NULL
                )
            ) {
                return $match[2];
            }
            return $match[2] . ' (' . ($href[1] ?? $href[2] ?? $href[3]) . ')';
        },
        $html
    );
    if ($textHtml === null) {
        throw new InvalidArgumentException('Ungültiges HTML.');
    }
    $text = html_entity_decode(
        strip_tags(preg_replace('/<\/(?:p|div|li|h[1-6])\s*>|<br\s*\/?>/i', "\n", $textHtml) ?? ''),
        ENT_QUOTES | ENT_HTML5,
        'UTF-8'
    );
    $text = trim($text) . "\n\n" . MAIL_OUTBOX_SETTINGS_HINT;
    $html .= '<p>' . htmlspecialchars(MAIL_OUTBOX_SETTINGS_HINT, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</p>';
    if (strlen($text) > 65535 || strlen($html) > 262144) {
        throw new InvalidArgumentException('Mailvorlage überschreitet die maximale Nachrichtengröße.');
    }
    $status = mail_outbox_recipient_status($db, $userId);
    $stmt = $db->prepare(
        'INSERT INTO mail_outbox (user_id, kind, dedupe_key, subject, body_text, body_html, template_id, '
        . 'template_revision, status, attempts, next_attempt_at, last_error) '
        . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)'
    );
    $dedupeKey = 'wp:' . $userId . ':' . $requestKey;
    try {
        $stmt->execute([$userId, 'wp_template', $dedupeKey, $subject, $text, $html,
            $template['id'], $template['revision'], $status === 'eligible' ? 'pending' : 'skipped', $now,
            $status === 'eligible' ? null : 'recipient_opted_out_or_invalid']);
        return true;
    } catch (PDOException $error) {
        $driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);
        $code = $error->errorInfo[1] ?? null;
        if (($driver === 'mysql' && $code === 1062) || ($driver === 'sqlite' && $code === 19)) {
            $existing = $db->prepare('SELECT 1 FROM mail_outbox WHERE dedupe_key = ?');
            $existing->execute([$dedupeKey]);
            if ($existing->fetchColumn() !== false) {
                return false;
            }
        }
        throw $error;
    }
}
