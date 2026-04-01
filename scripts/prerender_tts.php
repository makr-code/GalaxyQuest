#!/usr/bin/env php
<?php
/**
 * Pre-render TTS audio for frequently-used texts.
 *
 * Run once per deployment (or whenever the text corpus changes) to eliminate
 * synthesis latency during gameplay.
 *
 * Usage:
 *   php scripts/prerender_tts.php [--voice <name>] [--dry-run]
 *
 * Options:
 *   --voice <name>   Override the default voice for all texts.
 *   --dry-run        Print what would be synthesised without calling the service.
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../api/tts_client.php';

// ── CLI argument parsing ──────────────────────────────────────────────────────
$opts = getopt('', ['voice:', 'dry-run']);
$voiceOverride = isset($opts['voice']) ? trim((string) $opts['voice']) : null;
$dryRun        = array_key_exists('dry-run', $opts);

// ── Texts to pre-render ───────────────────────────────────────────────────────
// Add entries here as { text, voice? }.  Omitting 'voice' uses TTS_DEFAULT_VOICE.
$entries = [
    ['text' => 'Willkommen in der Galaxie, Kommandant.'],
    ['text' => 'Angriff eingeleitet. Schilde auf maximale Stärke.'],
    ['text' => 'Kolonie gegründet. Ressourcenabbau beginnt.'],
    ['text' => 'Forschung abgeschlossen. Neue Technologie verfügbar.'],
    ['text' => 'Flotte erreicht Zielposition.'],
    ['text' => 'Warnung: Feindliche Flotte in Sichtweite.'],
    ['text' => 'Diplomatische Nachricht eingegangen.'],
    ['text' => 'Warpantrieb wird kalibriert.'],
    ['text' => 'Galaxie vollständig kartiert.'],
    ['text' => 'Spionagemission abgeschlossen.'],
];

// ── Main ──────────────────────────────────────────────────────────────────────
if (!tts_is_enabled()) {
    fwrite(STDERR, "TTS_ENABLED is not set. Enable TTS in config/config.php or via env.\n");
    exit(1);
}

$total = count($entries);
$ok    = 0;
$skip  = 0;
$fail  = 0;

echo "GalaxyQuest TTS Pre-render\n";
echo str_repeat('─', 60) . "\n";

foreach ($entries as $i => $entry) {
    $text  = trim((string) ($entry['text'] ?? ''));
    $voice = trim((string) ($voiceOverride ?? $entry['voice'] ?? TTS_DEFAULT_VOICE));

    if ($text === '') {
        continue;
    }

    $label = mb_strlen($text) > 50
        ? mb_substr($text, 0, 47) . '…'
        : $text;

    printf("[%d/%d] %-52s ", $i + 1, $total, $label);

    if ($dryRun) {
        echo "(dry-run)\n";
        continue;
    }

    $result = tts_synthesise($text, ['voice' => $voice]);

    if ($result['ok'] ?? false) {
        if ($result['cached'] ?? false) {
            echo "SKIP (cached)\n";
            $skip++;
        } else {
            echo "OK   → {$result['audio_url']}\n";
            $ok++;
        }
    } else {
        $err = (string) ($result['error'] ?? 'unknown error');
        echo "FAIL → {$err}\n";
        $fail++;
    }
}

echo str_repeat('─', 60) . "\n";
if ($dryRun) {
    printf("Dry-run: %d entries would be synthesised.\n", $total);
} else {
    printf("Done. rendered=%d  skipped=%d  failed=%d\n", $ok, $skip, $fail);
}

exit($fail > 0 ? 1 : 0);
