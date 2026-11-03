<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class EmpireReadSideEffectsTest extends TestCase
{
    public function testEmpireScoreCalculationReturnsCurrentScoresWithoutPersisting(): void
    {
        require_once __DIR__ . '/../../scripts/project_user_overview.php';

        $db = new \PDO('sqlite::memory:');
        $db->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
        $db->setAttribute(\PDO::ATTR_DEFAULT_FETCH_MODE, \PDO::FETCH_ASSOC);
        $db->exec('
            CREATE TABLE colonies (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                colony_type TEXT DEFAULT "balanced",
                metal REAL DEFAULT 0,
                crystal REAL DEFAULT 0,
                deuterium REAL DEFAULT 0,
                population INTEGER DEFAULT 0,
                energy_balance INTEGER DEFAULT 0
            );
            CREATE TABLE fleets (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                ships_json TEXT DEFAULT "{}",
                "returning" INTEGER DEFAULT 0
            );
            CREATE TABLE diplomacy (id INTEGER PRIMARY KEY, user_id INTEGER, standing INTEGER DEFAULT 0);
            CREATE TABLE espionage_agents (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                skill_level INTEGER DEFAULT 1,
                status TEXT DEFAULT "idle"
            );
            CREATE TABLE empire_category_scores (
                user_id INTEGER PRIMARY KEY,
                score_economy INTEGER,
                score_military INTEGER,
                score_research INTEGER,
                score_growth INTEGER,
                score_stability INTEGER,
                score_diplomacy INTEGER,
                score_espionage INTEGER,
                total_score INTEGER,
                calculated_at TEXT
            );
            INSERT INTO colonies (user_id, metal, crystal, deuterium, population)
            VALUES (7, 1000, 1000, 1000, 500);
        ');

        $scores = \calc_empire_scores($db, 7);

        self::assertSame(15, $scores['economy']);
        self::assertSame(5, $scores['growth']);
        self::assertSame(
            $scores['economy'] + $scores['military'] + $scores['research'] + $scores['growth']
                + $scores['stability'] + $scores['diplomacy'] + $scores['espionage'],
            $scores['total']
        );
        self::assertSame(0, (int) $db->query('SELECT COUNT(*) FROM empire_category_scores')->fetchColumn());
    }

    public function testEmpireGetActionsUsePureCalculationInsteadOfPersistenceHelper(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/empire.php');
        self::assertIsString($source);

        self::assertSame(2, substr_count($source, 'calc_empire_scores($db, $uid)'));
        self::assertStringNotContainsString('calc_and_store_empire_scores(', $source);
    }
}
