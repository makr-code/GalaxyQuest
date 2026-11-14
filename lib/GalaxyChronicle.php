<?php

declare(strict_types=1);

/**
 * Collects chronicle-worthy game facts with stable IDs. Deliberately anonymous: no player
 * names or ids leave the game. Deterministic text, no LLM.
 */
final class GalaxyChronicle
{
    /** @return list<array{slug:string,title:string,summary:string,date:string}> */
    public static function entries(PDO $db, int $limit = 50): array
    {
        $limit = max(1, min(200, $limit));
        $entries = [];
        $rows = $db->query(
            "SELECT id, casus_belli, war_score_att, war_score_def, started_at, ended_at, ended_reason
             FROM wars WHERE status = 'ended' AND ended_at IS NOT NULL ORDER BY id LIMIT $limit"
        )->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $row) {
            $start = substr((string)$row['started_at'], 0, 10);
            $end = substr((string)$row['ended_at'], 0, 10);
            $reason = trim((string)($row['ended_reason'] ?? ''));
            $cause = trim((string)($row['casus_belli'] ?? ''));
            $summary = sprintf('Ein Krieg, begonnen am %s, endete am %s. Kriegspunkte: Angreifer %d, Verteidiger %d.',
                $start, $end, (int)$row['war_score_att'], (int)$row['war_score_def']);
            if ($cause !== '') {
                $summary .= ' Kriegsgrund: ' . self::plain($cause) . '.';
            }
            if ($reason !== '') {
                $summary .= ' Ende: ' . self::plain($reason) . '.';
            }
            $entries[] = ['slug' => 'chronik-krieg-' . (int)$row['id'], 'title' => 'Chronik: Ein Krieg ist beendet',
                'summary' => $summary, 'date' => $end];
        }
        $stmt = $db->prepare(
            "SELECT id, event_type, description, affected_scope, starts_at FROM galactic_events
             WHERE is_visible = 1 AND starts_at <= ? ORDER BY id LIMIT $limit"
        );
        $stmt->execute([gmdate('Y-m-d H:i:s')]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $row) {
            $text = self::plain((string)$row['description']);
            if ($text === '') {
                continue;
            }
            $entries[] = ['slug' => 'chronik-ereignis-' . (int)$row['id'],
                'title' => 'Chronik: ' . self::plain((string)$row['event_type']),
                'summary' => mb_substr($text, 0, 1000) . ' (Bereich: ' . self::plain((string)$row['affected_scope']) . ')',
                'date' => substr((string)$row['starts_at'], 0, 10)];
        }
        return $entries;
    }

    private static function plain(string $value): string
    {
        return trim(preg_replace('/\s+/u', ' ', strip_tags($value)) ?? '');
    }
}
