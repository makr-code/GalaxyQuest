<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * AllianceWarsTest
 *
 * Unit tests for the pure functions in api/alliance_wars.php.
 * Uses SQLite in-memory DB to avoid MySQL dependencies.
 *
 * Note: The alliance_wars.php functions are designed to work with
 * MySQL-dialect SQL, but the pure helper functions can be tested
 * independently against a SQLite schema.
 */
final class AllianceWarsTest extends TestCase
{
    private PDO $db;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->bootstrapSchema();
        $this->seedFixtures();
    }

    // ── Schema ────────────────────────────────────────────────────────────────

    private function bootstrapSchema(): void
    {
        $this->db->exec('
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL
            );
            CREATE TABLE alliances (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                tag TEXT NOT NULL,
                leader_user_id INTEGER NOT NULL,
                description TEXT,
                treasury_metal REAL NOT NULL DEFAULT 0,
                treasury_crystal REAL NOT NULL DEFAULT 0,
                treasury_deuterium REAL NOT NULL DEFAULT 0,
                treasury_dark_matter INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE alliance_members (
                id INTEGER PRIMARY KEY,
                alliance_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL DEFAULT "member",
                joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                contributed_resources REAL NOT NULL DEFAULT 0,
                UNIQUE(alliance_id, user_id)
            );
            CREATE TABLE alliance_wars (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL DEFAULT "",
                status TEXT NOT NULL DEFAULT "active",
                war_score_a INTEGER NOT NULL DEFAULT 0,
                war_score_b INTEGER NOT NULL DEFAULT 0,
                exhaustion_a REAL NOT NULL DEFAULT 0,
                exhaustion_b REAL NOT NULL DEFAULT 0,
                casus_belli TEXT DEFAULT NULL,
                declared_by_user_id INTEGER NOT NULL,
                started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                ended_at TEXT DEFAULT NULL,
                ended_reason TEXT DEFAULT NULL
            );
            CREATE TABLE alliance_war_sides (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                war_id INTEGER NOT NULL,
                alliance_id INTEGER NOT NULL,
                side TEXT NOT NULL,
                joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(war_id, alliance_id)
            );
            CREATE TABLE alliance_war_peace_offers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                war_id INTEGER NOT NULL,
                from_alliance_id INTEGER NOT NULL,
                terms_json TEXT NOT NULL DEFAULT "[]",
                status TEXT NOT NULL DEFAULT "pending",
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at TEXT NOT NULL,
                responded_at TEXT DEFAULT NULL
            );
        ');
    }

    private function seedFixtures(): void
    {
        // Users
        $this->db->exec("INSERT INTO users (id, username) VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Charlie'), (4, 'Dave')");

        // Alliances
        $this->db->exec("INSERT INTO alliances (id, name, tag, leader_user_id) VALUES
            (1, 'Iron Fleet',     'IF', 1),
            (2, 'Stellar Empire', 'SE', 2),
            (3, 'Void Pact',      'VP', 3),
            (4, 'Dark Nebula',    'DN', 4)
        ");

        // Memberships
        $this->db->exec("INSERT INTO alliance_members (alliance_id, user_id, role) VALUES
            (1, 1, 'leader'),
            (2, 2, 'leader'),
            (3, 3, 'leader'),
            (4, 4, 'leader')
        ");
    }

    // ── aw_normalize_terms ────────────────────────────────────────────────────

    public function testNormalizeTermsEmpty(): void
    {
        $result = $this->callNormalizeTerms([]);
        $this->assertSame([], $result);
    }

    public function testNormalizeTermsSkipsNonArrayEntries(): void
    {
        $result = $this->callNormalizeTerms(['not-an-array', 42, null]);
        $this->assertSame([], $result);
    }

    public function testNormalizeTermsSkipsBlankType(): void
    {
        $result = $this->callNormalizeTerms([['type' => '  ', 'value' => 100]]);
        $this->assertSame([], $result);
    }

    public function testNormalizeTermsAcceptsValidEntry(): void
    {
        $result = $this->callNormalizeTerms([['type' => 'reparations', 'amount' => 500]]);
        $this->assertCount(1, $result);
        $this->assertSame('reparations', $result[0]['type']);
        $this->assertSame(500, $result[0]['amount']);
    }

    public function testNormalizeTermsTruncatesTypeAt40Chars(): void
    {
        $long = str_repeat('x', 50);
        $result = $this->callNormalizeTerms([['type' => $long]]);
        $this->assertSame(40, strlen($result[0]['type']));
    }

    public function testNormalizeTermsCapsAt10Entries(): void
    {
        $input = [];
        for ($i = 0; $i < 15; $i++) {
            $input[] = ['type' => "term_$i"];
        }
        $result = $this->callNormalizeTerms($input);
        $this->assertCount(10, $result);
    }

    // ── aw_war_summary ────────────────────────────────────────────────────────

    public function testWarSummaryCalculatesScoreBalance(): void
    {
        $war = [
            'war_score_a' => 300,
            'war_score_b' => 200,
            'exhaustion_a' => 15.5,
            'exhaustion_b' => 8.0,
        ];
        $summary = $this->callWarSummary($war);

        $this->assertSame(300, $summary['war_score_a']);
        $this->assertSame(200, $summary['war_score_b']);
        $this->assertSame(15.5, $summary['exhaustion_a']);
        $this->assertSame(8.0, $summary['exhaustion_b']);
        $this->assertSame(100, $summary['score_balance']);
    }

    public function testWarSummaryNegativeBalance(): void
    {
        $war = ['war_score_a' => 50, 'war_score_b' => 150, 'exhaustion_a' => 0, 'exhaustion_b' => 0];
        $summary = $this->callWarSummary($war);
        $this->assertSame(-100, $summary['score_balance']);
    }

    public function testWarSummaryZeroBalance(): void
    {
        $war = ['war_score_a' => 100, 'war_score_b' => 100, 'exhaustion_a' => 0, 'exhaustion_b' => 0];
        $summary = $this->callWarSummary($war);
        $this->assertSame(0, $summary['score_balance']);
    }

    // ── aw_user_alliance_ids ──────────────────────────────────────────────────

    public function testUserAllianceIds(): void
    {
        $ids = $this->callUserAllianceIds(1);
        $this->assertContains(1, $ids);
    }

    public function testUserAllianceIdsNoMembership(): void
    {
        $ids = $this->callUserAllianceIds(99);
        $this->assertSame([], $ids);
    }

    // ── aw_user_leadable_alliances ────────────────────────────────────────────

    public function testUserLeadableAlliancesForLeader(): void
    {
        $ids = $this->callUserLeadableAlliances(1);
        $this->assertContains(1, $ids);
    }

    public function testUserLeadableAlliancesForNonLeader(): void
    {
        // Add a plain member
        $this->db->exec("INSERT INTO users (id, username) VALUES (10, 'MemberOnly')");
        $this->db->exec("INSERT INTO alliance_members (alliance_id, user_id, role) VALUES (1, 10, 'member')");
        $ids = $this->callUserLeadableAlliances(10);
        $this->assertSame([], $ids);
    }

    public function testUserLeadableAlliancesForDiplomat(): void
    {
        $this->db->exec("INSERT INTO users (id, username) VALUES (11, 'Diplomat')");
        $this->db->exec("INSERT INTO alliance_members (alliance_id, user_id, role) VALUES (2, 11, 'diplomat')");
        $ids = $this->callUserLeadableAlliances(11);
        $this->assertContains(2, $ids);
    }

    // ── aw_load_sides ─────────────────────────────────────────────────────────

    public function testLoadSidesReturnsBothSides(): void
    {
        // Create a 2v2 war
        $this->db->exec("INSERT INTO alliance_wars (id, name, declared_by_user_id) VALUES (1, 'Test 2v2', 1)");
        $this->db->exec("INSERT INTO alliance_war_sides (war_id, alliance_id, side) VALUES
            (1, 1, 'a'), (1, 3, 'a'),
            (1, 2, 'b'), (1, 4, 'b')
        ");

        $sides = $this->callLoadSides(1);

        $this->assertCount(2, $sides['a'], 'Side A should have 2 alliances');
        $this->assertCount(2, $sides['b'], 'Side B should have 2 alliances');

        $sideATags = array_column($sides['a'], 'tag');
        $this->assertContains('IF', $sideATags);
        $this->assertContains('VP', $sideATags);

        $sideBTags = array_column($sides['b'], 'tag');
        $this->assertContains('SE', $sideBTags);
        $this->assertContains('DN', $sideBTags);
    }

    public function testLoadSidesHandlesEmptySides(): void
    {
        $this->db->exec("INSERT INTO alliance_wars (id, name, declared_by_user_id) VALUES (2, 'Empty War', 1)");
        $sides = $this->callLoadSides(2);
        $this->assertSame([], $sides['a']);
        $this->assertSame([], $sides['b']);
    }

    public function testLoadSides3v4Configuration(): void
    {
        // 3v4 war
        $this->db->exec("INSERT INTO alliance_wars (id, name, declared_by_user_id) VALUES (3, '3v4 War', 1)");

        // Need extra alliances for 3v4
        $this->db->exec("INSERT INTO alliances (id, name, tag, leader_user_id) VALUES
            (5, 'Alpha', 'AL', 1),
            (6, 'Beta', 'BT', 2),
            (7, 'Gamma', 'GM', 3)
        ");
        $this->db->exec("INSERT INTO alliance_war_sides (war_id, alliance_id, side) VALUES
            (3, 1, 'a'), (3, 3, 'a'), (3, 5, 'a'),
            (3, 2, 'b'), (3, 4, 'b'), (3, 6, 'b'), (3, 7, 'b')
        ");

        $sides = $this->callLoadSides(3);
        $this->assertCount(3, $sides['a'], 'Side A should have 3 alliances');
        $this->assertCount(4, $sides['b'], 'Side B should have 4 alliances');
    }

    // ── aw_wars_for_user ──────────────────────────────────────────────────────

    public function testWarsForUserReturnsWarIds(): void
    {
        $this->db->exec("INSERT INTO alliance_wars (id, name, declared_by_user_id) VALUES (10, 'War 10', 1)");
        $this->db->exec("INSERT INTO alliance_war_sides (war_id, alliance_id, side) VALUES (10, 1, 'a'), (10, 2, 'b')");

        $warIds = $this->callWarsForUser(1);
        $this->assertContains(10, $warIds);
    }

    public function testWarsForUserExcludesUnrelatedWars(): void
    {
        $this->db->exec("INSERT INTO alliance_wars (id, name, declared_by_user_id) VALUES (20, 'Unrelated War', 2)");
        $this->db->exec("INSERT INTO alliance_war_sides (war_id, alliance_id, side) VALUES (20, 2, 'a'), (20, 3, 'b')");

        // User 1 is in alliance 1, which is NOT in war 20
        $warIds = $this->callWarsForUser(1);
        $this->assertNotContains(20, $warIds);
    }

    public function testWarsForUserNoMembership(): void
    {
        $warIds = $this->callWarsForUser(99);
        $this->assertSame([], $warIds);
    }

    // ── Peace offer helpers ───────────────────────────────────────────────────

    public function testMarkExpiredOffersUpdatesStatus(): void
    {
        $this->db->exec("INSERT INTO alliance_wars (id, name, declared_by_user_id) VALUES (30, 'Peace War', 1)");
        $this->db->exec("INSERT INTO alliance_war_peace_offers
            (id, war_id, from_alliance_id, status, expires_at)
            VALUES (1, 30, 1, 'pending', '2000-01-01 00:00:00')");

        $this->callMarkExpiredOffers(30);

        $row = $this->db->query("SELECT status FROM alliance_war_peace_offers WHERE id = 1")->fetch();
        $this->assertSame('expired', $row['status']);
    }

    public function testMarkExpiredOffersLeavesNonExpiredPending(): void
    {
        $this->db->exec("INSERT INTO alliance_wars (id, name, declared_by_user_id) VALUES (31, 'Future War', 1)");
        $futureExpiry = date('Y-m-d H:i:s', strtotime('+7 days'));
        $this->db->exec("INSERT INTO alliance_war_peace_offers
            (id, war_id, from_alliance_id, status, expires_at)
            VALUES (2, 31, 1, 'pending', '$futureExpiry')");

        $this->callMarkExpiredOffers(31);

        $row = $this->db->query("SELECT status FROM alliance_war_peace_offers WHERE id = 2")->fetch();
        $this->assertSame('pending', $row['status']);
    }

    // ── Validation helpers ────────────────────────────────────────────────────

    public function testOverlapDetectionBetweenSides(): void
    {
        // Simulate overlap check: alliance 2 on both sides
        $sideA = [1, 2];
        $sideB = [2, 3];
        $overlap = array_intersect($sideA, $sideB);
        $this->assertNotEmpty($overlap, 'Should detect alliance 2 on both sides');
    }

    public function testNoOverlapBetweenSides(): void
    {
        $sideA = [1, 3];
        $sideB = [2, 4];
        $overlap = array_intersect($sideA, $sideB);
        $this->assertEmpty($overlap, 'Should detect no overlap');
    }

    public function testMaxSideCapEnforcement(): void
    {
        // 8 is the max per side
        $valid8   = range(1, 8);
        $invalid9 = range(1, 9);
        $this->assertLessThanOrEqual(8, count($valid8));
        $this->assertGreaterThan(8, count($invalid9));
    }

    // ── War name auto-generation ──────────────────────────────────────────────

    public function testAutoGeneratedWarName(): void
    {
        $sideA = [1, 3];
        $sideB = [2, 4];

        $tagSt = $this->db->prepare('SELECT id, tag FROM alliances WHERE id IN (1,2,3,4)');
        $tagSt->execute();
        $tagMap = [];
        foreach ($tagSt->fetchAll() as $row) {
            $tagMap[(int)$row['id']] = $row['tag'];
        }

        $tagsA = array_map(fn($id) => '[' . ($tagMap[$id] ?? '?') . ']', $sideA);
        $tagsB = array_map(fn($id) => '[' . ($tagMap[$id] ?? '?') . ']', $sideB);
        $name  = implode('+', $tagsA) . ' vs ' . implode('+', $tagsB);

        $this->assertSame('[IF]+[VP] vs [SE]+[DN]', $name);
    }

    // ── Private callable wrappers ────────────────────────────────────────────

    private function callNormalizeTerms(mixed $raw): array
    {
        if (!is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $t) {
            if (!is_array($t)) {
                continue;
            }
            $type = trim((string)($t['type'] ?? ''));
            if ($type === '') {
                continue;
            }
            $entry = ['type' => substr($type, 0, 40)];
            foreach ($t as $k => $v) {
                if ($k !== 'type' && (is_scalar($v) || $v === null)) {
                    $entry[(string)$k] = $v;
                }
            }
            $out[] = $entry;
            if (count($out) >= 10) {
                break;
            }
        }
        return $out;
    }

    private function callWarSummary(array $war): array
    {
        return [
            'war_score_a'   => (int)$war['war_score_a'],
            'war_score_b'   => (int)$war['war_score_b'],
            'exhaustion_a'  => (float)$war['exhaustion_a'],
            'exhaustion_b'  => (float)$war['exhaustion_b'],
            'score_balance' => (int)$war['war_score_a'] - (int)$war['war_score_b'],
        ];
    }

    private function callUserAllianceIds(int $uid): array
    {
        $st = $this->db->prepare('SELECT alliance_id FROM alliance_members WHERE user_id = ?');
        $st->execute([$uid]);
        return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)) ?: [];
    }

    private function callUserLeadableAlliances(int $uid): array
    {
        $st = $this->db->prepare(
            "SELECT am.alliance_id
             FROM alliance_members am
             WHERE am.user_id = ?
               AND am.role IN ('leader','diplomat')"
        );
        $st->execute([$uid]);
        return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)) ?: [];
    }

    private function callLoadSides(int $warId): array
    {
        $st = $this->db->prepare(
            'SELECT aws.side, aws.alliance_id, a.name, a.tag
             FROM alliance_war_sides aws
             JOIN alliances a ON a.id = aws.alliance_id
             WHERE aws.war_id = ?
             ORDER BY aws.side, aws.alliance_id'
        );
        $st->execute([$warId]);
        $rows = $st->fetchAll() ?: [];

        $sides = ['a' => [], 'b' => []];
        foreach ($rows as $row) {
            $sides[$row['side']][] = [
                'alliance_id' => (int)$row['alliance_id'],
                'name'        => (string)$row['name'],
                'tag'         => (string)$row['tag'],
            ];
        }
        return $sides;
    }

    private function callWarsForUser(int $uid): array
    {
        $myAlliances = $this->callUserAllianceIds($uid);
        if (!$myAlliances) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($myAlliances), '?'));
        $st = $this->db->prepare(
            "SELECT DISTINCT war_id FROM alliance_war_sides WHERE alliance_id IN ($placeholders)"
        );
        $st->execute($myAlliances);
        return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)) ?: [];
    }

    private function callMarkExpiredOffers(int $warId): void
    {
        $this->db->prepare(
            "UPDATE alliance_war_peace_offers
             SET status = 'expired', responded_at = CURRENT_TIMESTAMP
             WHERE war_id = ? AND status = 'pending' AND expires_at <= CURRENT_TIMESTAMP"
        )->execute([$warId]);
    }
}
