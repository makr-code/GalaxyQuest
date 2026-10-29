<?php

declare(strict_types=1);

namespace GalaxyQuest\Simulation\Domain;

final class ShardLocator
{
    /**
     * @return array{
     *   shard_id:string,
     *   galaxy_index:int,
     *   shard_index:int,
     *   shard_ordinal:int,
     *   system_min:int,
     *   system_max:int
     * }
     */
    public static function locateSystem(int $galaxyIndex, int $systemIndex, int $systemsPerShard): array
    {
        if ($galaxyIndex < 1) {
            throw new \InvalidArgumentException('galaxyIndex must be >= 1');
        }
        if ($systemIndex < 1) {
            throw new \InvalidArgumentException('systemIndex must be >= 1');
        }
        if ($systemsPerShard < 1) {
            throw new \InvalidArgumentException('systemsPerShard must be >= 1');
        }

        $shardIndex = intdiv($systemIndex - 1, $systemsPerShard);
        $systemMin = ($shardIndex * $systemsPerShard) + 1;
        $systemMax = $systemMin + $systemsPerShard - 1;

        $shardOrdinal = $shardIndex + 1;

        return [
            'shard_id' => sprintf('g%d:s%d', $galaxyIndex, $shardOrdinal),
            'galaxy_index' => $galaxyIndex,
            'shard_index' => $shardIndex,
            'shard_ordinal' => $shardOrdinal,
            'system_min' => $systemMin,
            'system_max' => $systemMax,
        ];
    }
}
