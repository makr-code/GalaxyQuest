<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class AllianceWarsReadSideEffectsTest extends TestCase
{
    public function testListReadAndItsHelpersDoNotPersistWarState(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/alliance_wars.php');
        self::assertIsString($source);

        $list = $this->functionBody($source, 'aw_action_list');
        self::assertStringContainsString("only_method('GET');", $list);
        self::assertDoesNotMatchRegularExpression(
            '/\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO)\b/i',
            $list
        );

        foreach (['aw_wars_for_user', 'aw_user_alliance_ids', 'aw_load_sides'] as $helperName) {
            $helper = $this->functionBody($source, $helperName);
            self::assertDoesNotMatchRegularExpression(
                '/\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO)\b/i',
                $helper,
                $helperName
            );
        }
    }

    public function testGetStatusProjectsExpiredOffersWithoutPersistingThem(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/alliance_wars.php');
        self::assertIsString($source);

        $readStart = strpos($source, 'function aw_action_get_status(');
        $writeStart = strpos($source, 'function aw_action_offer_peace(', $readStart);
        self::assertNotFalse($readStart);
        self::assertNotFalse($writeStart);
        $readHandler = substr($source, $readStart, $writeStart - $readStart);

        self::assertStringNotContainsString('aw_mark_expired_offers(', $readHandler);
        self::assertStringContainsString(
            'CASE WHEN status = "pending" AND expires_at <= NOW() THEN "expired" ELSE status END AS status',
            $readHandler
        );
        self::assertStringContainsString(
            'aw_mark_expired_offers($db, $warId);',
            substr($source, $writeStart)
        );
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
