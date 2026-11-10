<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use InvalidArgumentException;
use PHPUnit\Framework\TestCase;
use RuntimeException;

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../lib/RegistrationMail.php';

final class RegistrationSmtpTest extends TestCase
{
    /** @var array<string, string|false> */
    private array $previous = [];

    protected function setUp(): void
    {
        foreach (
            [
            'SMTP_HOST' => 'mail.example.org', 'SMTP_PORT' => '587', 'SMTP_TLS' => 'starttls',
            'SMTP_USER' => 'game@example.org', 'SMTP_PASSWORD' => 'test-only-password',
            'SMTP_FROM' => 'game@example.org',
            ] as $key => $value
        ) {
            $this->previous[$key] = getenv($key);
            putenv($key . '=' . $value);
        }
    }

    protected function tearDown(): void
    {
        foreach ($this->previous as $key => $value) {
            putenv($value === false ? $key : $key . '=' . $value);
        }
    }

    public function testValidStartTlsAndImplicitTlsSettings(): void
    {
        self::assertSame(587, registration_smtp_settings()['port']);
        self::assertSame('starttls', registration_smtp_settings()['tls']);
        putenv('SMTP_TLS=implicit');
        putenv('SMTP_PORT=465');
        self::assertSame('implicit', registration_smtp_settings()['tls']);
        self::assertSame(465, registration_smtp_settings()['port']);
    }

    public function testRejectsPlaintextOrMalformedSmtpConfiguration(): void
    {
        foreach (
            [
            ['SMTP_TLS', 'none'], ['SMTP_HOST', 'mail.example.org/path'], ['SMTP_PORT', '0'],
            ['SMTP_PORT', '65536'], ['SMTP_FROM', "game@example.org\r\nBcc: other@example.org"],
            ['SMTP_PASSWORD', ''],
            ] as [$key, $value]
        ) {
            $before = getenv($key);
            putenv($key . '=' . $value);
            try {
                registration_smtp_settings();
                self::fail('Unsafe SMTP configuration accepted: ' . $key);
            } catch (RuntimeException $error) {
                self::assertSame(503, $error->getCode());
            } finally {
                putenv($key . '=' . $before);
            }
        }
    }

    public function testMessageHasSafeHeadersAndExactConfirmationLink(): void
    {
        $link = 'https://game.example.org/#registration-confirm=' . str_repeat('a', 64);
        $message = registration_smtp_message('game@example.org', 'player@example.org', $link);
        [$headers, $body] = explode("\r\n\r\n", $message, 2);
        self::assertStringContainsString('To: <player@example.org>', $headers);
        self::assertStringContainsString('Content-Transfer-Encoding: base64', $headers);
        self::assertSame($link . "\r\n", base64_decode($body, true));
    }

    public function testRejectsRecipientHeaderInjection(): void
    {
        $this->expectException(InvalidArgumentException::class);
        registration_smtp_message('game@example.org', "player@example.org\r\nBcc: other@example.org", 'link');
    }
}
