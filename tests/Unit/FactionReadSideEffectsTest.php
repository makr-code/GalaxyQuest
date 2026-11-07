<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class FactionReadSideEffectsTest extends TestCase
{
    public function testFactionAndQuestListsDoNotWriteSeedRowsDuringGet(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/factions.php');
        self::assertIsString($source);

        $listStart = strpos($source, "case 'list':");
        $governmentStart = strpos($source, "case 'government':", $listStart);
        $questsStart = strpos($source, "case 'quests':");
        $startQuestStart = strpos($source, "case 'start_quest':", $questsStart);

        self::assertNotFalse($listStart);
        self::assertNotFalse($governmentStart);
        self::assertNotFalse($questsStart);
        self::assertNotFalse($startQuestStart);

        $listHandler = substr($source, $listStart, $governmentStart - $listStart);
        $questsHandler = substr($source, $questsStart, $startQuestStart - $questsStart);

        self::assertStringContainsString("only_method('GET')", $listHandler);
        self::assertStringNotContainsString('ensure_diplomacy_rows(', $listHandler);
        self::assertStringContainsString('COALESCE(d.standing, f.base_diplomacy)', $listHandler);
        self::assertStringContainsString("only_method('GET')", $questsHandler);
        self::assertStringNotContainsString('ensure_precursor_beacon_quest_seed(', $questsHandler);
        self::assertStringContainsString('get_standing($db, $uid, $fid)', $questsHandler);
        self::assertStringContainsString('q.active = 1', $questsHandler);

        $startQuestHandler = substr($source, $startQuestStart, strpos($source, "case 'check_quests':", $startQuestStart) - $startQuestStart);
        self::assertStringContainsString("only_method('POST')", $startQuestHandler);
        self::assertStringContainsString('WHERE id = ? AND active = 1', $startQuestHandler);
        self::assertStringContainsString('ensure_precursor_beacon_quest_seed(', $startQuestHandler);
    }

    public function testQuestSeedBackfillDoesNotHideDatabaseFailures(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/factions.php');
        self::assertIsString($source);

        $start = strpos($source, 'function ensure_precursor_beacon_quest_seed(');
        $end = strpos($source, "\nfunction ", $start + 1);
        self::assertNotFalse($start);
        self::assertNotFalse($end);

        $seed = substr($source, $start, $end - $start);
        self::assertStringContainsString('INSERT IGNORE INTO faction_quests', $seed);
        self::assertStringNotContainsString('catch (Throwable', $seed);
        self::assertStringNotContainsString('catch (Exception', $seed);
    }
}
