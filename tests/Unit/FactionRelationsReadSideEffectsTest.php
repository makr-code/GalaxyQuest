<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class FactionRelationsReadSideEffectsTest extends TestCase
{
    public function testStandingAndTrustReadsDoNotBackfillDiplomacyRows(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/faction_relations.php');
        self::assertIsString($source);

        $standing = $this->caseBody($source, 'standing', 'trust_threat');
        $trustThreat = $this->caseBody($source, 'trust_threat', 'update_trust_threat');

        self::assertStringContainsString("only_method('GET');", $standing);
        self::assertStringNotContainsString('ensure_diplomacy_rows(', $standing);
        self::assertStringContainsString('COALESCE(d.standing, f.base_diplomacy)', $standing);
        self::assertStringContainsString('COALESCE(d.trust_level, 0.0)', $standing);

        self::assertStringContainsString("only_method('GET');", $trustThreat);
        self::assertStringNotContainsString('ensure_diplomacy_rows(', $trustThreat);
        self::assertStringContainsString('LEFT JOIN diplomacy d', $trustThreat);
        self::assertStringContainsString('COALESCE(d.trust_decay_rate, 0.5)', $trustThreat);
    }

    private function caseBody(string $source, string $action, string $nextAction): string
    {
        $actionOffset = strpos($source, "case '" . $action . "':");
        $nextActionOffset = strpos($source, "case '" . $nextAction . "':", $actionOffset);
        self::assertNotFalse($actionOffset, $action . ' action must exist.');
        self::assertNotFalse($nextActionOffset, $nextAction . ' action must exist.');

        return substr($source, $actionOffset, $nextActionOffset - $actionOffset);
    }
}
