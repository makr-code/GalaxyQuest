<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class RegistrationRememberCookieTest extends TestCase
{
    public function testConfirmedRegistrationIssuesPersistentLoginOnlyAfterVerification(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/registration_play.php');
        self::assertIsString($source);
        $confirmation = strpos($source, "\$result = \$service->confirm(\$body['token'])");
        $cookie = strpos($source, "issue_remember_me_token((int)\$result['user']['id'])");
        $ack = strpos($source, 'json_ok($result)');
        self::assertNotFalse($confirmation);
        self::assertNotFalse($cookie);
        self::assertNotFalse($ack);
        self::assertGreaterThan($confirmation, $cookie);
        self::assertGreaterThan($cookie, $ack);
        self::assertMatchesRegularExpression(
            '/hash_equals\(\$_SESSION\[\'registration_confirmation_hash\'\],[\s\S]*?'
            . 'if \(\$action === \'confirm\'\) issue_remember_me_token\(\$uid\)/',
            $source
        );
        $enter = substr($source, strpos($source, "if (\$action === 'enter')"),
            strpos($source, "if (\$action === 'confirm') {") - strpos($source, "if (\$action === 'enter')"));
        self::assertStringNotContainsString('issue_remember_me_token', $enter,
            'Unconfirmed drafts must remain private and must not receive account login cookies.');
    }
}
