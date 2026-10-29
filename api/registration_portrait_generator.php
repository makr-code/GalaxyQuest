<?php
declare(strict_types=1);

require_once __DIR__ . '/character_profile_generator.php';
require_once __DIR__ . '/../lib/RegistrationPortraitService.php';

function registration_render_portrait(array $snapshot): string {
    if (!swarmui_is_enabled()) throw new RuntimeException('Portrait generation is disabled on this server.', 503);
    $design = character_profile_load_species_designs_from_files($snapshot['species_code']);
    if ($design === null) throw new RuntimeException('Selected species design is not available.', 503);
    $profile = [
        'username' => $snapshot['character']['name'], 'race' => $design['display_name'],
        'profession' => 'colony commander', 'stance' => 'resolute', 'is_npc' => false,
    ];
    $profile['portrait_prompt'] = character_profile_build_prompt_with_designs($design, $profile);
    // Species morphology must come from the canonical design, not an LLM's invented race.
    $profile['portrait_prompt'] .= ', ' . $design['portrait_prompt_base'] . ', ' . $design['silhouette_desc'];
    $directory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'gq-portrait-' . bin2hex(random_bytes(16));
    if (!mkdir($directory, 0700)) throw new RuntimeException('Cannot prepare private portrait storage.', 503);
    $path = $directory . DIRECTORY_SEPARATOR . 'portrait.png';
    try {
        $result = character_profile_generate_portrait(0, $profile, $directory);
        if (!($result['ok'] ?? false)) {
            error_log('registration_portrait_backend_failure error=' . ($result['error'] ?? 'unknown'));
            throw new RuntimeException('The local portrait service could not generate an image. Please retry later.', 503);
        }
        $bytes = file_get_contents($path, false, null, 0, RegistrationPortraitService::MAX_BYTES + 1);
        if ($bytes === false) throw new RuntimeException('Cannot read generated portrait.', 503);
        return $bytes;
    } finally {
        if (is_file($path)) unlink($path);
        rmdir($directory);
    }
}
