<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/api/npc_llm_controller.php';

use PHPUnit\Framework\TestCase;

final class NpcLlmControllerCooldownTest extends TestCase
{
    public function testCooldownUsesLatestDecisionTimestamp(): void
    {
        $db = $this->createDecisionLogDb();
        $db->exec("INSERT INTO npc_llm_decision_log (user_id, faction_id, created_at)
                   VALUES (7, 3, datetime('now', '-30 seconds'))");

        self::assertFalse(npc_pve_llm_cooldown_ready($db, 7, 3, 60));

        $db->exec("UPDATE npc_llm_decision_log SET created_at = datetime('now', '-2 minutes')");
        self::assertTrue(npc_pve_llm_cooldown_ready($db, 7, 3, 60));
    }

    public function testInvalidDecisionTimestampFailsClosed(): void
    {
        $db = $this->createDecisionLogDb();
        $db->exec("INSERT INTO npc_llm_decision_log (user_id, faction_id, created_at)
                   VALUES (7, 3, 'not-a-timestamp')");

        self::assertFalse(npc_pve_llm_cooldown_ready($db, 7, 3, 60));
    }

    public function testDatabaseFailureIsPropagatedInsteadOfSkippingCooldown(): void
    {
        $db = new PDO('sqlite::memory:');
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        $this->expectException(PDOException::class);
        npc_pve_llm_cooldown_ready($db, 7, 3, 60);
    }

    private function createDecisionLogDb(): PDO
    {
        $db = new PDO('sqlite::memory:');
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->exec('CREATE TABLE npc_llm_decision_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            faction_id INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )');

        return $db;
    }
}
