<?php
/**
 * Generate NPC portrait images for all 12 main GalaxyQuest characters via SwarmUI.
 *
 * Usage:
 *   docker compose exec -T web php scripts/generate_npc_portraits.php
 *   docker compose exec -T web php scripts/generate_npc_portraits.php --npc=sol_kaar
 *   docker compose exec -T web php scripts/generate_npc_portraits.php --turbo
 *   docker compose exec -T web php scripts/generate_npc_portraits.php --steps=20 --npc=vela_thii
 *   docker compose exec -T web php scripts/generate_npc_portraits.php --lora           # use LoRA adapters
 *   docker compose exec -T web php scripts/generate_npc_portraits.php --lora --npc=drak_mol
 *
 * Output: gfx/portraits/<race>_<name>_<gender>.png
 */

require_once __DIR__ . '/../api/swarmui_client.php';

// ── CLI options ───────────────────────────────────────────────────────────────
$opts    = getopt('', ['npc:', 'turbo', 'steps:', 'width:', 'height:', 'dry-run', 'lora']);
$filter  = isset($opts['npc'])    ? strtolower((string) $opts['npc']) : null;
$turbo   = isset($opts['turbo']);
$dryRun  = isset($opts['dry-run']);
$useLora = isset($opts['lora']);
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

// LoRA adapter names per race (filename without .safetensors, relative to SwarmUI Models/Lora/)
const RACE_LORAS = [
    'Vor\'Tak'  => ['lora' => 'vortak_lora_v1',  'trigger' => 'vortak_race'],
    'Syl\'Nar'  => ['lora' => 'sylnar_lora_v1',  'trigger' => 'sylnar_race'],
    'Aereth'    => ['lora' => 'aereth_lora_v1',  'trigger' => 'aereth_race'],
    'Kryl\'Tha' => ['lora' => 'kryltha_lora_v1', 'trigger' => 'kryltha_race'],
    'Zhareen'   => ['lora' => 'zhareen_lora_v1', 'trigger' => 'zhareen_race'],
    'Vel\'Ar'   => ['lora' => 'velar_lora_v1',   'trigger' => 'velar_race'],
];

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
    // ── Second six NPCs ──────────────────────────────────────────────────────────
    't_asha' => [
        'name'   => "Stratega T'Asha",
        'race'   => 'Vor\'Tak',
        'gender' => 'w',
        'file'   => 'VorTak_TAsha_w.png',
        'prompt' => 'clearly female, mature female reptilian alien, sleek emerald-green scales with '
            . 'golden bioluminescent highlights, elegant refined facial structure with smaller horn '
            . 'ridges, intricate turquoise and gold patterns across skin, piercing intelligent yellow '
            . 'eyes with complex iris patterns radiating authority and cunning, graceful neck and '
            . 'shoulders, subtle high-rank ceremonial armor detailing integrated into scales.',
    ],
    'asha_vor' => [
        'name'   => "Licht-Diplomat Asha'Vor",
        'race'   => 'Syl\'Nar',
        'gender' => 'm',
        'file'   => 'SylNar_AshaVor_m.png',
        'prompt' => 'clearly male, strong male cephalopod alien, powerful tentacle ridges and broad '
            . 'cephalopod musculature, deep pulsating bioluminescent patterns in neon cyan and electric '
            . 'violet, wet glossy semi-transparent skin with inner light, deep-set commanding alien eyes '
            . 'with spiraling cosmic swirls of deep indigo, thick flowing tentacle-hair, spiritual '
            . 'authority and diplomatic gravitas.',
    ],
    'lyra_tehn' => [
        'name'   => "Forscherin Lyra'Tehn",
        'race'   => 'Aereth',
        'gender' => 'w',
        'file'   => 'Aereth_LyraTern_w.png',
        'prompt' => 'clearly female, elegant female humanoid energy-based alien, smooth graceful facial '
            . 'contours with luminous golden-white energy patterns flowing beneath semi-transparent skin, '
            . 'warm gentle amber and gold energy coloration radiating curiosity, soft diffused internal '
            . 'light creating a halo-like radiance, large expressive glowing eyes filled with wonder, '
            . 'serene confident expression of scientific discovery.',
    ],
    'ka_threx' => [
        'name'   => "Schwarm-Ältester Ka'Threx",
        'race'   => 'Kryl\'Tha',
        'gender' => 'm',
        'file'   => 'KrylTha_KaThrex_m.png',
        'prompt' => 'clearly male, ancient weathered male insectoid alien, thick battle-worn chitin '
            . 'armor plates, dark iridescent shell with deep oil-slick reflections in black-green-rust '
            . 'tones, heavy massive mandibles and pronounced jaw showing age and dominance, large '
            . 'compound eyes with amber-red facets glowing with ancient wisdom, ceremonial clan markings '
            . 'etched into chitin, imposing elder presence.',
    ],
    'myr_tal' => [
        'name'   => "Kristall-Bewahrerin Myr'Tal",
        'race'   => 'Zhareen',
        'gender' => 'w',
        'file'   => 'Zhareen_MyrTal_w.png',
        'prompt' => 'clearly female, serene female crystalline alien, smooth flowing crystal contours '
            . 'with warm rosy-gold and deep amethyst internal illumination, soft prismatic rainbow light '
            . 'refracting gracefully, perlmut iridescence cascading across surfaces, warm welcoming '
            . 'radiance, large compassionate eyes glowing with amber-rose light and profound empathy, '
            . 'refined crystalline beauty with ancient spiritual depth.',
    ],
    'val_kesh' => [
        'name'   => 'Geheimrat Val\'Kesh',
        'race'   => 'Vel\'Ar',
        'gender' => 'm',
        'file'   => 'VelAr_ValKesh_m.png',
        'prompt' => 'clearly male, imposing male gas-based alien with angular sharp semi-solid biomask, '
            . 'strong pointed geometric mask contours projecting authority and inscrutability, internal '
            . 'swirling gas in deep smoke-grey and cold ice-blue hues, pulsing energy veins of pale blue '
            . 'light, suspended alien eyes radiating cold calculation and hidden power, hard angular '
            . 'edges suggesting concealed threat, ethereal gravitas.',
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
    'Settings: model=%s  steps=%d  %dx%d  lora=%s  %s',
    basename($model, '.safetensors'),
    $steps,
    $width,
    $height,
    $useLora ? 'enabled' : 'disabled',
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
    $destPath   = $outDir . '/' . $npc['file'];
    $loraConfig = RACE_LORAS[$npc['race']] ?? null;

    // Build prompt: optionally prepend LoRA inline tag + trigger word
    $promptPrefix = '';
    $loraOptions  = [];
    if ($useLora && $loraConfig !== null) {
        $loraName      = SWARMUI_LORA_PATH . $loraConfig['lora'];
        $constName     = 'LORA_WEIGHT_' . strtoupper(str_replace(["'", ' '], '', $npc['race']));
        $loraWeight    = defined($constName) ? (float) constant($constName) : 0.80;
        $promptPrefix  = "<lora:{$loraName}:{$loraWeight}> {$loraConfig['trigger']}, ";
        $loraOptions   = ["{$loraName}:{$loraWeight}"];
    }
    $fullPrompt = $promptPrefix . BASE_PROMPT . ' ' . $npc['prompt'];

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
        'loras'          => $loraOptions,
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
