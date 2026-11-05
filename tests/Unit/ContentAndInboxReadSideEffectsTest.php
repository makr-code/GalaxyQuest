<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class ContentAndInboxReadSideEffectsTest extends TestCase
{
    public function testMessageUserSearchAndInboxAreReadOnlyGetActions(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/messages.php');
        self::assertIsString($source);

        foreach ([
            ['users', 'inbox'],
            ['inbox', 'read'],
        ] as [$action, $nextAction]) {
            $handler = $this->caseBody($source, $action, $nextAction);
            self::assertStringContainsString("only_method('GET');", $handler);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT\\s+INTO\\s+[a-z_]+|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM\\s+[a-z_]+|REPLACE\\s+INTO\\s+[a-z_]+)\\b/i',
                $handler
            );
        }

        $read = $this->caseBody($source, 'read', 'send');
        self::assertMatchesRegularExpression(
            "/only_method\\('POST'\\);\\s*verify_csrf\\(\\);/",
            $read
        );
        self::assertStringContainsString('UPDATE messages SET is_read = 1', $read);
    }

    public function testAchievementListOnlyReadsGameStateAndMayFillItsReadThroughCache(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/achievements.php');
        self::assertIsString($source);

        $list = $this->caseBody($source, 'list', 'claim');
        self::assertStringContainsString("only_method('GET');", $list);
        self::assertStringContainsString('fetch_achievements_for_user($db, $uid)', $list);
        self::assertStringContainsString("gq_cache_set('achievements_list'", $list);
        foreach (['check_and_update_achievements(', 'ensure_user_achievements_seeded(', 'grant_achievement_reward('] as $mutation) {
            self::assertStringNotContainsString($mutation, $list);
        }

        $fetch = $this->functionBody($source, 'fetch_achievements_for_user');
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO\\s+[a-z_]+|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM\\s+[a-z_]+|REPLACE\\s+INTO\\s+[a-z_]+)\\b/i',
            $fetch
        );
        self::assertStringNotContainsString('ensure_user_achievements_seeded(', $fetch);

        $questFetch = $this->functionBody($source, 'fetch_faction_quests_as_achievements');
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO\\s+[a-z_]+|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM\\s+[a-z_]+|REPLACE\\s+INTO\\s+[a-z_]+)\\b/i',
            $questFetch
        );
        self::assertStringNotContainsString('catch (Throwable', $questFetch);
        self::assertStringContainsString('return $stmt->fetchAll(PDO::FETCH_ASSOC);', $questFetch);
    }

    public function testGlossaryGetDoesNotRunGenerationOrWriteCache(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/glossary.php');
        self::assertIsString($source);

        $getStart = strpos($source, '} else {', strpos($source, "if (\$action === 'generate')"));
        $validationStart = strpos($source, '// Validate term', $getStart);
        $getActionStart = strpos($source, '// ─── Action: Retrieve cached or static definition', $validationStart);
        $getActionEnd = strpos($source, '// ─── RAG Pipeline', $getActionStart);
        self::assertNotFalse($getStart);
        self::assertNotFalse($validationStart);
        self::assertNotFalse($getActionStart);
        self::assertNotFalse($getActionEnd);

        $getSetup = substr($source, $getStart, $validationStart - $getStart);
        $getDispatch = substr($source, $getActionStart, $getActionEnd - $getActionStart);
        self::assertStringContainsString("only_method('GET');", $getSetup);
        self::assertStringNotContainsString('generate_rag_definition(', $getDispatch);
        self::assertStringNotContainsString('cache_glossary_definition(', $getDispatch);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO\\s+[a-z_]+|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM\\s+[a-z_]+|REPLACE\\s+INTO\\s+[a-z_]+)\\b/i',
            $getDispatch
        );
        self::assertStringContainsString('Use action=generate to get LLM-enhanced definition', $getDispatch);
    }

    private function caseBody(string $source, string $action, string $nextAction): string
    {
        $start = strpos($source, "case '" . $action . "':");
        self::assertNotFalse($start, $action . ' action must exist.');
        $end = strpos($source, "case '" . $nextAction . "':", $start + 1);
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
