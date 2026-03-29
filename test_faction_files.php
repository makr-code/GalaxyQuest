<?php
$specPath = '/var/www/html/fractions/vor_tak/spec.json';
echo "Path: $specPath\n";
echo "Exists: " . (is_file($specPath) ? 'YES' : 'NO') . "\n";
echo "Readable: " . (is_readable($specPath) ? 'YES' : 'NO') . "\n";

if (is_file($specPath)) {
    $data = json_decode(file_get_contents($specPath), true);
    echo "JSON valid: " . (is_array($data) ? 'YES' : 'NO') . "\n";
    echo "Display Name: " . ($data['display_name'] ?? 'N/A') . "\n";
    echo "Male Color: " . ($data['biology']['male']['color_primary'] ?? 'N/A') . "\n";
    echo "Female Color: " . ($data['biology']['female']['color_primary'] ?? 'N/A') . "\n";
    echo "Material Desc: " . ($data['portraiture']['material_description'] ?? 'N/A') . "\n";
}

// Test all 6 species
$speciesCodes = ['vor_tak', 'syl_nar', 'aereth', 'kryl_tha', 'zhareen', 'vel_ar'];
echo "\n\n=== Testing all species ===\n";
foreach ($speciesCodes as $code) {
    $path = "/var/www/html/fractions/$code/spec.json";
    echo "$code: " . (is_file($path) ? 'FOUND' : 'MISSING') . "\n";
}
