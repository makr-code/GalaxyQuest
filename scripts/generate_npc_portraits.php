<?php
/**
 * Generate NPC portrait images for all 6 main GalaxyQuest characters via SwarmUI.
 *
 * Usage:
 *   docker compose exec -T web php scripts/generate_npc_portraits.php
 *   docker compose exec -T web php scripts/generate_npc_portraits.php --npc=sol_kaar
 *   docker compose exec -T web php scripts/generate_npc_portraits.php --turbo
 *   docker compose exec -T web php scripts/generate_npc_portraits.php --steps=20 --npc=vela_thii
 *
 * Output: gfx/portraits/<race>_<name>_<gender>.png
 */

require_once __DIR__ . '/../api/swarmui_client.php';

// ── CLI options ───────────────────────────────────────────────────────────────
$opts    = getopt('', ['npc:', 'turbo', 'steps:', 'width:', 'height:', 'dry-run']);
$filter  = isset($opts['npc'])    ? strtolower((string) $opts['npc']) : null;
$turbo   = isset($opts['turbo']);
$dryRun  = isset($opts['dry-run']);
$steps   = isset($opts['steps'])  ? (int) $opts['steps']  : ($turbo ? 8 : (int) SWARMUI_DEFAULT_STEPS);
$width   = isset($opts['width'])  ? (int) $opts['width']  : 720;
$height  = isset($opts['height']) ? (int) $opts['height'] : 1024;

// ── Base prompt (injected before every race module) ───────────────────────────
const BASE_PROMPT = 'Photorealistic portrait photo of an alien lifeform, '
    . 'head and shoulders bust portrait, clearly alien, '
    . 'ultra-detailed skin or material texture, realistic lighting, '
    . 'studio portrait photography style with soft key light, subtle rim light, '
    . 'shallow depth of field f/2.8, sharp focus on face and eyes, '
    . 'natural specular highlights. No props, no background elements, '
    . 'clean neutral space. Transparent background PNG alpha, clean silhouette, '
    . 'cinematic realism, 8k resolution.';

const NEGATIVE_PROMPT = 'human, earth, realistic human face, ugly, deformed, '
    . 'blurry, low quality, background, props, watermark, text, logo.';

// ── NPC Definitions ───────────────────────────────────────────────────────────
const NPCS = [
    'sol_kaar' => [
        'name'   => "Sol'Kaar",
        'race'   => 'Aereth',
        'gender' => 'm',
        'file'   => 'Aereth_SolKaar_m.png',
        'prompt' => 'clearly male, male humanoid energy-based alien, angular crystalline facial structure, '
            . 'intense glowing energy core visible within semi-transparent skin, '
            . 'sharp geometric light refractions across face, cool white-blue energy coloration '
            . 'with silver undertones, sharp-edged masculine features, piercing bright energy eyes '
            . 'crackling with obsessive intelligence, subtle electric plasma tendrils around edges.',
    ],
    'vela_thii' => [
        'name'   => "Vela'Thii",
        'race'   => 'Syl\'Nar',
        'gender' => 'w',
        'file'   => 'SylNar_VelaThii_w.png',
        'prompt' => 'clearly female, female cephalopod alien, soft graceful tentacle structures, '
            . 'intricate bioluminescent markings in pastel blue and perlmut reflections, '
            . 'smooth translucent wet skin, gentle flowing form, large expressive soulful alien eyes '
            . 'with cosmic depth and ancient wisdom, luminous patterns cascading across body, '
            . 'serene peaceful spiritual expression.',
    ],
    'drak_mol' => [
        'name'   => "General Drak'Mol",
        'race'   => 'Vor\'Tak',
        'gender' => 'm',
        'file'   => 'VorTak_DrakMol_m.png',
        'prompt' => 'clearly male, mature male reptilian alien, massive bone plates across shoulders and '
            . 'head, dark green-black iridescent scales with battle-worn patina, strong muscular '
            . 'powerful build, broad masculine facial structure with sharp commanding features, '
            . 'intense yellow predatory eyes with slit pupils, prominent campaign scars and ridges, '
            . 'subtle bronze metallic armor integration, thick powerful neck.',
    ],
    'zha_mira' => [
        'name'   => "Kommandantin Zha'Mira",
        'race'   => 'Kryl\'Tha',
        'gender' => 'w',
        'file'   => 'KrylTha_ZhaMira_w.png',
        'prompt' => 'clearly female, fierce elegant female insectoid alien, bright iridescent '
            . 'gold-turquoise shell patterns with battle scars, refined articulated mandibles, '
            . 'graceful segmented facial structure showing strength and rank, '
            . 'softly glowing compound eyes in amber and emerald with warrior intensity, '
            . 'regal confident presence, complex heritage carapace patterns.',
    ],
    'kaelor' => [
        'name'   => 'Archivar Kaelor',
        'race'   => 'Zhareen',
        'gender' => 'm',
        'file'   => 'Zhareen_Kaelor_m.png',
        'prompt' => 'clearly male, ancient male crystalline alien, sharp angular crystal formations '
            . 'across face with geometric precision, multiple faceted crystal planes, '
            . 'cold internal glow in deep cobalt blue with hairline fractures suggesting loss, '
            . 'refracted light creating prismatic reflections, deep complex internal structure '
            . 'visible through semi-transparency, wise ancient eyes holding profound melancholy, '
            . 'cold detached beauty.',
    ],
    'shy_nira' => [
        'name'   => "Shy'Nira",
        'race'   => 'Vel\'Ar',
        'gender' => 'w',
        'file'   => 'VelAr_ShyNira_w.png',
        'prompt' => 'clearly female, mysterious female gas-based alien with smooth semi-solid biomask, '
            . 'soft rounded mask contours with elegant curves, gentle swirling internal gas '
            . 'in nebula white and lavendel hues, soft glowing energy lines pulsing through '
            . 'ethereal form, expressive suspended alien eyes with mystery and hidden intelligence, '
            . 'delicate biomask, enigmatic presence.',
    ],
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function log_info(string $msg): void
{
    echo "\033[0;36m[INFO]\033[0m $msg\n";
}
function log_ok(string $msg): void
{
    echo "\033[0;32m[ OK ]\033[0m $msg\n";
}
function log_err(string $msg): void
{
    echo "\033[0;31m[FAIL]\033[0m $msg\n";
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!swarmui_is_enabled()) {
    log_err('SwarmUI is disabled (SWARMUI_ENABLED=0). Set it to 1 to continue.');
    exit(1);
}

$outDir = __DIR__ . '/../gfx/portraits';
if (!is_dir($outDir) && !mkdir($outDir, 0755, true)) {
    log_err("Cannot create output directory: $outDir");
    exit(1);
}

// Verify connection
log_info('Connecting to SwarmUI at ' . SWARMUI_BASE_URL . ' …');
$modelsResult = swarmui_list_models();
if (!$modelsResult['ok']) {
    log_err('Cannot reach SwarmUI: ' . $modelsResult['error']);
    exit(1);
}
$modelNames = array_column($modelsResult['models'], 'title');
log_ok('Connected. Available models: ' . implode(', ', $modelNames));

$model = $turbo ? (string) SWARMUI_TURBO_MODEL : (string) SWARMUI_DEFAULT_MODEL;
log_info(sprintf(
    'Settings: model=%s  steps=%d  %dx%d  %s',
    basename($model, '.safetensors'),
    $steps,
    $width,
    $height,
    $dryRun ? '[DRY-RUN]' : ''
));
echo "\n";

// ── Generate loop ─────────────────────────────────────────────────────────────
$total  = 0;
$failed = 0;

foreach (NPCS as $key => $npc) {
    if ($filter !== null && $filter !== $key) {
        continue;
    }

    $total++;
    $destPath = $outDir . '/' . $npc['file'];
    $fullPrompt = BASE_PROMPT . ' ' . $npc['prompt'];

    log_info(sprintf("Generating %-30s  (%s %s, %s) …", $npc['name'], $npc['race'], $npc['gender'] === 'm' ? '♂' : '♀', basename($destPath)));

    if ($dryRun) {
        log_ok("DRY-RUN – prompt length: " . strlen($fullPrompt) . " chars");
        continue;
    }

    if (is_file($destPath)) {
        log_info("  ↳ Already exists, skipping. Delete to regenerate: " . basename($destPath));
        continue;
    }

    $genResult = swarmui_generate($fullPrompt, [
        'turbo'          => $turbo,
        'steps'          => $steps,
        'width'          => $width,
        'height'         => $height,
        'negativeprompt' => NEGATIVE_PROMPT,
        'timeout'        => (int) SWARMUI_TIMEOUT_SECONDS,
    ]);

    if (!$genResult['ok']) {
        log_err("  Generation failed: " . $genResult['error']);
        $failed++;
        continue;
    }

    $dlResult = swarmui_download_image($genResult['image_path'], $destPath);

    if (!$dlResult['ok']) {
        log_err("  Download failed: " . $dlResult['error']);
        $failed++;
        continue;
    }

    $kb = round($dlResult['bytes'] / 1024, 1);
    log_ok("  Saved → gfx/portraits/{$npc['file']}  ({$kb} KB)");
}

echo "\n";
if ($dryRun) {
    log_info("Dry-run complete. " . count(NPCS) . " NPC(s) would be generated.");
} elseif ($failed === 0) {
    log_ok("Done. $total portrait(s) generated successfully.");
} else {
    log_err("Done with errors. " . ($total - $failed) . "/$total succeeded, $failed failed.");
    exit(1);
}
