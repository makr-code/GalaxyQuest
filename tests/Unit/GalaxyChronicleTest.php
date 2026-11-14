<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/GalaxyChronicle.php';
require_once __DIR__ . '/../../lib/WordPressNewsPublisher.php';

final class GalaxyChronicleTest extends TestCase
{
    public function testEntriesAreStableAnonymousAndOnlyFinished(): void
    {
        $db = new PDO('sqlite::memory:');
        $db->exec('CREATE TABLE wars (id INTEGER, attacker_user_id INT, defender_user_id INT, status TEXT, war_score_att INT,
            war_score_def INT, casus_belli TEXT, started_at TEXT, ended_at TEXT, ended_reason TEXT)');
        $db->exec('CREATE TABLE galactic_events (id INTEGER, event_type TEXT, description TEXT, affected_scope TEXT,
            starts_at TEXT, is_visible INT)');
        $db->exec("INSERT INTO wars VALUES (7,111,222,'ended',5,3,'Grenzstreit','2026-01-02 10:00:00','2026-02-03 11:00:00','Frieden')");
        $db->exec("INSERT INTO wars VALUES (8,1,2,'active',0,0,NULL,'2026-03-01 00:00:00',NULL,NULL)");
        $db->exec("INSERT INTO galactic_events VALUES (3,'Supernova','<b>Ein Stern</b> explodiert.','sector','2026-01-05 00:00:00',1)");
        $db->exec("INSERT INTO galactic_events VALUES (4,'Geheim','Versteckt','sector','2026-01-05 00:00:00',0)");
        $entries = GalaxyChronicle::entries($db);
        self::assertSame(['chronik-krieg-7', 'chronik-ereignis-3'], array_column($entries, 'slug'));
        self::assertSame('2026-02-03', $entries[0]['date']);
        self::assertStringNotContainsString('111', $entries[0]['summary']);
        self::assertStringContainsString('Ein Stern explodiert.', $entries[1]['summary']);
    }

    public function testChronicleEntryPayloadCarriesChronologyMeta(): void
    {
        $sent = [];
        $publisher = new WordPressNewsPublisher('http://wp.test/wp-json', 'u', 'p', function (string $m, string $url, array $h, string $body) use (&$sent): array {
            $sent = json_decode($body, true);
            return ['status' => 201, 'body' => json_encode(['id' => 5, 'link' => 'http://wp.test/?p=5', 'status' => 'draft'])];
        });
        $publisher->createChronicleEntry('chronik-krieg-7', 'T', 'Kurz.', '2026-02-03', 'draft', 2, 3);
        self::assertSame('game-event', $sent['meta']['gq_event_origin']);
        self::assertSame('2026-02-03', $sent['meta']['gq_event_date']);
        self::assertSame([3], $sent['tags']);
    }
}
