<?php
/**
 * GalaxyQuest – Faction Species Seed
 *
 * Reads portraiture / logo / colour data from each playable faction's
 * fractions/{code}/spec.json and upserts it into the faction_species table.
 *
 * Spec fields consumed:
 *   display.color_male_primary / color_male_secondary / color_male_accent
 *   display.color_female_primary / color_female_secondary / color_female_accent
 *   portraiture.base_prompt / male_modifier / female_modifier
 *                material_description / silhouette_description
 *   logo.prompt
 *   description        (fallback: display_name)
 *   faction_type       (raw; accepted as-is)
 *   display_name / faction_name (→ display_name column)
 *   species_code / faction_code (→ species_code column)
 *
 * Idempotent – safe to run multiple times.
 * Run: docker compose exec -T web php scripts/seed_faction_species.php
 */

declare(strict_types=1);
require_once __DIR__ . '/../api/helpers.php';

$fractionsDir = realpath(__DIR__ . '/../fractions');
if (!$fractionsDir || !is_dir($fractionsDir)) {
    fwrite(STDERR, "ERROR: fractions/ directory not found.\n");
    exit(1);
}

$db = get_db();

$stmt = $db->prepare('
    INSERT INTO faction_species
        (species_code, display_name, description, faction_type,
         color_primary_male,   color_secondary_male,   color_accent_male,
         color_primary_female, color_secondary_female, color_accent_female,
         portrait_prompt_base, portrait_prompt_male_modifier, portrait_prompt_female_modifier,
         logo_prompt, material_desc, silhouette_desc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
        display_name                  = VALUES(display_name),
        description                   = VALUES(description),
        faction_type                  = VALUES(faction_type),
        color_primary_male            = VALUES(color_primary_male),
        color_secondary_male          = VALUES(color_secondary_male),
        color_accent_male             = VALUES(color_accent_male),
        color_primary_female          = VALUES(color_primary_female),
        color_secondary_female        = VALUES(color_secondary_female),
        color_accent_female           = VALUES(color_accent_female),
        portrait_prompt_base          = VALUES(portrait_prompt_base),
        portrait_prompt_male_modifier = VALUES(portrait_prompt_male_modifier),
        portrait_prompt_female_modifier = VALUES(portrait_prompt_female_modifier),
        logo_prompt                   = VALUES(logo_prompt),
        material_desc                 = VALUES(material_desc),
        silhouette_desc               = VALUES(silhouette_desc)
');

$counts = ['inserted' => 0, 'updated' => 0, 'unchanged' => 0, 'skipped' => 0];

echo "Seeding faction_species from fractions/ spec files...\n\n";

foreach (scandir($fractionsDir) as $entry) {
    if ($entry[0] === '.') {
        continue;
    }
    $dir = $fractionsDir . DIRECTORY_SEPARATOR . $entry;
    if (!is_dir($dir)) {
        continue;
    }
    $jsonPath = $dir . '/spec.json';
    if (!is_file($jsonPath)) {
        continue;
    }

    $raw  = file_get_contents($jsonPath);
    $spec = $raw !== false ? json_decode($raw, true) : null;
    if (!is_array($spec)) {
        echo "  skip  $entry  (invalid JSON)\n";
        $counts['skipped']++;
        continue;
    }

    // Only seed entries that have portraiture data
    $portraiture = is_array($spec['portraiture'] ?? null) ? $spec['portraiture'] : null;
    if ($portraiture === null) {
        continue; // not a species spec – silently skip
    }

    $code        = (string) ($spec['species_code'] ?? $spec['faction_code'] ?? $entry);
    $displayName = (string) ($spec['display_name'] ?? $spec['faction_name'] ?? ucwords(str_replace(['_', '-'], ' ', $code)));
    $description = (string) ($spec['description'] ?? $displayName);
    $factionType = (string) ($spec['faction_type'] ?? 'science');
    $display     = is_array($spec['display'] ?? null) ? $spec['display'] : [];
    $logo        = is_array($spec['logo']    ?? null) ? $spec['logo']    : [];

    $row = [
        $code,
        mb_substr($displayName, 0, 64),
        mb_substr($description, 0, 255),
        $factionType,
        (string) ($display['color_male_primary']     ?? ''),
        (string) ($display['color_male_secondary']   ?? ''),
        (string) ($display['color_male_accent']      ?? ''),
        (string) ($display['color_female_primary']   ?? ''),
        (string) ($display['color_female_secondary'] ?? ''),
        (string) ($display['color_female_accent']    ?? ''),
        (string) ($portraiture['base_prompt']        ?? ''),
        (string) ($portraiture['male_modifier']      ?? ''),
        (string) ($portraiture['female_modifier']    ?? ''),
        (string) ($logo['prompt']                    ?? ''),
        (string) ($portraiture['material_description']  ?? ''),
        (string) ($portraiture['silhouette_description'] ?? ''),
    ];

    $stmt->execute($row);
    $rc     = $stmt->rowCount();
    $action = match ($rc) { 0 => 'unchanged', 1 => 'inserted', default => 'updated' };
    $counts[$action]++;
    $mark   = $action === 'inserted' ? '✚' : ($action === 'updated' ? '↺' : '·');
    echo "  $mark $code  [$action]\n";
}

echo "\n";
echo "faction_species: inserted={$counts['inserted']}  updated={$counts['updated']}  unchanged={$counts['unchanged']}  skipped={$counts['skipped']}\n";

$total = (int) $db->query('SELECT COUNT(*) FROM faction_species')->fetchColumn();
echo "Total species in DB: $total\n";
