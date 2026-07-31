<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use GalaxyQuest\Galaxy\Application\GetStarsRangeService;
use GalaxyQuest\Galaxy\Domain\Interfaces\GalaxyRepositoryInterface;

/**
 * Unit tests for GetStarsRangeService.
 *
 * Verifies service orchestration, validation, and result formatting.
 */
final class GetStarsRangeServiceTest extends TestCase
{
    private GetStarsRangeService $service;
    private \PHPUnit\Framework\MockObject\MockObject $mockRepository;

    protected function setUp(): void
    {
        $this->mockRepository = $this->createMock(GalaxyRepositoryInterface::class);
        $this->service = new GetStarsRangeService($this->mockRepository);
    }

    public function testExecuteWithValidRange(): void
    {
        $mockSystems = [
            ['x' => 100, 'y' => 100, 'name' => 'Alpha'],
            ['x' => 110, 'y' => 110, 'name' => 'Beta'],
        ];

        $this->mockRepository->expects($this->once())
            ->method('getSystemsInRange')
            ->with(100, 200, 100, 200)
            ->willReturn($mockSystems);

        $this->mockRepository->expects($this->once())
            ->method('countSystemsInRange')
            ->with(100, 200, 100, 200)
            ->willReturn(2);

        $result = $this->service->execute(100, 200, 100, 200);

        $this->assertEquals($mockSystems, $result->systems);
        $this->assertEquals(2, $result->totalCount);
        $this->assertEquals(['x' => 100, 'y' => 100], $result->rangeMin);
        $this->assertEquals(['x' => 200, 'y' => 200], $result->rangeMax);
    }

    public function testExecuteThrowsOnInvalidRange(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->mockRepository->expects($this->never())->method('getSystemsInRange');

        $this->service->execute(200, 100, 100, 100); // min > max
    }

    public function testResultToArray(): void
    {
        $mockSystems = [
            ['x' => 50, 'y' => 50, 'name' => 'Sol'],
        ];

        $this->mockRepository->expects($this->once())
            ->method('getSystemsInRange')
            ->willReturn($mockSystems);

        $this->mockRepository->expects($this->once())
            ->method('countSystemsInRange')
            ->willReturn(1);

        $result = $this->service->execute(0, 100, 0, 100);
        $array = $result->toArray();

        $this->assertArrayHasKey('systems', $array);
        $this->assertArrayHasKey('total_count', $array);
        $this->assertArrayHasKey('range_min', $array);
        $this->assertArrayHasKey('range_max', $array);
        $this->assertEquals($mockSystems, $array['systems']);
        $this->assertEquals(1, $array['total_count']);
    }

    public function testExecuteWithEmptyResult(): void
    {
        $this->mockRepository->expects($this->once())
            ->method('getSystemsInRange')
            ->willReturn([]);

        $this->mockRepository->expects($this->once())
            ->method('countSystemsInRange')
            ->willReturn(0);

        $result = $this->service->execute(0, 50, 0, 50);

        $this->assertEquals([], $result->systems);
        $this->assertEquals(0, $result->totalCount);
    }
}
