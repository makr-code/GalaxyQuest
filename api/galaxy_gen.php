<?php
/**
 * GalaxyQuest – Scientific Galaxy Generator
 *
 * Procedurally generates a Milky Way-like barred spiral galaxy.
 * All output is purely deterministic from (galaxyIdx, systemIdx) – no DB,
 * no global state, no side effects.
 *
 * Physical models used:
 *  - Spiral geometry : logarithmic spiral, pitch angle 14° (Milky Way value)
 *  - Stellar types   : Kroupa (2001) / Chabrier (2003) IMF, main-sequence
 *                      physical parameters from Allen's Astrophysical
 *                      Quantities 4th ed. and Drilling & Landolt (2000)
 *  - Habitable zone  : Kopparapu et al. (2013) – conservative limits
 *  - Frost line      : 170 K ice-condensation isotherm, flux-balance model
 *  - Orbital periods : Kepler's Third Law  T² = (4π²/GM)·a³
 *  - Equilibrium T   : Stefan-Boltzmann flux balance with Bond albedo
 *  - Planet masses   : log-normal distribution calibrated to Kepler census
 *                      (Howard et al. 2012, Fressin et al. 2013)
 *  - Radii / gravity : mass–radius relations for rocky (Zeng et al. 2016)
 *                      and giant planets (Fortney et al. 2007)
 */

// ─── Physical / astronomical constants ───────────────────────────────────────

/** Solar luminosity (W) */
const GEN_L_SUN_W    = 3.828e26;
/** Solar mass (kg) */
const GEN_M_SUN_KG   = 1.989e30;
/** 1 AU in metres */
const GEN_AU_M       = 1.496e11;
/** Stefan-Boltzmann constant (W m⁻² K⁻⁴) */
const GEN_SIGMA_SB   = 5.670e-8;
/** Gravitational constant (m³ kg⁻¹ s⁻²) */
const GEN_G_SI       = 6.674e-11;

// ─── Galaxy geometry ──────────────────────────────────────────────────────────

/** Disk radius in light-years (Milky Way ≈ 50 kly) */
const GAL_RADIUS_LY        = 50000.0;
/** Number of main spiral arms */
const GAL_ARMS             = 4;
/** Logarithmic spiral pitch angle in degrees (Milky Way ≈ 12–14°) */
const GAL_PITCH_ANGLE_DEG  = 14.0;
/** Inner arm edge in ly (where arms emerge from the bar) */
const GAL_ARM_START_LY     = 3500.0;
/** Outer arm edge in ly */
const GAL_ARM_END_LY       = 45000.0;
/** 1-sigma Gaussian scatter perpendicular to arm centerline (ly) */
const GAL_ARM_WIDTH_LY     = 1500.0;
/** Thin-disk scale height, 1-sigma (ly) */
const GAL_DISK_HEIGHT_LY   = 300.0;
/** Bulge effective half-radius (ly) */
const GAL_BULGE_RADIUS_LY  = 4500.0;
/** Fraction of stars placed in the bulge component */
const GAL_BULGE_FRACTION   = 0.08;

// ─── Stellar type CDF (Kroupa IMF, main-sequence stars) ──────────────────────
//
// Cumulative probability | class | subtype lo | subtype hi |
//   typical mass (M☉)   | typical radius (R☉) | typical T (K) | typical L (L☉)
//
// Sources: Ledrew (2001) "The Real Starry Sky"; Reid et al. (2002)
const SPECTRAL_TYPE_CDF = [
    [0.7645, 'M', 0, 9,  0.35, 0.40,  3500,   0.040],
    [0.8855, 'K', 0, 9,  0.74, 0.80,  4750,   0.210],
    [0.9615, 'G', 0, 9,  0.97, 0.97,  5600,   0.840],
    [0.9925, 'F', 0, 9,  1.30, 1.30,  6750,   3.200],
    [0.9985, 'A', 0, 9,  2.00, 1.80,  8750,  14.000],
    [0.9998, 'B', 0, 9,  8.00, 5.00, 20000, 3000.00],
    [1.0000, 'O', 3, 8, 50.00, 9.00, 40000,200000.0],
];

// ─── Detailed main-sequence parameters per spectral class and subtype ─────────
// Each entry: [mass_solar, radius_solar, temp_K, luminosity_solar]
// Source: Allen's Astrophysical Quantities 4th ed.; Drilling & Landolt (2000)
const STELLAR_PARAMS = [
    'O' => [
        3 => [60.0, 12.0, 44500, 500000.0],
        5 => [37.0,  9.5, 40600, 180000.0],
        8 => [18.0,  7.4, 35000,  46000.0],
    ],
    'B' => [
        0 => [17.0, 7.0, 28000, 39000.0],
        2 => [ 9.0, 4.9, 21000,  4000.0],
        5 => [ 5.0, 3.9, 15400,   750.0],
        8 => [ 3.5, 2.9, 11400,   200.0],
    ],
    'A' => [
        0 => [2.90, 2.40, 9600, 54.0],
        2 => [2.50, 2.00, 8970, 28.0],
        5 => [2.00, 1.70, 8100, 14.0],
        7 => [1.80, 1.60, 7600,  8.0],
    ],
    'F' => [
        0 => [1.60, 1.50, 7200, 6.5],
        2 => [1.46, 1.41, 6890, 4.8],
        5 => [1.30, 1.30, 6440, 3.2],
        8 => [1.16, 1.16, 6200, 2.0],
    ],
    'G' => [
        0 => [1.06, 1.10, 6030, 1.50],
        2 => [1.00, 1.00, 5778, 1.00],   // Sun: G2V
        5 => [0.94, 0.95, 5660, 0.79],
        8 => [0.87, 0.90, 5440, 0.59],
    ],
    'K' => [
        0 => [0.78, 0.85, 5240, 0.42],
        2 => [0.74, 0.80, 4890, 0.29],
        5 => [0.69, 0.74, 4410, 0.16],
        8 => [0.62, 0.68, 3990, 0.08],
    ],
    'M' => [
        0 => [0.470, 0.510, 3800, 0.0630],
        2 => [0.350, 0.400, 3550, 0.0254],
        4 => [0.250, 0.300, 3150, 0.0063],
        6 => [0.160, 0.200, 2900, 0.0011],
        8 => [0.080, 0.120, 2650, 0.0001],
    ],
];

// ─── Planet class identifiers ─────────────────────────────────────────────────
const PC_LAVA        = 'lava';        // Innermost, T_eq > 1800 K
const PC_HOT_JUPITER = 'hot_jupiter'; // Gas giant inside frost line
const PC_ROCKY       = 'rocky';       // Terrestrial ≤ 2 M_earth
const PC_SUPER_EARTH = 'super_earth'; // Terrestrial 2–10 M_earth
const PC_OCEAN       = 'ocean';       // HZ, high water fraction
const PC_GAS_GIANT   = 'gas_giant';   // Beyond frost line, ≥ 30 M_earth
const PC_ICE_GIANT   = 'ice_giant';   // Outer system, ice + H/He envelope
const PC_ICE_DWARF   = 'ice_dwarf';   // Small outer-system body
const PC_COMET_BELT  = 'comet_belt';  // Outermost slot, like Kuiper belt

// ─── External generator config ───────────────────────────────────────────────

function galaxy_default_config(): array
{
    $cdf = [];
    foreach (SPECTRAL_TYPE_CDF as $entry) {
        [$cumProb, $class, $stLo, $stHi] = $entry;
        $cdf[] = [
            'cum_prob'    => $cumProb,
            'class'       => $class,
            'subtype_min' => $stLo,
            'subtype_max' => $stHi,
        ];
    }

    return [
        'galaxy' => [
            'name'               => 'Milky Way Core',
            'arms'               => GAL_ARMS,
            'radius_ly'          => GAL_RADIUS_LY,
            'arm_start_ly'       => GAL_ARM_START_LY,
            'arm_end_ly'         => GAL_ARM_END_LY,
            'arm_width_ly'       => GAL_ARM_WIDTH_LY,
            'pitch_angle_deg'    => GAL_PITCH_ANGLE_DEG,
            'disk_height_ly'     => GAL_DISK_HEIGHT_LY,
            'bulge_radius_ly'    => GAL_BULGE_RADIUS_LY,
            'bulge_fraction'     => GAL_BULGE_FRACTION,
            'systems_per_galaxy' => defined('SYSTEM_MAX') ? SYSTEM_MAX : 499,
        ],
        'resource_types' => ['metal', 'crystal', 'deuterium', 'rare_earth'],
        'planet_types'   => [
            PC_LAVA, PC_HOT_JUPITER, PC_ROCKY, PC_SUPER_EARTH,
            PC_OCEAN, PC_GAS_GIANT, PC_ICE_GIANT, PC_ICE_DWARF, PC_COMET_BELT,
        ],
        'stellar_types' => [
            'cdf' => $cdf,
            'mean_planets_by_class' => [
                'O' => 2.0, 'B' => 2.0, 'A' => 3.5,
                'F' => 5.0, 'G' => 6.5, 'K' => 6.5,
                'M' => 5.5, 'default' => 5.0,
            ],
            'main_sequence_params' => STELLAR_PARAMS,
        ],
        'resources' => [
            'base_deposits' => [
                'metal' => 5000000,
                'crystal' => 2000000,
                'deuterium' => 1000000,
                'rare_earth' => 200000,
            ],
            'low_metal_deposit_classes' => [PC_GAS_GIANT, PC_ICE_GIANT, PC_HOT_JUPITER],
            'unlimited_deuterium_classes' => [PC_GAS_GIANT],
            'mass_factor' => ['min' => 0.5, 'max' => 3.0, 'rare_earth_max' => 2.0],
            'hz_bonus' => [
                'classes' => [PC_ROCKY, PC_OCEAN, PC_SUPER_EARTH],
                'metal' => 1.2, 'crystal' => 1.1, 'deuterium' => 1.3,
            ],
            'class_richness' => [
                PC_LAVA        => ['metal' => 1.8, 'crystal' => 0.9, 'deuterium' => 0.2, 'rare_earth' => 2.0],
                PC_ROCKY       => ['metal' => 1.4, 'crystal' => 1.3, 'deuterium' => 1.0, 'rare_earth' => 1.5],
                PC_SUPER_EARTH => ['metal' => 1.1, 'crystal' => 1.0, 'deuterium' => 1.0, 'rare_earth' => 1.2],
                PC_OCEAN       => ['metal' => 0.7, 'crystal' => 0.8, 'deuterium' => 1.3, 'rare_earth' => 0.5],
                PC_ICE_DWARF   => ['metal' => 0.6, 'crystal' => 1.8, 'deuterium' => 1.4, 'rare_earth' => 1.0],
                PC_COMET_BELT  => ['metal' => 0.5, 'crystal' => 0.9, 'deuterium' => 1.2, 'rare_earth' => 0.4],
                PC_GAS_GIANT   => ['metal' => 0.3, 'crystal' => 0.2, 'deuterium' => 2.0, 'rare_earth' => 0.1],
                PC_ICE_GIANT   => ['metal' => 0.4, 'crystal' => 1.5, 'deuterium' => 1.6, 'rare_earth' => 0.5],
                PC_HOT_JUPITER => ['metal' => 0.2, 'crystal' => 0.1, 'deuterium' => 0.5, 'rare_earth' => 0.1],
            ],
        ],
    ];
}

function galaxy_config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }

    $defaults = galaxy_default_config();
    $path = __DIR__ . '/../config/galaxy_config.json';
    if (!is_file($path)) {
        $cfg = $defaults;
        return $cfg;
    }

    $raw = file_get_contents($path);
    $json = json_decode($raw ?: '', true);
    if (!is_array($json)) {
        $cfg = $defaults;
        return $cfg;
    }

    $cfg = array_replace_recursive($defaults, $json);
    return $cfg;
}

function naming_default_config(): array
{
    return [
        'max_name_length' => 16,
        'profiles' => [
            'latin_soft' => [
                'weight' => 0.36,
                'class_affinity' => ['O' => 0.6, 'B' => 0.7, 'A' => 0.9, 'F' => 1.1, 'G' => 1.2, 'K' => 1.15, 'M' => 1.05],
                'arm_bias' => [1.25, 0.95, 0.9, 1.0],
                'onsets' => ['', 'l', 'm', 'n', 'r', 's', 't', 'v', 'c', 'd', 'f', 'al', 'el', 'or', 've'],
                'nuclei' => ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'io', 'oa'],
                'codas' => ['', 'n', 'r', 's', 'l', 'm', 'th', 'ra', 'ria'],
                'suffixes' => ['', 'a', 'ia', 'on', 'or', 'is'],
                'syllables' => ['min' => 2, 'max' => 3],
            ],
            'nordic_hard' => [
                'weight' => 0.24,
                'class_affinity' => ['O' => 1.2, 'B' => 1.15, 'A' => 1.0, 'F' => 0.95, 'G' => 0.85, 'K' => 0.8, 'M' => 0.75],
                'arm_bias' => [0.9, 1.25, 1.05, 0.95],
                'onsets' => ['', 'k', 'kr', 'dr', 'sk', 'st', 'th', 'v', 'br', 'gr', 'h'],
                'nuclei' => ['a', 'e', 'i', 'o', 'u', 'y', 'ei', 'au'],
                'codas' => ['', 'k', 'r', 'n', 'nd', 'rk', 'ld', 'm'],
                'suffixes' => ['', 'gard', 'heim', 'var', 'sk'],
                'syllables' => ['min' => 2, 'max' => 3],
            ],
            'semitic_angular' => [
                'weight' => 0.20,
                'class_affinity' => ['O' => 1.1, 'B' => 1.05, 'A' => 1.0, 'F' => 1.0, 'G' => 0.95, 'K' => 0.95, 'M' => 0.9],
                'arm_bias' => [0.95, 0.9, 1.25, 1.0],
                'onsets' => ['', 'z', 'zh', 'q', 'kh', 's', 'sh', 't', 'd', 'r', 'h'],
                'nuclei' => ['a', 'e', 'i', 'o', 'u', 'aa', 'ia', 'ua'],
                'codas' => ['', 'n', 'm', 'r', 'th', 'q', 'z'],
                'suffixes' => ['', 'ar', 'esh', 'un', 'aq'],
                'syllables' => ['min' => 2, 'max' => 3],
            ],
            'alien_breathy' => [
                'weight' => 0.20,
                'class_affinity' => ['O' => 1.35, 'B' => 1.25, 'A' => 1.1, 'F' => 0.95, 'G' => 0.85, 'K' => 0.8, 'M' => 0.75],
                'arm_bias' => [0.9, 0.95, 0.95, 1.3],
                'onsets' => ['', 'x', 'zh', 'qh', 'vr', 'yl', 'kh', 'sr', 'th'],
                'nuclei' => ['a', 'e', 'i', 'o', 'u', 'ae', 'ou', 'ui', 'io'],
                'codas' => ['', 'x', 'r', 'n', 'sh', 'th', 'l'],
                'suffixes' => ['', 'ix', 'ion', 'ara', 'eth'],
                'syllables' => ['min' => 2, 'max' => 4],
            ],
        ],
        'illegal_clusters' => ['aaa', 'eee', 'iii', 'ooo', 'uuu', 'qj', 'jj', 'zxz', 'vvv', 'rthh'],
        'planet_suffix_mode' => 'roman',
    ];
}

function naming_config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }
    $runtime = galaxy_config();
    $cfg = array_replace_recursive(
        naming_default_config(),
        is_array($runtime['naming'] ?? null) ? $runtime['naming'] : []
    );
    return $cfg;
}

function weighted_pick(array $items, int ...$seeds): string
{
    if (count($items) === 0) {
        return '';
    }

    $normalized = [];
    $total = 0.0;
    foreach ($items as $key => $value) {
        if (is_array($value) && array_key_exists('value', $value)) {
            $entryValue = (string)$value['value'];
            $weight = max(0.0, (float)($value['weight'] ?? 1.0));
        } elseif (is_string($key) && is_numeric($value)) {
            $entryValue = $key;
            $weight = max(0.0, (float)$value);
        } else {
            $entryValue = (string)$value;
            $weight = 1.0;
        }
        if ($weight <= 0.0) {
            continue;
        }
        $normalized[] = ['value' => $entryValue, 'weight' => $weight];
        $total += $weight;
    }

    if ($total <= 0.0 || count($normalized) === 0) {
        return (string)reset($items);
    }

    $roll = gen_rand(...$seeds) * $total;
    $acc = 0.0;
    foreach ($normalized as $entry) {
        $acc += $entry['weight'];
        if ($roll <= $acc) {
            return $entry['value'];
        }
    }
    return $normalized[count($normalized) - 1]['value'];
}

function sanitize_fantasy_name(string $name, array $illegalClusters): string
{
    $name = strtolower($name);
    $name = preg_replace('/[^a-z]/', '', $name) ?? $name;
    $name = preg_replace('/([aeiou])\1{2,}/', '$1$1', $name) ?? $name;
    $name = preg_replace('/([^aeiou])\1{2,}/', '$1$1', $name) ?? $name;
    $name = preg_replace_callback(
        '/([^aeiou]{4,})/',
        static fn(array $m): string => substr((string)$m[1], 0, 3),
        $name
    ) ?? $name;

    foreach ($illegalClusters as $cluster) {
        $cluster = strtolower((string)$cluster);
        if ($cluster === '') {
            continue;
        }
        while (str_contains($name, $cluster)) {
            $replacement = substr($cluster, 0, max(1, (int)floor(strlen($cluster) / 2)));
            $name = str_replace($cluster, $replacement, $name);
        }
    }

    if ($name === '') {
        return 'nova';
    }
    return ucfirst($name);
}

function pick_name_profile(int $galaxyIdx, int $systemIdx, string $spectralClass = 'G'): array
{
    $cfg = naming_config();
    $profiles = is_array($cfg['profiles'] ?? null) ? $cfg['profiles'] : [];
    if (count($profiles) === 0) {
        return ['key' => 'latin_soft', 'profile' => naming_default_config()['profiles']['latin_soft']];
    }

    $armCount = max(1, galaxy_arm_count($galaxyIdx));
    $armNumber = (($galaxyIdx - 1) % $armCount) + 1;
    $sClass = strtoupper(substr($spectralClass, 0, 1));

    $weighted = [];
    foreach ($profiles as $key => $profile) {
        if (!is_array($profile)) {
            continue;
        }
        $base = max(0.0, (float)($profile['weight'] ?? 1.0));
        $classAffinity = is_array($profile['class_affinity'] ?? null)
            ? (float)(($profile['class_affinity'][$sClass] ?? 1.0))
            : 1.0;
        $armBias = is_array($profile['arm_bias'] ?? null)
            ? (float)($profile['arm_bias'][$armNumber - 1] ?? 1.0)
            : 1.0;
        $weighted[] = ['value' => (string)$key, 'weight' => max(0.0001, $base * $classAffinity * $armBias)];
    }
    $pickedKey = weighted_pick($weighted, $galaxyIdx, $systemIdx, 44001);
    $picked = is_array($profiles[$pickedKey] ?? null) ? $profiles[$pickedKey] : reset($profiles);
    return ['key' => $pickedKey, 'profile' => $picked];
}

/**
 * Determine arm count for a specific game-galaxy.
 * Default mode is deterministic dynamic range 4..6 arms per galaxy.
 *
 * Optional config in galaxy_config()['galaxy']:
 * - arm_mode = 'fixed' with 'arms' = N
 * - arm_mode = 'dynamic_4_6' (default)
 * - arm_min / arm_max to tune dynamic range
 */
function galaxy_arm_count(int $galaxyIdx): int
{
    $galCfg = galaxy_config()['galaxy'] ?? [];
    $mode = strtolower((string)($galCfg['arm_mode'] ?? 'dynamic_4_6'));

    if ($mode === 'fixed') {
        return max(2, (int)($galCfg['arms'] ?? GAL_ARMS));
    }

    $armMin = max(2, (int)($galCfg['arm_min'] ?? 4));
    $armMax = max($armMin, (int)($galCfg['arm_max'] ?? 6));
    $span = $armMax - $armMin + 1;
    if ($span <= 1) {
        return $armMin;
    }

    $pick = (int)floor(gen_rand($galaxyIdx, $galaxyIdx, 7700) * $span);
    return max($armMin, min($armMax, $armMin + $pick));
}

function generate_name_root(array $profile, int $galaxyIdx, int $systemIdx): string
{
    $minSyl = max(1, (int)($profile['syllables']['min'] ?? 2));
    $maxSyl = max($minSyl, (int)($profile['syllables']['max'] ?? 3));
    $syllables = $minSyl + (int)floor(gen_rand($galaxyIdx, $systemIdx, 44002) * ($maxSyl - $minSyl + 1));

    $onsets = is_array($profile['onsets'] ?? null) ? $profile['onsets'] : [''];
    $nuclei = is_array($profile['nuclei'] ?? null) ? $profile['nuclei'] : ['a', 'e', 'i', 'o', 'u'];
    $codas = is_array($profile['codas'] ?? null) ? $profile['codas'] : [''];
    $suffixes = is_array($profile['suffixes'] ?? null) ? $profile['suffixes'] : [''];

    $parts = [];
    for ($i = 0; $i < $syllables; $i++) {
        $parts[] = weighted_pick($onsets, $galaxyIdx, $systemIdx, 44100 + $i)
            . weighted_pick($nuclei, $galaxyIdx, $systemIdx, 44200 + $i)
            . weighted_pick($codas, $galaxyIdx, $systemIdx, 44300 + $i);
    }
    $parts[] = weighted_pick($suffixes, $galaxyIdx, $systemIdx, 44499);

    $illegal = is_array(naming_config()['illegal_clusters'] ?? null)
        ? naming_config()['illegal_clusters']
        : [];
    return sanitize_fantasy_name(implode('', $parts), $illegal);
}

function limit_name_length(string $name): string
{
    $max = max(8, (int)(naming_config()['max_name_length'] ?? 16));
    if (strlen($name) <= $max) {
        return $name;
    }
    return substr($name, 0, $max);
}

function generate_star_name(int $galaxyIdx, int $systemIdx, ?string $spectralClass = null): string
{
    $profileSelection = pick_name_profile($galaxyIdx, $systemIdx, (string)($spectralClass ?? 'G'));
    $root = generate_name_root((array)$profileSelection['profile'], $galaxyIdx, $systemIdx);
    return limit_name_length($root);
}

function roman_numeral(int $value): string
{
    $map = [
        1000 => 'M', 900 => 'CM', 500 => 'D', 400 => 'CD',
        100 => 'C', 90 => 'XC', 50 => 'L', 40 => 'XL',
        10 => 'X', 9 => 'IX', 5 => 'V', 4 => 'IV', 1 => 'I',
    ];
    $n = max(1, $value);
    $result = '';
    foreach ($map as $num => $symbol) {
        while ($n >= $num) {
            $result .= $symbol;
            $n -= $num;
        }
    }
    return $result;
}

function generate_planet_name(string $starName, int $position): string
{
    $mode = (string)(naming_config()['planet_suffix_mode'] ?? 'roman');
    $suffix = strtoupper($mode) === 'LETTER'
        ? chr(ord('a') + max(0, min(25, $position - 1)))
        : roman_numeral($position);

    $max = max(8, (int)(naming_config()['max_name_length'] ?? 16));
    $suffixPart = ' ' . $suffix;
    $baseMax = max(3, $max - strlen($suffixPart));
    $base = strlen($starName) > $baseMax ? substr($starName, 0, $baseMax) : $starName;
    return $base . $suffixPart;
}

function planet_science_default_config(): array
{
    return [
        'class_templates' => [
            'lava' => ['composition_family' => 'silicate_metal', 'dominant_surface_material' => 'molten_basalt', 'core_fraction' => 0.36, 'volatile_fraction' => 0.0, 'pressure_min_bar' => 0.001, 'pressure_max_bar' => 15.0],
            'hot_jupiter' => ['composition_family' => 'hydrogen_helium', 'dominant_surface_material' => 'superheated_gas_envelope', 'core_fraction' => 0.08, 'volatile_fraction' => 0.92, 'pressure_min_bar' => 20.0, 'pressure_max_bar' => 400.0],
            'rocky' => ['composition_family' => 'silicate_metal', 'dominant_surface_material' => 'basaltic_regolith', 'core_fraction' => 0.32, 'volatile_fraction' => 0.03, 'pressure_min_bar' => 0.01, 'pressure_max_bar' => 8.0],
            'super_earth' => ['composition_family' => 'silicate_metal', 'dominant_surface_material' => 'compressed_silicate_crust', 'core_fraction' => 0.30, 'volatile_fraction' => 0.08, 'pressure_min_bar' => 0.2, 'pressure_max_bar' => 25.0],
            'ocean' => ['composition_family' => 'silicate_hydrosphere', 'dominant_surface_material' => 'global_ocean', 'core_fraction' => 0.24, 'volatile_fraction' => 0.35, 'pressure_min_bar' => 0.7, 'pressure_max_bar' => 12.0],
            'gas_giant' => ['composition_family' => 'hydrogen_helium', 'dominant_surface_material' => 'deep_gas_ocean', 'core_fraction' => 0.06, 'volatile_fraction' => 0.94, 'pressure_min_bar' => 10.0, 'pressure_max_bar' => 300.0],
            'ice_giant' => ['composition_family' => 'ice_volatile', 'dominant_surface_material' => 'water_ammonia_mantle', 'core_fraction' => 0.12, 'volatile_fraction' => 0.82, 'pressure_min_bar' => 5.0, 'pressure_max_bar' => 180.0],
            'ice_dwarf' => ['composition_family' => 'ice_silicate', 'dominant_surface_material' => 'water_ice_crust', 'core_fraction' => 0.18, 'volatile_fraction' => 0.55, 'pressure_min_bar' => 0.0001, 'pressure_max_bar' => 1.2],
            'comet_belt' => ['composition_family' => 'ice_dust', 'dominant_surface_material' => 'volatile_ice_dust', 'core_fraction' => 0.10, 'volatile_fraction' => 0.70, 'pressure_min_bar' => 0.0, 'pressure_max_bar' => 0.05],
        ],
        'habitability' => [
            'ideal_temp_k' => 288.0,
            'ideal_gravity_g' => 1.0,
            'ideal_pressure_bar' => 1.0,
            'liquid_water_bonus' => 18,
            'oxygen_bonus' => 12,
            'co2_penalty' => 8,
            'hydrogen_penalty' => 20,
            'sulfuric_penalty' => 35,
            'radiation_penalty' => [
                'low' => 0,
                'moderate' => 6,
                'elevated' => 14,
                'high' => 28,
                'extreme' => 45,
            ],
        ],
        'species_profiles' => [
            'terran' => [
                'label' => 'Terran',
                'temperature_c' => ['min' => -20, 'optimal_min' => 4, 'optimal_max' => 28, 'max' => 42],
                'gravity_g' => ['min' => 0.65, 'optimal_min' => 0.85, 'optimal_max' => 1.15, 'max' => 1.45],
                'pressure_bar' => ['min' => 0.35, 'optimal_min' => 0.8, 'optimal_max' => 1.4, 'max' => 3.5],
                'preferred_water_states' => ['liquid'],
                'preferred_compositions' => ['silicate_hydrosphere', 'silicate_metal'],
                'radiation_tolerance' => 'moderate',
            ],
            'cryoran' => [
                'label' => 'Cryoran',
                'temperature_c' => ['min' => -170, 'optimal_min' => -95, 'optimal_max' => -20, 'max' => 5],
                'gravity_g' => ['min' => 0.3, 'optimal_min' => 0.5, 'optimal_max' => 1.0, 'max' => 1.4],
                'pressure_bar' => ['min' => 0.05, 'optimal_min' => 0.3, 'optimal_max' => 2.0, 'max' => 8.0],
                'preferred_water_states' => ['solid', 'subsurface_liquid', 'liquid_methane'],
                'preferred_compositions' => ['ice_silicate', 'ice_volatile', 'ice_dust'],
                'radiation_tolerance' => 'elevated',
            ],
            'lithian' => [
                'label' => 'Lithian',
                'temperature_c' => ['min' => -40, 'optimal_min' => 20, 'optimal_max' => 120, 'max' => 220],
                'gravity_g' => ['min' => 0.9, 'optimal_min' => 1.1, 'optimal_max' => 1.9, 'max' => 2.5],
                'pressure_bar' => ['min' => 0.02, 'optimal_min' => 0.2, 'optimal_max' => 8.0, 'max' => 30.0],
                'preferred_water_states' => ['none', 'supercritical_water'],
                'preferred_compositions' => ['silicate_metal', 'compressed_silicate', 'molten_silicate'],
                'radiation_tolerance' => 'high',
            ],
            'aerthian' => [
                'label' => 'Aerthian',
                'temperature_c' => ['min' => -60, 'optimal_min' => -10, 'optimal_max' => 30, 'max' => 70],
                'gravity_g' => ['min' => 0.15, 'optimal_min' => 0.3, 'optimal_max' => 0.9, 'max' => 1.2],
                'pressure_bar' => ['min' => 1.0, 'optimal_min' => 2.0, 'optimal_max' => 12.0, 'max' => 60.0],
                'preferred_water_states' => ['vapor', 'liquid'],
                'preferred_compositions' => ['hydrogen_helium', 'ice_volatile', 'silicate_hydrosphere'],
                'radiation_tolerance' => 'moderate',
            ],
        ],
    ];
}

function planet_science_config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }

    $defaults = planet_science_default_config();
    $runtime = galaxy_config();
    $section = is_array($runtime['planet_science'] ?? null) ? $runtime['planet_science'] : [];
    $cfg = array_replace_recursive($defaults, $section);
    return $cfg;
}

function clamp_float(float $value, float $min, float $max): float
{
    return max($min, min($max, $value));
}

function pressure_from_mass_and_class(string $planetClass, float $massEarth, int $eqTempK, array $template): float
{
    $pressureMin = (float)($template['pressure_min_bar'] ?? 0.0);
    $pressureMax = (float)($template['pressure_max_bar'] ?? 1.0);
    $massFactor = clamp_float(log10(max(1.01, $massEarth + 1.0)), 0.0, 2.2) / 2.2;
    $tempFactor = clamp_float(($eqTempK - 90.0) / 600.0, 0.0, 1.0);

    $pressure = $pressureMin + ($pressureMax - $pressureMin) * (($massFactor * 0.65) + ($tempFactor * 0.35));
    if (in_array($planetClass, [PC_COMET_BELT, PC_ICE_DWARF], true)) {
        $pressure *= 0.35;
    }
    if ($planetClass === PC_OCEAN) {
        $pressure *= 1.15;
    }
    return round(clamp_float($pressure, $pressureMin, $pressureMax), 4);
}

function classify_volatile_state(string $species, int $tempK, float $pressureBar): string
{
    return match ($species) {
        'water' => match (true) {
            $pressureBar < 0.0061 => $tempK < 273 ? 'solid' : 'vapor',
            $tempK < 273 => 'solid',
            $tempK <= 647 => 'liquid',
            $pressureBar >= 221 => 'supercritical_water',
            default => 'vapor',
        },
        'methane' => match (true) {
            $tempK < 91 => 'solid',
            $tempK <= 112 && $pressureBar >= 0.2 => 'liquid_methane',
            $tempK <= 191 && $pressureBar >= 46 => 'supercritical_methane',
            default => 'gas',
        },
        'ammonia' => match (true) {
            $tempK < 195 => 'solid',
            $tempK <= 240 && $pressureBar >= 0.6 => 'liquid_ammonia',
            $tempK <= 406 && $pressureBar >= 113 => 'supercritical_ammonia',
            default => 'gas',
        },
        default => 'unknown',
    };
}

function dominant_surface_liquid(string $waterState, string $methaneState, string $ammoniaState): string
{
    if ($waterState === 'liquid' || $waterState === 'supercritical_water') {
        return $waterState;
    }
    if ($methaneState === 'liquid_methane' || $methaneState === 'supercritical_methane') {
        return $methaneState;
    }
    if ($ammoniaState === 'liquid_ammonia' || $ammoniaState === 'supercritical_ammonia') {
        return $ammoniaState;
    }
    return 'none';
}

function radiation_environment(array $star, float $semiMajorAxisAU, bool $inHz): string
{
    $class = (string)($star['spectral_class'] ?? 'G');
    if (in_array($class, ['O', 'B'], true)) {
        return 'extreme';
    }
    if ($class === 'A') {
        return $semiMajorAxisAU < 2.0 ? 'high' : 'elevated';
    }
    if ($class === 'M') {
        return $inHz ? 'elevated' : ($semiMajorAxisAU < 0.2 ? 'high' : 'moderate');
    }
    if ($semiMajorAxisAU < 0.15) {
        return 'high';
    }
    if ($semiMajorAxisAU < 0.35) {
        return 'elevated';
    }
    return 'low';
}

function range_score(float $value, array $range): float
{
    $min = (float)($range['min'] ?? $value);
    $optMin = (float)($range['optimal_min'] ?? $min);
    $optMax = (float)($range['optimal_max'] ?? $optMin);
    $max = (float)($range['max'] ?? $optMax);

    if ($value < $min || $value > $max) {
        return 0.0;
    }
    if ($value >= $optMin && $value <= $optMax) {
        return 1.0;
    }
    if ($value < $optMin) {
        return ($optMin - $min) <= 0.0 ? 0.0 : ($value - $min) / ($optMin - $min);
    }
    return ($max - $optMax) <= 0.0 ? 0.0 : ($max - $value) / ($max - $optMax);
}

function habitability_label(int $score): string
{
    return match (true) {
        $score >= 85 => 'garden_world',
        $score >= 65 => 'life_friendly',
        $score >= 40 => 'marginal',
        default => 'life_hostile',
    };
}

function evaluate_species_suitability(array $profiles, array $planetMetrics, string $radiationLevel): array
{
    $scienceCfg = planet_science_config();
    $radiationPenaltyMap = $scienceCfg['habitability']['radiation_penalty'] ?? [];
    $toleranceScale = ['moderate' => 1.0, 'elevated' => 0.75, 'high' => 0.45, 'extreme' => 0.15];
    $results = [];

    foreach ($profiles as $key => $profile) {
        if (!is_array($profile)) {
            continue;
        }
        $tempScore = range_score((float)$planetMetrics['surface_temp_c'], (array)($profile['temperature_c'] ?? []));
        $gravScore = range_score((float)$planetMetrics['surface_gravity_g'], (array)($profile['gravity_g'] ?? []));
        $pressureScore = range_score((float)$planetMetrics['surface_pressure_bar'], (array)($profile['pressure_bar'] ?? []));

        $preferredWater = is_array($profile['preferred_water_states'] ?? null) ? $profile['preferred_water_states'] : [];
        $waterBonus = in_array((string)$planetMetrics['dominant_surface_liquid'], $preferredWater, true)
            || in_array((string)$planetMetrics['water_state'], $preferredWater, true) ? 0.12 : -0.08;

        $preferredComp = is_array($profile['preferred_compositions'] ?? null) ? $profile['preferred_compositions'] : [];
        $compBonus = in_array((string)$planetMetrics['composition_family'], $preferredComp, true) ? 0.10 : 0.0;

        $tolerance = (string)($profile['radiation_tolerance'] ?? 'moderate');
        $radPenalty = (float)($radiationPenaltyMap[$radiationLevel] ?? 0);
        $radFactor = 1.0 - clamp_float(($radPenalty / 45.0) * (float)($toleranceScale[$tolerance] ?? 1.0), 0.0, 0.95);

        $score = (0.35 * $tempScore)
            + (0.2 * $gravScore)
            + (0.2 * $pressureScore)
            + $waterBonus
            + $compBonus
            + (0.15 * $radFactor);

        $normalized = (int)round(clamp_float($score, 0.0, 1.0) * 100.0);
        $results[$key] = [
            'label' => (string)($profile['label'] ?? ucfirst((string)$key)),
            'score' => $normalized,
            'verdict' => habitability_label($normalized),
        ];
    }

    return $results;
}

function derive_planet_environment(string $planetClass, array $star, float $massEarth, float $a_AU, int $surfaceTempK, float $gravG, bool $inHz, string $atmoType): array
{
    $scienceCfg = planet_science_config();
    $template = $scienceCfg['class_templates'][$planetClass] ?? $scienceCfg['class_templates']['rocky'];
    $pressureBar = pressure_from_mass_and_class($planetClass, $massEarth, $surfaceTempK, $template);
    $waterState = classify_volatile_state('water', $surfaceTempK, $pressureBar);
    $methaneState = classify_volatile_state('methane', $surfaceTempK, $pressureBar);
    $ammoniaState = classify_volatile_state('ammonia', $surfaceTempK, $pressureBar);
    $surfaceLiquid = dominant_surface_liquid($waterState, $methaneState, $ammoniaState);
    $radiationLevel = radiation_environment($star, $a_AU, $inHz);

    $habitabilityCfg = $scienceCfg['habitability'] ?? [];
    $idealTemp = (float)($habitabilityCfg['ideal_temp_k'] ?? 288.0);
    $idealGravity = (float)($habitabilityCfg['ideal_gravity_g'] ?? 1.0);
    $idealPressure = (float)($habitabilityCfg['ideal_pressure_bar'] ?? 1.0);
    $temperatureScore = 1.0 - clamp_float(abs($surfaceTempK - $idealTemp) / 160.0, 0.0, 1.0);
    $gravityScore = 1.0 - clamp_float(abs($gravG - $idealGravity) / 1.8, 0.0, 1.0);
    $pressureScore = 1.0 - clamp_float(abs(log10(max(0.01, $pressureBar)) - log10($idealPressure)) / 1.8, 0.0, 1.0);

    $score = (int)round((0.4 * $temperatureScore + 0.25 * $gravityScore + 0.2 * $pressureScore) * 100.0);
    if ($surfaceLiquid === 'liquid' || $surfaceLiquid === 'supercritical_water') {
        $score += (int)($habitabilityCfg['liquid_water_bonus'] ?? 18);
    }
    if ($atmoType === 'nitrogen_oxygen') {
        $score += (int)($habitabilityCfg['oxygen_bonus'] ?? 12);
    }
    if ($atmoType === 'thick_co2' || $atmoType === 'thin_co2') {
        $score -= (int)($habitabilityCfg['co2_penalty'] ?? 8);
    }
    if ($atmoType === 'hydrogen_helium' || $atmoType === 'methane') {
        $score -= (int)($habitabilityCfg['hydrogen_penalty'] ?? 20);
    }
    if ($atmoType === 'sulfuric') {
        $score -= (int)($habitabilityCfg['sulfuric_penalty'] ?? 35);
    }
    $score -= (int)($habitabilityCfg['radiation_penalty'][$radiationLevel] ?? 0);
    if (!$inHz && $planetClass === PC_ROCKY) {
        $score -= 8;
    }
    $score = (int)round(clamp_float((float)$score, 0.0, 100.0));

    $compositionFamily = (string)($template['composition_family'] ?? 'silicate_metal');
    if ($planetClass === PC_SUPER_EARTH && $gravG > 1.5) {
        $compositionFamily = 'compressed_silicate';
    }
    if ($planetClass === PC_LAVA) {
        $compositionFamily = 'molten_silicate';
    }

    $speciesSuitability = evaluate_species_suitability(
        (array)($scienceCfg['species_profiles'] ?? []),
        [
            'surface_temp_c' => $surfaceTempK - 273.15,
            'surface_gravity_g' => $gravG,
            'surface_pressure_bar' => $pressureBar,
            'dominant_surface_liquid' => $surfaceLiquid,
            'water_state' => $waterState,
            'composition_family' => $compositionFamily,
        ],
        $radiationLevel
    );

    return [
        'composition_family' => $compositionFamily,
        'dominant_surface_material' => (string)($template['dominant_surface_material'] ?? 'unknown_regolith'),
        'core_fraction' => round((float)($template['core_fraction'] ?? 0.3), 3),
        'volatile_fraction' => round((float)($template['volatile_fraction'] ?? 0.1), 3),
        'surface_pressure_bar' => $pressureBar,
        'water_state' => $waterState,
        'methane_state' => $methaneState,
        'ammonia_state' => $ammoniaState,
        'dominant_surface_liquid' => $surfaceLiquid,
        'radiation_level' => $radiationLevel,
        'habitability_score' => $score,
        'life_friendliness' => habitability_label($score),
        'species_suitability' => $speciesSuitability,
    ];
}

// ─── Deterministic PRNG ───────────────────────────────────────────────────────

/**
 * Deterministic pseudo-random float in [0, 1).
 *
 * Uses SHA-256 of the seed tuple for excellent avalanche behaviour.
 * No global state; calling with the same seeds always returns the same value.
 */
function gen_rand(int ...$seeds): float
{
    $raw  = hash('sha256', implode('|', $seeds), true);
    $bits = unpack('N', substr($raw, 0, 4))[1];
    return ($bits & 0x7FFFFFFF) / 2147483648.0;
}

/**
 * Deterministic float in [$min, $max).
 */
function gen_rand_range(float $min, float $max, int ...$seeds): float
{
    return $min + gen_rand(...$seeds) * ($max - $min);
}

/**
 * Deterministic approximately Normal deviate N(mean, sigma²) via Box-Muller.
 * Two independent gen_rand draws with distinct internal selectors.
 */
function gen_rand_normal(float $mean, float $sigma, int ...$seeds): float
{
    $u1 = max(1e-10, gen_rand(...array_merge($seeds, [97531])));
    $u2 =            gen_rand(...array_merge($seeds, [86420]));
    $z  = sqrt(-2.0 * log($u1)) * cos(2.0 * M_PI * $u2);
    return $mean + $sigma * $z;
}

// ─── Galactic coordinate assignment ──────────────────────────────────────────

/**
 * Compute a 3-D galactic position [x_ly, y_ly, z_ly] for a star system.
 *
 * Generates a realistic barred spiral galaxy with 4-6 arms, central bar,
 * bulge and interarm field stars.
 *
 * BUG-FIX: arm assignment is now derived from (galaxyIdx, systemIdx) so
 * that multiple arms are populated within a single game-galaxy rather than
 * every system landing on the same arm.
 *
 * Structural components (fraction of all systems):
 *   ~8%   bulge     — triaxial Gaussian near the core
 *   ~4%   bar       — elongated along galactic x-axis
 *   ~13%  field     — uniform thin-disk, interarm filler
 *   ~75%  arm stars — distributed across all N logarithmic spiral arms
 *
 * Logarithmic spiral:  r = r₀ · exp(b·θ),  b = tan(pitch_angle)
 * Inverse (for r→θ):   θ = ln(r/r₀) / b
 *
 * @return float[]  [x_ly, y_ly, z_ly]
 */
function galactic_position(int $galaxyIdx, int $systemIdx): array
{
    $cfg = galaxy_config();
    $galCfg = $cfg['galaxy'] ?? [];

    $arms        = galaxy_arm_count($galaxyIdx);
    $armStartLy  = (float)($galCfg['arm_start_ly'] ?? GAL_ARM_START_LY);
    $armEndLy    = (float)($galCfg['arm_end_ly'] ?? GAL_ARM_END_LY);
    $armWidthLy  = (float)($galCfg['arm_width_ly'] ?? GAL_ARM_WIDTH_LY);
    $pitchDeg    = (float)($galCfg['pitch_angle_deg'] ?? GAL_PITCH_ANGLE_DEG);
    $diskHeight  = (float)($galCfg['disk_height_ly'] ?? GAL_DISK_HEIGHT_LY);
    $bulgeRadius = (float)($galCfg['bulge_radius_ly'] ?? GAL_BULGE_RADIUS_LY);
    $bulgeFrac   = (float)($galCfg['bulge_fraction'] ?? GAL_BULGE_FRACTION);
    $sysMaxCfg   = (int)($galCfg['systems_per_galaxy'] ?? (defined('SYSTEM_MAX') ? SYSTEM_MAX : 499));
    $sysMax      = max(2, $sysMaxCfg);

    // ── 1. Bulge component (~8 % of systems) ──────────────────────────────────
    // Triaxial Gaussian near the galactic core; K/G-dominated warm stars.
    if (gen_rand($galaxyIdx, $systemIdx, 9901) < $bulgeFrac) {
        $sx = $bulgeRadius * 0.40;
        $sy = $bulgeRadius * 0.40;
        $sz = $diskHeight  * 0.60;
        return [
            round(gen_rand_normal(0, $sx, $galaxyIdx, $systemIdx * 3 + 1), 2),
            round(gen_rand_normal(0, $sy, $galaxyIdx, $systemIdx * 3 + 2), 2),
            round(gen_rand_normal(0, $sz, $galaxyIdx, $systemIdx * 3 + 3), 2),
        ];
    }

    // ── 2. Central bar component (~4 % of systems) ────────────────────────────
    // Elongated along galactic X-axis, connects the two inner arm roots.
    $barFrac   = 0.04;
    $barLength = $armStartLy * 1.7;
    if (gen_rand($galaxyIdx, $systemIdx, 9902) < $barFrac) {
        $xBar = gen_rand_range(-$barLength, $barLength, $galaxyIdx, $systemIdx, 1);
        $yBar = gen_rand_normal(0, $barLength * 0.11, $galaxyIdx, $systemIdx * 5 + 2, 2);
        $zBar = gen_rand_normal(0, $diskHeight * 0.40, $galaxyIdx, $systemIdx * 5 + 3, 3);
        return [round($xBar, 2), round($yBar, 2), round($zBar, 2)];
    }

    // ── 3. Interarm field stars (~13 % of disk stars) ─────────────────────────
    // Uniform thin-disk population not associated with any particular arm.
    $fieldFrac = 0.13;
    if (gen_rand($galaxyIdx, $systemIdx, 9903) < $fieldFrac) {
        $rField     = $armStartLy + gen_rand($galaxyIdx, $systemIdx * 7 + 1, 4501) * ($armEndLy - $armStartLy);
        $thetaField = gen_rand($galaxyIdx, $systemIdx * 7 + 2, 4502) * 2.0 * M_PI;
        $zField     = gen_rand_normal(0, $diskHeight * 1.3, $galaxyIdx, $systemIdx, 4503);
        return [
            round($rField * cos($thetaField), 2),
            round($rField * sin($thetaField), 2),
            round($zField, 2),
        ];
    }

    // ── 4. Spiral arm component (~75 % of systems) ────────────────────────────
    //
    // CRITICAL FIX: arm is chosen per-system using both galaxyIdx and
    // systemIdx, NOT from galaxyIdx alone.  The old code used
    //   ($galaxyIdx - 1) % $arms
    // which put every system in a given game-galaxy on the exact same arm.
    //
    $armRand  = gen_rand($galaxyIdx, $systemIdx, 7777);
    $armIndex = (int)floor($armRand * $arms) % $arms;

    // Per-galaxy global orientation offset — each game-galaxy rotates differently.
    $galRotOffset = gen_rand($galaxyIdx, $galaxyIdx, 8888) * 2.0 * M_PI;

    // Radial position: linear in systemIdx over the FULL arm span, plus jitter.
    // (Old code restricted stars to a narrow annulus per galaxyIdx.)
    $t = ($sysMax > 1) ? ($systemIdx - 1) / ($sysMax - 1) : 0.5;
    $tJitter = gen_rand($galaxyIdx, $systemIdx, 3131) * 0.18 - 0.09;
    $t  = max(0.0, min(1.0, $t + $tJitter));
    $r  = $armStartLy + $t * ($armEndLy - $armStartLy);

    // Winding angle from logarithmic spiral: θ = ln(r/r₀) / tan(pitch)
    $b     = tan(deg2rad($pitchDeg));
    $theta = log($r / max(1.0, $armStartLy)) / max(1e-6, $b);

    // Add arm base angle (arms equally spaced) plus per-galaxy rotation offset.
    $theta += $armIndex * (2.0 * M_PI / $arms) + $galRotOffset;

    // Gaussian scatter around the arm centreline (perpendicular and angular).
    $scatterR = gen_rand_normal(0, $armWidthLy * 0.5, $galaxyIdx * 100 + $armIndex, $systemIdx, 4001);
    $scatterT = gen_rand_normal(0, 0.055,             $galaxyIdx * 100 + $armIndex, $systemIdx, 4002);

    $rFinal     = max($armStartLy, min($armEndLy, $r + $scatterR));
    $thetaFinal = $theta + $scatterT;

    return [
        round($rFinal * cos($thetaFinal), 2),
        round($rFinal * sin($thetaFinal), 2),
        round(gen_rand_normal(0, $diskHeight, $galaxyIdx, $systemIdx, 4003), 2),
    ];
}

// ─── Stellar classification ───────────────────────────────────────────────────

/**
 * Interpolate main-sequence stellar physical parameters for a given
 * spectral class and numeric subtype (0-9).
 *
 * @return float[]  [mass_solar, radius_solar, temp_K, luminosity_solar]
 */
function interpolate_stellar_params(string $class, int $subtype, ?array $paramsTable = null): array
{
    if ($paramsTable === null) {
        $cfg = galaxy_config();
        $paramsTable = $cfg['stellar_types']['main_sequence_params'] ?? STELLAR_PARAMS;
    }

    $table = $paramsTable[$class] ?? null;
    if ($table === null) {
        return [1.0, 1.0, 5778, 1.0];
    }

    $keys = array_keys($table);
    sort($keys);

    // Lower anchor
    $lo = $keys[0];
    foreach ($keys as $k) {
        if ($k <= $subtype) {
            $lo = $k;
        }
    }
    // Upper anchor
    $hi = $lo;
    foreach ($keys as $k) {
        if ($k >= $subtype) {
            $hi = $k;
            break;
        }
    }

    if ($lo === $hi) {
        return $table[$lo];
    }

    $frac = ($subtype - $lo) / ($hi - $lo);
    $lp   = $table[$lo];
    $hp   = $table[$hi];
    return [
        $lp[0] + $frac * ($hp[0] - $lp[0]),
        $lp[1] + $frac * ($hp[1] - $lp[1]),
        $lp[2] + $frac * ($hp[2] - $lp[2]),
        $lp[3] + $frac * ($hp[3] - $lp[3]),
    ];
}

// ─── White Dwarf Generation (Fontaine et al. 2001 cooling; ~6% of stars) ────

/**
 * Generate a white dwarf with age-dependent cooling.
 *
 * White dwarfs cool from ~150,000 K (progenitor max) down to ~8,000 K over ~14 Gy.
 * Typical WD mass is 0.6 M☉ and radius is ~0.01 R☉ (Earth-sized).
 *
 * @return array{spectral_class:string, subtype:int, luminosity_class:string,
 *               mass_solar:float, radius_solar:float, temperature_k:int,
 *               luminosity_solar:float, age_gyr:float, stellar_type:string}
 */
function pick_white_dwarf(int $galaxyIdx, int $systemIdx): array
{
    // Age of WD: 8–14 Gyr (old remnants from earlier stellar generations)
    $ageRoll = gen_rand($galaxyIdx, $systemIdx, 2001);
    $age_gyr = 8.0 + $ageRoll * 6.0;  // 8.0 to 14.0

    // Cooling model (simplified Fontaine et al.): T_cool(t) ≈ 150,000 - (119,000 * t/14)
    // At t=0 (just formed): ~150 kK; at t=14 Gy: ~8 kK
    $temp_k = max(8000, (int)(150000 - ($age_gyr / 14.0) * 142000));

    // Radius: constant ~0.01 R☉ (degenerate matter)
    $radius_solar = 0.0095;

    // Mass: typically 0.55–0.65 M☉ (Chandrasekhar limit is 1.4 but rare)
    $massRoll = gen_rand($galaxyIdx, $systemIdx, 2002);
    $mass_solar = 0.55 + $massRoll * 0.10;  // 0.55 to 0.65

    // Luminosity from Stefan-Boltzmann: L = 4π R² σ T⁴
    // L_solar = (R_solar)² · (T_k / 5778)⁴
    $luminosity_solar = pow($radius_solar, 2) * pow($temp_k / 5778.0, 4);

    return [
        'spectral_class'   => 'WD',
        'subtype'          => 0,  // Not applicable for WD
        'luminosity_class' => 'VIII',  // White dwarf luminosity class
        'mass_solar'       => round($mass_solar, 4),
        'radius_solar'     => round($radius_solar, 5),
        'temperature_k'    => $temp_k,
        'luminosity_solar' => round($luminosity_solar, 6),
        'age_gyr'          => round($age_gyr, 2),
        'stellar_type'     => 'white_dwarf',
    ];
}

/**
 * Pick a spectral type and physical parameters from the Kroupa IMF CDF.
 *
 * @return array{spectral_class:string, subtype:int, luminosity_class:string,
 *               mass_solar:float, radius_solar:float, temperature_k:int,
 *               luminosity_solar:float}
 */
function pick_spectral_type(int $galaxyIdx, int $systemIdx): array
{
    // ~6% probability: white dwarf instead of main sequence
    $wdRoll = gen_rand($galaxyIdx, $systemIdx, 1000);
    if ($wdRoll < 0.06) {
        return pick_white_dwarf($galaxyIdx, $systemIdx);
    }

    $cfg = galaxy_config();
    $cdfTable = $cfg['stellar_types']['cdf'] ?? [];
    $paramsTable = $cfg['stellar_types']['main_sequence_params'] ?? STELLAR_PARAMS;

    if (!is_array($cdfTable) || count($cdfTable) === 0) {
        $cdfTable = [];
        foreach (SPECTRAL_TYPE_CDF as $entry) {
            [$cumProb, $class, $stLo, $stHi] = $entry;
            $cdfTable[] = [
                'cum_prob' => $cumProb,
                'class' => $class,
                'subtype_min' => $stLo,
                'subtype_max' => $stHi,
            ];
        }
    }

    $roll = gen_rand($galaxyIdx, $systemIdx, 1001);

    foreach ($cdfTable as $entry) {
        $cumProb = (float)($entry['cum_prob'] ?? 1.0);
        $class   = (string)($entry['class'] ?? 'G');
        $stLo    = (int)($entry['subtype_min'] ?? 0);
        $stHi    = (int)($entry['subtype_max'] ?? 9);
        if ($roll > $cumProb) {
            continue;
        }
        $subtype = (int)round(
            $stLo + gen_rand($galaxyIdx, $systemIdx, 1002) * ($stHi - $stLo)
        );
        $params  = interpolate_stellar_params($class, $subtype, $paramsTable);
        
        // Age of main-sequence star: 0.5–12 Gyr
        $ageRoll = gen_rand($galaxyIdx, $systemIdx, 2003);
        $age_gyr = 0.5 + $ageRoll * 11.5;
        
        return [
            'spectral_class'   => $class,
            'subtype'          => $subtype,
            'luminosity_class' => 'V',
            'mass_solar'       => round($params[0], 4),
            'radius_solar'     => round($params[1], 4),
            'temperature_k'    => (int)round($params[2]),
            'luminosity_solar' => round($params[3], 6),
            'age_gyr'          => round($age_gyr, 2),
            'metallicity_z'    => 0.02,  // Solar metallicity default
            'stellar_type'     => 'main_sequence',
        ];
    }

    // Fallback: G2V (solar twin)
    $ageRoll = gen_rand($galaxyIdx, $systemIdx, 2003);
    $age_gyr = 0.5 + $ageRoll * 11.5;
    return [
        'spectral_class' => 'G', 'subtype' => 2, 'luminosity_class' => 'V',
        'mass_solar' => 1.0, 'radius_solar' => 1.0,
        'temperature_k' => 5778, 'luminosity_solar' => 1.0,
        'age_gyr' => round($age_gyr, 2),
        'metallicity_z' => 0.02,
        'stellar_type' => 'main_sequence',
    ];
}

/**
 * Pick a secondary companion star for binary systems.
 * Companion mass is constrained to <= primary mass for stable hierarchy.
 *
 * @return array{spectral_class:string, subtype:int, luminosity_class:string,
 *               mass_solar:float, radius_solar:float, temperature_k:int,
 *               luminosity_solar:float, age_gyr:float, metallicity_z:float,
 *               stellar_type:string}
 */
function pick_binary_companion(array $primary, int $galaxyIdx, int $systemIdx): array
{
    $candidate = pick_spectral_type($galaxyIdx + 97, $systemIdx + 7919);
    $primaryMass = max(0.08, (float)($primary['mass_solar'] ?? 1.0));
    $candMass = max(0.08, (float)($candidate['mass_solar'] ?? 1.0));

    if ($candMass <= $primaryMass) {
        return $candidate;
    }

    // If the sampled companion is heavier than the primary, clamp using a
    // deterministic mass ratio and recompute radius/luminosity by scaling laws.
    $ratio = 0.35 + gen_rand($galaxyIdx, $systemIdx, 2081) * 0.60; // 0.35..0.95
    $mass = max(0.08, min($primaryMass * $ratio, $primaryMass));
    $temp = (int)max(2200, min(42000, round((float)($candidate['temperature_k'] ?? 5778) * pow($mass / $candMass, 0.48))));
    $radius = max(0.08, round((float)($candidate['radius_solar'] ?? 1.0) * pow($mass / $candMass, 0.8), 5));
    $lum = round(pow($radius, 2) * pow($temp / 5778.0, 4), 6);

    $candidate['mass_solar'] = round($mass, 4);
    $candidate['radius_solar'] = round($radius, 5);
    $candidate['temperature_k'] = $temp;
    $candidate['luminosity_solar'] = $lum;
    return $candidate;
}

/**
 * Holman-Wiegert style critical radius estimate for circumbinary stability.
 *
 * The base expression from the roadmap is transformed to a conservative
 * circumbinary inner limit by using its inverse and clamping to realistic
 * multi-star ranges.
 */
function circumbinary_critical_radius_au(float $binarySeparationAU, float $binaryEccentricity, float $mu): float
{
    $e = max(0.0, min(0.85, $binaryEccentricity));
    $m = max(0.01, min(0.99, $mu));

    $factor = 0.464
        - 0.380 * $e
        - 0.631 * $m
        + 0.586 * $m * $e
        + 0.150 * ($e ** 2)
        - 0.198 * $m * ($e ** 2);

    $factor = max(0.12, $factor);
    $critical = $binarySeparationAU / $factor;
    return max($binarySeparationAU * 1.8, min($binarySeparationAU * 9.5, $critical));
}

// ─── Habitable zone & frost line ──────────────────────────────────────────────

/**
 * Conservative habitable zone boundaries in AU (Kopparapu et al. 2013).
 *
 *  Inner edge (runaway greenhouse): S_eff ≈ 1.107  →  d_in  = √(L / 1.107)
 *  Outer edge (maximum greenhouse): S_eff ≈ 0.356  →  d_out = √(L / 0.356)
 *
 * @return float[]  [hz_inner_au, hz_outer_au]
 */
function habitable_zone_au(float $luminositySolar): array
{
    return [
        sqrt($luminositySolar / 1.107),
        sqrt($luminositySolar / 0.356),
    ];
}

/**
 * Water-ice frost line in AU.
 *
 * Derived from the 170 K condensation isotherm using flux-balance:
 *   T_eq = 278.5 · L^0.25 / √a  →  a_frost = (278.5/170)² · √L ≈ 2.68·√L
 */
function frost_line_au(float $luminositySolar): float
{
    return 2.68 * sqrt($luminositySolar);
}

// ─── Kepler's Third Law ───────────────────────────────────────────────────────

/**
 * Orbital period in Earth days.
 *
 * Kepler III:  T = 2π · √(a³ / G·M)
 * In convenient units:  T [days] = 365.25 · √(a³ [AU³] / M [M☉])
 */
function kepler_period_days(float $semiMajorAxisAU, float $starMassSolar): float
{
    return 365.25 * sqrt(pow($semiMajorAxisAU, 3) / $starMassSolar);
}

// ─── Equilibrium temperature ──────────────────────────────────────────────────

/**
 * Equilibrium surface temperature in Kelvin (Stefan-Boltzmann flux balance).
 *
 *   T_eq = T_star · √(R_star / 2a) · (1 – A)^0.25
 *         ≈ 278.5 · L^0.25 / √a · (1 – A)^0.25
 *
 * @param float $albedo Bond albedo (0.306 Earth-like, 0.65 icy, 0.10 bare rock)
 */
function equilibrium_temp_k(float $luminositySolar, float $semiMajorAxisAU,
                            float $albedo = 0.306): float
{
    return 278.5
           * pow($luminositySolar, 0.25)
           / sqrt($semiMajorAxisAU)
           * pow(1.0 - $albedo, 0.25);
}

// ─── Planet classification ────────────────────────────────────────────────────

/**
 * Classify a planet based on orbital position, mass, and temperature.
 */
function classify_planet(float $a_AU, float $eqTempK, float $massEarth,
                         float $hzInner, float $hzOuter, float $frostLine,
                         bool  $isOutermostSlot): string
{
    if ($isOutermostSlot) {
        return PC_COMET_BELT;
    }
    if ($eqTempK > 1800.0) {
        return PC_LAVA;
    }
    if ($a_AU >= $frostLine) {
        if ($massEarth >= 30.0) {
            return ($eqTempK < 200.0) ? PC_ICE_GIANT : PC_GAS_GIANT;
        }
        return PC_ICE_DWARF;
    }
    // Inside frost line
    if ($massEarth >= 30.0) {
        return PC_HOT_JUPITER;
    }
    if ($a_AU >= $hzInner && $a_AU <= $hzOuter) {
        if ($massEarth >= 5.0) {
            return PC_SUPER_EARTH;
        }
        // Distinguish ocean worlds: lower irradiation fraction + higher mass
        if ($massEarth >= 0.5 && $eqTempK < 320.0) {
            return PC_OCEAN;
        }
        return PC_ROCKY;
    }
    if ($massEarth >= 5.0) {
        return PC_SUPER_EARTH;
    }
    return PC_ROCKY;
}

/**
 * Determine atmosphere type from planet class and equilibrium temperature.
 */
function atmosphere_type(string $planetClass, float $eqTempK): string
{
    return match ($planetClass) {
        PC_LAVA                    => 'sulfuric',
        PC_GAS_GIANT, PC_HOT_JUPITER,
        PC_ICE_GIANT               => 'hydrogen_helium',
        PC_ICE_DWARF               => 'thin_co2',
        PC_COMET_BELT              => 'none',
        PC_OCEAN                   => 'nitrogen_oxygen',
        PC_ROCKY                   => $eqTempK > 350.0 ? 'thick_co2' : 'nitrogen_oxygen',
        PC_SUPER_EARTH             => $eqTempK > 370.0 ? 'thick_co2' : 'nitrogen_oxygen',
        default                    => 'thin_co2',
    };
}

// ─── Planet diameter & surface gravity ───────────────────────────────────────

/**
 * Estimated planet diameter in km.
 *
 * Rocky / terrestrial:  R ∝ M^0.28  (Zeng et al. 2016 – pure rock)
 * Giant planets:        R ∝ M^0.45  (Fortney et al. 2007 – H/He envelope)
 *
 * @return int  Diameter in km, clamped to [800, 200 000]
 */
function planet_diameter_km(float $massEarth): int
{
    $earthDiam = 12742.0;
    $diam = $massEarth >= 30.0
        ? $earthDiam * pow($massEarth, 0.45)
        : $earthDiam * pow($massEarth, 0.28);
    return (int)max(800, min(200000, round($diam)));
}

/**
 * Surface gravity relative to Earth (g).
 *
 *  g/g_earth = M / R²   (in Earth units)
 */
function surface_gravity(float $massEarth, int $diamKm): float
{
    $radiusEarth = $diamKm / 12742.0;
    if ($radiusEarth <= 0.0) {
        return 1.0;
    }
    return round($massEarth / ($radiusEarth ** 2), 3);
}

// ─── Planetary system generator ───────────────────────────────────────────────

/**
 * Generate up to POSITION_MAX planetary-slot descriptors for a star system.
 *
 * Orbital spacing follows a log-normal inter-planet period ratio calibrated
 * to the Kepler survey (Fabrycky et al. 2014: median ratio ≈ 1.7, σ ≈ 0.3 dex).
 * The outermost slot is always a comet/debris belt analogous to the Kuiper belt.
 *
 * @param array $star     Output of pick_spectral_type()
 * @param int   $galaxyIdx
 * @param int   $systemIdx
 * @return array  Array of planet descriptors indexed by 'position' (1-N)
 */
function generate_planets(array $star, int $galaxyIdx, int $systemIdx, ?string $starName = null, ?array $binary = null): array
{
    $cfg = galaxy_config();
    $posMax  = defined('POSITION_MAX') ? POSITION_MAX : 15;
    $lum     = $star['luminosity_solar'];
    $mass    = $star['mass_solar'];

    [$hzIn, $hzOut] = habitable_zone_au($lum);
    $frostLine      = frost_line_au($lum);

    // Mean planet count per spectral class (from Kepler occurrence rates)
    $meanByClass = $cfg['stellar_types']['mean_planets_by_class'] ?? [];
    $meanPlanets = (float)($meanByClass[$star['spectral_class']] ?? $meanByClass['default'] ?? 5.0);

    $nPlanets = (int)max(1, min($posMax - 1,
        round($meanPlanets
              + gen_rand_normal(0, 1.5, $galaxyIdx, $systemIdx, 201))));

    // Last slot is always a comet belt
    $nSlots = min($posMax, $nPlanets + 1);

    // Innermost orbital distance (AU), scaled with √L
    $a0 = max(0.04,
              gen_rand_normal(0.12, 0.05, $galaxyIdx, $systemIdx, 202)) * sqrt($lum);

    // Circumbinary systems require planets outside the critical stability radius.
    $criticalOrbitAU = null;
    if (is_array($binary) && !empty($binary['is_binary']) && !empty($binary['is_circumbinary'])) {
        $aBin = max(0.05, (float)($binary['companion_separation_au'] ?? 0.8));
        $eBin = max(0.0, min(0.85, (float)($binary['companion_eccentricity'] ?? 0.2)));
        $m1 = max(0.08, (float)($star['mass_solar'] ?? 1.0));
        $m2 = max(0.08, (float)($binary['companion_mass_solar'] ?? 0.4));
        $mu = $m2 / max(0.16, ($m1 + $m2));
        $criticalOrbitAU = circumbinary_critical_radius_au($aBin, $eBin, $mu);
        $a0 = max($a0, $criticalOrbitAU * 1.05);
    }

    $planets    = [];
    $aCurrent   = $a0;
    $spacingMu  = log(1.8);   // Mean ln-period-ratio ≈ ln(1.8)
    $spacingSig = 0.25;       // σ in log-space

    for ($slot = 1; $slot <= $nSlots; $slot++) {
        // Stochastic spacing (log-normal, Fabrycky et al. 2014)
        $lnRatio  = gen_rand_normal($spacingMu, $spacingSig,
                                    $galaxyIdx * 7  + $slot, $systemIdx, 3);
        $a_AU     = $aCurrent;
        $aCurrent = $a_AU * exp($lnRatio);

        // Orbital eccentricity: log-normal, truncated [0, 0.95]
        // Median e ≈ 0.05 for compact systems (Wright et al. 2009)
        $ecc = max(0.0, min(0.95,
                   abs(gen_rand_normal(0.0, 0.12,
                                       $galaxyIdx * 13 + $slot, $systemIdx, 5))));

        // Planet mass (M_earth): log-normal
        // For outer slots (beyond frost line) bias strongly toward giants
        $logMassCenter = $a_AU >= $frostLine
            ? gen_rand_normal(2.0, 0.9,  $galaxyIdx * 17 + $slot, $systemIdx, 6)
            : gen_rand_normal(0.3, 1.1,  $galaxyIdx * 17 + $slot, $systemIdx, 6);
        $massEarth     = max(0.01, round(pow(10.0, $logMassCenter), 3));

        // Bond albedo
        $albedo = match (true) {
            $massEarth >= 30.0  => 0.50,
            $a_AU >= $frostLine => 0.65,
            default             => 0.306,
        };

        $eqTemp = (int)round(equilibrium_temp_k($lum, $a_AU, $albedo));

        // Orbital period via Kepler III
        $period = round(kepler_period_days($a_AU, $mass), 2);

        $diamKm   = planet_diameter_km($massEarth);
        $gravG    = surface_gravity($massEarth, $diamKm);
        $inHz     = ($a_AU >= $hzIn && $a_AU <= $hzOut);

        $isLast      = ($slot === $nSlots);
        $planetClass = classify_planet($a_AU, $eqTemp, $massEarth,
                                       $hzIn, $hzOut, $frostLine, $isLast);
        $atmoType    = atmosphere_type($planetClass, $eqTemp);

        // Greenhouse correction for rocky-ish planets with atmosphere
        $greenhouseK = match ($atmoType) {
            'thick_co2'       => 50,
            'sulfuric'        => 450,
            'nitrogen_oxygen' => 33,   // Earth-like greenhouse effect
            default           => 0,
        };
        $surfTempK = $eqTemp + $greenhouseK;
        $surfTempC = $surfTempK - 273;

        // Temperature range (day/night swing, latitude spread)
        $tempRange = $massEarth >= 30.0 ? 30 : ($inHz ? 60 : 80);

        $environment = derive_planet_environment($planetClass, $star, $massEarth, $a_AU, $surfTempK, $gravG, $inHz, $atmoType);

        $planetStarName = $starName ?: sprintf('GQ-%d-%03d', $galaxyIdx, $systemIdx);

        $planets[] = [
            'position'             => $slot,
            'name'                 => generate_planet_name($planetStarName, $slot),
            'planet_class'         => $planetClass,
            'semi_major_axis_au'   => round($a_AU, 5),
            'orbital_period_days'  => $period,
            'orbital_eccentricity' => round($ecc, 5),
            'mass_earth'           => $massEarth,
            'diameter_km'          => $diamKm,
            'surface_gravity_g'    => $gravG,
            'eq_temp_k'            => $surfTempK,
            'temp_min'             => (int)round($surfTempC - $tempRange / 2),
            'temp_max'             => (int)round($surfTempC + $tempRange / 2),
            'in_habitable_zone'    => (int)$inHz,
            'has_atmosphere'       => (int)($atmoType !== 'none'),
            'atmosphere_type'      => $atmoType,
            'stability_critical_au'=> $criticalOrbitAU !== null ? round($criticalOrbitAU, 5) : null,
        ] + $environment + derive_planet_deposits($planetClass, $inHz, $massEarth);
    }

    return $planets;
}

/**
 * Derive resource richness multipliers and deposit amounts from planet class.
 * richness 0.1–2.0 (1.0 = standard), deposit -1 = unlimited (gas giant deuterium).
 */
function derive_planet_deposits(string $planetClass, bool $inHz, float $massEarth): array {
    $cfg = galaxy_config();
    $resCfg = $cfg['resources'] ?? [];

    $classRich = $resCfg['class_richness'][$planetClass] ?? [
        'metal' => 1.0, 'crystal' => 1.0, 'deuterium' => 1.0, 'rare_earth' => 0.5,
    ];

    $richMetal   = (float)($classRich['metal'] ?? 1.0);
    $richCrystal = (float)($classRich['crystal'] ?? 1.0);
    $richDeut    = (float)($classRich['deuterium'] ?? 1.0);
    $richRare    = (float)($classRich['rare_earth'] ?? 0.5);

    // HZ bonus: terrestrial/ocean planets in HZ are richer overall
    $hzBonus = $resCfg['hz_bonus'] ?? [];
    $hzClasses = $hzBonus['classes'] ?? ['rocky', 'ocean', 'super_earth'];
    if ($inHz && is_array($hzClasses) && in_array($planetClass, $hzClasses, true)) {
        $richMetal   *= (float)($hzBonus['metal'] ?? 1.2);
        $richCrystal *= (float)($hzBonus['crystal'] ?? 1.1);
        $richDeut    *= (float)($hzBonus['deuterium'] ?? 1.3);
    }

    // Deposits: base amounts scaled by richness and planet mass
    $baseDeposits = $resCfg['base_deposits'] ?? [
        'metal' => 5000000,
        'crystal' => 2000000,
        'deuterium' => 1000000,
        'rare_earth' => 200000,
    ];
    $massCfg = $resCfg['mass_factor'] ?? [];
    $massMin = (float)($massCfg['min'] ?? 0.5);
    $massMax = (float)($massCfg['max'] ?? 3.0);
    $rareMax = (float)($massCfg['rare_earth_max'] ?? 2.0);
    $massFactor = max($massMin, min($massMax, $massEarth));

    $lowMetalClasses = $resCfg['low_metal_deposit_classes'] ?? ['gas_giant', 'ice_giant', 'hot_jupiter'];
    $unlimitedDeutClasses = $resCfg['unlimited_deuterium_classes'] ?? ['gas_giant'];

    $baseMetal = in_array($planetClass, $lowMetalClasses, true)
        ? (int)round(((int)($baseDeposits['metal'] ?? 5000000)) * 0.1)
        : (int)($baseDeposits['metal'] ?? 5000000);

    $depositMetal    = (int)round($baseMetal * $richMetal * $massFactor);
    $depositCrystal  = (int)round(((int)($baseDeposits['crystal'] ?? 2000000)) * $richCrystal * $massFactor);
    $depositDeut     = in_array($planetClass, $unlimitedDeutClasses, true)
        ? -1   // unlimited deuterium on gas giants
        : (int)round(((int)($baseDeposits['deuterium'] ?? 1000000)) * $richDeut * $massFactor);
    $depositRare     = (int)round(((int)($baseDeposits['rare_earth'] ?? 200000)) * $richRare * min($massFactor, $rareMax));

    return [
        'richness_metal'      => round($richMetal,   2),
        'richness_crystal'    => round($richCrystal, 2),
        'richness_deuterium'  => round($richDeut,    2),
        'richness_rare_earth' => round($richRare,    2),
        'deposit_metal'       => $depositMetal,
        'deposit_crystal'     => $depositCrystal,
        'deposit_deuterium'   => $depositDeut,
        'deposit_rare_earth'  => $depositRare,
    ];
}

// ─── Top-level generator ──────────────────────────────────────────────────────

/**
 * Generate a complete, self-consistent star system descriptor.
 *
 * Fully deterministic from (galaxyIdx, systemIdx).
 * No database access, no side effects.
 *
 * @return array{
 *   galaxy_index: int, system_index: int,
 *   name: string,
 *   x_ly: float, y_ly: float, z_ly: float,
 *   spectral_class: string, subtype: int, luminosity_class: string,
 *   mass_solar: float, radius_solar: float,
 *   temperature_k: int, luminosity_solar: float,
 *   hz_inner_au: float, hz_outer_au: float, frost_line_au: float,
 *   planets: array
 * }
 */
function generate_star_system(int $galaxyIdx, int $systemIdx): array
{
    [$x, $y, $z] = galactic_position($galaxyIdx, $systemIdx);
    $star        = pick_spectral_type($galaxyIdx, $systemIdx);

    $binaryRoll = gen_rand($galaxyIdx, $systemIdx, 2080);
    $isBinary = ($binaryRoll < 0.50);
    $companion = null;
    $companionSeparationAU = null;
    $companionEccentricity = null;
    $isCircumbinary = 0;
    $criticalOrbitAU = null;
    if ($isBinary) {
        $companion = pick_binary_companion($star, $galaxyIdx, $systemIdx);
        $companionSeparationAU = round(gen_rand_range(0.18, 2.6, $galaxyIdx, $systemIdx, 2082), 5);
        $companionEccentricity = round(gen_rand_range(0.00, 0.58, $galaxyIdx, $systemIdx, 2083), 5);
        $isCircumbinary = gen_rand($galaxyIdx, $systemIdx, 2084) < 0.65 ? 1 : 0;

        if ($isCircumbinary) {
            $mu = (float)$companion['mass_solar'] / max(0.16, ((float)$star['mass_solar'] + (float)$companion['mass_solar']));
            $criticalOrbitAU = round(circumbinary_critical_radius_au(
                (float)$companionSeparationAU,
                (float)$companionEccentricity,
                $mu
            ), 5);
        }
    }

    $catalogName = sprintf('GQ-%d-%03d', $galaxyIdx, $systemIdx);
    $displayName = generate_star_name($galaxyIdx, $systemIdx, (string)$star['spectral_class']);

    [$hzIn, $hzOut] = habitable_zone_au($star['luminosity_solar']);
    $frostLine      = frost_line_au($star['luminosity_solar']);

    $planets = generate_planets($star, $galaxyIdx, $systemIdx, $displayName, [
        'is_binary' => $isBinary ? 1 : 0,
        'is_circumbinary' => $isCircumbinary,
        'companion_mass_solar' => $companion['mass_solar'] ?? null,
        'companion_separation_au' => $companionSeparationAU,
        'companion_eccentricity' => $companionEccentricity,
    ]);

    return array_merge($star, [
        'galaxy_index'  => $galaxyIdx,
        'system_index'  => $systemIdx,
        'name'          => $displayName,
        'catalog_name'  => $catalogName,
        'x_ly'          => $x,
        'y_ly'          => $y,
        'z_ly'          => $z,
        'hz_inner_au'   => round($hzIn,      5),
        'hz_outer_au'   => round($hzOut,     5),
        'frost_line_au' => round($frostLine, 5),
        'is_binary'     => $isBinary ? 1 : 0,
        'is_circumbinary' => $isCircumbinary,
        'companion_spectral_class' => $companion['spectral_class'] ?? null,
        'companion_subtype' => $companion['subtype'] ?? null,
        'companion_luminosity_class' => $companion['luminosity_class'] ?? null,
        'companion_stellar_type' => $companion['stellar_type'] ?? null,
        'companion_mass_solar' => $companion['mass_solar'] ?? null,
        'companion_radius_solar' => $companion['radius_solar'] ?? null,
        'companion_temperature_k' => $companion['temperature_k'] ?? null,
        'companion_luminosity_solar' => $companion['luminosity_solar'] ?? null,
        'companion_separation_au' => $companionSeparationAU,
        'companion_eccentricity' => $companionEccentricity,
        'stability_critical_au' => $criticalOrbitAU,
        'planets'       => $planets,
    ]);
}
