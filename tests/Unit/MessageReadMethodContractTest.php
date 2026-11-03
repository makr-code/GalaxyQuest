<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class MessageReadMethodContractTest extends TestCase
{
    public function testReadingMessageRequiresPostAndCsrfBeforeChangingReadState(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/messages.php');
        self::assertIsString($source);

        $caseOffset = strpos($source, "case 'read':");
        $nextCaseOffset = strpos($source, "case 'send':", $caseOffset);
        self::assertNotFalse($caseOffset);
        self::assertNotFalse($nextCaseOffset);
        $handler = substr($source, $caseOffset, $nextCaseOffset - $caseOffset);

        $postGuardOffset = strpos($handler, "only_method('POST');");
        $csrfGuardOffset = strpos($handler, 'verify_csrf();');
        $updateOffset = strpos($handler, 'UPDATE messages SET is_read = 1');
        self::assertNotFalse($postGuardOffset);
        self::assertNotFalse($csrfGuardOffset);
        self::assertNotFalse($updateOffset);
        self::assertLessThan($csrfGuardOffset, $postGuardOffset);
        self::assertLessThan($updateOffset, $csrfGuardOffset);
        self::assertStringContainsString('WHERE id = ? AND receiver_id = ?', $handler);
    }
}
