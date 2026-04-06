<?php
declare(strict_types=1);

header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=31536000, immutable');

$action = strtolower((string)($_GET['action'] ?? 'planet_map'));
$allowedActions = ['planet_map', 'object_map'];
if (!in_array($action, $allowedActions, true)) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'invalid action']);
    exit;
}

$gdAvailable = extension_loaded('gd');

$map = strtolower((string)($_GET['map'] ?? 'albedo'));
$allowedMaps = ['albedo', 'bump', 'normal', 'emissive', 'city', 'cloud'];
if (!in_array($map, $allowedMaps, true)) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'invalid map']);
    exit;
}

$size = (int)($_GET['size'] ?? 256);
$size = max(128, min(1024, $size));
$height = max(64, (int)floor($size / 2));

$algo = (string)($_GET['algo'] ?? 'v1');
$descriptor = decode_descriptor((string)($_GET['d'] ?? ''));
if (!is_array($descriptor)) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'invalid descriptor']);
    exit;
}

$objectType = sanitize_object_type((string)($_GET['object'] ?? 'generic'));
$cacheScope = $action === 'planet_map'
    ? 'planet'
    : ('object' . DIRECTORY_SEPARATOR . $objectType);
$cacheDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'generated' . DIRECTORY_SEPARATOR . 'textures' . DIRECTORY_SEPARATOR . $cacheScope;
if (!is_dir($cacheDir) && !@mkdir($cacheDir, 0775, true) && !is_dir($cacheDir)) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'cache dir unavailable']);
    exit;
}

$normalizedDescriptor = normalize_descriptor($descriptor);
$signature = hash('sha256', $action . '|' . $objectType . '|' . $map . '|' . $size . '|' . $algo . '|' . json_encode($normalizedDescriptor, JSON_UNESCAPED_SLASHES));
$ext = $gdAvailable ? 'png' : 'svg';
$cacheFile = $cacheDir . DIRECTORY_SEPARATOR . $signature . '.' . $ext;
$lockFile = $cacheDir . DIRECTORY_SEPARATOR . $signature . '.lock';

$lockHandle = @fopen($lockFile, 'c+');
if ($lockHandle !== false) {
    @flock($lockHandle, LOCK_EX);
}

if (!is_file($cacheFile)) {
    $ok = $gdAvailable
        ? render_planet_map_png($cacheFile, $map, $size, $height, $normalizedDescriptor)
        : render_planet_map_svg($cacheFile, $map, $size, $height, $normalizedDescriptor);
    if (!$ok) {
        if ($lockHandle !== false) {
            @flock($lockHandle, LOCK_UN);
            @fclose($lockHandle);
        }
        header('Content-Type: application/json; charset=utf-8');
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'texture generation failed']);
        exit;
    }
}

if ($lockHandle !== false) {
    @flock($lockHandle, LOCK_UN);
    @fclose($lockHandle);
}

$etag = '"' . $signature . '"';
header('ETag: ' . $etag);
if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && trim((string)$_SERVER['HTTP_IF_NONE_MATCH']) === $etag) {
    http_response_code(304);
    exit;
}

header('Content-Type: ' . ($gdAvailable ? 'image/png' : 'image/svg+xml; charset=utf-8'));
header('Content-Length: ' . (string)filesize($cacheFile));
readfile($cacheFile);
exit;

function decode_descriptor(string $encoded): ?array
{
    if ($encoded === '') return null;
    $decoded = base64_decode(strtr($encoded, ' ', '+'), true);
    if ($decoded === false) return null;
    $data = json_decode($decoded, true);
    return is_array($data) ? $data : null;
}

function normalize_descriptor(array $descriptor): array
{
    $variant = strtolower((string)($descriptor['variant'] ?? 'rocky'));
    $palette = is_array($descriptor['palette'] ?? null) ? $descriptor['palette'] : [];
    return [
        'seed' => (int)($descriptor['seed'] ?? 0),
        'variant' => $variant,
        'palette' => [
            'base' => sanitize_hex((string)($palette['base'] ?? '#8aa2bf'), '#8aa2bf'),
            'secondary' => sanitize_hex((string)($palette['secondary'] ?? '#6f879e'), '#6f879e'),
            'accent' => sanitize_hex((string)($palette['accent'] ?? '#a8c0da'), '#a8c0da'),
            'ice' => sanitize_hex((string)($palette['ice'] ?? '#e0ecf8'), '#e0ecf8'),
        ],
        'banding' => clamp01((float)($descriptor['banding'] ?? 0.16)),
        'clouds' => clamp01((float)($descriptor['clouds'] ?? 0.18)),
        'craters' => clamp01((float)($descriptor['craters'] ?? 0.12)),
        'ice_caps' => clamp01((float)($descriptor['ice_caps'] ?? 0.0)),
        'glow' => clamp01((float)($descriptor['glow'] ?? 0.0)),
        'city_density' => clamp01((float)($descriptor['city_density'] ?? 0.0)),
        'city_grid' => clamp01((float)($descriptor['city_grid'] ?? 0.0)),
        'city_warmth' => clamp01((float)($descriptor['city_warmth'] ?? 0.0)),
    ];
}

function sanitize_hex(string $value, string $fallback): string
{
    $v = ltrim(trim($value), '#');
    if (!preg_match('/^[0-9a-fA-F]{6}$/', $v)) {
        return $fallback;
    }
    return '#' . strtolower($v);
}

function clamp01(float $value): float
{
    return max(0.0, min(1.0, $value));
}

function sanitize_object_type(string $value): string
{
    $raw = strtolower(trim($value));
    if ($raw === '') {
        return 'generic';
    }
    $clean = preg_replace('/[^a-z0-9_-]+/', '_', $raw);
    $clean = trim((string)$clean, '_');
    return $clean !== '' ? $clean : 'generic';
}

function hex_to_rgb(string $hex): array
{
    $clean = ltrim($hex, '#');
    return [
        hexdec(substr($clean, 0, 2)),
        hexdec(substr($clean, 2, 2)),
        hexdec(substr($clean, 4, 2)),
    ];
}

function noise2(int $seed, float $x, float $y): float
{
    $sx = sin(($x * 12.9898) + ($y * 78.233) + ($seed * 0.00021)) * 43758.5453;
    return $sx - floor($sx);
}

function fbm(int $seed, float $u, float $v, int $octaves = 4): float
{
    $total = 0.0;
    $amp = 0.5;
    $freq = 1.0;
    $norm = 0.0;
    for ($i = 0; $i < $octaves; $i++) {
        $total += noise2($seed + $i * 97, $u * $freq, $v * $freq) * $amp;
        $norm += $amp;
        $amp *= 0.5;
        $freq *= 2.07;
    }
    return $norm > 0 ? $total / $norm : 0.0;
}

function lerp_color(array $a, array $b, float $t): array
{
    $p = max(0.0, min(1.0, $t));
    return [
        (int)round($a[0] + ($b[0] - $a[0]) * $p),
        (int)round($a[1] + ($b[1] - $a[1]) * $p),
        (int)round($a[2] + ($b[2] - $a[2]) * $p),
    ];
}

function allocate_rgba(GdImage $image, int $r, int $g, int $b, int $alpha): int
{
    return imagecolorallocatealpha(
        $image,
        max(0, min(255, $r)),
        max(0, min(255, $g)),
        max(0, min(255, $b)),
        max(0, min(127, $alpha))
    );
}

function render_planet_map_png(string $path, string $map, int $width, int $height, array $descriptor): bool
{
    $img = imagecreatetruecolor($width, $height);
    if (!$img) return false;
    imagealphablending($img, false);
    imagesavealpha($img, true);

    $seed = (int)($descriptor['seed'] ?? 0);
    $variant = (string)($descriptor['variant'] ?? 'rocky');
    $palette = is_array($descriptor['palette'] ?? null) ? $descriptor['palette'] : [];
    $base = hex_to_rgb((string)($palette['base'] ?? '#8aa2bf'));
    $secondary = hex_to_rgb((string)($palette['secondary'] ?? '#6f879e'));
    $accent = hex_to_rgb((string)($palette['accent'] ?? '#a8c0da'));
    $ice = hex_to_rgb((string)($palette['ice'] ?? '#e0ecf8'));
    $banding = (float)($descriptor['banding'] ?? 0.16);
    $clouds = (float)($descriptor['clouds'] ?? 0.18);
    $craters = (float)($descriptor['craters'] ?? 0.12);
    $iceCaps = (float)($descriptor['ice_caps'] ?? 0.0);
    $glow = (float)($descriptor['glow'] ?? 0.0);
    $hasCityDensity = array_key_exists('city_density', $descriptor);
    $hasCityGrid = array_key_exists('city_grid', $descriptor);
    $cityDensityInput = (float)($descriptor['city_density'] ?? 0.0);
    $cityGridInput = (float)($descriptor['city_grid'] ?? 0.0);

    $defaultCityDensity = 0.0;
    $defaultCityGrid = 0.0;
    $cityVariantBoost = 0.0;
    if ($variant === 'rocky') {
        $defaultCityDensity = 0.62;
        $defaultCityGrid = 0.58;
        $cityVariantBoost = 1.0;
    } elseif ($variant === 'desert') {
        $defaultCityDensity = 0.52;
        $defaultCityGrid = 0.64;
        $cityVariantBoost = 0.92;
    } elseif ($variant === 'ocean') {
        $defaultCityDensity = 0.34;
        $defaultCityGrid = 0.42;
        $cityVariantBoost = 0.68;
    }
    $cityDensity = $hasCityDensity ? clamp01($cityDensityInput) : $defaultCityDensity;
    $cityGrid = $hasCityGrid ? clamp01($cityGridInput) : $defaultCityGrid;

    for ($y = 0; $y < $height; $y++) {
        $v = $height > 1 ? ($y / ($height - 1)) : 0.0;
        $lat = ($v - 0.5) * M_PI;
        for ($x = 0; $x < $width; $x++) {
            $u = $width > 1 ? ($x / ($width - 1)) : 0.0;
            $n1 = fbm($seed, $u * 3.4, $v * 3.4, 4);
            $n2 = fbm($seed + 177, $u * 8.3, $v * 8.3, 3);
            $swirls = 0.5 + (sin(($u * M_PI * 2 * (1.2 + $banding * 5.2)) + ($n1 * 3.4) + $seed * 0.0002) * 0.5);
            $tone = $n1 * 0.6 + $n2 * 0.4;
            if ($variant === 'gas') {
                $tone = $tone * 0.35 + $swirls * 0.65;
            } elseif ($variant === 'ocean') {
                $tone = $tone * 0.55 + (1 - abs($lat) / (M_PI / 2)) * 0.2;
            } elseif ($variant === 'lava') {
                $tone = $tone * 0.42 + pow($n2, 1.7) * 0.58;
            }

            $color = lerp_color($base, $secondary, $tone);
            if ($variant === 'gas') {
                $accentMix = max(0.0, ($swirls - 0.62) / 0.38) * (0.25 + $banding * 0.5);
                $color = lerp_color($color, $accent, $accentMix);
            } elseif ($variant === 'lava') {
                $fissure = max(0.0, ($n2 - 0.72) / 0.28);
                $color = lerp_color($color, $accent, $fissure * (0.45 + $glow * 0.35));
            } else {
                $ridge = max(0.0, ($n2 - 0.68) / 0.32);
                $color = lerp_color($color, $accent, $ridge * 0.32);
            }

            if ($iceCaps > 0.0) {
                $polar = max(0.0, (abs($lat) - ((1 - $iceCaps) * 1.08)) / 0.34);
                if ($polar > 0.0) {
                    $color = lerp_color($color, $ice, min(1.0, $polar));
                }
            }

            if ($craters > 0.02 && $variant !== 'gas' && $variant !== 'ocean') {
                $c = max(0.0, (fbm($seed + 631, $u * 9.7, $v * 9.7, 3) - (0.84 - $craters * 0.35)) / 0.16);
                if ($c > 0.0) {
                    $color = lerp_color($color, [
                        (int)round($color[0] * 0.56),
                        (int)round($color[1] * 0.56),
                        (int)round($color[2] * 0.56),
                    ], $c);
                }
            }

            $cloudMask = 0.0;
            if ($clouds > 0.02) {
                $cloudMask = max(0.0, (fbm($seed + 911, $u * 5.1, $v * 5.1, 4) - (0.62 - $clouds * 0.22)) / 0.38);
            }

            $relief = max(0.0, min(1.0, ($n1 * 0.58) + ($n2 * 0.42)));
            $bumpShade = (int)round(45 + $relief * 210);
            $emissiveStrength = 0.0;
            $cityStrength = 0.0;
            if ($variant === 'lava') {
                $emissiveStrength = max(0.0, ($n2 - 0.68) / 0.32) * (0.45 + $glow * 0.45);
            } elseif (in_array($variant, ['ocean', 'rocky', 'desert'], true)) {
                $emissiveStrength = max(0.0, (fbm($seed + 1401, $u * 11.5, $v * 11.5, 3) - 0.83) / 0.17) * $glow * 0.45;
                $cityCluster = fbm($seed + 1843, $u * 14.0, $v * 14.0, 4);
                $cityGridNoise = fbm($seed + 1961, $u * 38.0, $v * 38.0, 2);
                $clusterThreshold = 0.78 - $cityDensity * 0.32;
                $clusterSpan = 0.22 + (1.0 - $cityDensity) * 0.30;
                $gridThreshold = 0.74 - $cityGrid * 0.34;
                $gridSpan = 0.26 + (1.0 - $cityGrid) * 0.26;
                $cityStrength = max(0.0, ($cityCluster - $clusterThreshold) / $clusterSpan)
                    * max(0.0, ($cityGridNoise - $gridThreshold) / $gridSpan);
                $cityStrength *= (0.16 + $glow * 0.72 + $cityDensity * 0.34) * $cityVariantBoost;
            }
            $emissiveShade = (int)round(max(0.0, min(1.0, $emissiveStrength)) * 255);
            $cityShade = (int)round(max(0.0, min(1.0, $cityStrength)) * 255);
            $cloudShade = (int)round(max(0.0, min(1.0, $cloudMask * $clouds)) * 255);

            if ($map === 'albedo') {
                $final = $cloudMask > 0.0
                    ? lerp_color($color, [244, 246, 250], $cloudMask * $clouds * 0.88)
                    : $color;
                $col = allocate_rgba($img, $final[0], $final[1], $final[2], 0);
            } elseif ($map === 'bump') {
                $col = allocate_rgba($img, $bumpShade, $bumpShade, $bumpShade, 0);
            } elseif ($map === 'normal') {
                $left = max(0.0, min(1.0, fbm($seed + 77, max(0.0, $u - (1 / max(1, $width - 1))) * 3.4, $v * 3.4, 4) * 0.58 + fbm($seed + 254, max(0.0, $u - (1 / max(1, $width - 1))) * 8.3, $v * 8.3, 3) * 0.42));
                $right = max(0.0, min(1.0, fbm($seed + 77, min(1.0, $u + (1 / max(1, $width - 1))) * 3.4, $v * 3.4, 4) * 0.58 + fbm($seed + 254, min(1.0, $u + (1 / max(1, $width - 1))) * 8.3, $v * 8.3, 3) * 0.42));
                $up = max(0.0, min(1.0, fbm($seed + 77, $u * 3.4, max(0.0, $v - (1 / max(1, $height - 1))) * 3.4, 4) * 0.58 + fbm($seed + 254, $u * 8.3, max(0.0, $v - (1 / max(1, $height - 1))) * 8.3, 3) * 0.42));
                $down = max(0.0, min(1.0, fbm($seed + 77, $u * 3.4, min(1.0, $v + (1 / max(1, $height - 1))) * 3.4, 4) * 0.58 + fbm($seed + 254, $u * 8.3, min(1.0, $v + (1 / max(1, $height - 1))) * 8.3, 3) * 0.42));
                $dx = $left - $right;
                $dy = $up - $down;
                $nz = $variant === 'gas' ? 0.34 : 0.58;
                $len = sqrt($dx * $dx + $dy * $dy + $nz * $nz);
                if ($len <= 0.00001) $len = 1.0;
                $nr = (int)round(max(0.0, min(1.0, (($dx / $len) * 0.5) + 0.5)) * 255);
                $ng = (int)round(max(0.0, min(1.0, (($dy / $len) * 0.5) + 0.5)) * 255);
                $nb = (int)round(max(0.0, min(1.0, (($nz / $len) * 0.5) + 0.5)) * 255);
                $col = allocate_rgba($img, $nr, $ng, $nb, 0);
            } elseif ($map === 'emissive') {
                $col = allocate_rgba($img, $emissiveShade, $emissiveShade, $emissiveShade, 0);
            } elseif ($map === 'city') {
                $col = allocate_rgba($img, $cityShade, $cityShade, $cityShade, 0);
            } else {
                $alpha = 127 - (int)round(($cloudShade / 255) * 127);
                $col = allocate_rgba($img, 255, 255, 255, $alpha);
            }
            imagesetpixel($img, $x, $y, $col);
        }
    }

    $tmpPath = $path . '.tmp';
    $ok = imagepng($img, $tmpPath, 6);
    imagedestroy($img);
    if (!$ok) {
        @unlink($tmpPath);
        return false;
    }
    $renamed = @rename($tmpPath, $path);
    if (!$renamed) {
        @copy($tmpPath, $path);
        @unlink($tmpPath);
    }
    return is_file($path);
}

function render_planet_map_svg(string $path, string $map, int $width, int $height, array $descriptor): bool
{
        $seed = (int)($descriptor['seed'] ?? 0);
        $palette = is_array($descriptor['palette'] ?? null) ? $descriptor['palette'] : [];
        $base = sanitize_hex((string)($palette['base'] ?? '#8aa2bf'), '#8aa2bf');
        $secondary = sanitize_hex((string)($palette['secondary'] ?? '#6f879e'), '#6f879e');
        $accent = sanitize_hex((string)($palette['accent'] ?? '#a8c0da'), '#a8c0da');
        $ice = sanitize_hex((string)($palette['ice'] ?? '#e0ecf8'), '#e0ecf8');
        $clouds = clamp01((float)($descriptor['clouds'] ?? 0.18));
        $glow = clamp01((float)($descriptor['glow'] ?? 0.0));
        $banding = clamp01((float)($descriptor['banding'] ?? 0.16));

        $freqA = number_format(0.004 + ($banding * 0.01), 6, '.', '');
        $freqB = number_format(0.008 + ($clouds * 0.015), 6, '.', '');
        $seedA = (string)(abs($seed) % 9973 + 1);
        $seedB = (string)((abs($seed) + 313) % 9973 + 1);
        $opacityCloud = number_format(0.22 + $clouds * 0.45, 3, '.', '');
        $opacityGlow = number_format(0.08 + $glow * 0.45, 3, '.', '');

        if ($map === 'bump' || $map === 'emissive' || $map === 'city') {
                $svg = <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="{$width}" height="{$height}" viewBox="0 0 {$width} {$height}">
    <defs>
        <filter id="n" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="{$freqA}" numOctaves="4" seed="{$seedA}" result="t"/>
            <feColorMatrix type="saturate" values="0"/>
            <feComponentTransfer>
                <feFuncR type="gamma" amplitude="1" exponent="1.2" offset="0"/>
                <feFuncG type="gamma" amplitude="1" exponent="1.2" offset="0"/>
                <feFuncB type="gamma" amplitude="1" exponent="1.2" offset="0"/>
            </feComponentTransfer>
        </filter>
    </defs>
    <rect width="100%" height="100%" fill="#7f7f7f" filter="url(#n)"/>
</svg>
SVG;
    } elseif ($map === 'normal') {
        $svg = <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="{$width}" height="{$height}" viewBox="0 0 {$width} {$height}">
    <rect width="100%" height="100%" fill="#8080ff"/>
</svg>
SVG;
        } elseif ($map === 'cloud') {
                $svg = <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="{$width}" height="{$height}" viewBox="0 0 {$width} {$height}">
    <defs>
        <filter id="c" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="{$freqB}" numOctaves="5" seed="{$seedB}" result="t"/>
            <feComponentTransfer>
                <feFuncA type="gamma" amplitude="1" exponent="1.8" offset="-0.18"/>
            </feComponentTransfer>
        </filter>
    </defs>
    <rect width="100%" height="100%" fill="white" opacity="{$opacityCloud}" filter="url(#c)"/>
</svg>
SVG;
        } else {
                $svg = <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="{$width}" height="{$height}" viewBox="0 0 {$width} {$height}">
    <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="{$base}"/>
            <stop offset="45%" stop-color="{$secondary}"/>
            <stop offset="100%" stop-color="{$accent}"/>
        </linearGradient>
        <filter id="n" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="{$freqA}" numOctaves="5" seed="{$seedA}" result="t"/>
            <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"/>
        </filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect width="100%" height="100%" fill="{$ice}" opacity="{$opacityGlow}" filter="url(#n)"/>
</svg>
SVG;
        }

        $tmpPath = $path . '.tmp';
        $ok = @file_put_contents($tmpPath, $svg);
        if ($ok === false) {
                @unlink($tmpPath);
                return false;
        }
        $renamed = @rename($tmpPath, $path);
        if (!$renamed) {
                @copy($tmpPath, $path);
                @unlink($tmpPath);
        }
        return is_file($path);
}
