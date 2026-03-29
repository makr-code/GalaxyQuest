<?php
/**
 * Generate NPC text content for all 6 main GalaxyQuest characters via Ollama.
 *
 * Usage:
 *   docker compose exec -T web php scripts/generate_npc_text.php
 *   docker compose exec -T web php scripts/generate_npc_text.php --npc=sol_kaar
 *   docker compose exec -T web php scripts/generate_npc_text.php --type=dialogue
 *   docker compose exec -T web php scripts/generate_npc_text.php --type=description --npc=kaelor
 *   docker compose exec -T web php scripts/generate_npc_text.php --type=intel --model=llama3.1:8b
 *
 * Types:
 *   description  – 3-paragraph in-universe NPC description (default)
 *   dialogue     – 5 in-character dialogue lines (situational)
 *   intel        – Vel'Ar intelligence briefing about the NPC
 *
 * Output: printed to stdout and optionally saved to docs/npcs/<key>_<type>.txt
 */

require_once __DIR__ . '/../api/ollama_client.php';

// ── CLI options ───────────────────────────────────────────────────────────────
$opts   = getopt('', ['npc:', 'type:', 'model:', 'save', 'dry-run']);
$filter = isset($opts['npc'])   ? strtolower((string) $opts['npc'])  : null;
$type   = isset($opts['type'])  ? strtolower((string) $opts['type']) : 'description';
$model  = isset($opts['model']) ? trim((string) $opts['model'])      : '';
$save   = isset($opts['save']);
$dryRun = isset($opts['dry-run']);

$allowedTypes = ['description', 'dialogue', 'intel'];
if (!in_array($type, $allowedTypes, true)) {
    fwrite(STDERR, "Unknown --type=$type. Allowed: " . implode(', ', $allowedTypes) . "\n");
    exit(1);
}

// ── NPC Definitions ───────────────────────────────────────────────────────────
const NPCS_TEXT = [
    'sol_kaar' => [
        'name'        => "Sol'Kaar",
        'race'        => 'Aereth',
        'gender'      => 'male',
        'role'        => 'Lead scientist of the Kernrat (Science Council)',
        'personality' => 'Brilliant, obsessive, emotionally detached, driven by a hunger for understanding above all ethics',
        'secret'      => 'He was instrumental in the experiment that inadvertently created the Voidbrood 2000 years ago',
        'situation'   => "being confronted about his past research after the player discovers encrypted logs in the forbidden station",
        'emotion'     => 'controlled guilt layered beneath intellectual detachment',
    ],
    'vela_thii' => [
        'name'        => "Hohepriesterin Vela'Thii",
        'race'        => "Syl'Nar",
        'gender'      => 'female',
        'role'        => "Spiritual leader of the Lichtbund (Light Covenant), Syl'Nar councilmember",
        'personality' => 'Wise, serene, compassionate, but haunted by a secret she cannot reveal',
        'secret'      => 'She has been receiving fragmented telepathic transmissions from a Voidbrood echo – whether this is contact or infection, she does not know',
        'situation'   => 'meeting the player after the rift has been disturbed, choosing her words carefully',
        'emotion'     => 'calm on the surface, but deeply unsettled beneath',
    ],
    'drak_mol' => [
        'name'        => "General Drak'Mol",
        'race'        => "Vor'Tak",
        'gender'      => 'male',
        'role'        => "Supreme Military Commander, leader of the Schildzirkel (Shield Circle)",
        'personality' => 'Stern, honourable, distrustful of non-military solutions, secretly doubting his own methods',
        'secret'      => 'He suspects the Convergence is being manipulated from within, but he cannot identify the source',
        'situation'   => 'briefing the player before a critical fleet engagement, weighing the cost of lives against tactical necessity',
        'emotion'     => 'iron discipline masking deep weariness',
    ],
    'zha_mira' => [
        'name'        => "Kommandantin Zha'Mira",
        'race'        => "Kryl'Tha",
        'gender'      => 'female',
        'role'        => "Fleet Tactician and Strike Commander for the Convergence",
        'personality' => 'Direct, efficient, fiercely loyal, driven by a deep personal wound',
        'secret'      => 'Her brood-chamber was stolen by Iron Fleet researchers for genetic experiments; she survived only by being off-world',
        'situation'   => 'before a retaliatory strike on a human research facility she suspects holds her stolen brood',
        'emotion'     => 'cold fury underneath rigid military composure',
    ],
    'kaelor' => [
        'name'        => 'Archivar Kaelor',
        'race'        => 'Zhareen',
        'gender'      => 'male',
        'role'        => "Keeper of the Crystal Archives, last surviving high archivar of Aeryth'Luun",
        'personality' => 'Calm, analytical, profoundly melancholic, searching for meaning in loss',
        'secret'      => "A fragment of his home-crystal has begun to resonate with the Voidbrood's frequency – he is keeping this from the council",
        'situation'   => "walking through the ruins of Aeryth'Luun as the player assists in a rescue of the final archive shards",
        'emotion'     => 'quiet grief held together by duty',
    ],
    'shy_nira' => [
        'name'        => "Shy'Nira",
        'race'        => "Vel'Ar",
        'gender'      => 'female',
        'role'        => "Director of the Schattenzirkel (Shadow Circle), supreme intelligence operative",
        'personality' => 'Enigmatic, supremely intelligent, manipulative, isolated by her own omniscience',
        'secret'      => "She knows Sol'Kaar's secret, Vela'Thii's telepathic contact, and the Iron Fleet's next target – but reveals information only when it furthers her own calculus",
        'situation'   => 'offering the player a deal that could tip the balance of the Convergence, in her own inscrutable way',
        'emotion'     => 'amused detachment over genuine uncertainty about who to trust',
    ],
];

// ── Prompts per type ──────────────────────────────────────────────────────────
function build_messages(string $type, array $npc): array
{
    $name        = $npc['name'];
    $race        = $npc['race'];
    $gender      = $npc['gender'];
    $role        = $npc['role'];
    $personality = $npc['personality'];
    $secret      = $npc['secret'] ?? '';
    $situation   = $npc['situation'] ?? 'a tense diplomatic meeting aboard the Kalytherion Ascendant';
    $emotion     = $npc['emotion'] ?? 'guarded';

    if ($type === 'description') {
        return [
            [
                'role'    => 'system',
                'content' => 'You are a creative writer for the GalaxyQuest sci-fi universe. '
                    . 'The Kalytherion Convergence is an alliance of six alien species: '
                    . "Vor'Tak (reptilian strategists), Syl'Nar (cephalopod mystics), Aereth (energy beings), "
                    . "Kryl'Tha (insectoid warriors), Zhareen (crystalline empaths), Vel'Ar (gaseous intelligences). "
                    . 'Write vivid, concise descriptions in third person. Use sensory details specific to the species. '
                    . 'Never reference real-world brands, places, or people. Keep each paragraph under 80 words.',
            ],
            [
                'role'    => 'user',
                'content' => "Write a 3-paragraph in-universe description for this NPC:\n"
                    . "- Name: $name\n"
                    . "- Race: $race\n"
                    . "- Gender: $gender\n"
                    . "- Role: $role\n"
                    . "- Personality: $personality\n"
                    . ($secret ? "- Hidden truth: $secret\n" : '')
                    . "\nParagraph 1: Physical appearance – species-specific details, what makes them visually distinctive.\n"
                    . "Paragraph 2: How others perceive them; their demeanor, presence, speech patterns.\n"
                    . "Paragraph 3: Their role in the Convergence and the tension that drives them.",
            ],
        ];
    }

    if ($type === 'dialogue') {
        return [
            [
                'role'    => 'system',
                'content' => 'You are a dialogue writer for the GalaxyQuest sci-fi universe. '
                    . "Stay strictly in character. Each NPC has a distinct voice shaped by their species and role.\n"
                    . "- Vor'Tak: terse, military, honour-bound\n"
                    . "- Syl'Nar: poetic, layered, spiritually metaphorical\n"
                    . "- Aereth: cold precision, scientific framing\n"
                    . "- Kryl'Tha: blunt, swarm-focused, no wasted words\n"
                    . "- Zhareen: detached melancholy, archival precision\n"
                    . "- Vel'Ar: cryptic, indirect, imply never state\n"
                    . 'Output only the five dialogue lines, numbered 1-5. No stage directions. No explanations.',
            ],
            [
                'role'    => 'user',
                'content' => "Generate 5 dialogue lines for $name ($race, $gender, $role).\n"
                    . "Situation: $situation\n"
                    . "Emotional state: $emotion\n"
                    . "These lines should feel distinct to this character. Begin writing:",
            ],
        ];
    }

    // intel
    return [
        [
            'role'    => 'system',
            'content' => "You are the Vel'Ar intelligence network of the Kalytherion Convergence. "
                . "Write classified briefings in terse intelligence-report style. "
                . "Format strictly as:\n"
                . "CLASSIFICATION: [EYES-ONLY | COMMAND | OPEN]\n"
                . "SUBJECT: [name + role]\n"
                . "THREAT LEVEL: [NONE | LOW | MODERATE | HIGH | CRITICAL]\n"
                . "ASSESSMENT: [2-3 sentences]\n"
                . "KNOWN SECRETS: [bullet list, 2-3 items]\n"
                . "RECOMMENDED ACTION: [1 sentence]",
        ],
        [
            'role'    => 'user',
            'content' => "Generate an intelligence briefing for the following asset:\n"
                . "- Name: $name\n"
                . "- Race: $race\n"
                . "- Role: $role\n"
                . "- Known personality: $personality\n"
                . ($secret ? "- Intelligence intercept: $secret" : ''),
        ],
    ];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function log_info(string $msg): void  { echo "\033[0;36m[INFO]\033[0m $msg\n"; }
function log_ok(string $msg): void    { echo "\033[0;32m[ OK ]\033[0m $msg\n"; }
function log_err(string $msg): void   { echo "\033[0;31m[FAIL]\033[0m $msg\n"; }
function separator(): void            { echo str_repeat('─', 72) . "\n"; }

function is_embedding_model(array $entry): bool
{
    $name   = strtolower((string) ($entry['name'] ?? ''));
    $family = strtolower((string) ($entry['details']['family'] ?? ''));

    if (str_contains($name, 'embed') || str_contains($name, 'minilm')) {
        return true;
    }
    if (str_contains($family, 'bert')) {
        return true;
    }

    return false;
}

function model_penalty(array $entry): int
{
    $name = strtolower((string) ($entry['name'] ?? ''));

    // Coding-specialized models are less suitable for narrative NPC text.
    if (str_contains($name, 'coder')) {
        return 3_000_000_000;
    }

    return 0;
}

/**
 * Resolve the model to use.
 * - If --model is provided, use it.
 * - Otherwise list available models and choose the smallest non-embedding text model.
 */
function resolve_model(string $requestedModel): array
{
    $requestedModel = trim($requestedModel);
    if ($requestedModel !== '') {
        return [
            'model'      => $requestedModel,
            'source'     => 'cli',
            'available'  => [],
            'autoPicked' => false,
            'warning'    => null,
        ];
    }

    $modelsResult = ollama_list_models();
    if (!$modelsResult['ok']) {
        return [
            'model'      => (string) OLLAMA_DEFAULT_MODEL,
            'source'     => 'config-fallback',
            'available'  => [],
            'autoPicked' => false,
            'warning'    => 'Could not list Ollama models; falling back to OLLAMA_DEFAULT_MODEL.',
        ];
    }

    $entries = $modelsResult['raw']['models'] ?? [];
    $available = $modelsResult['models'] ?? [];

    // Prefer phi3 when available: small, fast, and suitable for short NPC text output.
    foreach ((array) $available as $name) {
        if (strcasecmp((string) $name, 'phi3:latest') === 0) {
            return [
                'model'      => 'phi3:latest',
                'source'     => 'auto-preferred-phi3',
                'available'  => $available,
                'autoPicked' => true,
                'warning'    => null,
            ];
        }
    }

    $textEntries = [];

    foreach ((array) $entries as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        if (is_embedding_model($entry)) {
            continue;
        }
        $name = trim((string) ($entry['name'] ?? ''));
        if ($name === '') {
            continue;
        }
        $size = (int) ($entry['size'] ?? PHP_INT_MAX);
        $textEntries[] = [
            'name'  => $name,
            'size'  => $size,
            'score' => $size + model_penalty($entry),
        ];
    }

    if (empty($textEntries)) {
        return [
            'model'      => (string) OLLAMA_DEFAULT_MODEL,
            'source'     => 'config-fallback',
            'available'  => $available,
            'autoPicked' => false,
            'warning'    => 'No suitable text model found in Ollama tags; falling back to OLLAMA_DEFAULT_MODEL.',
        ];
    }

    usort($textEntries, static function (array $a, array $b): int {
        return $a['score'] <=> $b['score'];
    });

    return [
        'model'      => (string) $textEntries[0]['name'],
        'source'     => 'auto-smallest',
        'available'  => $available,
        'autoPicked' => true,
        'warning'    => null,
    ];
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!ollama_is_enabled()) {
    log_err('Ollama is disabled (OLLAMA_ENABLED=0). Set it to 1 to continue.');
    exit(1);
}

$modelResolution = resolve_model($model);
$model = (string) $modelResolution['model'];

$saveDir = __DIR__ . '/../docs/npcs';
if ($save && !is_dir($saveDir) && !mkdir($saveDir, 0755, true)) {
    log_err("Cannot create docs/npcs directory.");
    exit(1);
}

if (!empty($modelResolution['available'])) {
    log_info('Available Ollama models: ' . implode(', ', $modelResolution['available']));
}
if (!empty($modelResolution['warning'])) {
    log_info($modelResolution['warning']);
}
if ($modelResolution['autoPicked']) {
    log_info('Auto-selected small text model: ' . $model);
}

log_info('Ollama at ' . OLLAMA_BASE_URL . '  model=' . $model . '  source=' . $modelResolution['source']);
log_info("Type: $type" . ($save ? '  [saving to docs/npcs/]' : '') . ($dryRun ? '  [DRY-RUN]' : ''));
echo "\n";

$total  = 0;
$failed = 0;

foreach (NPCS_TEXT as $key => $npc) {
    if ($filter !== null && $filter !== $key) {
        continue;
    }

    $total++;
    $messages = build_messages($type, $npc);

    separator();
    echo "\033[1;33m{$npc['name']}\033[0m  ({$npc['race']}, {$npc['gender']})  [{$type}]\n";
    separator();

    if ($dryRun) {
        echo "[DRY-RUN] System: " . mb_substr($messages[0]['content'], 0, 80) . "…\n";
        echo "[DRY-RUN] User:   " . mb_substr($messages[1]['content'], 0, 80) . "…\n\n";
        continue;
    }

    $result = ollama_chat($messages, ['model' => $model, 'temperature' => 0.75]);

    if (!$result['ok']) {
        log_err("Ollama error: " . ($result['error'] ?? 'unknown'));
        $failed++;
        echo "\n";
        continue;
    }

    $text = trim($result['text']);
    echo $text . "\n\n";

    if ($save) {
        $filename = $saveDir . '/' . $key . '_' . $type . '.txt';
        $header   = "NPC: {$npc['name']} | Race: {$npc['race']} | Type: $type | Model: $model | Generated: "
            . date('Y-m-d H:i') . "\n" . str_repeat('=', 72) . "\n\n";
        file_put_contents($filename, $header . $text . "\n");
        log_ok("Saved → docs/npcs/" . basename($filename));
    }
}

separator();
if ($dryRun) {
    log_info("Dry-run complete. $total NPC(s) would be processed.");
} elseif ($failed === 0) {
    log_ok("Done. $total NPC(s) generated successfully.");
} else {
    log_err("Done with errors. " . ($total - $failed) . "/$total succeeded, $failed failed.");
    exit(1);
}
