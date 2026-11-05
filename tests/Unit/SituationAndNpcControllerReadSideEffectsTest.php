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
        self::assertStringContainsString('tick_situation(', $tick);
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
        self::assertStringContainsString('npc_ai_tick($db, $uid, true)', $runOnce);
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
