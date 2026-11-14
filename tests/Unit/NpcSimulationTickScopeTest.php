<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\NpcSimulationTickScope;

use PHPUnit\Framework\TestCase;

final class NpcSimulationTickScopeTest extends TestCase
{
    public function testUserNpcTickDoesNotRunGlobalSubsystems(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_ai.php');
        self::assertIsString($source);
        $start = strpos($source, 'function npc_ai_tick(');
        self::assertNotFalse($start);
        $nextFunction = strpos($source, "\nfunction ", $start + 1);
        self::assertNotFalse($nextFunction);
        $userTick = substr($source, $start, $nextFunction - $start);

        foreach ([
            'npc_player_accounts_tick_global(',
            'faction_events_tick_global(',
            'ScenarioEngine::tick(',
            'colony_events_tick_global(',
            'wormhole_regeneration_tick_global(',
            'trader_tick_global(',
        ] as $globalCall) {
            self::assertStringNotContainsString($globalCall, $userTick);
        }
        self::assertStringContainsString('npc_faction_tick($db, $userId, $faction)', $userTick);
    }

    public function testGlobalSimulationRunsNpcWorldUnderItsGlobalScopeLock(): void
    {
        $runtime = file_get_contents(__DIR__ . '/../../api/simulation_runtime.php');
        $npc = file_get_contents(__DIR__ . '/../../api/npc_ai.php');
        self::assertIsString($runtime);
        self::assertIsString($npc);

        self::assertStringContainsString(
            "\$result['ticks']['npc_world'] = simulation_runtime_execute_subsystem(",
            $runtime
        );
        self::assertStringContainsString('npc_ai_global_tick($db, $force)', $runtime);

        $globalTick = strpos($runtime, 'function simulation_tick_global(PDO');
        $userTick = strpos($runtime, 'function simulation_tick_user(PDO');
        self::assertNotFalse($globalTick);
        self::assertNotFalse($userTick);
        $globalBody = substr($runtime, $globalTick, $userTick - $globalTick);
        self::assertStringContainsString("'global',\n        '',\n        static fn(): array => simulation_tick_global_locked", $globalBody);

        $globalNpc = strpos($npc, 'function npc_ai_global_tick(');
        self::assertNotFalse($globalNpc);
        $nextFunction = strpos($npc, "\nfunction ", $globalNpc + 1);
        self::assertNotFalse($nextFunction);
        $globalNpcBody = substr($npc, $globalNpc, $nextFunction - $globalNpc);
        foreach ([
            'npc_player_accounts_tick_global($db, $force)',
            'faction_events_tick_global($db)',
            'ScenarioEngine::tick($db, $scenariosDir)',
            'colony_events_tick_global($db)',
            'wormhole_regeneration_tick_global($db)',
        ] as $globalCall) {
            self::assertStringContainsString($globalCall, $globalNpcBody);
        }
        self::assertStringNotContainsString('trader_tick_global(', $globalNpcBody);
    }

    public function testSimulationCooldownsStartAfterSuccessfulTickCompletion(): void
    {
        $runtime = file_get_contents(__DIR__ . '/../../api/simulation_runtime.php');
        self::assertIsString($runtime);

        foreach ([
            'simulation_tick_global_locked' => 'simulation_tick_user',
            'simulation_tick_user_locked' => null,
        ] as $function => $nextFunction) {
            $start = strpos($runtime, 'function ' . $function . '(');
            self::assertNotFalse($start);
            $end = $nextFunction === null
                ? strlen($runtime)
                : strpos($runtime, 'function ' . $nextFunction . '(', $start + 1);
            self::assertNotFalse($end);
            $tick = substr($runtime, $start, $end - $start);

            $completionCheck = strpos($tick, 'foreach ($result[\'ticks\'] as $tick)');
            $cooldownWrite = strpos($tick, 'app_state_set_int($db, $stateKey, time())');
            self::assertNotFalse($completionCheck);
            self::assertNotFalse($cooldownWrite);
            self::assertLessThan($cooldownWrite, $completionCheck);
            self::assertStringContainsString(
                'if ($allTicksSucceeded && $supportsStateTracking)',
                $tick
            );
        }
    }

    public function testManualNpcControllerUsesTheLockedUserTickAndReportsSkips(): void
    {
        $controller = file_get_contents(__DIR__ . '/../../api/npc_controller.php');
        self::assertIsString($controller);
        self::assertStringContainsString("require_once __DIR__ . '/simulation_runtime.php';", $controller);
        self::assertStringContainsString('$simulation = simulation_tick_user($db, $uid, true);', $controller);
        self::assertStringContainsString('$response = simulation_runtime_public_response($simulation);', $controller);
        self::assertStringContainsString("'NPC tick skipped: '", $controller);
        self::assertStringNotContainsString('npc_ai_tick($db, $uid, true)', $controller);
    }

    public function testNpcAccountMutationsAndRetryMarkerShareOneTransaction(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_ai.php');
        self::assertIsString($source);
        $start = strpos($source, 'function npc_player_account_tick(');
        self::assertNotFalse($start);
        $nextFunction = strpos($source, "\nfunction ", $start + 1);
        self::assertNotFalse($nextFunction);
        $tick = substr($source, $start, $nextFunction - $start);

        self::assertStringContainsString("'npc_player_tick:user:' . \$npcUserId . ':last_unix'", $tick);
        self::assertStringContainsString('if (!$force && ($now - $lastTick) < NPC_PLAYER_DECISION_PERIOD_SECONDS)', $tick);
        self::assertStringContainsString('ElapsedTime::rounds(', $tick);
        self::assertStringContainsString('game_engine_begin_tick_transaction($db, $savepoint)', $tick);
        self::assertStringContainsString('npc_player_account_tick_actions($db, $npcUserId)', $tick);
        $action = strpos($tick, 'npc_player_account_tick_actions($db, $npcUserId)');
        $marker = strpos($tick, 'app_state_set_int($db, $stateKey, time())');
        $commit = strpos($tick, 'game_engine_commit_tick_transaction');
        self::assertNotFalse($action);
        self::assertNotFalse($marker);
        self::assertNotFalse($commit);
        self::assertStringContainsString('game_engine_commit_tick_transaction($db, $savepoint, $ownsTransaction)', $tick);
        self::assertStringContainsString('game_engine_rollback_tick_transaction($db, $savepoint, $ownsTransaction)', $tick);
        self::assertLessThan($marker, $action);
        self::assertLessThan($commit, $marker);
    }

    public function testNpcAccountBatchPassesForceThroughToIndividualAccounts(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_ai.php');
        self::assertIsString($source);
        $start = strpos($source, 'function npc_player_accounts_tick_global(');
        self::assertNotFalse($start);
        $nextFunction = strpos($source, "\nfunction ", $start + 1);
        self::assertNotFalse($nextFunction);
        $batch = substr($source, $start, $nextFunction - $start);

        self::assertStringContainsString('npc_player_account_tick($db, $npcId, $force)', $batch);
    }
}
