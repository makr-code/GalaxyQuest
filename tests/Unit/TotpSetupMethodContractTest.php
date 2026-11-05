<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class TotpSetupMethodContractTest extends TestCase
{
    public function testTotpSetupIsPostOnlyAndCsrfProtectedBeforeWritingPendingSecret(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/auth.php');
        self::assertIsString($source);

        $caseStart = strpos($source, "case 'totp_begin_setup':");
        $caseEnd = strpos($source, "case 'totp_confirm_setup':", $caseStart);
        self::assertNotFalse($caseStart);
        self::assertNotFalse($caseEnd);
        $route = substr($source, $caseStart, $caseEnd - $caseStart);
        self::assertStringContainsString("only_method('POST');", $route);
        self::assertStringContainsString('handle_totp_begin_setup();', $route);

        $handlerStart = strpos($source, 'function handle_totp_begin_setup(');
        $handlerEnd = strpos($source, '/**', $handlerStart + 1);
        self::assertNotFalse($handlerStart);
        self::assertNotFalse($handlerEnd);
        $handler = substr($source, $handlerStart, $handlerEnd - $handlerStart);
        $csrf = strpos($handler, 'verify_csrf();');
        $write = strpos($handler, 'UPDATE users SET totp_pending_secret');
        self::assertNotFalse($csrf);
        self::assertNotFalse($write);
        self::assertLessThan($write, $csrf);
    }

    public function testTotpSetupDocumentationMatchesPostContract(): void
    {
        $authSource = file_get_contents(__DIR__ . '/../../api/auth.php');
        $uiSource = file_get_contents(__DIR__ . '/../../js/ui/settings-2fa.js');
        self::assertIsString($authSource);
        self::assertIsString($uiSource);

        self::assertStringContainsString('POST /api/auth.php?action=totp_begin_setup', $authSource);
        self::assertStringContainsString('POST ?action=totp_begin_setup', $uiSource);
        self::assertStringNotContainsString('GET  ?action=totp_begin_setup', $uiSource);
    }
}
