<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class TraderDashboardReadMethodContractTest extends TestCase
{
    public function testDashboardEndpointRequiresGetBeforeDatabaseAccess(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/traders_dashboard.php');
        self::assertIsString($source);

        $authOffset = strpos($source, 'require_auth();');
        $methodOffset = strpos($source, "only_method('GET');");
        $databaseOffset = strpos($source, '$db = get_db();');

        self::assertNotFalse($authOffset);
        self::assertNotFalse($methodOffset);
        self::assertNotFalse($databaseOffset);
        self::assertLessThan($methodOffset, $authOffset);
        self::assertLessThan($databaseOffset, $methodOffset);
    }
}
