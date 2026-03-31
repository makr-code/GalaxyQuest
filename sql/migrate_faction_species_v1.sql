-- ────────────────────────────────────────────────────────────────────────────────
-- Migration: faction_species v1
-- Creates faction_species table and seeds 6 base species definitions.
-- Idempotent: CREATE TABLE IF NOT EXISTS + INSERT IGNORE for re-run safety.
-- ────────────────────────────────────────────────────────────────────────────────

USE galaxyquest;

-- Create table for species/race definitions with design specs
CREATE TABLE IF NOT EXISTS faction_species (
    id INT AUTO_INCREMENT PRIMARY KEY,
    species_code VARCHAR(32) NOT NULL UNIQUE,
    display_name VARCHAR(80) NOT NULL,
    description TEXT,
    faction_type VARCHAR(40) NOT NULL,

    -- Male color palette (hex or css color list)
    color_primary_male VARCHAR(7) NOT NULL DEFAULT '#000000',
    color_secondary_male VARCHAR(7) NOT NULL DEFAULT '#FFFFFF',
    color_accent_male VARCHAR(7) NOT NULL DEFAULT '#808080',

    -- Female color palette
    color_primary_female VARCHAR(7) NOT NULL DEFAULT '#000000',
    color_secondary_female VARCHAR(7) NOT NULL DEFAULT '#FFFFFF',
    color_accent_female VARCHAR(7) NOT NULL DEFAULT '#808080',

    -- Prompts for AI portrait generation
    portrait_prompt_base TEXT NOT NULL,
    portrait_prompt_male_modifier TEXT,
    portrait_prompt_female_modifier TEXT,

    -- Logo/icon generation prompt
    logo_prompt TEXT,

    -- Material/texture description
    material_desc VARCHAR(255),

    -- Silhouette description for consistency
    silhouette_desc VARCHAR(255),

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Indexes (idx_species_code already covered by UNIQUE constraint on species_code)
-- idx_faction_type added separately for query performance

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED: 6 base species (INSERT IGNORE = safe re-run on UNIQUE species_code)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. VOR'TAK – Reptiloid Strategists
INSERT IGNORE INTO faction_species (
    species_code, display_name, description, faction_type,
    color_primary_male, color_secondary_male, color_accent_male,
    color_primary_female, color_secondary_female, color_accent_female,
    portrait_prompt_base,
    portrait_prompt_male_modifier,
    portrait_prompt_female_modifier,
    logo_prompt,
    material_desc,
    silhouette_desc
) VALUES (
    'vor_tak',
    'Vor\'Tak',
    'Reptiloid warriors and strategists. Hierarchical, honor-bound, strong militaristic culture.',
    'military',
    '#1a3d2a', '#2d5f3f', '#8b6914',
    '#00c851', '#00e6ff', '#ffd700',
    'Photorealistic bust portrait of a reptiloid alien, clearly gendered, muscular humanoid form with visible scaled texture overlay. Head features sharp angles and pronounced bone structure. Eyes have slit pupils. Heavily differentiated visual presentation between genders.',
    'Clearly MALE: Massive bone plates across shoulders and head, dark green-black iridescent scales with battle-worn patina, broad masculine facial structure with commanding features, intense yellow predatory eyes, prominent campaign scars, thick powerful neck, subtle bronze metallic armor integration.',
    'Clearly FEMALE: Finer scale structure, bright iridescent gold-turquoise patterns with precision geometry, elegant segmented facial features showing strength and rank, glowing emerald compound eyes with warrior intensity, regal confident presence, complex carapace-like patterns.',
    'Shield-emblem divided by upright sword: left half glossy dark green scale-texture, right half burnished bronze. Centered slit-pupil eye. Geometric military precision. Color palette: dark green, bronze, gold accent.',
    'Dark green-black iridescent scaled skin with bronze metallic undertones. Leathery texture visible at shoulders and spine. Semi-reflective surface.',
    'Broad-shouldered, upright powerful posture. Pronounced bone ridge from neck to pelvis. Scaled arms and legs with visible muscle definition. Clear gender dimorphism in shoulder width and facial geometry.'
);

-- 2. SYL'NAR – Cephalopodic Mystics
INSERT IGNORE INTO faction_species (
    species_code, display_name, description, faction_type,
    color_primary_male, color_secondary_male, color_accent_male,
    color_primary_female, color_secondary_female, color_accent_female,
    portrait_prompt_base,
    portrait_prompt_male_modifier,
    portrait_prompt_female_modifier,
    logo_prompt,
    material_desc,
    silhouette_desc
) VALUES (
    'syl_nar',
    'Syl\'Nar',
    'Cephalopodic mystics and diplomats. Spiritual, peaceful, communicate through color and bioluminescence.',
    'diplomacy',
    '#001a66', '#9966ff', '#00ffff',
    '#e6b3ff', '#ff66ff', '#e6ccff',
    'Photorealistic portrait of a cephalopod-based alien, clearly gendered, soft graceful tentacle structures visible. Intricate bioluminescent markings in species-specific hues. Smooth translucent skin with organic flowing form. Large expressive alien eyes with cosmic depth.',
    'Clearly MALE: Pulsing bioluminescence in deep blue and bright neon cyan. Angular patterns. Piercing gaze. Crystalline light refractions. Subtle geometric precision in pattern placement.',
    'Clearly FEMALE: Complex flowing bioluminescent patterns in soft lavender and magenta. Graceful soft-edged form. Large soulful eyes with ancient wisdom. Luminous patterns cascading softly across body. Serene peaceful spiritual expression.',
    'Circle with flowing tentacle motifs: background gradient deep blue to cyan. Centered bioluminescent spiral in magenta. Emanating light rays. Color palette: blues, magentas, cyan, silver accents.',
    'Smooth semi-transparent gelatinous skin. Bioluminescent glow emanates from beneath surface. Organic wet appearance. Soft gradient coloration in base and accent hues.',
    'Graceful rounded form with visible tentacle protrusions. Soft flowing contours. Large head-like central mass. Tapered limbs. Non-bipedal but upright-oriented orientation. Gender expressed through pattern complexity and form softness.'
);

-- 3. AERETH – Humanoid Energy Beings
INSERT IGNORE INTO faction_species (
    species_code, display_name, description, faction_type,
    color_primary_male, color_secondary_male, color_accent_male,
    color_primary_female, color_secondary_female, color_accent_female,
    portrait_prompt_base,
    portrait_prompt_male_modifier,
    portrait_prompt_female_modifier,
    logo_prompt,
    material_desc,
    silhouette_desc
) VALUES (
    'aereth',
    'Aereth',
    'Semi-material energy beings. Scientific culture. Energy is sacred. Transcendent and ethereal.',
    'research',
    '#e6f2ff', '#b3d9ff', '#4d94ff',
    '#ffe6cc', '#fff9e6', '#ffffcc',
    'Photorealistic portrait of an energy-being alien in humanoid form, clearly gendered. Visible internal luminosity and light refractions across semi-transparent surface. Floating crystalline structures around form. Intense glowing eyes.',
    'Clearly MALE: Compact angular light-form structure. Sharp geometric internal crystalline lattice visible. Bright white-blue dominant glow with silver undertones. Piercing intense glowing eyes. Cold detached beauty. Light refractions creating prism effects across surface.',
    'Clearly FEMALE: Flowing smoothly-curved luminous form. Golden inner glow with amber accents. Warm radiant emanation. Elegant curved geometric patterns in light structure. Eyes glow softly golden. Ethereal transcendent appearance. Grace in form.',
    'Diamond shape: top half brilliant white-blue gradient, bottom half radiant gold. Central eye-like sphere in each half. Radiating energy lines outward. Color palette: white, blue, gold, silver.',
    'Semi-transparent crystalline appearance with internal luminosity. Bright glowing core. Light refractions cascade across surface. Barely-material energy presence. Smooth glass-like quality.',
    'Tall upright humanoid silhouette. Angular when male, curved when female. Visible internal geometric crystalline structure. Floating or hovering posture. Radiating aura around form.'
);

-- 4. KRYL'THA – Insectoid Warriors
INSERT IGNORE INTO faction_species (
    species_code, display_name, description, faction_type,
    color_primary_male, color_secondary_male, color_accent_male,
    color_primary_female, color_secondary_female, color_accent_female,
    portrait_prompt_base,
    portrait_prompt_male_modifier,
    portrait_prompt_female_modifier,
    logo_prompt,
    material_desc,
    silhouette_desc
) VALUES (
    'kryl_tha',
    'Kryl\'Tha',
    'Insectoid warriors with strong hive mentality. Swarm-oriented. Female-led commanders.',
    'production',
    '#1a1a00', '#664d00', '#cc0000',
    '#ffcc00', '#00ff99', '#00cc99',
    'Photorealistic portrait of an insectoid alien, clearly gendered. Chitinous exoskeleton with segmented armor-like plates. Sharp mandibles and complex facial articulation. Compound or large soulful eyes depending on gender.',
    'Clearly MALE: Dark glossy black-green chitinous plates with deep crimson accents. Stark military appearance. Visible segmented armor over entire form. Sharp commanding mandibles. Intense focused eyes. Minimal ornamentation. Pure warrior aesthetic.',
    'Clearly FEMALE: Bright iridescent gold and turquoise segmented patterns with precision geometry. Elegant articulated form showing rank and refinement. Regal confident presence. Softly glowing compound eyes. Battle scars integrated as status marks. Ornamental carapace patterning.',
    'Upright insectoid silhouette: hexagon shape, top half gold-turquoise with geometric segmentation, bottom half dark with crimson accent line. Centered mandible-like shape. Color palette: gold, turquoise, black, crimson.',
    'Hardened chitinous exoskeleton with multiple segments. Matte dark coloration on male, glossy iridescent on female. Armor-like plate structure. Metallic sheen in accent areas.',
    'Upright insectoid posture. Broad armored shoulders. Visible segment lines from head to abdomen. Multiple limb joints visible. Gender shown through pattern intensity and form elegance. Mandible-like jaw structure.'
);

-- 5. ZHAREEN – Crystalline Empaths
INSERT IGNORE INTO faction_species (
    species_code, display_name, description, faction_type,
    color_primary_male, color_secondary_male, color_accent_male,
    color_primary_female, color_secondary_female, color_accent_female,
    portrait_prompt_base,
    portrait_prompt_male_modifier,
    portrait_prompt_female_modifier,
    logo_prompt,
    material_desc,
    silhouette_desc
) VALUES (
    'zhareen',
    'Zhareen',
    'Crystalline organic life forms. Archivists and empaths. Store consciousness in crystal structure.',
    'archive',
    '#0d1f4d', '#4d7a99', '#c0c0c0',
    '#ffb3d9', '#e6ccff', '#e6f2ff',
    'Photorealistic portrait of a crystalline alien, clearly gendered. Faceted geometric crystal structure visible in form. Internal light refraction and prismatic effects. Smooth flowing or sharp angular forms based on gender.',
    'Clearly MALE: Sharp angular crystalline facets in cobalt blue and platinum gray. Geometric precision. Internal light refractions creating prismatic scatter across surface. Cold intellectual presence. Symmetric perfectly-formed angles. Deep internal luminosity in cool tones.',
    'Clearly FEMALE: Smooth flowing curved crystal contours in rose gold and soft amethyst. Elegant refined appearance. Warm inner luminescence. Graceful transitional angles. Soft prismatic glow. Jewel-like beauty and refinement.',
    'Perfect geometric shape (hexagon or octagon): Gradient cobalt to platinum with rose-gold geometric inlay. Central refraction-star. Radiating light-lines. Color palette: cobalt, platinum, rose-gold, amethyst, periwinkle.',
    'Translucent crystalline structure with visible internal facets. Prismatic light refractions. Smooth gemstone-like surface. Luminous core. Metallic sheen in platinum or rose-gold tones.',
    'Geometric crystalline form. Angular when male, gracefully curved when female. Faceted surface structure. Symmetrical composition. Internal luminosity visible. Jewel-like proportions and form.'
);

-- 6. VEL'AR – Gaseous Intelligences
INSERT IGNORE INTO faction_species (
    species_code, display_name, description, faction_type,
    color_primary_male, color_secondary_male, color_accent_male,
    color_primary_female, color_secondary_female, color_accent_female,
    portrait_prompt_base,
    portrait_prompt_male_modifier,
    portrait_prompt_female_modifier,
    logo_prompt,
    material_desc,
    silhouette_desc
) VALUES (
    'vel_ar',
    'Vel\'Ar',
    'Gas-based conscious entities. Intelligence operatives. Wear biomasked personas. Enigmatic and secretive.',
    'espionage',
    '#2a2a2a', '#0d66cc', '#0db3ff',
    '#f0f0f0', '#e6b3ff', '#00ffff',
    'Photorealistic portrait of a gas-based alien wearing a refined biomask, clearly gendered. Semi-solid biomasked face. Internal swirling nebula-like gas patterns visible beneath mask. Soft glowing ethereal presence.',
    'Clearly MALE: Angular sharp-edged biomask. Smoke-gray with ice-blue accents. Internal gas layer shows cold geometric patterns in darker tones. Eyes glow piercing ice-blue. Clinical detached presence. Minimal ornamentation. Secretive mysterious quality.',
    'Clearly FEMALE: Smooth rounded elegant biomask. Misty-white and soft lavender coloration. Internal gas shows warm nebula patterns in magenta and cyan swirls. Eyes glow softly cyan. Enigmatic graceful mystique. Soft ethereal presence.',
    'Circular mask-like shape: left half smoke-gray (male) or lavender (female), right half ice-blue or cyan with swirling nebula pattern. Central eye-aperture. Radiating mystery lines. Color palette: grays, blues, lavenders, cyans.',
    'Semi-solid gaseous appearance with visible swirling internal patterns. Nebula-like coloration in base and accent hues. Soft diffuse boundaries. Luminous gaze. Ethereal translucent quality.',
    'Smooth rounded or angular biomask form. Central focused gaze. Soft diffuse floating posture. Internal nebula patterns visible through semi-transparent surface. Gender expressed through mask shape angularity and color warmth.'
);
-- Added via conditional PREPARE to be idempotent on re-run
SET @idx_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE table_schema = 'galaxyquest'
      AND table_name   = 'faction_species'
      AND index_name   = 'idx_faction_type'
);
SET @sql = IF(@idx_exists = 0,
    'ALTER TABLE faction_species ADD INDEX idx_faction_type (faction_type)',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
