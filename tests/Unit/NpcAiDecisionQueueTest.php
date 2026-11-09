<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/api/npc_ai_decision_queue.php';

use PHPUnit\Framework\TestCase;

final class NpcAiDecisionQueueTest extends TestCase
{
    public function testDedupeKeyIsDeterministic(): void
    {
        $this->assertSame(
            'npc_ai:user:42:faction:7',
            npc_ai_decision_dedupe_key(42, 7)
        );
    }

    public function testDedupeLockNameIsStableAndWithinMysqlLimit(): void
    {
        $name = npc_ai_decision_queue_dedupe_lock_name('npc_ai:user:42:faction:7');

        $this->assertSame($name, npc_ai_decision_queue_dedupe_lock_name('npc_ai:user:42:faction:7'));
        $this->assertSame(56, strlen($name));
        $this->assertSame('gq:npcq:', substr($name, 0, 8));
    }

    public function testNormalizeLimitClampsRange(): void
    {
        $this->assertSame(1, npc_ai_decision_queue_normalize_limit(0));
        $this->assertSame(50, npc_ai_decision_queue_normalize_limit(50));
        $this->assertSame(100, npc_ai_decision_queue_normalize_limit(999));
    }

    public function testClaimLeaseCoversConfiguredTimeoutAndSequentialBatchBudget(): void
    {
        $this->assertSame(60, npc_ai_decision_queue_claim_ttl_seconds(30, 8, 1));
        $this->assertSame(760, npc_ai_decision_queue_claim_ttl_seconds(60, 8, 20));
        $this->assertSame(900, npc_ai_decision_queue_claim_ttl_seconds(900, 8, 20));
        $this->assertSame(5500, npc_ai_decision_queue_claim_ttl_seconds(60, 25, 100));
    }

    public function testFailureStatusTransitions(): void
    {
        $this->assertSame('failed', npc_ai_decision_queue_failure_status(1, 3));
        $this->assertSame('dead', npc_ai_decision_queue_failure_status(3, 3));
    }

    public function testWorkerOutcomeDistinguishesRejectedCompletions(): void
    {
        $this->assertSame('success', npc_ai_decision_queue_worker_outcome(true, true));
        $this->assertSame('failed', npc_ai_decision_queue_worker_outcome(true, false));
        $this->assertSame('rejected', npc_ai_decision_queue_worker_outcome(false, true));
        $this->assertSame('rejected', npc_ai_decision_queue_worker_outcome(false, false));
    }

    public function testWorkerBatchFailsOnFailedOrRejectedJobs(): void
    {
        $this->assertTrue(npc_ai_decision_queue_worker_batch_ok(0, 0));
        $this->assertFalse(npc_ai_decision_queue_worker_batch_ok(1, 0));
        $this->assertFalse(npc_ai_decision_queue_worker_batch_ok(0, 1));
        $this->assertFalse(npc_ai_decision_queue_worker_batch_ok(1, 1));
    }

    public function testNormalizeWorkerIdValidation(): void
    {
        $this->assertSame('py-worker_1', npc_ai_decision_queue_normalize_worker_id('py-worker_1'));
        $this->assertNull(npc_ai_decision_queue_normalize_worker_id(''));
        $this->assertNull(npc_ai_decision_queue_normalize_worker_id('x'));
        $this->assertNull(npc_ai_decision_queue_normalize_worker_id('bad worker'));
    }

    public function testQueueSchemaChecksDoNotHideDatabaseFailuresOrReuseStaleResults(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2) . '/api/npc_ai_decision_queue.php');
        $this->assertIsString($source);

        foreach ([
            'function npc_ai_decision_queue_available(',
            'function npc_ai_decision_queue_supports_worker_claim_fields(',
        ] as $functionName) {
            $start = strpos($source, $functionName);
            $this->assertNotFalse($start);
            $end = strpos($source, "\n}", $start);
            $this->assertNotFalse($end);

            $functionBody = substr($source, $start, $end - $start);
            $this->assertStringNotContainsString('catch (', $functionBody);
            $this->assertStringNotContainsString('static $', $functionBody);
        }
    }

    public function testLlmDecisionIsFencedBeforeAnyGameSideEffect(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2) . '/api/npc_llm_controller.php');
        $this->assertIsString($source);
        $claimGuard = strpos($source, 'if ($beforeApply !== null && !$beforeApply())');
        $sideEffect = strpos($source, '$apply = npc_pve_apply_decision(');
        $this->assertNotFalse($claimGuard);
        $this->assertNotFalse($sideEffect);
        $this->assertLessThan($sideEffect, $claimGuard);
    }
}
