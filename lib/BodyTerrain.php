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

    public static function solid(array $body): ?array
    {
        $payload = $body['payload_json'] ?? null;
        if (is_string($payload) && $payload !== '') {
            $payload = json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
        }
        $solid = is_array($payload) ? ($payload['solid'] ?? null) : null;
        if ($solid === null) {
            if (preg_match('/comet/i', (string)$body['body_type'] . ' ' . ($body['planet_class'] ?? '')) !== 1) {
                return null;
            }
            return [
                'version' => 1,
                'blend' => 0.18,
                'lobes' => [
                    ['center' => [-0.5, 0, 0], 'axes' => [0.85, 0.7, 0.65]],
                    ['center' => [0.65, 0.05, 0], 'axes' => [0.6, 0.5, 0.5]],
                ],
                'cuts' => [['center' => [-0.6, 0.65, 0.15], 'radius' => 0.18]],
            ];
        }
        if (
            !is_array($solid) || ($solid['version'] ?? null) !== 1
            || !isset($solid['lobes'], $solid['cuts']) || !is_array($solid['lobes'])
            || !is_array($solid['cuts']) || !array_is_list($solid['lobes']) || !array_is_list($solid['cuts'])
            || count($solid['lobes']) < 1 || count($solid['lobes']) > 4 || count($solid['cuts']) > 8
        ) {
            throw new InvalidArgumentException('Invalid body solid');
        }
        $result = [
            'version' => 1, 'blend' => self::boundedNumber($solid['blend'] ?? null, 0.01, 0.4),
            'lobes' => [], 'cuts' => [],
        ];
        foreach ($solid['lobes'] as $lobe) {
            if (!is_array($lobe)) {
                throw new InvalidArgumentException('Invalid solid lobe');
            }
            $result['lobes'][] = [
                'center' => self::solidVector($lobe['center'] ?? null, -2, 2),
                'axes' => self::solidVector($lobe['axes'] ?? null, 0.1, 2),
            ];
        }
        foreach ($solid['cuts'] as $cut) {
            if (!is_array($cut)) {
                throw new InvalidArgumentException('Invalid solid cut');
            }
            $result['cuts'][] = [
                'center' => self::solidVector($cut['center'] ?? null, -2, 2),
                'radius' => self::boundedNumber($cut['radius'] ?? null, 0.02, 0.8),
            ];
        }
        return $result;
    }

    private static function boundedNumber(mixed $value, float $min, float $max): float
    {
        if ((!is_int($value) && !is_float($value)) || !is_finite((float)$value) || $value < $min || $value > $max) {
            throw new InvalidArgumentException('Solid parameters must be finite numbers within bounds');
        }
        return (float)$value;
    }

    private static function solidVector(mixed $vector, float $min, float $max): array
    {
        if (!is_array($vector) || !array_is_list($vector) || count($vector) !== 3) {
            throw new InvalidArgumentException('Solid vectors require three coordinates');
        }
        return array_map(static fn ($value) => self::boundedNumber($value, $min, $max), $vector);
    }

    public static function solidDistance(array $solid, array $point): float
    {
        $distance = INF;
        foreach ($solid['lobes'] as $lobe) {
            $lengthSquared = 0;
            for ($axis = 0; $axis < 3; $axis++) {
                $lengthSquared += (($point[$axis] - $lobe['center'][$axis]) / $lobe['axes'][$axis]) ** 2;
            }
            $next = (sqrt($lengthSquared) - 1) * min($lobe['axes']);
            $h = max($solid['blend'] - abs($distance - $next), 0) / $solid['blend'];
            $distance = min($distance, $next) - $h * $h * $solid['blend'] / 4;
        }
        foreach ($solid['cuts'] as $cut) {
            $lengthSquared = 0;
            for ($axis = 0; $axis < 3; $axis++) {
                $lengthSquared += ($point[$axis] - $cut['center'][$axis]) ** 2;
            }
            $distance = max($distance, $cut['radius'] - sqrt($lengthSquared));
        }
        return $distance;
    }

    public static function solidBound(array $solid): float
    {
        $bound = 0.0;
        foreach ($solid['lobes'] as $lobe) {
            $centerLength = sqrt(array_sum(array_map(static fn ($n) => $n * $n, $lobe['center'])));
            $axis = max($lobe['axes']);
            // Each smooth minimum can reduce approximate distance by at most blend / 4.
            $padding = $solid['blend'] * max(1, (count($solid['lobes']) - 1) * $axis / (4 * min($lobe['axes'])));
            $bound = max($bound, $centerLength + $axis + $padding);
        }
        return $bound;
    }

    private static function geology(array $manifest): array
    {
        $erosion = match ($manifest['biome']) {
            'terran', 'ocean' => 0.8,
            'lava' => 0.6,
            'ice' => 0.1,
            default => 0,
        };
        $tectonics = match ($manifest['biome']) {
            'terran', 'ocean' => 0.6,
            'lava' => 0.8,
            default => 0,
        };
        $craters = [];
        if ($manifest['biome'] !== 'gas') {
            $random = static fn (int $index): float =>
                (float)sprintf('%u', crc32($manifest['seed'] . ':geology:' . $index)) / 4294967295;
            for ($index = 0; $index < 32; $index++) {
                $y = $random($index * 4) * 2 - 1;
                $azimuth = $random($index * 4 + 1) * 2 * M_PI;
                $ring = sqrt(max(0, 1 - $y * $y));
                $radius = 0.015 + $random($index * 4 + 2) * 0.165;
                $craters[] = [
                    'direction' => [$ring * cos($azimuth), $y, $ring * sin($azimuth)],
                    'angular_radius' => $radius,
                    'depth_km' => min(
                        $manifest['amplitude_km'] * 0.5,
                        $manifest['radius_km'] * $radius * 0.1
                    ) * (0.4 + $random($index * 4 + 3) * 0.6),
                ];
            }
            // Even overlapping pits fit the declared height envelope.
            $total = array_sum(array_column($craters, 'depth_km'));
            $scale = min(1, $manifest['amplitude_km'] * 0.5 / max($total, PHP_FLOAT_MIN));
            foreach ($craters as &$crater) {
                $crater['depth_km'] *= $scale;
            }
            unset($crater);
        }
        return ['version' => 1, 'erosion' => $erosion, 'tectonics' => $tectonics, 'craters' => $craters];
    }

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
            'height_min_km' => -$amplitude * 2,
            'height_max_km' => $amplitude * 2,
            'sea_level_km' => 0,
            'biome' => $biome,
            'resolution' => self::RESOLUTION,
            'max_lod' => min(16, max(0, (int)ceil(log(max(1, $radius * M_PI / 2 / 0.008), 2)))),
            'tile_encoding' => 'uint16-json',
            'shape' => self::shape($body),
            'solid' => self::solid($body),
        ];
        $manifest['geology'] = self::geology($manifest);
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

    public static function surfaceRadius(array $manifest, array $direction): float
    {
        if (isset($manifest['solid'])) {
            $solid = $manifest['solid'];
            $bound = self::solidBound($solid);
            $outer = $bound;
            $previous = self::solidDistance($solid, array_map(static fn ($n) => $n * $outer, $direction));
            for ($step = 1; $step <= 128; $step++) {
                $inner = $bound * (1 - $step / 128);
                $distance = self::solidDistance($solid, array_map(static fn ($n) => $n * $inner, $direction));
                if ($previous > 0 && $distance <= 0) {
                    for ($iteration = 0; $iteration < 24; $iteration++) {
                        $middle = ($inner + $outer) / 2;
                        $value = self::solidDistance($solid, array_map(static fn ($n) => $n * $middle, $direction));
                        if ($value <= 0) {
                            $inner = $middle;
                        } else {
                            $outer = $middle;
                        }
                    }
                    return $manifest['radius_km'] * (($inner + $outer) / 2) + self::height($manifest, $direction);
                }
                $outer = $inner;
                $previous = $distance;
            }
            throw new RuntimeException('Solid has no radial surface intersection');
        }
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
        $geology = $manifest['geology'] ?? null;
        $erosion = $geology['erosion'] ?? 0;
        $height = max(-1, min(1, $broad * 0.6 + $ridge * 0.32 + $detail * 0.06 * (1 - $erosion) - $offset))
            * (float)$manifest['amplitude_km'];
        if ($geology === null) {
            return $height;
        }
        $value = sin($x * 5 + $seed) * cos($z * 4 - $seed + $y * 3);
        $height += $manifest['amplitude_km'] * $geology['tectonics'] * 0.35 * ((1 - abs($value)) ** 8 - 0.15);
        foreach ($geology['craters'] as $crater) {
            $dot = $x * $crater['direction'][0] + $y * $crater['direction'][1] + $z * $crater['direction'][2];
            $q = acos(max(-1, min(1, $dot))) / $crater['angular_radius'];
            if ($q < 1.6) {
                $bowl = -max(0, 1 - $q * $q) ** 2;
                $rim = 0.25 * exp(-(($q - 1) / 0.16) ** 2);
                $height += ($bowl + $rim) * $crater['depth_km'] * (1 - $erosion * 0.85);
            }
        }
        return $height;
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
                $samples[] = max(0, min(65535, (int)round(($height - $min) / $range * 65535)));
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
