#!/usr/bin/env php
<?php
/**
 * Compression benchmark: JSON vs Trimmed vs Gzip vs Binary V1 vs Binary V2
 * 
 * Usage: php bin/test-compression.php [--output json|table|csv]
 */

// Setup paths
define('ROOT_DIR', dirname(dirname(__FILE__)));
require_once ROOT_DIR . '/api/helpers.php';
require_once ROOT_DIR . '/api/compression.php';
require_once ROOT_DIR . '/api/compression-v2.php';

// Color support for terminal
$NO_COLOR = getenv('NO_COLOR');
$isTerminal = !$NO_COLOR && php_sapi_name() === 'cli' && posix_isatty(STDOUT);
function color($text, $code) {
    global $isTerminal;
    return $isTerminal ? "\033[{$code}m{$text}\033[0m" : $text;
}

// Generate realistic test payload
function generate_test_payload($numPlanets = 8, $numFleets = 3) {
    $planetClasses = ['rocky', 'terrestrial', 'super_earth', 'ice', 'gas_giant', 'ice_giant', 'terrestrial_high_metal'];
    $missionTypes = ['transport', 'military', 'exploration', 'colonization'];
    $vesselTypes = ['scout', 'corvette', 'frigate', 'destroyer', 'battleship', 'carrier', 'transport', 'colony_ship'];
    
    $planets = [];
    for ($i = 0; $i < $numPlanets; $i++) {
        $slot = [
            'position' => $i + 1,
        ];
        
        if ($i % 3 === 0) {
            $slot['player_planet'] = [
                'id' => 'col_' . rand(1000, 9999),
                'name' => 'Colony ' . chr(65 + $i),
                'owner' => 'PlayerID_' . rand(100, 999),
                'planet_class' => $planetClasses[$i % count($planetClasses)],
                'in_habitable_zone' => $i % 2 === 0 ? 1 : 0,
                'semi_major_axis_au' => 0.5 + $i * 0.2,
            ];
        }
        
        if ($i % 2 === 0 || $i % 3 === 0) {
            $slot['generated_planet'] = [
                'name' => 'Planet_' . chr(65 + $i),
                'planet_class' => $planetClasses[$i % count($planetClasses)],
                'diameter_km' => 8000 + rand(2000, 20000),
                'in_habitable_zone' => $i % 2 === 0 ? 1 : 0,
                'semi_major_axis_au' => 0.5 + $i * 0.2,
                'orbital_period_days' => 100 + $i * 50,
                'surface_gravity_g' => 0.8 + ($i * 0.15),
            ];
        }
        
        $planets[] = $slot;
    }
    
    $fleets = [];
    for ($i = 0; $i < $numFleets; $i++) {
        $vessels = [];
        $vesselCount = rand(2, 5);
        for ($j = 0; $j < $vesselCount; $j++) {
            $vessels[$vesselTypes[rand(0, count($vesselTypes) - 1)]] = rand(5, 100);
        }
        
        $fleets[] = [
            'id' => 'fleet_' . rand(1000000, 9999999),
            'mission' => $missionTypes[rand(0, count($missionTypes) - 1)],
            'origin_position' => rand(1, $numPlanets),
            'target_position' => rand(1, $numPlanets),
            'vessels' => $vessels,
        ];
    }
    
    return [
        'galaxy' => 1,
        'system' => 1,
        'system_max' => 25000,
        'server_ts_ms' => (int)(microtime(true) * 1000),
        'star_system' => [
            'name' => 'Test-Star-' . rand(100, 999),
            'spectral_class' => ['G', 'F', 'A', 'K', 'M'][rand(0, 4)],
            'x_ly' => rand(-1000, 1000),
            'y_ly' => rand(-1000, 1000),
            'z_ly' => rand(-1000, 1000),
            'hz_inner_au' => 0.95,
            'hz_outer_au' => 1.37,
            'planet_count' => $numPlanets,
        ],
        'planets' => $planets,
        'planet_texture_manifest' => [
            'version' => 1,
            'planets' => [
                ['position' => 1, 'texture_url' => 'path/to/texture_1.jpg', 'size_kb' => 256],
                ['position' => 2, 'texture_url' => 'path/to/texture_2.jpg', 'size_kb' => 512],
                ['position' => 3, 'texture_url' => 'path/to/texture_3.jpg', 'size_kb' => 384],
                ['position' => 4, 'texture_url' => 'path/to/texture_4.jpg', 'size_kb' => 256],
                ['position' => 5, 'texture_url' => 'path/to/texture_5.jpg', 'size_kb' => 768],
            ]
        ],
        'fleets_in_system' => $fleets,
    ];
}

/**
 * Benchmark a compression method
 */
function benchmark_method($name, callable $encoder, callable $decoder = null, $payload = null) {
    global $testPayload;
    if (!$payload) $payload = $testPayload;
    
    $result = [
        'name' => $name,
        'encoded_size' => null,
        'encode_time_ms' => null,
        'decode_time_ms' => null,
        'gzipped_size' => null,
        'gzipped_time_ms' => null,
        'error' => null,
    ];
    
    try {
        // Encode
        $t0 = microtime(true);
        $encoded = $encoder($payload);
        $result['encode_time_ms'] = round((microtime(true) - $t0) * 1000, 2);
        $result['encoded_size'] = strlen($encoded);
        
        // Gzip the result
        $t0 = microtime(true);
        $gzipped = gzencode($encoded, 9);
        $result['gzipped_time_ms'] = round((microtime(true) - $t0) * 1000, 2);
        $result['gzipped_size'] = strlen($gzipped);
        
        // Decode (if decoder provided)
        if ($decoder && is_string($encoded)) {
            $t0 = microtime(true);
            $decoded = $decoder($encoded);
            $result['decode_time_ms'] = round((microtime(true) - $t0) * 1000, 2);
            
            // Validate
            if (!$decoded) {
                $result['error'] = 'Decode returned null';
            } elseif ($decoded['galaxy'] !== $payload['galaxy']) {
                $result['error'] = 'Validation failed: galaxy mismatch';
            }
        }
    } catch (Exception $e) {
        $result['error'] = $e->getMessage();
    }
    
    return $result;
}

// Parse args
$outputFormat = 'table';
foreach ($argv as $arg) {
    if (strpos($arg, '--output=') === 0) {
        $outputFormat = substr($arg, 9);
    }
}

echo color("═══════════════════════════════════════════════════════════\n", '1;36');
echo color("    Galaxy Quest Compression Benchmark\n", '1;36');
echo color("═══════════════════════════════════════════════════════════\n", '1;36');
echo "\n";

// Generate test payloads
$testPayload = generate_test_payload(8, 3);
$smallPayload = generate_test_payload(2, 1);
$largePayload = generate_test_payload(16, 6);

$results = [];

// Test different payload sizes
foreach ([
    ['name' => 'Small', 'payload' => $smallPayload],
    ['name' => 'Medium', 'payload' => $testPayload],
    ['name' => 'Large', 'payload' => $largePayload],
] as $testCase) {
    $results[$testCase['name']] = [];
    
    echo color("Testing {$testCase['name']} Payload ({$testCase['payload']['planets']|count} planets, {$testCase['payload']['fleets_in_system']|count} fleets)\n", '1;33');
    echo "\n";
    
    // 1. Raw JSON
    $results[$testCase['name']]['Raw JSON'] = benchmark_method(
        'Raw JSON',
        fn($p) => json_encode($p),
        fn($d) => json_decode($d, true),
        $testCase['payload']
    );
    
    // 2. Trimmed JSON
    $results[$testCase['name']]['Trimmed JSON'] = benchmark_method(
        'Trimmed JSON',
        fn($p) => json_encode(trim_system_payload_for_transit($p)),
        fn($d) => json_decode($d, true),
        $testCase['payload']
    );
    
    // 3. Binary V1
    $results[$testCase['name']]['Binary V1'] = benchmark_method(
        'Binary V1',
        fn($p) => encode_system_payload_binary($p),
        fn($d) => decode_system_payload_binary($d),
        $testCase['payload']
    );
    
    // 4. Binary V2
    $results[$testCase['name']]['Binary V2'] = benchmark_method(
        'Binary V2',
        fn($p) => encode_system_payload_binary_v2($p),
        fn($d) => decode_system_payload_binary_v2($d),
        $testCase['payload']
    );
}

// Output in chosen format
if ($outputFormat === 'json') {
    echo json_encode($results, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
} elseif ($outputFormat === 'csv') {
    // CSV header
    echo "Payload,Method,RawSize,EncodeMs,GzipSize,GzipMs,DecodeMs,Error\n";
    foreach ($results as $payloadSize => $methods) {
        foreach ($methods as $method => $data) {
            echo "{$payloadSize},{$method},{$data['encoded_size']},{$data['encode_time_ms']},{$data['gzipped_size']},{$data['gzipped_time_ms']},{$data['decode_time_ms']},{$data['error']}\n";
        }
    }
} else {
    // Table output
    foreach ($results as $payloadSize => $methods) {
        echo "\n";
        echo color("┌─────────────────────────────────────────────────────────────────────────────────┐\n", '36');
        echo color("│ " . str_pad("$payloadSize Payload", 77) . "│\n", '36');
        echo color("├─────────────────────────────────────────────────────────────────────────────────┤\n", '36');
        echo color("│ " . str_pad("Method", 15) . str_pad("Raw Size", 12) . str_pad("Gzipped", 12) . str_pad("Enc.ms", 8) . str_pad("Dec.ms", 8) . str_pad("Gzip.ms", 8) . "│\n", '36');
        echo color("├─────────────────────────────────────────────────────────────────────────────────┤\n", '36');
        
        foreach ($methods as $method => $data) {
            $row = "│ ";
            $row .= str_pad($method, 15);
            $row .= str_pad(number_format($data['encoded_size']) . ' B', 12);
            $row .= str_pad(number_format($data['gzipped_size']) . ' B', 12);
            $row .= str_pad(($data['encode_time_ms'] ?? '-') . ' ms', 8);
            $row .= str_pad(($data['decode_time_ms'] ?? '-') . ' ms', 8);
            $row .= str_pad(($data['gzipped_time_ms'] ?? '-') . ' ms', 8);
            $row .= "│";
            
            if ($data['error']) {
                $row = color($row, '31');  // Red for errors
            }
            
            echo $row . "\n";
        }
        
        echo color("└─────────────────────────────────────────────────────────────────────────────────┘\n", '36');
    }
    
    // Summary
    echo "\n";
    echo color("SUMMARY & RECOMMENDATIONS\n", '1;32');
    echo color("═════════════════════════════════════════════════════════════\n", '32');
    
    $mediumResults = $results['Medium'];
    $rawJsonSize = $mediumResults['Raw JSON']['encoded_size'];
    $v1BinarySize = $mediumResults['Binary V1']['gzipped_size'];
    $v2BinarySize = $mediumResults['Binary V2']['gzipped_size'];
    
    echo sprintf(
        "Raw JSON Size: %d B\n" .
        "  → V1 Binary + Gzip: %d B (%.1f%% savings)\n" .
        "  → V2 Binary + Gzip: %d B (%.1f%% savings)\n" .
        "  → V2 vs V1: %.1f%% smaller\n\n",
        $rawJsonSize,
        $v1BinarySize,
        100 * (1 - $v1BinarySize / $rawJsonSize),
        $v2BinarySize,
        100 * (1 - $v2BinarySize / $rawJsonSize),
        100 * (1 - $v2BinarySize / $v1BinarySize)
    );
    
    echo color("✓ Recommendation: Use ", '32');
    if ($v2BinarySize > $v1BinarySize * 1.1) {
        echo color("V1 Binary (simpler, similar or better size)", '32');
    } else {
        echo color("V2 Binary (extensible, only slightly larger, pool dedup works)", '32');
    }
    echo color("\n", '32');
}

echo "\n";
echo color("Benchmark completed.\n", '1;32');
