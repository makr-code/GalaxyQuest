<?php

declare(strict_types=1);

/**
 * Turns the day's public game notices into short broadcast-style news lines.
 * The LLM only rephrases supplied facts; its answer is strictly validated before use.
 */
final class GalaxyNewsWriter
{
    public const MAX_LINES = 6;
    public const MIN_LINE_CHARS = 10;
    public const MAX_LINE_CHARS = 300;
    public const SPECIAL_INTRO = 'Sondermeldung von Galaxy News Radio.';
    public const INTRO = 'Hier ist Galaxy News Radio. Die Meldungen des Tages.';

    /** @return list<array{kind:string,title:string,text:string}> */
    public static function itemsForDay(PDO $db, string $date): array
    {
        if (!self::validDate($date)) {
            throw new InvalidArgumentException('Ungültiges Datum.');
        }
        $from = $date . ' 00:00:00';
        $to = (new DateTimeImmutable($date, new DateTimeZone('UTC')))->modify('+1 day')->format('Y-m-d') . ' 00:00:00';
        $items = [];
        $stmt = $db->prepare(
            'SELECT title, message FROM server_announcements
             WHERE withdrawn_at IS NULL AND published_at >= ? AND published_at < ? ORDER BY id LIMIT 20'
        );
        $stmt->execute([$from, $to]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $items[] = ['kind' => 'Serverankündigung', 'title' => (string)$row['title'],
                'text' => mb_substr((string)$row['message'], 0, 600)];
        }
        $stmt = $db->prepare(
            'SELECT event_type, description, affected_scope FROM galactic_events
             WHERE is_visible = 1 AND starts_at >= ? AND starts_at < ? ORDER BY id LIMIT 20'
        );
        $stmt->execute([$from, $to]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $items[] = ['kind' => 'Galaktisches Ereignis (' . $row['affected_scope'] . ')',
                'title' => (string)$row['event_type'], 'text' => mb_substr((string)$row['description'], 0, 600)];
        }
        return $items;
    }

    /** @param list<array{kind:string,title:string,text:string}> $items */
    public static function messages(array $items, string $date): array
    {
        $facts = '';
        foreach ($items as $index => $item) {
            $facts .= sprintf("%d. [%s] %s: %s\n", $index + 1, $item['kind'], $item['title'], $item['text']);
        }
        return [
            ['role' => 'system', 'content' =>
                'Du bist Nachrichtensprecher des Senders Galaxy News Radio. Formuliere aus den gelieferten '
                . 'Mitteilungen kurze, sachliche Sprecherzeilen auf Deutsch, wie sie im Fernsehen oder Rundfunk '
                . 'gesprochen werden: ganze Sätze, ohne Aufzählungszeichen, Markdown, Emojis oder Klammern. '
                . 'Erfinde keine Fakten, Namen oder Zahlen, die nicht in den Mitteilungen stehen; '
                . 'nenne das Datum nur, wenn es angegeben ist, und exakt so. '
                . 'Antworte ausschließlich mit JSON der Form {"lines":["...","..."]} mit höchstens '
                . self::MAX_LINES . ' Zeilen; jede Zeile höchstens ' . self::MAX_LINE_CHARS . ' Zeichen.'],
            ['role' => 'user', 'content' => 'Datum: ' . self::germanDate($date) . "\nMitteilungen:\n$facts"],
        ];
    }

    public static function germanDate(string $date): string
    {
        $days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
        $parsed = new DateTimeImmutable($date, new DateTimeZone('UTC'));
        return $days[(int)$parsed->format('w')] . ', ' . $parsed->format('d.m.Y');
    }

    /** @return list<string> */
    public static function parseLines(string $answer, int $maxScriptChars = 2000, int $maxLines = self::MAX_LINES): array
    {
        $json = trim(preg_replace('/^```(?:json)?\s*|\s*```$/i', '', trim($answer)) ?? '');
        try {
            $data = json_decode($json, true, 8, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new UnexpectedValueException('Die LLM-Antwort ist kein gültiges JSON.', 0, $error);
        }
        $lines = is_array($data) ? ($data['lines'] ?? null) : null;
        if (!is_array($lines) || !array_is_list($lines) || $lines === [] || count($lines) > $maxLines) {
            throw new UnexpectedValueException('Die LLM-Antwort enthält keine gültige Zeilenliste.');
        }
        $clean = [];
        foreach ($lines as $line) {
            if (!is_string($line)) {
                throw new UnexpectedValueException('Die LLM-Zeile ist kein Text.');
            }
            $line = trim(preg_replace('/\s+/u', ' ', $line) ?? '');
            $length = mb_strlen($line);
            if ($length < self::MIN_LINE_CHARS || $length > self::MAX_LINE_CHARS
                || $line !== strip_tags($line) || preg_match('/[\x00-\x1f*_`#\[\]{}<>]/u', $line)) {
                throw new UnexpectedValueException('Die LLM-Zeile ist ungültig.');
            }
            $clean[] = $line;
        }
        if (mb_strlen(self::script($clean)) > $maxScriptChars) {
            throw new UnexpectedValueException('Die Sendung überschreitet das Sprachlimit.');
        }
        return $clean;
    }

    /** @param list<string> $lines */
    public static function script(array $lines, string $intro = self::INTRO): string
    {
        return $intro . ' ' . implode(' ', $lines);
    }

    public static function validDate(string $date): bool
    {
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date, new DateTimeZone('UTC'));
        return $parsed !== false && $parsed->format('Y-m-d') === $date;
    }
}
