<?php
declare(strict_types=1);

final class PlanetReservation {
    public static function withLock(PDO $db, int $planetId, Closure $work): mixed {
        $key = 'gq_planet_' . $planetId;
        $stmt = $db->prepare('SELECT GET_LOCK(?, 5)');
        $stmt->execute([$key]);
        if ((int)$stmt->fetchColumn() !== 1) throw new RuntimeException('World allocation is busy. Please retry.', 503);
        try {
            return $work();
        } finally {
            $db->prepare('SELECT RELEASE_LOCK(?)')->execute([$key]);
        }
    }

    public static function isReserved(PDO $db, int $planetId): bool {
        $stmt = $db->prepare('SELECT token FROM registration_drafts WHERE planet_id = ? AND expires_at > UTC_TIMESTAMP() FOR UPDATE');
        $stmt->execute([$planetId]);
        return $stmt->fetchColumn() !== false;
    }
}
