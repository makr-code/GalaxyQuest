<?php
/**
 * Transit compression helpers.
 * - Auto-gzip (browser standard Accept-Encoding)
 * - Schema-based binary encoding (MessagePack-like for phase 2)
 * - Field trimming to reduce JSON bulk
 */

/**
 * Enable response gzip if supported by client.
 * Most modern browsers+servers do this automatically, but explicit is better.
 */
function enable_response_gzip(): void {
    // Check if client accepts gzip
    $acceptEncoding = $_SERVER['HTTP_ACCEPT_ENCODING'] ?? '';
    if (strpos($acceptEncoding, 'gzip') !== false) {
        header('Content-Encoding: gzip');
        ob_start('ob_gzhandler');
    }
}

/**
 * Trim system payload to minimal fields needed for rendering.
 * Reduces JSON by ~30-40% by removing redundant/unused fields.
 * Client can request full payload with ?trim=0 if needed.
 * 
 * Fields kept:
 *   - star_system: only name, spectral_class, coordinates, planet_count
 *   - planets: position, type, name, climate (texture gen + 3D)
 *   - planet_texture_manifest: full (needed for rendering)
 *   - fleets_in_system: mission, current_pos, vessels (gameplay)
 */
function trim_system_payload_for_transit(array $payload): array {
    $trimmed = [
        'galaxy' => $payload['galaxy'] ?? null,
        'system' => $payload['system'] ?? null,
        'system_max' => $payload['system_max'] ?? null,
        'server_ts_ms' => $payload['server_ts_ms'] ?? null,
        'star_system' => null,
        'planets' => [],
        'planet_texture_manifest' => $payload['planet_texture_manifest'] ?? [],
        'fleets_in_system' => [],
    ];

    // Keep only essential star fields
    if (is_array($payload['star_system'] ?? null)) {
        $s = $payload['star_system'];
        $trimmed['star_system'] = [
            'name' => $s['name'] ?? null,
            'spectral_class' => $s['spectral_class'] ?? 'G',
            'x_ly' => $s['x_ly'] ?? 0,
            'y_ly' => $s['y_ly'] ?? 0,
            'z_ly' => $s['z_ly'] ?? 0,
            'hz_inner_au' => $s['hz_inner_au'] ?? 0.95,
            'hz_outer_au' => $s['hz_outer_au'] ?? 1.37,
            'planet_count' => $s['planet_count'] ?? 0,
        ];
    }

    // Keep only essential planet slots
    if (is_array($payload['planets'] ?? null)) {
        foreach ($payload['planets'] as $slot) {
            $position = (int)($slot['position'] ?? 0);
            $trimmedSlot = ['position' => $position];

            // Player colony
            if (is_array($slot['player_planet'] ?? null)) {
                $pp = $slot['player_planet'];
                $trimmedSlot['player_planet'] = [
                    'id' => $pp['id'] ?? null,
                    'name' => $pp['name'] ?? null,
                    'owner' => $pp['owner'] ?? null,
                    'planet_class' => $pp['planet_class'] ?? 'rocky',
                    'in_habitable_zone' => $pp['in_habitable_zone'] ?? 0,
                    'semi_major_axis_au' => (float)($pp['semi_major_axis_au'] ?? 1.0),
                ];
            }

            // Generated planet
            if (is_array($slot['generated_planet'] ?? null)) {
                $gp = $slot['generated_planet'];
                $trimmedSlot['generated_planet'] = [
                    'name' => $gp['name'] ?? null,
                    'planet_class' => $gp['planet_class'] ?? 'rocky',
                    'diameter_km' => (int)($gp['diameter_km'] ?? 12742),
                    'in_habitable_zone' => $gp['in_habitable_zone'] ?? 0,
                    'semi_major_axis_au' => (float)($gp['semi_major_axis_au'] ?? 1.0),
                    'orbital_period_days' => (float)($gp['orbital_period_days'] ?? 365),
                    'surface_gravity_g' => (float)($gp['surface_gravity_g'] ?? 1.0),
                ];
            }

            $trimmed['planets'][] = $trimmedSlot;
        }
    }

    // Keep only essential fleet fields
    if (is_array($payload['fleets_in_system'] ?? null)) {
        foreach ($payload['fleets_in_system'] as $fleet) {
            $trimmed['fleets_in_system'][] = [
                'id' => $fleet['id'] ?? null,
                'mission' => $fleet['mission'] ?? 'transport',
                'origin_position' => (int)($fleet['origin_position'] ?? 0),
                'target_position' => (int)($fleet['target_position'] ?? 0),
                'ships' => is_array($fleet['ships'] ?? null) ? count($fleet['ships']) : 0,
                'vessels' => $fleet['vessels'] ?? [],
                'current_pos' => $fleet['current_pos'] ?? ['progress' => 0.5],
            ];
        }
    }

    return $trimmed;
}

/**
 * Spectral class enum (matches JS decoder).
 */
const SPECTRAL_CLASS_ENUM = [
    'G' => 0, 'F' => 1, 'A' => 2, 'B' => 3, 'O' => 4, 'K' => 5, 'M' => 6
];
const SPECTRAL_CLASS_REV = [
    0 => 'G', 1 => 'F', 2 => 'A', 3 => 'B', 4 => 'O', 5 => 'K', 6 => 'M'
];

/**
 * Planet class enum.
 */
const PLANET_CLASS_ENUM = [
    'rocky' => 0, 'terrestrial' => 1, 'super_earth' => 2, 'ice' => 3,
    'gas_giant' => 4, 'ice_giant' => 5, 'terrestrial_high_metal' => 6
];
const PLANET_CLASS_REV = [
    0 => 'rocky', 1 => 'terrestrial', 2 => 'super_earth', 3 => 'ice',
    4 => 'gas_giant', 5 => 'ice_giant', 6 => 'terrestrial_high_metal'
];

/**
 * Mission enum.
 */
const MISSION_ENUM = [
    'transport' => 0, 'military' => 1, 'exploration' => 2, 'colonization' => 3
];
const MISSION_REV = [
    0 => 'transport', 1 => 'military', 2 => 'exploration', 3 => 'colonization'
];

/**
 * Encode system payload to compact binary format.
 * Format: [magic (4)][version (2)][galaxy (2)][system (2)][star data][planets][fleets]
 * Size: ~600-1200 bytes for typical system (vs 3-5 KB gzipped JSON).
 */
function encode_system_payload_binary(array $payload): string {
    $buf = '';
    
    // Magic + version
    $buf .= pack('N', 0xDEADBEEF);  // 4 bytes
    $buf .= pack('n', 1);             // 2 bytes version 1
    
    // Galaxy, system IDs
    $buf .= pack('n', (int)($payload['galaxy'] ?? 0));
    $buf .= pack('n', (int)($payload['system'] ?? 0));
    
    // Star system
    $star = $payload['star_system'] ?? [];
    $name = (string)($star['name'] ?? 'Unknown');
    $buf .= pack('C', strlen($name));
    $buf .= $name;
    
    $spectralClass = SPECTRAL_CLASS_ENUM[$star['spectral_class'] ?? 'G'] ?? 0;
    $buf .= pack('C', $spectralClass);
    
    $buf .= pack('N', (int)($star['x_ly'] ?? 0) & 0xFFFFFFFF);
    $buf .= pack('N', (int)($star['y_ly'] ?? 0) & 0xFFFFFFFF);
    $buf .= pack('N', (int)($star['z_ly'] ?? 0) & 0xFFFFFFFF);
    $buf .= pack('f', (float)($star['hz_inner_au'] ?? 0.95));
    $buf .= pack('f', (float)($star['hz_outer_au'] ?? 1.37));
    
    // Planets
    $planets = $payload['planets'] ?? [];
    $buf .= pack('C', min(count($planets), 255));  // Max 255 planets per system
    
    foreach ($planets as $slot) {
        $buf .= pack('C', (int)($slot['position'] ?? 0));
        
        $hasPlayer = is_array($slot['player_planet'] ?? null);
        $hasGenerated = is_array($slot['generated_planet'] ?? null);
        $flags = ($hasPlayer ? 0x01 : 0) | ($hasGenerated ? 0x02 : 0);
        $buf .= pack('C', $flags);
        
        // Player planet
        if ($hasPlayer) {
            $pp = $slot['player_planet'];
            $idStr = (string)($pp['id'] ?? '');
            $buf .= pack('C', strlen($idStr));
            $buf .= $idStr;
            
            $nameStr = (string)($pp['name'] ?? '');
            $buf .= pack('C', strlen($nameStr));
            $buf .= $nameStr;
            
            $ownerStr = (string)($pp['owner'] ?? '');
            $buf .= pack('C', strlen($ownerStr));
            $buf .= $ownerStr;
            
            $classIdx = PLANET_CLASS_ENUM[$pp['planet_class'] ?? 'rocky'] ?? 0;
            $buf .= pack('C', $classIdx);
            $buf .= pack('C', $pp['in_habitable_zone'] ? 1 : 0);
            $buf .= pack('f', (float)($pp['semi_major_axis_au'] ?? 1.0));
        }
        
        // Generated planet
        if ($hasGenerated) {
            $gp = $slot['generated_planet'];
            $nameStr = (string)($gp['name'] ?? '');
            $buf .= pack('C', strlen($nameStr));
            $buf .= $nameStr;
            
            $classIdx = PLANET_CLASS_ENUM[$gp['planet_class'] ?? 'rocky'] ?? 0;
            $buf .= pack('C', $classIdx);
            
            $diamKm = (int)($gp['diameter_km'] ?? 12742);
            $buf .= pack('n', max(0, min(65535, intdiv($diamKm, 100))));
            
            $buf .= pack('C', $gp['in_habitable_zone'] ? 1 : 0);
            $buf .= pack('f', (float)($gp['semi_major_axis_au'] ?? 1.0));
            $buf .= pack('f', (float)($gp['orbital_period_days'] ?? 365.0));
            $buf .= pack('f', (float)($gp['surface_gravity_g'] ?? 1.0));
        }
    }
    
    // Fleets
    $fleets = $payload['fleets_in_system'] ?? [];
    $buf .= pack('C', min(count($fleets), 255));
    
    foreach ($fleets as $fleet) {
        $missionIdx = MISSION_ENUM[$fleet['mission'] ?? 'transport'] ?? 0;
        $buf .= pack('C', $missionIdx);
        $buf .= pack('C', (int)($fleet['origin_position'] ?? 0));
        $buf .= pack('C', (int)($fleet['target_position'] ?? 0));
        
        $vesselCount = is_array($fleet['vessels'] ?? null) ? count($fleet['vessels']) : 0;
        $buf .= pack('C', min($vesselCount, 255));
        
        // Encode each vessel type + count
        if ($vesselCount > 0) {
            foreach ($fleet['vessels'] as $vType => $vCount) {
                $typeStr = (string)$vType;
                $buf .= pack('C', strlen($typeStr));
                $buf .= $typeStr;
                $buf .= pack('n', (int)$vCount);
            }
        }
    }
    
    return $buf;
}

/**
 * Decode binary system payload.
 * Used by JavaScript decoder (this function is for reference).
 */
function decode_system_payload_binary(string $buf): ?array {
    $offset = 0;
    
    // Validate magic
    $magic = unpack('N', substr($buf, $offset, 4))[1];
    if ($magic !== 0xDEADBEEF) return null;
    $offset += 4;
    
    $version = unpack('n', substr($buf, $offset, 2))[1];
    if ($version !== 1) return null;
    $offset += 2;
    
    // Decode header
    $galaxy = unpack('n', substr($buf, $offset, 2))[1];
    $offset += 2;
    $system = unpack('n', substr($buf, $offset, 2))[1];
    $offset += 2;
    
    // Decode star
    $nameLen = unpack('C', substr($buf, $offset, 1))[1];
    $offset += 1;
    $starName = substr($buf, $offset, $nameLen);
    $offset += $nameLen;
    
    $spectralIdx = unpack('C', substr($buf, $offset, 1))[1];
    $offset += 1;
    $spectralClass = SPECTRAL_CLASS_REV[$spectralIdx] ?? 'G';
    
    $bytes = unpack('C*', substr($buf, $offset, 4));
    $xLy = (($bytes[1] << 24) | ($bytes[2] << 16) | ($bytes[3] << 8) | $bytes[4]);
    if ($xLy >= 0x80000000) $xLy -= 0x100000000;  // Convert to signed
    $offset += 4;
    $bytes = unpack('C*', substr($buf, $offset, 4));
    $yLy = (($bytes[1] << 24) | ($bytes[2] << 16) | ($bytes[3] << 8) | $bytes[4]);
    if ($yLy >= 0x80000000) $yLy -= 0x100000000;
    $offset += 4;
    $bytes = unpack('C*', substr($buf, $offset, 4));
    $zLy = (($bytes[1] << 24) | ($bytes[2] << 16) | ($bytes[3] << 8) | $bytes[4]);
    if ($zLy >= 0x80000000) $zLy -= 0x100000000;
    $offset += 4;
    
    $hzInner = unpack('f', substr($buf, $offset, 4))[1];
    $offset += 4;
    $hzOuter = unpack('f', substr($buf, $offset, 4))[1];
    $offset += 4;
    
    $star = [
        'name' => $starName,
        'spectral_class' => $spectralClass,
        'x_ly' => $xLy,
        'y_ly' => $yLy,
        'z_ly' => $zLy,
        'hz_inner_au' => $hzInner,
        'hz_outer_au' => $hzOuter,
        'planet_count' => 0
    ];
    
    // Decode planets
    $planetCount = unpack('C', substr($buf, $offset, 1))[1];
    $offset += 1;
    $planets = [];
    
    for ($i = 0; $i < $planetCount; $i++) {
        $position = unpack('C', substr($buf, $offset, 1))[1];
        $offset += 1;
        $flags = unpack('C', substr($buf, $offset, 1))[1];
        $offset += 1;
        
        $hasPlayer = ($flags & 0x01) !== 0;
        $hasGenerated = ($flags & 0x02) !== 0;
        
        $slot = ['position' => $position];
        
        if ($hasPlayer) {
            $idLen = unpack('C', substr($buf, $offset, 1))[1];
            $offset += 1;
            $id = substr($buf, $offset, $idLen);
            $offset += $idLen;
            
            $nameLen = unpack('C', substr($buf, $offset, 1))[1];
            $offset += 1;
            $ppName = substr($buf, $offset, $nameLen);
            $offset += $nameLen;
            
            $ownerLen = unpack('C', substr($buf, $offset, 1))[1];
            $offset += 1;
            $owner = substr($buf, $offset, $ownerLen);
            $offset += $ownerLen;
            
            $classIdx = unpack('C', substr($buf, $offset, 1))[1];
            $offset += 1;
            $inHz = unpack('C', substr($buf, $offset, 1))[1];
            $offset += 1;
            $sma = unpack('f', substr($buf, $offset, 4))[1];
            $offset += 4;
            
            $slot['player_planet'] = [
                'id' => $id,
                'name' => $ppName,
                'owner' => $owner,
                'planet_class' => PLANET_CLASS_REV[$classIdx] ?? 'rocky',
                'in_habitable_zone' => $inHz === 1,
                'semi_major_axis_au' => $sma
            ];
        }
        
        if ($hasGenerated) {
            $nameLen = unpack('C', substr($buf, $offset, 1))[1];
            $offset += 1;
            $gpName = substr($buf, $offset, $nameLen);
            $offset += $nameLen;
            
            $classIdx = unpack('C', substr($buf, $offset, 1))[1];
            $offset += 1;
            $diamCode = unpack('n', substr($buf, $offset, 2))[1];
            $offset += 2;
            $inHz = unpack('C', substr($buf, $offset, 1))[1];
            $offset += 1;
            $sma = unpack('f', substr($buf, $offset, 4))[1];
            $offset += 4;
            $orbPeriod = unpack('f', substr($buf, $offset, 4))[1];
            $offset += 4;
            $surfGrav = unpack('f', substr($buf, $offset, 4))[1];
            $offset += 4;
            
            $slot['generated_planet'] = [
                'name' => $gpName,
                'planet_class' => PLANET_CLASS_REV[$classIdx] ?? 'rocky',
                'diameter_km' => $diamCode * 100,
                'in_habitable_zone' => $inHz === 1,
                'semi_major_axis_au' => $sma,
                'orbital_period_days' => $orbPeriod,
                'surface_gravity_g' => $surfGrav
            ];
        }
        
        $planets[] = $slot;
    }
    
    $star['planet_count'] = $planetCount;
    
    // Decode fleets
    $fleetCount = unpack('C', substr($buf, $offset, 1))[1];
    $offset += 1;
    $fleets = [];
    
    for ($i = 0; $i < $fleetCount; $i++) {
        $missionIdx = unpack('C', substr($buf, $offset, 1))[1];
        $offset += 1;
        $originPos = unpack('C', substr($buf, $offset, 1))[1];
        $offset += 1;
        $targetPos = unpack('C', substr($buf, $offset, 1))[1];
        $offset += 1;
        $vesselCount = unpack('C', substr($buf, $offset, 1))[1];
        $offset += 1;
        
        $vessels = [];
        for ($j = 0; $j < $vesselCount; $j++) {
            $typeLen = unpack('C', substr($buf, $offset, 1))[1];
            $offset += 1;
            $vType = substr($buf, $offset, $typeLen);
            $offset += $typeLen;
            $vCount = unpack('n', substr($buf, $offset, 2))[1];
            $offset += 2;
            $vessels[$vType] = $vCount;
        }
        
        $fleets[] = [
            'mission' => MISSION_REV[$missionIdx] ?? 'transport',
            'origin_position' => $originPos,
            'target_position' => $targetPos,
            'vessels' => $vessels
        ];
    }
    
    return [
        'galaxy' => $galaxy,
        'system' => $system,
        'star_system' => $star,
        'planets' => $planets,
        'fleets_in_system' => $fleets
    ];
}
