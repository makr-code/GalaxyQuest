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

    public function testNormalizeLimitClampsRange(): void
    {
        $this->assertSame(1, npc_ai_decision_queue_normalize_limit(0));
        $this->assertSame(50, npc_ai_decision_queue_normalize_limit(50));
        $this->assertSame(100, npc_ai_decision_queue_normalize_limit(999));
    }

    public function testFailureStatusTransitions(): void
    {
        $this->assertSame('failed', npc_ai_decision_queue_failure_status(1, 3));
        $this->assertSame('dead', npc_ai_decision_queue_failure_status(3, 3));
    }
}
