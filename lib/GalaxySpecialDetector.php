<?php

declare(strict_types=1);

/**
 * Detects the rare situations that justify a "Sondernachrichten" post: large interstellar wars
 * and market crashes affecting many players. Evaluated on demand (cron/CLI), never by a game tick.
 * Thresholds are deliberately high; each type yields at most one special per UTC day.
 */
final class GalaxySpecialDetector
{
    /**
     * @param array{war_min_players?:int,crash_min_goods?:int,crash_price_mult?:float} $limits
     * @return list<array{type:string,title:string,facts:string}>
     */
    public static function detect(PDO $db, array $limits = []): array
    {
        $specials = [];
        $war = self::warSpecial($db, max(2, (int)($limits['war_min_players'] ?? 50)));
        if ($war !== null) {
            $specials[] = $war;
        }
        $crash = self::crashSpecial(
            $db,
            max(2, (int)($limits['crash_min_goods'] ?? 5)),
            min(0.95, max(0.05, (float)($limits['crash_price_mult'] ?? 0.5)))
        );
        if ($crash !== null) {
            $specials[] = $crash;
        }
        return $specials;
    }

    /** @return array{type:string,title:string,facts:string}|null */
    public static function warSpecial(PDO $db, int $minPlayers): ?array
    {
        $row = $db->query(
            "SELECT COUNT(*) AS wars,
                    (SELECT COUNT(DISTINCT u) FROM (
                        SELECT attacker_user_id AS u FROM wars WHERE status = 'active'
                        UNION SELECT defender_user_id FROM wars WHERE status = 'active') p) AS players
             FROM wars WHERE status = 'active'"
        )->fetch(PDO::FETCH_ASSOC);
        $wars = (int)($row['wars'] ?? 0);
        $players = (int)($row['players'] ?? 0);
        if ($players < $minPlayers) {
            return null;
        }
        return [
            'type' => 'war',
            'title' => 'Sondernachrichten: Interstellarer Krieg erschüttert die Galaxie',
            'facts' => "Aktive Kriege: $wars. Beteiligte Spieler: $players.",
        ];
    }

    /** @return array{type:string,title:string,facts:string}|null */
    public static function crashSpecial(PDO $db, int $minGoods, float $maxMult): ?array
    {
        $stmt = $db->prepare('SELECT good_type, price_mult FROM economy_market_prices WHERE price_mult <= ? ORDER BY price_mult LIMIT 20');
        $stmt->execute([$maxMult]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if (count($rows) < $minGoods) {
            return null;
        }
        $goods = implode(', ', array_map(
            static fn(array $r): string => sprintf('%s (Preisfaktor %.2f)', $r['good_type'], (float)$r['price_mult']),
            $rows
        ));
        return [
            'type' => 'crash',
            'title' => 'Sondernachrichten: Börsencrash an den Galaxiemärkten',
            'facts' => sprintf('%d Handelsgüter sind auf höchstens %.0f%% ihres Normalpreises gefallen: %s.', count($rows), $maxMult * 100, $goods),
        ];
    }

    /** @param array{type:string,title:string,facts:string} $special */
    public static function messages(array $special, string $date): array
    {
        return [
            ['role' => 'system', 'content' =>
                'Du bist Chefsprecher von Galaxy News Radio und verliest eine Sondermeldung auf Deutsch. '
                . 'Formuliere eine bis drei kurze, dringliche, sachliche Sprecherzeilen ohne Markdown, Emojis '
                . 'oder Klammern. Erfinde keine Fakten, Namen oder Zahlen, die nicht in den Fakten stehen. '
                . 'Antworte ausschließlich mit JSON der Form {"lines":["..."]}; jede Zeile höchstens '
                . GalaxyNewsWriter::MAX_LINE_CHARS . ' Zeichen.'],
            ['role' => 'user', 'content' => 'Datum: ' . GalaxyNewsWriter::germanDate($date)
                . "\nLage: {$special['title']}\nFakten: {$special['facts']}"],
        ];
    }
}
