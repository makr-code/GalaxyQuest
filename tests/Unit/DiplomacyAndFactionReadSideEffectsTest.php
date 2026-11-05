<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class DiplomacyAndFactionReadSideEffectsTest extends TestCase
{
    public function testAgreementAndDiplomaticPlayReadsAreGetOnlyAndReadOnly(): void
    {
        foreach ([
            ['../../api/diplomacy.php', [['list', 'types'], ['types', 'propose']]],
            ['../../api/diplomatic_plays.php', [['list', 'trust_threat'], ['trust_threat', 'propose_play']]],
        ] as [$path, $actions]) {
            $source = file_get_contents(__DIR__ . '/' . $path);
            self::assertIsString($source);
            $dispatchOffset = strpos($source, 'switch ($action)');
            self::assertNotFalse($dispatchOffset);
            $dispatch = substr($source, $dispatchOffset);

            foreach ($actions as [$action, $nextAction]) {
                $handler = $this->caseBody($dispatch, $action, $nextAction);
                self::assertStringContainsString("only_method('GET');", $handler, $action);
                self::assertDoesNotMatchRegularExpression(
                    '/\\b(?:INSERT\\s+INTO\\s+[a-z_]+|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM\\s+[a-z_]+|REPLACE\\s+INTO\\s+[a-z_]+)\\b/i',
                    $handler,
                    $action
                );
            }
        }

        $agreements = file_get_contents(__DIR__ . '/../../api/diplomacy.php');
        $plays = file_get_contents(__DIR__ . '/../../api/diplomatic_plays.php');
        self::assertIsString($agreements);
        self::assertIsString($plays);
        foreach ([
            [$agreements, 'handle_list'],
            [$plays, 'handle_list'],
            [$plays, 'handle_trust_threat'],
            [$plays, 'dp_get_trust_threat'],
            [$plays, 'dp_get_faction'],
        ] as [$source, $function]) {
            $handler = $this->functionBody($source, $function);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT\\s+INTO\\s+[a-z_]+|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM\\s+[a-z_]+|REPLACE\\s+INTO\\s+[a-z_]+)\\b/i',
                $handler,
                $function
            );
        }
    }

    public function testFactionRelationGetActionsDoNotPersistState(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/faction_relations.php');
        self::assertIsString($source);

        $actions = [
            ['standing', 'trust_threat'],
            ['trust_threat', 'update_trust_threat'],
            ['relationships', 'conflicts'],
            ['conflicts', 'trade_routes'],
            ['trade_routes', 'update_standing'],
            ['diplomacy_events', 'graph_conflicts'],
            ['graph_conflicts', 'graph_path'],
            ['graph_path', 'graph_clusters'],
            ['graph_clusters', 'compare_conflicts'],
            ['compare_conflicts', 'seed_themisdb'],
            ['db_status', 'default'],
        ];

        foreach ($actions as [$action, $nextAction]) {
            $handler = $this->caseBody($source, $action, $nextAction);
            self::assertStringContainsString("only_method('GET');", $handler, $action);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT\\s+INTO\\s+[a-z_]+|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM\\s+[a-z_]+|REPLACE\\s+INTO\\s+[a-z_]+)\\b/i',
                $handler,
                $action
            );
            self::assertStringNotContainsString('ensure_diplomacy_rows(', $handler, $action);
        }

        $eventGenerator = $this->functionBody($source, 'generate_diplomatic_event');
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO\\s+[a-z_]+|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM\\s+[a-z_]+|REPLACE\\s+INTO\\s+[a-z_]+)\\b/i',
            $eventGenerator
        );
    }

    private function caseBody(string $source, string $action, string $nextAction): string
    {
        $start = strpos($source, "case '" . $action . "':");
        self::assertNotFalse($start, $action . ' action must exist.');
        $end = $nextAction === 'default'
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
