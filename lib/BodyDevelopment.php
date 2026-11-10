<?php

declare(strict_types=1);

namespace GalaxyQuest\Terrain;

use InvalidArgumentException;
use LogicException;
use PDO;
use UnexpectedValueException;

final class BodyDevelopment
{
    public const VERSION = 1;
    public const MAX_SETTLEMENTS = 12;

    public static function enabled(): bool
    {
        return defined('BODY_DEVELOPMENT_ENABLED') && BODY_DEVELOPMENT_ENABLED === 1;
    }

    public static function settlementCount(int $population, bool $built): int
    {
        if ($population < 0) {
            throw new InvalidArgumentException('Development population cannot be negative.');
        }
        if ($population === 0 && !$built) {
            return 0;
        }
        $count = 1;
        for ($threshold = 2000; $population >= $threshold && $count < self::MAX_SETTLEMENTS; $threshold *= 2) {
            $count++;
        }
        return $count;
    }

    /** The caller holds the colony lock inside its settlement transaction. */
    public static function observe(PDO $db, array $colony, int $peakPopulation, int $now): ?array
    {
        if (!$db->inTransaction()) {
            throw new LogicException('Body development requires the colony settlement transaction.');
        }
        $bodyId = (int)($colony['body_id'] ?? 0);
        $colonyId = (int)($colony['id'] ?? 0);
        if ($bodyId <= 0 || $colonyId <= 0 || $peakPopulation < 0 || $now < 0) {
            throw new InvalidArgumentException('Invalid body development observation.');
        }
        $peakPopulation = max($peakPopulation, (int)$colony['population']);
        $built = $db->prepare('SELECT 1 FROM buildings WHERE colony_id = ? AND level > 0 LIMIT 1');
        $built->execute([$colonyId]);
        $count = self::settlementCount($peakPopulation, $built->fetchColumn() !== false);
        $current = self::read($db, $bodyId);
        if (
            $count === 0 || ($current !== null && $current['peak_population'] >= $peakPopulation
            && $current['founded_count'] >= $count)
        ) {
            return $current;
        }
        $columns = '(body_id, version, peak_population, founded_count, initialized_at, observed_at)';
        $upsert = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite'
            ? "INSERT INTO body_development $columns
               VALUES (?, 1, ?, ?, ?, ?) ON CONFLICT(body_id) DO UPDATE SET
               peak_population = MAX(peak_population, excluded.peak_population),
               founded_count = MAX(founded_count, excluded.founded_count),
               observed_at = MAX(observed_at, excluded.observed_at)"
            : "INSERT INTO body_development $columns
               VALUES (?, 1, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE
               peak_population = GREATEST(peak_population, VALUES(peak_population)),
               founded_count = GREATEST(founded_count, VALUES(founded_count)),
               observed_at = GREATEST(observed_at, VALUES(observed_at))";
        $db->prepare($upsert)->execute([$bodyId, $peakPopulation, $count, $now, $now]);
        return self::read($db, $bodyId);
    }

    public static function read(PDO $db, int $bodyId): ?array
    {
        if ($bodyId <= 0) {
            throw new InvalidArgumentException('Body id must be positive.');
        }
        $query = $db->prepare(
            'SELECT body_id, version, peak_population, founded_count, initialized_at, observed_at
             FROM body_development WHERE body_id = ?'
        );
        $query->execute([$bodyId]);
        $row = $query->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            return null;
        }
        $result = array_map(static fn ($n): int => (int)$n, $row);
        if (
            $result['version'] !== self::VERSION || $result['peak_population'] < 0
            || $result['founded_count'] < 1 || $result['founded_count'] > self::MAX_SETTLEMENTS
            || $result['founded_count'] !== max(1, self::settlementCount($result['peak_population'], false))
            || $result['initialized_at'] < 0 || $result['observed_at'] < $result['initialized_at']
        ) {
            throw new UnexpectedValueException('Invalid persisted body development.');
        }
        return $result;
    }
}
