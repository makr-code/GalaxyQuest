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
}
