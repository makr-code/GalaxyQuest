<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class ConstructionQueueReadSideEffectsTest extends TestCase
{
    public function testBuildingListDoesNotCompleteOrAdvanceUpgrades(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/buildings.php');
        self::assertIsString($source);

        $listStart = strpos($source, "case 'list':");
        $upgradeStart = strpos($source, "case 'upgrade':", $listStart);
        self::assertNotFalse($listStart);
        self::assertNotFalse($upgradeStart);
        $listAction = substr($source, $listStart, $upgradeStart - $listStart);

        self::assertStringContainsString("only_method('GET');", $listAction);
        self::assertStringContainsString('update_colony_resources($db, $cid)', $listAction);
        self::assertStringNotContainsString('complete_upgrades(', $listAction);
        self::assertStringNotContainsString('start_next_building_upgrade(', $listAction);
    }

    public function testShipyardListDoesNotCompleteOrAdvanceShipQueue(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/shipyard.php');
        self::assertIsString($source);

        $dispatchStart = strpos($source, "case 'list':");
        $nextAction = strpos($source, "case 'finish':", $dispatchStart);
        self::assertNotFalse($dispatchStart);
        self::assertNotFalse($nextAction);
        $dispatchAction = substr($source, $dispatchStart, $nextAction - $dispatchStart);
        self::assertStringContainsString("only_method('GET');", $dispatchAction);

        $listAction = $this->functionBody($source, 'action_shipyard_list');
        self::assertStringContainsString('list_ship_build_queue($db, $cid)', $listAction);
        self::assertStringNotContainsString('complete_ship_build_queue(', $listAction);
        self::assertStringNotContainsString('start_next_ship_build_queue(', $listAction);

        $queueSource = file_get_contents(__DIR__ . '/../../api/shipyard_queue.php');
        self::assertIsString($queueSource);
        $schemaGuard = $this->functionBody($queueSource, 'ensure_ship_build_queue_table');
        self::assertStringContainsString('GalaxySchema::assertShipQueue($db)', $schemaGuard);
        self::assertDoesNotMatchRegularExpression(
            '/\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/i',
            $schemaGuard
        );

        $queueReader = $this->functionBody($queueSource, 'list_ship_build_queue');
        self::assertStringNotContainsString('UPDATE ship_build_queue', $queueReader);
        self::assertStringNotContainsString('INSERT INTO ships', $queueReader);

        $queueLock = $this->functionBody($queueSource, 'ship_build_queue_with_colony_lock');
        self::assertStringContainsString('$db->beginTransaction();', $queueLock);
        self::assertStringContainsString('$db->exec(\'SAVEPOINT \' . $savepoint);', $queueLock);
        self::assertStringContainsString("SELECT id FROM colonies WHERE id = ?", $queueLock);
        self::assertStringContainsString("' FOR UPDATE' : ''", $queueLock);
        self::assertStringContainsString('$db->commit();', $queueLock);
        self::assertStringContainsString('$db->rollBack();', $queueLock);

        $complete = $this->functionBody($queueSource, 'complete_ship_build_queue');
        self::assertStringContainsString('ship_build_queue_with_colony_lock(', $complete);
        self::assertStringContainsString('complete_ship_build_queue_locked($db, $colonyId)', $complete);
        $lockedCompletion = $this->functionBody($queueSource, 'complete_ship_build_queue_locked');
        self::assertStringContainsString('start_next_ship_build_queue($db, $colonyId)', $lockedCompletion);
    }

    private function functionBody(string $source, string $functionName): string
    {
        $start = strpos($source, 'function ' . $functionName . '(');
        self::assertNotFalse($start, $functionName . ' must exist.');
        $next = preg_match('/^[ \t]*function\s+/m', $source, $matches, PREG_OFFSET_CAPTURE, $start + 1)
            ? $matches[0][1]
            : strlen($source);
        return substr($source, $start, $next - $start);
    }

    public function testDevelopmentMutationsInvalidateAuthoritativeHudCaches(): void
    {
        foreach (['buildings' => ['upgrade', 'finish'], 'research' => ['research', 'finish']] as $file => $actions) {
            $source = file_get_contents(__DIR__ . '/../../api/' . $file . '.php');
            self::assertIsString($source);
            foreach ($actions as $action) {
                $start = strpos($source, "case '$action':");
                self::assertNotFalse($start);
                $next = strpos($source, "\n        case ", $start + 1);
                if ($file === 'research') $next = strpos($source, "\n    case ", $start + 1);
                $body = substr($source, $start, ($next === false ? strlen($source) : $next) - $start);
                self::assertStringContainsString("only_method('POST');", $body);
                self::assertStringContainsString('verify_csrf();', $body);
                self::assertStringContainsString("gq_cache_delete('game_overview', ['uid' => \$uid]);", $body);
                if ($action !== 'finish' || $file === 'buildings') {
                    self::assertStringContainsString("gq_cache_delete('game_resources', ['uid' => \$uid, 'cid' => \$cid]);", $body);
                }
            }
        }
    }
}
