<?php

declare(strict_types=1);

use GalaxyQuest\Simulation\Domain\ShardLocator;
use PHPUnit\Framework\TestCase;

final class ShardLocatorTest extends TestCase
{
    public function testLocateSystemReturnsDeterministicShard(): void
    {
        $actual = ShardLocator::locateSystem(1, 25001, 20000);

        $this->assertSame('g1:s2', $actual['shard_id']);
        $this->assertSame(1, $actual['shard_index']);
        $this->assertSame(2, $actual['shard_ordinal']);
        $this->assertSame(20001, $actual['system_min']);
        $this->assertSame(40000, $actual['system_max']);
    }

    public function testLocateSystemValidatesArguments(): void
    {
        $this->expectException(InvalidArgumentException::class);
        ShardLocator::locateSystem(0, 1, 20000);
    }
}
