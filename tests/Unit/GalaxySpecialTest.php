<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/GalaxyNewsWriter.php';
require_once __DIR__ . '/../../lib/GalaxySpecialDetector.php';

final class GalaxySpecialTest extends TestCase
{
    private function db(): PDO
    {
        $db = new PDO('sqlite::memory:');
        $db->exec("CREATE TABLE wars (id INTEGER PRIMARY KEY, attacker_user_id INT, defender_user_id INT, status TEXT)");
        $db->exec('CREATE TABLE economy_market_prices (id INTEGER PRIMARY KEY, good_type TEXT, price_mult REAL)');
        return $db;
    }

    public function testNothingTriggersBelowThresholds(): void
    {
        $db = $this->db();
        $db->exec("INSERT INTO wars (attacker_user_id, defender_user_id, status) VALUES (1,2,'active')");
        $db->exec("INSERT INTO economy_market_prices (good_type, price_mult) VALUES ('iron',0.3),('gold',1.0)");
        self::assertSame([], GalaxySpecialDetector::detect($db, ['war_min_players' => 50, 'crash_min_goods' => 5]));
    }

    public function testWarWithManyPlayersTriggers(): void
    {
        $db = $this->db();
        for ($i = 1; $i <= 6; $i += 2) {
            $db->exec("INSERT INTO wars (attacker_user_id, defender_user_id, status) VALUES ($i," . ($i + 1) . ",'active')");
        }
        $db->exec("INSERT INTO wars (attacker_user_id, defender_user_id, status) VALUES (90,91,'ended')");
        $specials = GalaxySpecialDetector::detect($db, ['war_min_players' => 6]);
        self::assertSame('war', $specials[0]['type']);
        self::assertStringContainsString('Beteiligte Spieler: 6', $specials[0]['facts']);
    }

    public function testCrashNeedsEnoughCrashedGoods(): void
    {
        $db = $this->db();
        foreach (['a', 'b', 'c'] as $good) {
            $db->exec("INSERT INTO economy_market_prices (good_type, price_mult) VALUES ('$good',0.4)");
        }
        self::assertSame([], GalaxySpecialDetector::detect($db, ['crash_min_goods' => 4]));
        $specials = GalaxySpecialDetector::detect($db, ['crash_min_goods' => 3, 'crash_price_mult' => 0.5]);
        self::assertSame('crash', $specials[0]['type']);
    }

    public function testSpecialLinesLimitedToThree(): void
    {
        $line = 'Dies ist eine ausreichend lange Sondermeldung.';
        self::assertCount(3, GalaxyNewsWriter::parseLines(json_encode(['lines' => [$line, $line, $line]]), 2000, 3));
        $this->expectException(UnexpectedValueException::class);
        GalaxyNewsWriter::parseLines(json_encode(['lines' => [$line, $line, $line, $line]]), 2000, 3);
    }
}
