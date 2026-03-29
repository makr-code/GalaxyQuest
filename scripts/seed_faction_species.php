<?php
# Faction Species Seed Inserts
# Run: docker compose exec -T web php scripts/seed_faction_species.php

require_once __DIR__ . '/../api/helpers.php';

$db = get_db();

$species = [
    [
        'code' => 'vor_tak',
        'name' => 'Vor\'Tak',
        'description' => 'Reptiloid warriors and strategists. Hierarchical, honor-bound, strong militaristic culture.',
        'faction_type' => 'military',
        'color_m_primary' => '#1a3d2a',
        'color_m_secondary' => '#2d5f3f',
        'color_m_accent' => '#8b6914',
        'color_f_primary' => '#00c851',
        'color_f_secondary' => '#00e6ff',
        'color_f_accent' => '#ffd700',
        'portrait_base' => 'Photorealistic bust portrait of a reptiloid alien, clearly gendered, muscular humanoid form with visible scaled texture overlay. Head features sharp angles and pronounced bone structure. Eyes have slit pupils.',
        'portrait_m' => 'Clearly MALE: Massive bone plates across shoulders and head, dark green-black iridescent scales with battle-worn patina, broad masculine facial structure, intense yellow predatory eyes, prominent scars, thick powerful neck.',
        'portrait_f' => 'Clearly FEMALE: Finer scale structure, bright iridescent gold-turquoise patterns, elegant segmented facial features, glowing emerald eyes with warrior intensity, regal confident presence.',
        'logo' => 'Shield-emblem: left half glossy dark green scale-texture, right half burnished bronze. Slit-pupil eye. Geometric military precision.',
        'material' => 'Dark green-black iridescent scaled skin with bronze metallic undertones.',
        'silhouette' => 'Broad-shouldered powerful posture. Pronounced bone ridge. Scaled arms/legs. Clear gender dimorphism.'
    ],
    [
        'code' => 'syl_nar',
        'name' => 'Syl\'Nar',
        'description' => 'Cephalopodic mystics and diplomats. Spiritual, peaceful, communicate through color and bioluminescence.',
        'faction_type' => 'diplomacy',
        'color_m_primary' => '#001a66',
        'color_m_secondary' => '#9966ff',
        'color_m_accent' => '#00ffff',
        'color_f_primary' => '#e6b3ff',
        'color_f_secondary' => '#ff66ff',
        'color_f_accent' => '#e6ccff',
        'portrait_base' => 'Photorealistic portrait of a cephalopod-based alien, clearly gendered, soft graceful tentacle structures. Intricate bioluminescent markings. Smooth translucent skin with flowing form. Large expressive alien eyes.',
        'portrait_m' => 'Clearly MALE: Pulsing bioluminescence in deep blue and neon cyan. Angular patterns. Piercing gaze. Crystalline light refractions. Geometric precision.',
        'portrait_f' => 'Clearly FEMALE: Complex flowing bioluminescent patterns in lavender and magenta. Graceful soft-edged form. Soulful eyes. Luminous patterns cascading. Serene spiritual expression.',
        'logo' => 'Circle with flowing tentacle motifs: gradient deep blue to cyan. Centered bioluminescent spiral in magenta with light rays.',
        'material' => 'Smooth semi-transparent gelatinous skin. Bioluminescent glow. Organic wet appearance.',
        'silhouette' => 'Graceful rounded form with tentacle protrusions. Large central mass. Tapered limbs. Gender via pattern complexity.'
    ],
    [
        'code' => 'aereth',
        'name' => 'Aereth',
        'description' => 'Semi-material energy beings. Scientific culture. Energy is sacred. Transcendent and ethereal.',
        'faction_type' => 'research',
        'color_m_primary' => '#e6f2ff',
        'color_m_secondary' => '#b3d9ff',
        'color_m_accent' => '#4d94ff',
        'color_f_primary' => '#ffe6cc',
        'color_f_secondary' => '#fff9e6',
        'color_f_accent' => '#ffffcc',
        'portrait_base' => 'Photorealistic portrait of an energy-being alien in humanoid form, clearly gendered. Visible internal luminosity. Floating crystalline structures. Intense glowing eyes.',
        'portrait_m' => 'Clearly MALE: Compact angular light-form. Sharp geometric crystalline lattice. Bright white-blue glow with silver. Intense glowing eyes. Cold detached beauty.',
        'portrait_f' => 'Clearly FEMALE: Flowing smoothly-curved luminous form. Golden inner glow with amber. Elegant curved patterns. Softly glowing eyes. Ethereal transcendent.',
        'logo' => 'Diamond shape: top half white-blue gradient, bottom half radiant gold. Central eye-like sphere each half.',
        'material' => 'Semi-transparent crystalline with internal luminosity. Bright glowing core. Light refractions.',
        'silhouette' => 'Tall upright humanoid. Angular when male, curved when female. Internal geometric structure. Floating posture. Radiating aura.'
    ],
    [
        'code' => 'kryl_tha',
        'name' => 'Kryl\'Tha',
        'description' => 'Insectoid warriors with strong hive mentality. Swarm-oriented. Female-led commanders.',
        'faction_type' => 'production',
        'color_m_primary' => '#1a1a00',
        'color_m_secondary' => '#664d00',
        'color_m_accent' => '#cc0000',
        'color_f_primary' => '#ffcc00',
        'color_f_secondary' => '#00ff99',
        'color_f_accent' => '#00cc99',
        'portrait_base' => 'Photorealistic portrait of an insectoid alien, clearly gendered. Chitinous exoskeleton with segmented armor-like plates. Sharp mandibles. Complex facial articulation.',
        'portrait_m' => 'Clearly MALE: Dark glossy black-green plates with crimson accents. Stark military appearance. Sharp mandibles. Intense focused eyes. Minimal ornamentation.',
        'portrait_f' => 'Clearly FEMALE: Bright iridescent gold/turquoise with precision geometry. Elegant articulated form. Regal confident presence. Glowing compound eyes. Ornamental carapace.',
        'logo' => 'Upright hexagon: top half gold-turquoise segmented, bottom half dark with crimson line. Centered mandible.',
        'material' => 'Hardened chitinous exoskeleton with segments. Matte dark on male, glossy iridescent on female.',
        'silhouette' => 'Upright insectoid posture. Broad armored shoulders. Segment lines head to abdomen. Multiple limb joints. Gender via pattern intensity.'
    ],
    [
        'code' => 'zhareen',
        'name' => 'Zhareen',
        'description' => 'Crystalline organic life forms. Archivists and empaths. Store consciousness in crystal.',
        'faction_type' => 'archive',
        'color_m_primary' => '#0d1f4d',
        'color_m_secondary' => '#4d7a99',
        'color_m_accent' => '#c0c0c0',
        'color_f_primary' => '#ffb3d9',
        'color_f_secondary' => '#e6ccff',
        'color_f_accent' => '#e6f2ff',
        'portrait_base' => 'Photorealistic portrait of a crystalline alien, clearly gendered. Faceted geometric crystal structure. Internal light refraction and prismatic effects.',
        'portrait_m' => 'Clearly MALE: Sharp angular crystalline facets in cobalt and platinum. Geometric precision. Internal light refractions. Cold intellectual presence. Symmetric perfection.',
        'portrait_f' => 'Clearly FEMALE: Smooth flowing curved crystal in rose-gold and amethyst. Elegant refined appearance. Warm luminescence. Graceful angles. Jewel-like beauty.',
        'logo' => 'Perfect geometric hexagon: gradient cobalt to platinum with rose-gold inlay. Central refraction-star. Radiating light-lines.',
        'material' => 'Translucent crystalline with visible facets. Prismatic light refractions. Smooth gemstone surface.',
        'silhouette' => 'Geometric crystalline form. Angular male, gracefully curved female. Faceted surface. Symmetric. Internal luminosity. Jewel-like proportions.'
    ],
    [
        'code' => 'vel_ar',
        'name' => 'Vel\'Ar',
        'description' => 'Gas-based conscious entities. Intelligence operatives. Wear biomasked personas. Enigmatic.',
        'faction_type' => 'espionage',
        'color_m_primary' => '#2a2a2a',
        'color_m_secondary' => '#0d66cc',
        'color_m_accent' => '#0db3ff',
        'color_f_primary' => '#f0f0f0',
        'color_f_secondary' => '#e6b3ff',
        'color_f_accent' => '#00ffff',
        'portrait_base' => 'Photorealistic portrait of a gas-based alien wearing refined biomask, clearly gendered. Semi-solid biomasked face. Internal swirling nebula-like gas patterns.',
        'portrait_m' => 'Clearly MALE: Angular sharp-edged biomask in smoke-gray with ice-blue accents. Cold geometric patterns. Eyes glow piercing ice-blue. Clinical detached presence.',
        'portrait_f' => 'Clearly FEMALE: Smooth rounded elegant biomask in misty-white and lavender. Internal warm nebula patterns in magenta/cyan. Softly glowing cyan eyes. Graceful mystique.',
        'logo' => 'Circular mask-like shape: half smoke-gray/lavender, half ice-blue/cyan with nebula pattern. Central eye-aperture. Mystery lines.',
        'material' => 'Semi-solid gaseous with swirling patterns. Nebula-like coloration. Soft diffuse boundaries. Luminous gaze.',
        'silhouette' => 'Smooth rounded/angular biomask form depending on gender. Central focused gaze. Soft floating posture. Internal nebula patterns.'
    ]
];

$table = 'faction_species';
$count = 0;

foreach ($species as $s) {
    try {
        $stmt = $db->prepare(
            "INSERT INTO $table 
            (species_code, display_name, description, faction_type, 
             color_primary_male, color_secondary_male, color_accent_male,
             color_primary_female, color_secondary_female, color_accent_female,
             portrait_prompt_base, portrait_prompt_male_modifier, portrait_prompt_female_modifier,
             logo_prompt, material_desc, silhouette_desc)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        $result = $stmt->execute([
            $s['code'], $s['name'], $s['description'], $s['faction_type'],
            $s['color_m_primary'], $s['color_m_secondary'], $s['color_m_accent'],
            $s['color_f_primary'], $s['color_f_secondary'], $s['color_f_accent'],
            $s['portrait_base'], $s['portrait_m'], $s['portrait_f'],
            $s['logo'], $s['material'], $s['silhouette']
        ]);
        if ($result) {
            echo "✓ {$s['name']}\n";
            $count++;
        }
    } catch (Throwable $e) {
        echo "✗ {$s['name']}: {$e->getMessage()}\n";
    }
}

echo "\nSeeded $count species.\n";
$verify = $db->query("SELECT COUNT(*) as cnt FROM $table")->fetchColumn();
echo "Total in DB: $verify\n";
