<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class WarStatusReadSideEffectsTest extends TestCase
{
    public function testWarReadActionsAndTheirProjectionHelpersAreReadOnlyGetRequests(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/war.php');
        self::assertIsString($source);

        foreach ([
            ['get_status', 'list'],
            ['list', 'get_supply_status'],
            ['get_supply_status', 'set_supply_route'],
            ['get_intel', 'get_goal_progress'],
            ['get_goal_progress', 'force_status_quo'],
        ] as [$action, $nextAction]) {
            $handler = $this->caseBody($source, $action, $nextAction);
            self::assertStringContainsString("only_method('GET');", $handler, $action);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO)\\b/i',
                $handler,
                $action
            );
            self::assertStringNotContainsString('war_mark_expired_offers(', $handler, $action);
        }

        $dispatcherOffset = strpos($source, 'switch ($action)');
        self::assertNotFalse($dispatcherOffset);
        $helpersSource = substr($source, 0, $dispatcherOffset);
        foreach ([
            'war_load_for_participant',
            'war_get_goals',
            'war_goal_status_payload',
            'war_get_enriched_goals',
            'war_list_summary',
            'war_list_active',
        ] as $helper) {
            $body = $this->functionBody($helpersSource, $helper);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO)\\b/i',
                $body,
                $helper
            );
            self::assertStringNotContainsString('war_mark_expired_offers(', $body, $helper);
        }
    }

    public function testGetStatusProjectsExpiredOffersWithoutPersistingThem(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/war.php');
        self::assertIsString($source);

        $readStart = strpos($source, "case 'get_status': {");
        $readEnd = strpos($source, "case 'list': {", $readStart);
        self::assertNotFalse($readStart);
        self::assertNotFalse($readEnd);
        $readHandler = substr($source, $readStart, $readEnd - $readStart);

        self::assertStringNotContainsString('war_mark_expired_offers(', $readHandler);
        self::assertStringContainsString(
            'CASE WHEN status = "pending" AND expires_at <= NOW() THEN "expired" ELSE status END AS status',
            $readHandler
        );
        self::assertStringContainsString(
            'war_mark_expired_offers($db, $warId);',
            substr($source, strpos($source, "case 'offer_peace': {"))
        );
    }

    public function testSupplyRouteMutationVerifiesCsrfBeforeReadingPostData(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/war.php');
        self::assertIsString($source);

        $actionStart = strpos($source, "case 'set_supply_route': {");
        $actionEnd = strpos($source, "case 'alliance_wars': {", $actionStart);
        self::assertNotFalse($actionStart);
        self::assertNotFalse($actionEnd);
        $action = substr($source, $actionStart, $actionEnd - $actionStart);

        $postGuardOffset = strpos($action, "only_method('POST');");
        $csrfGuardOffset = strpos($action, 'verify_csrf();');
        $inputReadOffset = strpos($action, "\$_POST['war_id']");
        self::assertNotFalse($postGuardOffset);
        self::assertNotFalse($csrfGuardOffset);
        self::assertNotFalse($inputReadOffset);
        self::assertLessThan($csrfGuardOffset, $postGuardOffset);
        self::assertLessThan($inputReadOffset, $csrfGuardOffset);
    }

    private function caseBody(string $source, string $action, string $nextAction): string
    {
        $start = strpos($source, "case '" . $action . "':");
        self::assertNotFalse($start, $action . ' action must exist.');
        $end = strpos($source, "case '" . $nextAction . "':", $start + 1);
        self::assertNotFalse($end, $action . ' action must be bounded.');
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
