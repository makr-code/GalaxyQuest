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
 * The nine game-galaxy indices are mapped to radial bands of a four-armed
 * logarithmic spiral (pitch angle 14°), mirroring the Milky Way structure.
 * A small bulge fraction receives a Gaussian distribution near the centre.
 *
 * Logarithmic spiral equation:  r = r₀ · exp(b·θ),  b = tan(pitch_angle)
 *
 * @return float[]  [x_ly, y_ly, z_ly]
 */
function galactic_position(int $galaxyIdx, int $systemIdx): array
{
    // Bulge stars (8 % of systems) drawn from a triaxial Gaussian
    if (gen_rand($galaxyIdx, $systemIdx, 9901) < GAL_BULGE_FRACTION) {
        $sx = GAL_BULGE_RADIUS_LY * 0.40;
        $sy = GAL_BULGE_RADIUS_LY * 0.40;
        $sz = GAL_DISK_HEIGHT_LY  * 0.60;
        return [
            round(gen_rand_normal(0, $sx, $galaxyIdx, $systemIdx * 3 + 1), 2),
            round(gen_rand_normal(0, $sy, $galaxyIdx, $systemIdx * 3 + 2), 2),
            round(gen_rand_normal(0, $sz, $galaxyIdx, $systemIdx * 3 + 3), 2),
        ];
    }

    // Assign to one of 4 spiral arms based on game galaxy index
    $armIndex = ($galaxyIdx - 1) % GAL_ARMS;

    // Radial zone: galaxies 1-4 → inner half; 5-8 → outer half; 9 → outermost
    $radialZone = (int)(($galaxyIdx - 1) / GAL_ARMS);  // 0, 1, 2
    $bandFrac   = $radialZone / 2.0;                    // 0.0, 0.5, 1.0

    $rMin = GAL_ARM_START_LY + $bandFrac * (GAL_ARM_END_LY - GAL_ARM_START_LY) * 0.5;
    $rMax = $rMin + (GAL_ARM_END_LY - GAL_ARM_START_LY) * 0.5;

    // Position fraction along the arm (0..1)
    $sysMax = defined('SYSTEM_MAX') ? SYSTEM_MAX : 499;
    $t = ($sysMax > 1) ? ($systemIdx - 1) / ($sysMax - 1) : 0.5;

    // Midline galactocentric radius
    $r = $rMin + $t * ($rMax - $rMin);

    // Winding angle from logarithmic spiral: θ = ln(r/r₀) / b
    $b     = tan(deg2rad(GAL_PITCH_ANGLE_DEG));
    $theta = log($r / GAL_ARM_START_LY) / $b;

    // Add arm base offset (arms equally spaced by 90°)
    $theta += $armIndex * (2.0 * M_PI / GAL_ARMS);

    // Gaussian scatter around arm centreline
    $scatterR = gen_rand_normal(0, GAL_ARM_WIDTH_LY * 0.5,
                                $galaxyIdx * 100 + $armIndex, $systemIdx, 4);
    $scatterT = gen_rand_normal(0, 0.05,
                                $galaxyIdx * 100 + $armIndex, $systemIdx, 5);

    $rFinal     = $r     + $scatterR;
    $thetaFinal = $theta + $scatterT;

    return [
        round($rFinal * cos($thetaFinal), 2),
        round($rFinal * sin($thetaFinal), 2),
        round(gen_rand_normal(0, GAL_DISK_HEIGHT_LY, $galaxyIdx, $systemIdx, 6), 2),
    ];
}

// ─── Stellar classification ───────────────────────────────────────────────────

/**
 * Interpolate main-sequence stellar physical parameters for a given
 * spectral class and numeric subtype (0-9).
 *
 * @return float[]  [mass_solar, radius_solar, temp_K, luminosity_solar]
 */
function interpolate_stellar_params(string $class, int $subtype): array
{
    $table = STELLAR_PARAMS[$class] ?? null;
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

/**
 * Pick a spectral type and physical parameters from the Kroupa IMF CDF.
 *
 * @return array{spectral_class:string, subtype:int, luminosity_class:string,
 *               mass_solar:float, radius_solar:float, temperature_k:int,
 *               luminosity_solar:float}
 */
function pick_spectral_type(int $galaxyIdx, int $systemIdx): array
{
    $roll = gen_rand($galaxyIdx, $systemIdx, 1001);

    foreach (SPECTRAL_TYPE_CDF as [$cumProb, $class, $stLo, $stHi]) {
        if ($roll > $cumProb) {
            continue;
        }
        $subtype = (int)round(
            $stLo + gen_rand($galaxyIdx, $systemIdx, 1002) * ($stHi - $stLo)
        );
        $params  = interpolate_stellar_params($class, $subtype);
        return [
            'spectral_class'   => $class,
            'subtype'          => $subtype,
            'luminosity_class' => 'V',
            'mass_solar'       => round($params[0], 4),
            'radius_solar'     => round($params[1], 4),
            'temperature_k'    => (int)round($params[2]),
            'luminosity_solar' => round($params[3], 6),
        ];
    }

    // Fallback: G2V (solar twin)
    return [
        'spectral_class' => 'G', 'subtype' => 2, 'luminosity_class' => 'V',
        'mass_solar' => 1.0, 'radius_solar' => 1.0,
        'temperature_k' => 5778, 'luminosity_solar' => 1.0,
    ];
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
function generate_planets(array $star, int $galaxyIdx, int $systemIdx): array
{
    $posMax  = defined('POSITION_MAX') ? POSITION_MAX : 15;
    $lum     = $star['luminosity_solar'];
    $mass    = $star['mass_solar'];

    [$hzIn, $hzOut] = habitable_zone_au($lum);
    $frostLine      = frost_line_au($lum);

    // Mean planet count per spectral class (from Kepler occurrence rates)
    $meanPlanets = match ($star['spectral_class']) {
        'O', 'B' => 2.0,
        'A'      => 3.5,
        'F'      => 5.0,
        'G', 'K' => 6.5,
        'M'      => 5.5,
        default  => 5.0,
    };

    $nPlanets = (int)max(1, min($posMax - 1,
        round($meanPlanets
              + gen_rand_normal(0, 1.5, $galaxyIdx, $systemIdx, 201))));

    // Last slot is always a comet belt
    $nSlots = min($posMax, $nPlanets + 1);

    // Innermost orbital distance (AU), scaled with √L
    $a0 = max(0.04,
              gen_rand_normal(0.12, 0.05, $galaxyIdx, $systemIdx, 202)) * sqrt($lum);
    $a0 = max(0.02, $a0);

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

        $planets[] = [
            'position'             => $slot,
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
        ];
    }

    return $planets;
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

    [$hzIn, $hzOut] = habitable_zone_au($star['luminosity_solar']);
    $frostLine      = frost_line_au($star['luminosity_solar']);

    $planets = generate_planets($star, $galaxyIdx, $systemIdx);

    // Catalogue name: "GQ-<galaxy>-<system zero-padded to 3 digits>"
    $name = sprintf('GQ-%d-%03d', $galaxyIdx, $systemIdx);

    return array_merge($star, [
        'galaxy_index'  => $galaxyIdx,
        'system_index'  => $systemIdx,
        'name'          => $name,
        'x_ly'          => $x,
        'y_ly'          => $y,
        'z_ly'          => $z,
        'hz_inner_au'   => round($hzIn,      5),
        'hz_outer_au'   => round($hzOut,     5),
        'frost_line_au' => round($frostLine, 5),
        'planets'       => $planets,
    ]);
}
