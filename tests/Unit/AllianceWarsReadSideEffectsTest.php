<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class AllianceWarsReadSideEffectsTest extends TestCase
{
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
}
