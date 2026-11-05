<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PDO;
use PDOException;
use PHPUnit\Framework\TestCase;
use PromptCatalogRepository;
use RuntimeException;

require_once __DIR__ . '/../../api/llm_soc/PromptCatalogRepository.php';

final class PromptCatalogRepositoryTest extends TestCase
{
    public function testDatabaseQueryFailureIsNotReportedAsAnEmptyProfileList(): void
    {
        $database = $this->createMock(PDO::class);
        $database->expects(self::once())
            ->method('query')
            ->willThrowException(new PDOException('database unavailable'));

        $repository = new PromptCatalogRepository();

        $this->expectException(PDOException::class);
        $repository->loadDbProfiles($database);
    }

    public function testFailedDatabaseQueryResultIsNotReportedAsAnEmptyProfileList(): void
    {
        $database = $this->createMock(PDO::class);
        $database->expects(self::once())
            ->method('query')
            ->willReturn(false);

        $repository = new PromptCatalogRepository();

        $this->expectException(RuntimeException::class);
        $repository->loadDbProfiles($database);
    }
}
