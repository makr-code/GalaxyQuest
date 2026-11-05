<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class AuthReadErrorContractTest extends TestCase
{
    public function testMeReadOnlyTreatsOnlyMissingFactionQuestTableAsOptional(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/auth.php');
        self::assertIsString($source);

        $start = strpos($source, 'function handle_me()');
        $end = strpos($source, "\nfunction handle_dev_tools_status(", $start);
        self::assertNotFalse($start);
        self::assertNotFalse($end);

        $handler = substr($source, $start, $end - $start);
        self::assertStringContainsString('catch (PDOException $error)', $handler);
        self::assertStringContainsString("if (\$error->getCode() !== '42S02')", $handler);
        self::assertStringContainsString('throw $error;', $handler);
        self::assertStringNotContainsString('catch (Throwable', $handler);
    }
}
