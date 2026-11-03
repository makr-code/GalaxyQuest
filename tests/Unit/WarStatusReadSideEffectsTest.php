<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class WarStatusReadSideEffectsTest extends TestCase
{
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
}
