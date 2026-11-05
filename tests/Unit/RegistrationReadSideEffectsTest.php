<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/registration_handlers.php';

final class RegistrationReadSideEffectsTest extends TestCase
{
    private array $previousSession;

    protected function setUp(): void
    {
        $this->previousSession = $_SESSION ?? [];
        $_SESSION = [];
    }

    protected function tearDown(): void
    {
        $_SESSION = $this->previousSession;
    }

    public function testRegistrationReadsDoNotInitializeSessionOwner(): void
    {
        foreach (['register_catalog', 'register_preview', 'register_status', 'register_portrait_status', 'register_portrait_image'] as $action) {
            self::assertSame('', \registration_session_owner($action, true));
            self::assertArrayNotHasKey('registration_owner', $_SESSION);
        }
    }

    public function testDraftMutationInitializesOwnerWhileCancelDoesNot(): void
    {
        self::assertSame('', \registration_session_owner('register_cancel', false));
        self::assertArrayNotHasKey('registration_owner', $_SESSION);

        $owner = \registration_session_owner('register_prepare', false);
        self::assertSame(64, strlen((string)($_SESSION['registration_owner'] ?? '')));
        self::assertSame(hash('sha256', $_SESSION['registration_owner']), $owner);
    }

    public function testRegistrationCatalogPreviewAndStatusServicesOnlyReadPersistentState(): void
    {
        $draftService = file_get_contents(__DIR__ . '/../../lib/RegistrationDraftService.php');
        $portraitService = file_get_contents(__DIR__ . '/../../lib/RegistrationPortraitService.php');
        $handler = file_get_contents(__DIR__ . '/../../api/registration_handlers.php');
        self::assertIsString($draftService);
        self::assertIsString($portraitService);
        self::assertIsString($handler);

        self::assertStringContainsString(
            "\$read = in_array(\$action, ['register_catalog', 'register_preview', 'register_status', 'register_portrait_status', 'register_portrait_image'], true);",
            $handler
        );
        self::assertStringContainsString("only_method(\$read ? 'GET' : 'POST');", $handler);

        foreach (['catalog', 'preview', 'status'] as $method) {
            $body = $this->methodBody($draftService, $method);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO)\\b/i',
                $body,
                $method . ' must not persist registration changes.'
            );
        }

        foreach (['draft', 'portrait', 'status', 'image'] as $method) {
            $body = $this->methodBody($portraitService, $method);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO)\\b/i',
                $body,
                $method . ' must not persist portrait changes.'
            );
        }
    }

    public function testPortraitStatusProjectsExpiredPendingLeaseWithoutUpdatingStoredState(): void
    {
        $source = file_get_contents(__DIR__ . '/../../lib/RegistrationPortraitService.php');
        self::assertIsString($source);
        $status = $this->methodBody($source, 'status');

        self::assertStringContainsString("\$state = 'failed';", $status);
        self::assertStringContainsString('Portrait generation timed out.', $status);
        self::assertDoesNotMatchRegularExpression('/\\bUPDATE\\s+registration_portraits\\b/i', $status);
    }

    private function methodBody(string $source, string $method): string
    {
        $start = strpos($source, 'function ' . $method . '(');
        self::assertNotFalse($start, $method . ' method must exist.');
        $tail = substr($source, $start + 1);
        $nextMethod = preg_match('/\n    (?:public|private|protected) function /', $tail, $matches, PREG_OFFSET_CAPTURE)
            ? $start + 1 + $matches[0][1]
            : false;
        $end = $nextMethod === false ? strlen($source) : $nextMethod;
        return substr($source, $start, $end - $start);
    }
}
