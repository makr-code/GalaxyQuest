<?php

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/ollama_client.php';
require_once __DIR__ . '/swarmui_client.php';

/**
 * Ensure a stored character profile exists for a user (player or NPC).
 * Returns the persisted DB row as associative array.
 */
function ensure_user_character_profile(PDO $db, int $userId, bool $isNpc = false, string $usernameHint = ''): array {
    ensure_character_profile_tables($db);

    $existing = $db->prepare('SELECT * FROM user_character_profiles WHERE user_id = ? LIMIT 1');
    $existing->execute([$userId]);
    $row = $existing->fetch(PDO::FETCH_ASSOC);
    if (is_array($row) && !empty($row['json_path']) && !empty($row['yaml_path'])) {
        return $row;
    }

    $username = trim($usernameHint);
    if ($username === '') {
        $u = $db->prepare('SELECT username FROM users WHERE id = ? LIMIT 1');
        $u->execute([$userId]);
        $username = (string)($u->fetchColumn() ?: ('user_' . $userId));
    }

    $profile = character_profile_fallback($userId, $username, $isNpc);
    $profile['_fallback'] = true;
    $paths = [
        'dir_abs' => dirname(__DIR__) . DIRECTORY_SEPARATOR . 'generated' . DIRECTORY_SEPARATOR . 'characters' . DIRECTORY_SEPARATOR . 'u_' . $userId,
        'dir_rel' => 'generated/characters/u_' . $userId,
        'json_rel' => 'generated/characters/u_' . $userId . '/profile.json',
        'yaml_rel' => 'generated/characters/u_' . $userId . '/profile.yaml',
    ];
    $portrait = ['ok' => false, 'error' => 'portrait not generated'];
    $status = 'failed';
    $lastError = '';

    try {
        $profile = character_profile_generate_payload($db, $userId, $username, $isNpc);
        $paths = character_profile_store_files($userId, $profile);
        $portrait = character_profile_generate_portrait($userId, $profile, $paths['dir_abs']);

        $status = !empty($profile['_fallback']) ? 'fallback' : 'generated';
        if (!($portrait['ok'] ?? false)) {
            $status = $status === 'generated' ? 'image_missing' : 'fallback_image_missing';
            $lastError = (string)($portrait['error'] ?? '');
        }
    } catch (Throwable $e) {
        $lastError = $e->getMessage();
    }

    $insert = $db->prepare(
        'INSERT INTO user_character_profiles
            (user_id, is_npc, race, profession, stance, vita, profile_json, yaml_path, json_path, png_path, storage_dir, generation_status, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            is_npc = VALUES(is_npc),
            race = VALUES(race),
            profession = VALUES(profession),
            stance = VALUES(stance),
            vita = VALUES(vita),
            profile_json = VALUES(profile_json),
            yaml_path = VALUES(yaml_path),
            json_path = VALUES(json_path),
            png_path = VALUES(png_path),
            storage_dir = VALUES(storage_dir),
            generation_status = VALUES(generation_status),
            last_error = VALUES(last_error),
            updated_at = CURRENT_TIMESTAMP'
    );
    $insert->execute([
        $userId,
        $isNpc ? 1 : 0,
        (string)$profile['race'],
        (string)$profile['profession'],
        (string)$profile['stance'],
        (string)$profile['vita'],
        json_encode(character_profile_public_payload($profile), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT),
        $paths['yaml_rel'],
        $paths['json_rel'],
        (string)($portrait['png_rel'] ?? ''),
        $paths['dir_rel'],
        $status,
        $lastError !== '' ? $lastError : (string)($portrait['error'] ?? ''),
    ]);

    $reload = $db->prepare('SELECT * FROM user_character_profiles WHERE user_id = ? LIMIT 1');
    $reload->execute([$userId]);
    return (array)$reload->fetch(PDO::FETCH_ASSOC);
}

function ensure_character_profile_tables(PDO $db): void {
    $db->exec(
        'CREATE TABLE IF NOT EXISTS user_character_profiles (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            is_npc TINYINT(1) NOT NULL DEFAULT 0,
            race VARCHAR(80) NOT NULL DEFAULT \'Unknown\',
            profession VARCHAR(80) NOT NULL DEFAULT \'Wanderer\',
            stance VARCHAR(80) NOT NULL DEFAULT \'Neutral\',
            vita TEXT NOT NULL,
            profile_json LONGTEXT NOT NULL,
            yaml_path VARCHAR(255) NOT NULL,
            json_path VARCHAR(255) NOT NULL,
            png_path VARCHAR(255) NOT NULL DEFAULT \'\',
            storage_dir VARCHAR(255) NOT NULL,
            generation_status VARCHAR(40) NOT NULL DEFAULT \'generated\',
            last_error TEXT DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_character_profile_user (user_id),
            CONSTRAINT fk_character_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB'
    );
}

function character_profile_generate_payload(PDO $db, int $userId, string $username, bool $isNpc): array {
    $fallback = character_profile_fallback($userId, $username, $isNpc);
    if (!ollama_is_enabled()) {
        $fallback['_fallback'] = true;
        return $fallback;
    }

    // Pick a random species and load its design specs for consistent portraits
    $species = character_profile_pick_random_species($db);
    $speciesCode = $species['species_code'] ?? 'aereth';
    $speciesDesigns = character_profile_load_species_designs($db, $speciesCode);

    $model = character_profile_pick_model();
    $system = implode("\n", [
        'You generate one concise sci-fi character identity in JSON.',
        'Output JSON only: {"race":"...","profession":"...","stance":"...","vita":"...","portrait_prompt":"..."}',
        'Rules:',
        '- race/profession/stance max 80 chars each.',
        '- vita is 2-4 short sentences, max 500 chars.',
        '- portrait_prompt must be an English prompt for photorealistic alien bust portrait with transparent background.',
        '- Keep it lore-friendly and internally consistent.',
    ]);
    $user = implode("\n", [
        'context:',
        'username=' . $username,
        'user_id=' . $userId,
        'account_type=' . ($isNpc ? 'npc' : 'player'),
        'species=' . ($speciesDesigns['display_name'] ?? 'Alien'),
        'genre=scifi strategy, galactic factions, diplomacy, trade, conflict',
    ]);

    $resp = ollama_chat([
        ['role' => 'system', 'content' => $system],
        ['role' => 'user', 'content' => $user],
    ], [
        'model' => $model,
        'format' => 'json',
        'temperature' => 0.45,
        'timeout' => 30,
        'options' => ['num_predict' => 260],
    ]);

    if (!($resp['ok'] ?? false)) {
        $fallback['_fallback'] = true;
        return $fallback;
    }

    $payload = character_profile_parse_json((string)($resp['text'] ?? ''));
    if (!is_array($payload)) {
        $fallback['_fallback'] = true;
        return $fallback;
    }

    $race = character_profile_trim((string)($payload['race'] ?? ''), 80);
    $profession = character_profile_trim((string)($payload['profession'] ?? ''), 80);
    $stance = character_profile_trim((string)($payload['stance'] ?? ''), 80);
    $vita = character_profile_trim((string)($payload['vita'] ?? ''), 500);
    $portraitPrompt = character_profile_trim((string)($payload['portrait_prompt'] ?? ''), 900);

    if ($race === '' || $profession === '' || $stance === '' || $vita === '') {
        $fallback['_fallback'] = true;
        return $fallback;
    }
    if ($portraitPrompt === '') {
        $portraitPrompt = character_profile_build_prompt_with_designs(
            $speciesDesigns,
            [
                'username' => $username,
                'race' => $race,
                'profession' => $profession,
                'stance' => $stance,
                'is_npc' => $isNpc,
            ]
        );
    }

    return [
        'username' => $username,
        'is_npc' => $isNpc,
        'race' => $race,
        'profession' => $profession,
        'stance' => $stance,
        'vita' => $vita,
        'portrait_prompt' => $portraitPrompt,
        '_fallback' => false,
        'species_code' => $speciesCode,
    ];
}

/**
 * Load species design specifications from local files or database.
 * Files are primary source, database is fallback.
 * Returns the species design spec or a generic fallback.
 */
function character_profile_load_species_designs(PDO $db, string $speciesCode = ''): ?array {
    if ($speciesCode === '') {
        return null;
    }

    // Try loading from local files first (primary source)
    $fromFiles = character_profile_load_species_designs_from_files($speciesCode);
    if (is_array($fromFiles) && !empty($fromFiles)) {
        return $fromFiles;
    }

    // Fallback to database
    try {
        $stmt = $db->prepare(
            'SELECT species_code, display_name, color_primary_male, color_primary_female, 
                    portrait_prompt_base, portrait_prompt_male_modifier, portrait_prompt_female_modifier,
                    material_desc, silhouette_desc
             FROM faction_species WHERE species_code = ? LIMIT 1'
        );
        $stmt->execute([$speciesCode]);
        return (array)($stmt->fetch(PDO::FETCH_ASSOC) ?: []);
    } catch (Throwable $e) {
        error_log('Failed to load species designs for ' . $speciesCode . ': ' . $e->getMessage());
        return null;
    }
}

/**
 * Load species design specifications from local files (fractions/<species_code>/spec.json).
 * Returns null if file not found or not readable.
 */
function character_profile_load_species_designs_from_files(string $speciesCode): ?array {
    $specPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'fractions' . DIRECTORY_SEPARATOR
        . str_replace('_', '_', strtolower($speciesCode)) . DIRECTORY_SEPARATOR . 'spec.json';

    if (!is_file($specPath) || !is_readable($specPath)) {
        return null;
    }

    try {
        $json = file_get_contents($specPath);
        if ($json === false) {
            return null;
        }
        $data = json_decode($json, true);
        if (!is_array($data)) {
            return null;
        }

        // Map local spec fields to the generator's expected keys
        return [
            'species_code' => (string)($data['species_code'] ?? $speciesCode),
            'display_name' => (string)($data['display_name'] ?? ''),
            'color_primary_male' => (string)($data['biology']['male']['color_primary'] ?? ''),
            'color_primary_female' => (string)($data['biology']['female']['color_primary'] ?? ''),
            'portrait_prompt_base' => (string)($data['portraiture']['base_prompt'] ?? ''),
            'portrait_prompt_male_modifier' => (string)($data['portraiture']['male_modifier'] ?? ''),
            'portrait_prompt_female_modifier' => (string)($data['portraiture']['female_modifier'] ?? ''),
            'material_desc' => (string)($data['portraiture']['material_description'] ?? ''),
            'silhouette_desc' => (string)($data['portraiture']['silhouette_description'] ?? ''),
        ];
    } catch (Throwable $e) {
        error_log('Failed to load species designs from files for ' . $speciesCode . ': ' . $e->getMessage());
        return null;
    }
}

function character_profile_pick_model(): string {
    $preferred = ['phi3:latest', 'llama3.2:latest', 'llama3:latest', 'llama3.1:8b'];
    $list = ollama_list_models(['timeout' => 8]);
    if (!($list['ok'] ?? false)) {
        return (string) OLLAMA_DEFAULT_MODEL;
    }
    $models = array_map(static fn($m) => strtolower((string)$m), (array)($list['models'] ?? []));
    foreach ($preferred as $m) {
        if (in_array(strtolower($m), $models, true)) {
            return $m;
        }
    }
    return (string) OLLAMA_DEFAULT_MODEL;
}

function character_profile_parse_json(string $raw): ?array {
    $raw = trim($raw);
    if ($raw === '') {
        return null;
    }
    $raw = preg_replace('/^```(?:json)?\s*/i', '', $raw) ?? $raw;
    $raw = preg_replace('/\s*```$/', '', $raw) ?? $raw;
    $raw = trim($raw);
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) {
        return $decoded;
    }
    if (preg_match('/\{.*\}/s', $raw, $match)) {
        $decoded = json_decode($match[0], true);
        if (is_array($decoded)) {
            return $decoded;
        }
    }
    return null;
}

function character_profile_fallback(int $userId, string $username, bool $isNpc): array {
    $races = ['Human Frontierborn', 'Cephalid Synapsekin', 'Crystalline Asterite', 'Insectoid Varkh', 'Synthetic Helion'];
    $jobs = ['Navigator', 'Trade Envoy', 'Recon Analyst', 'Xeno-Archaeologist', 'Fleet Logistician'];
    $stances = ['Pragmatic', 'Diplomatic', 'Resolute', 'Skeptical', 'Opportunistic'];

    $seed = abs((int)crc32(strtolower($username) . ':' . $userId . ':' . ($isNpc ? 'npc' : 'player')));
    $race = $races[$seed % count($races)];
    $profession = $jobs[intdiv($seed, 7) % count($jobs)];
    $stance = $stances[intdiv($seed, 13) % count($stances)];
    $origin = $isNpc ? 'an autonomous sector protocol' : 'a newly commissioned colony command';
    $vita = $username . ' emerged from ' . $origin . ' and built a reputation as a ' . strtolower($profession)
        . '. Their ' . strtolower($stance) . ' outlook makes them effective in uncertain diplomacy.
In hostile regions they balance risk, intelligence, and timing before committing resources.';

    return [
        'username' => $username,
        'is_npc' => $isNpc,
        'race' => $race,
        'profession' => $profession,
        'stance' => $stance,
        'vita' => character_profile_trim($vita, 500),
        'portrait_prompt' => character_profile_build_prompt([
            'username' => $username,
            'race' => $race,
            'profession' => $profession,
            'stance' => $stance,
            'is_npc' => $isNpc,
        ]),
    ];
}

/**
 * Pick a random faction species code from database.
 * Falls back to default if table empty or query fails.
 */
function character_profile_pick_random_species(PDO $db): array {
    try {
        $stmt = $db->prepare('SELECT species_code, display_name FROM faction_species ORDER BY RAND() LIMIT 1');
        $stmt->execute();
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (is_array($row)) {
            return $row;
        }
    } catch (Throwable $e) {
        error_log('Failed to pick random species: ' . $e->getMessage());
    }
    return ['species_code' => 'aereth', 'display_name' => 'Aereth'];
}

/**
 * Build a portrait prompt using faction species design specifications.
 * Incorporates color palettes, material descriptions, and gender-specific modifiers.
 */
function character_profile_build_prompt_with_designs(?array $speciesDesigns, array $profile): string {
    $race = (string)($profile['race'] ?? 'alien');
    $profession = (string)($profile['profession'] ?? 'strategist');
    $stance = (string)($profile['stance'] ?? 'neutral');
    $npcHint = !empty($profile['is_npc']) ? 'autonomous npc representative' : 'player commander';

    $colorHint = '';
    $materialHint = '';
    $genderModifier = '';

    if (is_array($speciesDesigns)) {
        // Determine character gender (binary for simplicity; can be expanded)
        // Use CRC32 of username as pseudo-random generator
        $username = (string)($profile['username'] ?? '');
        $isFemale = (abs((int)crc32($username . ':gender')) % 2) === 1;

        // Pick gender-specific color from Species palette
        $colorField = $isFemale ? 'color_primary_female' : 'color_primary_male';
        $colorValue = (string)($speciesDesigns[$colorField] ?? '');
        if ($colorValue !== '') {
            $colorHint = ', dominant color palette: ' . $colorValue;
        }

        // Add material description from species design
        $materialDesc = (string)($speciesDesigns['material_desc'] ?? '');
        if ($materialDesc !== '') {
            $materialHint = ', material: ' . $materialDesc;
        }

        // Add gender-specific portrait modifier
        $modifierField = $isFemale ? 'portrait_prompt_female_modifier' : 'portrait_prompt_male_modifier';
        $modValue = (string)($speciesDesigns[$modifierField] ?? '');
        if ($modValue !== '') {
            $genderModifier = ', ' . $modValue;
        }
    }

    return implode(', ', array_filter([
        'Photorealistic bust portrait of a sci-fi alien character',
        'head and shoulders only',
        'race: ' . $race,
        'role: ' . $profession,
        'attitude: ' . $stance,
        $npcHint,
        'ultra detailed skin or material texture' . $materialHint,
        'studio portrait lighting with soft key light and subtle rim light' . $colorHint,
        'sharp focus on face and eyes' . $genderModifier,
        'transparent background',
        'PNG alpha',
        'cinematic realism',
    ]));
}

function character_profile_build_prompt(array $profile): string {
    $race = (string)($profile['race'] ?? 'alien');
    $profession = (string)($profile['profession'] ?? 'strategist');
    $stance = (string)($profile['stance'] ?? 'neutral');
    $npcHint = !empty($profile['is_npc']) ? 'autonomous npc representative' : 'player commander';

    return implode(', ', [
        'Photorealistic bust portrait of a sci-fi alien character',
        'head and shoulders only',
        'race: ' . $race,
        'role: ' . $profession,
        'attitude: ' . $stance,
        $npcHint,
        'ultra detailed skin or material texture',
        'studio portrait lighting with soft key light and subtle rim light',
        'sharp focus on face and eyes',
        'transparent background',
        'PNG alpha',
        'cinematic realism',
    ]);
}

function character_profile_generate_portrait(int $userId, array $profile, string $targetDirAbs): array {
    if (!swarmui_is_enabled()) {
        return ['ok' => false, 'error' => 'SwarmUI disabled'];
    }

    $prompt = (string)($profile['portrait_prompt'] ?? '');
    if ($prompt === '') {
        return ['ok' => false, 'error' => 'Missing portrait prompt'];
    }

    $gen = swarmui_generate($prompt, [
        'width' => 768,
        'height' => 1024,
        'steps' => 30,
        'cfgscale' => 7.5,
        'negativeprompt' => 'text, watermark, logo, lowres, blurry, duplicate face, extra limbs, cropped',
        'timeout' => 180,
    ]);
    if (!($gen['ok'] ?? false)) {
        return ['ok' => false, 'error' => (string)($gen['error'] ?? 'SwarmUI generation failed')];
    }

    $pngAbs = rtrim($targetDirAbs, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'portrait.png';
    $dl = swarmui_download_image((string)$gen['image_path'], $pngAbs);
    if (!($dl['ok'] ?? false)) {
        return ['ok' => false, 'error' => (string)($dl['error'] ?? 'SwarmUI download failed')];
    }

    return [
        'ok' => true,
        'png_abs' => $pngAbs,
        'png_rel' => character_profile_rel_path($pngAbs),
    ];
}

function character_profile_store_files(int $userId, array $profile): array {
    $baseAbs = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'generated' . DIRECTORY_SEPARATOR . 'characters';
    $dirAbs = $baseAbs . DIRECTORY_SEPARATOR . 'u_' . $userId;
    if (!is_dir($dirAbs) && !mkdir($dirAbs, 0755, true) && !is_dir($dirAbs)) {
        throw new RuntimeException('Cannot create character profile directory: ' . $dirAbs);
    }

    $jsonAbs = $dirAbs . DIRECTORY_SEPARATOR . 'profile.json';
    $yamlAbs = $dirAbs . DIRECTORY_SEPARATOR . 'profile.yaml';

    $publicPayload = character_profile_public_payload($profile);
    $json = json_encode($publicPayload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false) {
        throw new RuntimeException('Failed to encode character profile JSON.');
    }
    file_put_contents($jsonAbs, $json);
    file_put_contents($yamlAbs, character_profile_to_yaml($publicPayload));

    return [
        'dir_abs' => $dirAbs,
        'dir_rel' => character_profile_rel_path($dirAbs),
        'json_abs' => $jsonAbs,
        'json_rel' => character_profile_rel_path($jsonAbs),
        'yaml_abs' => $yamlAbs,
        'yaml_rel' => character_profile_rel_path($yamlAbs),
    ];
}

function character_profile_public_payload(array $profile): array {
    return [
        'username' => (string)($profile['username'] ?? ''),
        'is_npc' => !empty($profile['is_npc']),
        'race' => (string)($profile['race'] ?? ''),
        'profession' => (string)($profile['profession'] ?? ''),
        'stance' => (string)($profile['stance'] ?? ''),
        'vita' => (string)($profile['vita'] ?? ''),
        'portrait_prompt' => (string)($profile['portrait_prompt'] ?? ''),
        'generated_at' => gmdate('c'),
    ];
}

function character_profile_to_yaml(array $data, int $depth = 0): string {
    $indent = str_repeat('  ', $depth);
    $lines = [];
    foreach ($data as $key => $value) {
        $safeKey = preg_replace('/[^A-Za-z0-9_\-]/', '_', (string)$key) ?? 'key';
        if (is_array($value)) {
            if (array_is_list($value)) {
                $lines[] = $indent . $safeKey . ':';
                foreach ($value as $item) {
                    if (is_array($item)) {
                        $lines[] = $indent . '  -';
                        $lines[] = rtrim(character_profile_to_yaml($item, $depth + 2));
                    } else {
                        $lines[] = $indent . '  - ' . character_profile_yaml_scalar($item);
                    }
                }
            } else {
                $lines[] = $indent . $safeKey . ':';
                $lines[] = rtrim(character_profile_to_yaml($value, $depth + 1));
            }
        } else {
            $lines[] = $indent . $safeKey . ': ' . character_profile_yaml_scalar($value);
        }
    }
    return implode("\n", $lines) . "\n";
}

function character_profile_yaml_scalar($value): string {
    if (is_bool($value)) {
        return $value ? 'true' : 'false';
    }
    if (is_int($value) || is_float($value)) {
        return (string)$value;
    }
    $str = str_replace(["\r\n", "\r", "\n"], ' ', (string)$value);
    $str = str_replace('"', '\\"', $str);
    return '"' . $str . '"';
}

function character_profile_trim(string $text, int $maxLen): string {
    $text = trim(preg_replace('/\s+/u', ' ', $text) ?? '');
    if ($text === '') {
        return '';
    }
    return strlen($text) > $maxLen ? substr($text, 0, $maxLen) : $text;
}

function character_profile_rel_path(string $absolutePath): string {
    $normalized = str_replace('\\', '/', $absolutePath);
    $root = str_replace('\\', '/', dirname(__DIR__));
    if (str_starts_with($normalized, $root)) {
        $rel = ltrim(substr($normalized, strlen($root)), '/');
        return str_replace('//', '/', $rel);
    }
    return $normalized;
}
