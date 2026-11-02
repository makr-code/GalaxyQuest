<?php

declare(strict_types=1);

namespace GalaxyQuest\Terrain;

use InvalidArgumentException;
use PDO;
use RuntimeException;

final class BodyTerrain
{
    public const VERSION = 1;
    public const RESOLUTION = 17;

    public static function shape(array $body): array
    {
        $payload = $body['payload_json'] ?? null;
        if (is_string($payload) && $payload !== '') {
            $payload = json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
        }
        $shape = $body['shape'] ?? (is_array($payload) ? ($payload['shape'] ?? null) : null);
        $small = preg_match('/comet|asteroid/', (string)$body['body_type'] . ' ' . ($body['planet_class'] ?? '')) === 1;
        if ($shape === null) {
            return [
                'version' => 1,
                'axes' => $small ? [1.45, 0.8, 0.95] : [1, 1, 1],
                'deformation' => $small ? 0.22 : 0,
            ];
        }
        if (
            !is_array($shape) || ($shape['version'] ?? 1) !== 1
            || !isset($shape['axes']) || !is_array($shape['axes'])
            || !array_is_list($shape['axes']) || count($shape['axes']) !== 3
        ) {
            throw new InvalidArgumentException('Invalid body shape');
        }
        foreach ($shape['axes'] as $axis) {
            if (!is_numeric($axis) || !is_finite((float)$axis) || (float)$axis < 0.5 || (float)$axis > 2) {
                throw new InvalidArgumentException('Body shape axes must be between 0.5 and 2');
            }
        }
        $deformation = $shape['deformation'] ?? 0;
        if (!is_numeric($deformation) || !is_finite((float)$deformation) || $deformation < 0 || $deformation > 0.35) {
            throw new InvalidArgumentException('Body shape deformation must be between 0 and 0.35');
        }
        return [
            'version' => 1, 'axes' => array_map('floatval', $shape['axes']),
            'deformation' => (float)$deformation,
        ];
    }

    public static function forColony(PDO $db, int $userId, int $colonyId): array
    {
        $read = $db->prepare(
            'SELECT cb.* FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id
             WHERE c.id = ? AND c.user_id = ?'
        );
        $read->execute([$colonyId, $userId]);
        $body = $read->fetch(PDO::FETCH_ASSOC);
        if (!$body) {
            throw new RuntimeException('Colony body not found or access denied', 404);
        }
        return self::manifest($db, $body);
    }

    public static function tiles(PDO $db, array $manifest, array $requested): array
    {
        if (!array_is_list($requested) || count($requested) < 1 || count($requested) > 16) {
            throw new InvalidArgumentException('Request between one and sixteen tiles');
        }
        foreach ($requested as $tile) {
            if (!is_array($tile)) {
                throw new InvalidArgumentException('Invalid tile address');
            }
            self::address($tile, (int)$manifest['max_lod']);
        }
        return array_map(static fn ($tile) => self::tile($db, $manifest, $tile), $requested);
    }

    public static function manifest(PDO $db, array $body): array
    {
        $read = $db->prepare('SELECT manifest_json FROM body_terrain_manifests WHERE body_id = ?');
        $read->execute([(int)$body['id']]);
        $saved = $read->fetchColumn();
        if ($saved !== false) {
            $manifest = json_decode((string)$saved, true, 512, JSON_THROW_ON_ERROR);
            if (!isset($manifest['shape'])) {
                // Existing v1 worlds keep their original spherical base.
                $manifest['shape'] = ['version' => 1, 'axes' => [1, 1, 1], 'deformation' => 0];
                $db->prepare('UPDATE body_terrain_manifests SET manifest_json = ? WHERE body_id = ?')
                    ->execute([json_encode($manifest, JSON_THROW_ON_ERROR), $body['id']]);
            }
            return $manifest;
        }
        $kind = strtolower((string)(($body['planet_class'] ?? '') ?: $body['body_type']));
        $biome = match (true) {
            preg_match('/gas|jovian|jupiter|ice_giant/', $kind) === 1 => 'gas',
            preg_match('/ice|frost|tundra|comet/', $kind) === 1 => 'ice',
            preg_match('/lava|volcan|molten/', $kind) === 1 => 'lava',
            preg_match('/desert|arid/', $kind) === 1 => 'desert',
            preg_match('/ocean|water/', $kind) === 1 => 'ocean',
            preg_match('/moon|asteroid|barren|rock/', $kind) === 1 => 'rock',
            default => 'terran',
        };
        $radius = max(0.1, (float)($body['diameter_km'] ?? 3000) / 2);
        $amplitude = min(8.0, $radius * 0.02);
        $manifest = [
            'body_id' => (int)$body['id'],
            'generator_version' => self::VERSION,
            'projection' => 'cube-sphere',
            'seed' => (int)sprintf('%u', crc32((string)$body['body_uid'])),
            'radius_km' => $radius,
            'amplitude_km' => $amplitude,
            'height_min_km' => -$amplitude,
            'height_max_km' => $amplitude,
            'sea_level_km' => 0,
            'biome' => $biome,
            'resolution' => self::RESOLUTION,
            'max_lod' => min(16, max(0, (int)ceil(log(max(1, $radius * M_PI / 2 / 0.008), 2)))),
            'tile_encoding' => 'uint16-json',
            'shape' => self::shape($body),
        ];
        if (preg_match('/comet/i', (string)$body['body_type'] . ' ' . ($body['planet_class'] ?? '')) === 1) {
            $manifest['settlement'] = self::valleySettlement($manifest);
        }
        $sql = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite'
            ? 'INSERT INTO body_terrain_manifests (body_id, manifest_json)
               VALUES (?, ?) ON CONFLICT(body_id) DO NOTHING'
            : 'INSERT INTO body_terrain_manifests (body_id, manifest_json)
               VALUES (?, ?) ON DUPLICATE KEY UPDATE body_id = body_id';
        $db->prepare($sql)->execute([$body['id'], json_encode($manifest, JSON_THROW_ON_ERROR)]);
        $read->execute([(int)$body['id']]);
        return json_decode((string)$read->fetchColumn(), true, 512, JSON_THROW_ON_ERROR);
    }

    public static function valleySettlement(array $manifest): array
    {
        $bestScore = INF;
        $best = null;
        // A bounded one-time search; no mesh generation or simulation tick.
        for ($face = 0; $face < 6; $face++) {
            for ($row = -4; $row <= 4; $row++) {
                for ($col = -4; $col <= 4; $col++) {
                    $u = $col / 5;
                    $v = $row / 5;
                    $direction = self::direction($face, $u, $v);
                    $height = self::height($manifest, $direction);
                    $neighbors = [];
                    $radii = [];
                    foreach ([[0.08, 0], [-0.08, 0], [0, 0.08], [0, -0.08]] as [$du, $dv]) {
                        $neighbor = self::direction($face, $u + $du, $v + $dv);
                        $neighbors[] = self::height($manifest, $neighbor);
                        $radii[] = self::surfaceRadius($manifest, $neighbor);
                    }
                    $slope = abs($radii[0] - $radii[1]) + abs($radii[2] - $radii[3]);
                    $shelter = array_sum($neighbors) / 4 - $height;
                    if ($height >= 0 || $shelter <= 0) {
                        continue;
                    }
                    $score = $height + $slope * 2 - $shelter;
                    if ($score < $bestScore) {
                        $bestScore = $score;
                        $best = [
                            'version' => 1,
                            'kind' => 'valley-dome',
                            'direction' => $direction,
                            'floor_height_km' => $height,
                            'dome_height_ratio' => 0.55,
                        ];
                    }
                }
            }
        }
        if ($best === null) {
            throw new RuntimeException('No finite valley settlement candidate');
        }
        return $best;
    }

    private static function surfaceRadius(array $manifest, array $direction): float
    {
        [$x, $y, $z] = $direction;
        [$a, $b, $c] = $manifest['shape']['axes'];
        $wave = 0.6 * ($x * $x - $y * $y) + 0.4 * $x * $z;
        $factor = (1 + $manifest['shape']['deformation'] * $wave)
            / sqrt(($x / $a) ** 2 + ($y / $b) ** 2 + ($z / $c) ** 2);
        return $manifest['radius_km'] * $factor + self::height($manifest, $direction);
    }

    public static function address(array $tile, int $maxLod): array
    {
        foreach (['face', 'lod', 'x', 'y'] as $field) {
            if (!isset($tile[$field]) || !is_int($tile[$field])) {
                throw new InvalidArgumentException('Tile addresses require integer face/lod/x/y');
            }
        }
        if ($tile['face'] < 0 || $tile['face'] > 5 || $tile['lod'] < 0 || $tile['lod'] > $maxLod) {
            throw new InvalidArgumentException('Tile face or LOD out of range');
        }
        $size = 1 << $tile['lod'];
        if ($tile['x'] < 0 || $tile['y'] < 0 || $tile['x'] >= $size || $tile['y'] >= $size) {
            throw new InvalidArgumentException('Tile coordinates out of range');
        }
        return array_intersect_key($tile, array_flip(['face', 'lod', 'x', 'y']));
    }

    public static function direction(int $face, float $u, float $v): array
    {
        $point = match ($face) {
            0 => [1, $v, -$u],
            1 => [-1, $v, $u],
            2 => [$u, 1, -$v],
            3 => [$u, -1, $v],
            4 => [$u, $v, 1],
            5 => [-$u, $v, -1],
            default => throw new InvalidArgumentException('Unknown cube face'),
        };
        $length = sqrt($point[0] ** 2 + $point[1] ** 2 + $point[2] ** 2);
        return array_map(static fn ($value) => $value / $length, $point);
    }

    public static function height(array $manifest, array $direction): float
    {
        if ($manifest['biome'] === 'gas') {
            return 0;
        }
        [$x, $y, $z] = $direction;
        $seed = ((int)$manifest['seed'] % 100000) / 1000;
        $broad = sin($x * 19 + $seed + sin($z * 11)) * cos($z * 17 - $seed + $y * 9);
        $ridge = (1 - abs(sin($x * 41 + $z * 29 + $y * 31 + $seed))) ** 3;
        $detail = sin($x * 173 + $y * 97 + $seed) * cos($z * 157 - $y * 79);
        $offset = $manifest['biome'] === 'ocean' ? 0.4 : 0.1;
        return max(-1, min(1, $broad * 0.6 + $ridge * 0.32 + $detail * 0.06 - $offset))
            * (float)$manifest['amplitude_km'];
    }

    public static function tile(PDO $db, array $manifest, array $requested): array
    {
        $tile = self::address($requested, (int)$manifest['max_lod']);
        if ((int)$manifest['generator_version'] !== self::VERSION) {
            throw new RuntimeException('Unsupported terrain generator version');
        }
        $params = [
            $manifest['body_id'], $manifest['generator_version'], $tile['face'],
            $tile['lod'], $tile['x'], $tile['y'],
        ];
        $read = $db->prepare(
            'SELECT tile_json FROM body_terrain_tiles
             WHERE body_id = ? AND generator_version = ? AND face = ? AND lod = ? AND tile_x = ? AND tile_y = ?'
        );
        $read->execute($params);
        $saved = $read->fetchColumn();
        if ($saved !== false) {
            return json_decode((string)$saved, true, 512, JSON_THROW_ON_ERROR);
        }
        $samples = [];
        $size = 1 << $tile['lod'];
        $resolution = (int)$manifest['resolution'];
        $min = (float)$manifest['height_min_km'];
        $range = (float)$manifest['height_max_km'] - $min;
        for ($row = 0; $row < $resolution; $row++) {
            for ($col = 0; $col < $resolution; $col++) {
                $u = (($tile['x'] + $col / ($resolution - 1)) / $size) * 2 - 1;
                $v = (($tile['y'] + $row / ($resolution - 1)) / $size) * 2 - 1;
                $height = self::height($manifest, self::direction($tile['face'], $u, $v));
                $samples[] = (int)round(($height - $min) / $range * 65535);
            }
        }
        $payload = $tile + [
            'body_id' => $manifest['body_id'], 'generator_version' => self::VERSION,
            'resolution' => $resolution, 'heights' => $samples,
        ];
        $sql = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite'
            ? 'INSERT INTO body_terrain_tiles (body_id, generator_version, face, lod, tile_x, tile_y, tile_json)
               VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'
            : 'INSERT INTO body_terrain_tiles (body_id, generator_version, face, lod, tile_x, tile_y, tile_json)
               VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE body_id = body_id';
        $db->prepare($sql)->execute([...$params, json_encode($payload, JSON_THROW_ON_ERROR)]);
        $read->execute($params);
        return json_decode((string)$read->fetchColumn(), true, 512, JSON_THROW_ON_ERROR);
    }
}
