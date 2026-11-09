<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class SituationAndNpcControllerReadSideEffectsTest extends TestCase
{
    public function testSituationListIsReadOnlyAndTickIsExplicitPost(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/situations.php');
        self::assertIsString($source);

        $list = $this->caseBody($source, 'list', 'start');
        self::assertStringContainsString("only_method('GET');", $list);
        self::assertDoesNotMatchRegularExpression('/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i', $list);
        self::assertStringNotContainsString('tick_situation(', $list);

        $tick = $this->caseBody($source, 'tick', 'resolve');
        self::assertMatchesRegularExpression(
            "/case 'tick':\\s*only_method\\('POST'\\);\\s*verify_csrf\\(\\);/",
            $tick
        );
        self::assertStringContainsString('$db->beginTransaction();', $tick);
        self::assertStringContainsString('FOR UPDATE', $tick);
        self::assertStringContainsString('$db->commit();', $tick);
        self::assertStringContainsString('$db->rollBack();', $tick);
        self::assertStringContainsString('tick_situation(', $tick);

        foreach (['set_approach', 'resolve'] as $action) {
            $mutation = $this->caseBody($source, $action, $action === 'set_approach' ? 'tick' : null);
            self::assertStringContainsString('mutate_user_situation(', $mutation, $action);
            self::assertStringContainsString('json_ok($result)', $mutation, $action);
        }

        $mutationHelper = $this->functionBody($source, 'mutate_user_situation');
        self::assertStringContainsString('$db->beginTransaction();', $mutationHelper);
        self::assertStringContainsString('FOR UPDATE', $mutationHelper);
        self::assertStringContainsString('$db->commit();', $mutationHelper);
        self::assertStringContainsString('$db->rollBack();', $mutationHelper);
    }

    public function testNpcControllerReadActionsDoNotInvokeTheNpcTick(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_controller.php');
        self::assertIsString($source);

        foreach ([
            ['status', 'summary'],
            ['summary', 'decisions'],
            ['decisions', 'run_once'],
        ] as [$action, $nextAction]) {
            $readAction = $this->caseBody($source, $action, $nextAction);
            self::assertStringContainsString("only_method('GET');", $readAction, $action);
            self::assertStringNotContainsString('npc_ai_tick(', $readAction, $action);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i',
                $readAction,
                $action
            );
        }

        $runOnce = $this->caseBody($source, 'run_once', null);
        self::assertMatchesRegularExpression(
            "/case 'run_once':\\s*only_method\\('POST'\\);\\s*verify_csrf\\(\\);/",
            $runOnce
        );
        self::assertStringContainsString('simulation_tick_user($db, $uid, true)', $runOnce);
        self::assertStringContainsString('simulation_runtime_public_response($simulation)', $runOnce);
        self::assertStringContainsString('NPC tick skipped:', $runOnce);
        self::assertStringNotContainsString('npc_ai_tick($db, $uid, true)', $runOnce);
    }

    public function testNpcControllerReadHelpersOnlyInspectSchemaAndDecisionLogs(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_controller.php');
        self::assertIsString($source);

        $status = $this->caseBody($source, 'status', 'summary');
        self::assertStringContainsString('SELECT last_npc_tick FROM users', $status);
        self::assertStringContainsString('SELECT COUNT(*) FROM npc_llm_decision_log', $status);
        self::assertStringNotContainsString('catch (Throwable', $status);

        foreach (['npc_controller_log_table_exists', 'npc_controller_count_logs'] as $function) {
            $helper = $this->functionBody($source, $function);
            self::assertDoesNotMatchRegularExpression(
                '/\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO)\b/i',
                $helper,
                $function
            );
            self::assertStringNotContainsString('catch (Throwable', $helper, $function);
        }
    }

    public function testNpcAiWorkerRejectsGetBeforeDatabaseOrNonceMutation(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_ai_worker.php');
        self::assertIsString($source);

        $methodGuard = strpos($source, "only_method('POST');");
        $databaseConnection = strpos($source, '$db = get_db();');
        $authentication = strpos($source, 'npc_ai_worker_authenticate($db, $rawBody, $sharedSecret)');
        self::assertNotFalse($methodGuard);
        self::assertNotFalse($databaseConnection);
        self::assertNotFalse($authentication);
        self::assertLessThan($databaseConnection, $methodGuard);
        self::assertLessThan($authentication, $methodGuard);

        $nonceConsumer = $this->functionBody($source, 'npc_ai_worker_nonce_consume_status');
        self::assertStringContainsString('DELETE FROM npc_ai_worker_nonce', $nonceConsumer);
        self::assertStringContainsString('INSERT IGNORE INTO npc_ai_worker_nonce', $nonceConsumer);

        $nonceSchemaCheck = $this->functionBody($source, 'npc_ai_worker_nonce_table_available');
        self::assertStringNotContainsString('catch (', $nonceSchemaCheck);
        self::assertStringNotContainsString('static $', $nonceSchemaCheck);
    }

    public function testTraderTickChecksOptionalSchemaBeforeConsumingCooldown(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_ai.php');
        self::assertIsString($source);

        $tick = $this->functionBody($source, 'trader_tick_global');
        $schemaProbe = strpos($tick, "SELECT 1 FROM npc_traders LIMIT 1");
        $cooldownRead = strpos($tick, 'app_state_get_int($db, $stateKey, 0)');
        $cooldownWrite = strpos($tick, 'app_state_set_int($db, $stateKey, time())');
        self::assertNotFalse($schemaProbe);
        self::assertNotFalse($cooldownRead);
        self::assertNotFalse($cooldownWrite);
        self::assertLessThan($cooldownRead, $schemaProbe);
        self::assertLessThan($cooldownWrite, $schemaProbe);
        self::assertStringContainsString('catch (PDOException $error)', $tick);
        self::assertStringContainsString("if (\$error->getCode() !== '42S02')", $tick);
        self::assertStringContainsString('throw $error;', $tick);
        self::assertStringContainsString('$db->rollBack();', $tick);
    }

    public function testNpcPlayerAccountTickWritesCooldownOnlyAfterAllAccountsSucceed(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_ai.php');
        self::assertIsString($source);

        $tick = $this->functionBody($source, 'npc_player_accounts_tick_global');
        $accountQuery = strpos($tick, '$db->query("SELECT id FROM users');
        $accountLoop = strpos($tick, 'foreach ($npcIds as $npcIdRaw)');
        $accountTick = strpos($tick, 'npc_player_account_tick($db, $npcId, $force)');
        $cooldownWrite = strpos($tick, 'app_state_set_int($db, $stateKey, time())');
        self::assertNotFalse($accountQuery);
        self::assertNotFalse($accountLoop);
        self::assertNotFalse($accountTick);
        self::assertNotFalse($cooldownWrite);
        self::assertLessThan($accountLoop, $accountQuery);
        self::assertLessThan($cooldownWrite, $accountTick);
        self::assertStringContainsString('if (!$stmt)', $tick);
        self::assertStringNotContainsString('$stmt ? $stmt->fetchAll', $tick);
    }

    public function testNpcTickCooldownsFollowTheirWorkAndTraderDatabaseErrorsPropagate(): void
    {
        $npcSource = file_get_contents(__DIR__ . '/../../api/npc_ai.php');
        self::assertIsString($npcSource);

        $npcTick = $this->functionBody($npcSource, 'npc_ai_tick');
        $factionWork = strpos($npcTick, 'npc_faction_tick($db, $userId, $faction)');
        $diplomacyWork = strpos($npcTick, ')->execute([$userId]);');
        $userCooldown = strpos($npcTick, "\$db->prepare('UPDATE users SET last_npc_tick=NOW()");
        self::assertNotFalse($factionWork);
        self::assertNotFalse($diplomacyWork);
        self::assertNotFalse($userCooldown);
        self::assertLessThan(
            $userCooldown,
            $factionWork
        );
        self::assertLessThan($userCooldown, $diplomacyWork);

        $traderTick = $this->functionBody($npcSource, 'trader_tick_global');
        $lastTraderWork = strpos($traderTick, 'execute_trader_decisions($db)');
        $traderCooldown = strpos($traderTick, 'app_state_set_int($db, $stateKey, time())');
        $traderCommit = strpos($traderTick, '$db->commit();');
        self::assertNotFalse($lastTraderWork);
        self::assertNotFalse($traderCooldown);
        self::assertNotFalse($traderCommit);
        self::assertLessThan($traderCooldown, $lastTraderWork);
        self::assertLessThan($traderCommit, $traderCooldown);
        self::assertStringContainsString('$db->beginTransaction();', $traderTick);
        self::assertStringContainsString('$db->rollBack();', $traderTick);

        $wormholeTick = $this->functionBody($npcSource, 'wormhole_regeneration_tick_global');
        $wormholeUpdate = strpos($wormholeTick, 'UPDATE wormholes');
        $wormholeCooldown = strpos($wormholeTick, "app_state_set_int(\$db, 'wormholes:regen:last_tick', \$now)");
        $wormholeCommit = strpos($wormholeTick, '$db->commit();');
        self::assertNotFalse($wormholeUpdate);
        self::assertNotFalse($wormholeCooldown);
        self::assertNotFalse($wormholeCommit);
        self::assertLessThan($wormholeCooldown, $wormholeUpdate);
        self::assertLessThan($wormholeCommit, $wormholeCooldown);
        self::assertStringContainsString('$db->beginTransaction();', $wormholeTick);
        self::assertStringContainsString('$db->rollBack();', $wormholeTick);

        $tradersSource = file_get_contents(__DIR__ . '/../../api/traders.php');
        self::assertIsString($tradersSource);
        foreach (['process_route_transitions', 'execute_trader_decisions'] as $function) {
            $body = $this->functionBody($tradersSource, $function);
            self::assertStringContainsString('catch (PDOException $error)', $body);
            self::assertStringContainsString('throw $error;', $body);
        }
    }

    public function testNpcTickUpdatesUserCooldownOnlyAfterAllSubsystemsSucceed(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_ai.php');
        self::assertIsString($source);

        $tick = $this->functionBody($source, 'npc_ai_tick');
        $cooldownWrite = strpos($tick, "\$db->prepare('UPDATE users SET last_npc_tick=NOW()");
        self::assertNotFalse($cooldownWrite);
        $factionLoop = strpos($tick, 'foreach ($factions as $faction)');
        self::assertNotFalse($factionLoop);
        self::assertLessThan($cooldownWrite, $factionLoop);
        foreach ([
            'npc_player_accounts_tick_global(',
            'faction_events_tick_global(',
            'ScenarioEngine::tick(',
            'colony_events_tick_global(',
            'wormhole_regeneration_tick_global(',
            'trader_tick_global(',
        ] as $call) {
            self::assertStringNotContainsString($call, $tick);
        }
        self::assertStringNotContainsString('catch (Throwable', $tick);

        $globalTick = $this->functionBody($source, 'npc_ai_global_tick');
        foreach ([
            'npc_player_accounts_tick_global($db, $force);',
            'faction_events_tick_global($db);',
            'ScenarioEngine::tick($db, $scenariosDir);',
            'colony_events_tick_global($db);',
            'wormhole_regeneration_tick_global($db);',
        ] as $call) {
            self::assertStringContainsString($call, $globalTick);
        }
        self::assertStringNotContainsString('trader_tick_global(', $globalTick);

        $accountTick = $this->functionBody($source, 'npc_player_account_tick');
        self::assertMatchesRegularExpression(
            '/catch \(PDOException \$error\)\s*\{\s*throw \$error;\s*\}\s*catch \(Throwable \$e\)/',
            $accountTick
        );
    }

    public function testBehaviorScriptDatabaseFailuresDoNotFallThroughToOtherNpcActions(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_ai.php');
        self::assertIsString($source);

        $factionTick = $this->functionBody($source, 'npc_faction_tick');
        self::assertMatchesRegularExpression(
            '/catch \(PDOException \$error\)\s*\{\s*throw \$error;\s*\}\s*catch \(Throwable \$e\)/',
            $factionTick
        );
        self::assertStringContainsString('npc_ai_decision_queue_maybe_enqueue(', $factionTick);
        self::assertStringContainsString(
            "!in_array(\$queueReason, ['already_pending', 'lock_busy'], true)",
            $factionTick
        );
        self::assertStringContainsString('npc_pve_llm_controller_try(', $factionTick);
    }

    public function testColonyEventTickDoesNotConsumeCooldownOnFailureOrDuplicateEvents(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_ai.php');
        self::assertIsString($source);

        $tick = $this->functionBody($source, 'colony_events_tick_global');
        $cooldownWrite = strrpos($tick, "app_state_set_int(\$db, 'colony_events:last_tick', \$now)");
        $eventMessage = strpos($tick, '$msgStmt->execute(');
        $eventInsert = strpos($tick, '$insertStmt->execute(');
        self::assertNotFalse($cooldownWrite);
        self::assertNotFalse($eventMessage);
        self::assertNotFalse($eventInsert);
        self::assertGreaterThan($eventMessage, $cooldownWrite);

        self::assertStringContainsString("if (\$error->getCode() !== '42S02')", $tick);
        self::assertStringContainsString('if ($insertStmt->rowCount() === 1)', $tick);
        self::assertStringContainsString("\$db->exec('SAVEPOINT ' . \$savepoint)", $tick);
        self::assertStringContainsString("\$db->exec('ROLLBACK TO SAVEPOINT ' . \$savepoint)", $tick);
        self::assertStringContainsString(
            'INSERT INTO messages (sender_id, receiver_id, subject, body)',
            $tick
        );
        self::assertStringNotContainsString('is_system, created_at', $tick);

        $schema = file_get_contents(__DIR__ . '/../../sql/schema.sql');
        self::assertIsString($schema);
        $messagesStart = strpos($schema, 'CREATE TABLE IF NOT EXISTS messages');
        self::assertNotFalse($messagesStart);
        $messagesEnd = strpos($schema, ') ENGINE=InnoDB;', $messagesStart);
        self::assertNotFalse($messagesEnd);
        $messagesSchema = substr($schema, $messagesStart, $messagesEnd - $messagesStart);
        self::assertStringContainsString('sent_at DATETIME', $messagesSchema);
        self::assertStringNotContainsString('is_system', $messagesSchema);
    }

    public function testGlobalFactionEventChangesAreWrappedInTransactionOrSavepoint(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_ai.php');
        self::assertIsString($source);

        $tick = $this->functionBody($source, 'faction_events_tick_global');
        self::assertStringContainsString('faction_events_tick_global_run($db)', $tick);
        self::assertStringContainsString('$db->beginTransaction();', $tick);
        self::assertStringContainsString("\$db->exec('SAVEPOINT ' . \$savepoint)", $tick);
        self::assertStringContainsString('$db->commit();', $tick);
        self::assertStringContainsString('$db->rollBack();', $tick);
        self::assertStringContainsString("\$db->exec('ROLLBACK TO SAVEPOINT ' . \$savepoint)", $tick);
        self::assertStringContainsString('throw $error;', $tick);

        $work = $this->functionBody($source, 'faction_events_tick_global_run');
        self::assertStringContainsString('faction_event_revert($db, $activeType)', $work);
        self::assertStringContainsString('faction_event_apply($db, $eventType)', $work);
        self::assertStringContainsString("'faction_event:active_type'", $work);
        self::assertStringContainsString('INSERT INTO messages', $work);
    }

    private function caseBody(string $source, string $action, ?string $nextAction): string
    {
        $start = strpos($source, "case '" . $action . "':");
        self::assertNotFalse($start, $action . ' action must exist.');
        $end = $nextAction === null
            ? strpos($source, 'default:', $start + 1)
            : strpos($source, "case '" . $nextAction . "':", $start + 1);
        self::assertNotFalse($end, $action . ' action must have a bounded body.');
        return substr($source, $start, $end - $start);
    }

    private function functionBody(string $source, string $function): string
    {
        $start = strpos($source, 'function ' . $function . '(');
        self::assertNotFalse($start, $function . ' function must exist.');
        $nextFunction = strpos($source, "\nfunction ", $start + 1);
        $end = $nextFunction === false ? strlen($source) : $nextFunction;
        return substr($source, $start, $end - $start);
    }
}
