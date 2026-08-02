<?php
/**
 * Ship Designer Prompt Engine
 * Generates TRELLIS2 prompts from faction specs + player customization
 * Supports LoRA-based style consistency and real-time generation
 * 
 * GET  /api/ship_designer_engine.php?action=generate_prompt          – Generate TRELLIS2 prompt from faction/class
 * POST /api/ship_designer_engine.php?action=queue_generation         – Queue async generation job
 * GET  /api/ship_designer_engine.php?action=generation_status&job_id – Check generation progress
 * POST /api/ship_designer_engine.php?action=save_generated_ship      – Import generated GLB as user ship
 * GET  /api/ship_designer_engine.php?action=ship_templates           – List faction ship templates
 * GET  /api/ship_designer_engine.php?action=lora_styles              – List available LoRA style presets
 */
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/../lib/MiniYamlParser.php';
require_once __DIR__ . '/llm_soc/FactionSpecLoader.php';

// ────────────────────────────────────────────────────────────────────────────

/**
 * Faction-specific ship design signatures
 * Defines silhouette, materials, and signature parts per faction
 */
final class FactionShipSignature {
    
    private const SIGNATURES = [
        'vor_tak' => [
            'silhouette' => 'wedge-based, heavily armored, front-heavy, with dorsal spinal ridges',
            'materials' => 'dark industrial metals, bone-colored plating, bronze accents, matte finish',
            'signature_parts' => ['jaw_bridge', 'dorsal_spine', 'armor_scales'],
            'color_primary' => '#8B4513',      // dark brown-bronze
            'color_secondary' => '#C0C0C0',    // silver
            'lora_style' => 'vor_tak_industrial_militaristic',
            'motifs' => ['jagged', 'layered_armor', 'forward_aggressive', 'ritualistic_markings'],
        ],
        'syl_nar' => [
            'silhouette' => 'soft orbital geometry, flowing curves, tentacle-like extensions, bioluminescent features',
            'materials' => 'translucent shells, bio-luminescent veins, wet-glossy surfaces, mother-of-pearl shimmer',
            'signature_parts' => ['halo_tentacles', 'lumen_veins', 'tide_fins'],
            'color_primary' => '#4169E1',      // royal blue
            'color_secondary' => '#7FFFD4',    // aquamarine
            'lora_style' => 'syl_nar_organic_bioluminescent',
            'motifs' => ['flowing', 'tentacular', 'luminous', 'water_inspired', 'harmonic_resonance'],
        ],
        'aereth' => [
            'silhouette' => 'sleek energy-forms, crystalline geometry, angular precision, sensor nodes',
            'materials' => 'polished crystalline structures, energy conduit veins, luminous edges, frictionless surfaces',
            'signature_parts' => ['crystal_core', 'energy_vanes', 'sensor_crown'],
            'color_primary' => '#2288EE',      // bright blue
            'color_secondary' => '#FFFFFF',    // white
            'lora_style' => 'aereth_crystalline_scientific',
            'motifs' => ['crystalline', 'energetic', 'precise', 'geometric', 'research_beacons'],
        ],
        'kryl_tha' => [
            'silhouette' => 'insectoid, chitinous, segmented, swarm-optimized, compact efficiency',
            'materials' => 'organic chitinous carapace, bio-metallics, bristling barbs, glossy exoskeleton',
            'signature_parts' => ['chitin_ridges', 'swarm_appendages', 'mandible_jaw'],
            'color_primary' => '#228B22',      // forest green
            'color_secondary' => '#FFD700',    // gold
            'lora_style' => 'kryl_tha_insectoid_organic',
            'motifs' => ['segmented', 'chitinous', 'mandibular', 'swarm_coordinated', 'bio_bristling'],
        ],
        'zhareen' => [
            'silhouette' => 'geometric archival, structured, library-like, information storage density visual',
            'materials' => 'polished metallic surfaces with engravings, data-inscribed panels, amber crystal nodes',
            'signature_parts' => ['archive_spire', 'data_node_cluster', 'sealed_vault_section'],
            'color_primary' => '#CC44AA',      // magenta
            'color_secondary' => '#FFD700',    // gold (knowledge)
            'lora_style' => 'zhareen_archival_geometric',
            'motifs' => ['geometric', 'data_inscribed', 'archival', 'knowledge_storage', 'ordered_precision'],
        ],
        'vel_ar' => [
            'silhouette' => 'shadow-mimicking, angular stealth, minimal profile, geometric concealment patterns',
            'materials' => 'matte-black radar-absorbing surfaces, stealth-geometric facets, shadow-reactive finishes',
            'signature_parts' => ['stealth_vanes', 'sensor_ghost_array', 'shadow_cowl'],
            'color_primary' => '#1C1C1C',      // near black
            'color_secondary' => '#4A4A4A',    // dark gray
            'lora_style' => 'vel_ar_stealth_espionage',
            'motifs' => ['angular_stealth', 'shadow', 'geometric_concealment', 'minimal_profile', 'radar_evasion'],
        ],
    ];
    
    public static function getSignature(string $factionCode): array {
        $code = strtolower(trim($factionCode));
        return self::SIGNATURES[$code] ?? self::SIGNATURES['vor_tak'];
    }
    
    public static function getAllSignatures(): array {
        return self::SIGNATURES;
    }
}

// ────────────────────────────────────────────────────────────────────────────

/**
 * Ship class templates with geometry & performance constraints
 */
final class ShipClassTemplate {
    
    private const CLASSES = [
        'fighter' => [
            'title' => 'Fighter',
            'scale_unit' => 20,                 // 20m reference
            'tri_budget' => 3000,               // max triangles
            'description' => 'Agile single-pilot combat vessel',
            'silhouette_hint' => 'sleek, pointed, minimal profile',
            'role_descriptor' => 'combat interceptor with high maneuverability',
        ],
        'corvette' => [
            'title' => 'Corvette',
            'scale_unit' => 60,
            'tri_budget' => 8000,
            'description' => 'Light patrol/strike vessel',
            'silhouette_hint' => 'compact, multipurpose, balanced firepower',
            'role_descriptor' => 'fast patrol and strike capability with crew quarters',
        ],
        'frigate' => [
            'title' => 'Frigate',
            'scale_unit' => 120,
            'tri_budget' => 12000,
            'description' => 'Medium escort/exploration vessel',
            'silhouette_hint' => 'balanced form, crew capacity, sensor suite',
            'role_descriptor' => 'exploration and medium-range combat with extended crew',
        ],
        'destroyer' => [
            'title' => 'Destroyer',
            'scale_unit' => 180,
            'tri_budget' => 18000,
            'description' => 'Heavy combat capital ship',
            'silhouette_hint' => 'powerful, imposing, weapon-heavy silhouette',
            'role_descriptor' => 'dominant firepower projection and fleet command',
        ],
        'freighter' => [
            'title' => 'Freighter',
            'scale_unit' => 150,
            'tri_budget' => 15000,
            'description' => 'Cargo transport vessel',
            'silhouette_hint' => 'large cargo bay emphasis, utility-focused',
            'role_descriptor' => 'maximum cargo capacity with moderate defense',
        ],
        'capital' => [
            'title' => 'Capital Ship',
            'scale_unit' => 300,
            'tri_budget' => 25000,
            'description' => 'Flagship-class commanding vessel',
            'silhouette_hint' => 'massive, command authority visual, multi-section',
            'role_descriptor' => 'fleet command center with formidable independent combat capability',
        ],
    ];
    
    public static function getTemplate(string $shipClass): ?array {
        $class = strtolower(trim($shipClass));
        return self::CLASSES[$class] ?? null;
    }
    
    public static function getAllTemplates(): array {
        return self::CLASSES;
    }
}

// ────────────────────────────────────────────────────────────────────────────

/**
 * LoRA style presets for consistent faction aesthetics across generations
 */
final class LoRAStylePreset {
    
    private const PRESETS = [
        'faction_signature' => [
            'name' => 'Faction Signature Style',
            'description' => 'Apply faction-specific LoRA for visual consistency',
            'enabled_by_default' => true,
            'guidance_scale' => 7.5,
            'affects' => ['silhouette', 'materials', 'color_palette', 'signature_parts'],
        ],
        'industrial_militaristic' => [
            'name' => 'Industrial Militaristic',
            'description' => 'Heavy armor plating, angular geometry, weapons-focused',
            'enabled_by_default' => false,
            'guidance_scale' => 6.0,
            'affects' => ['armor', 'weapons', 'industrial_textures'],
            'faction_optimized_for' => ['vor_tak'],
        ],
        'organic_biomimetic' => [
            'name' => 'Organic Biomimetic',
            'description' => 'Flowing curves, biological inspiration, living vessel aesthetic',
            'enabled_by_default' => false,
            'guidance_scale' => 7.0,
            'affects' => ['curves', 'organic_materials', 'bioluminescence'],
            'faction_optimized_for' => ['syl_nar', 'kryl_tha'],
        ],
        'crystalline_geometric' => [
            'name' => 'Crystalline Geometric',
            'description' => 'Sharp angles, crystalline structures, energy nodes',
            'enabled_by_default' => false,
            'guidance_scale' => 6.5,
            'affects' => ['geometry', 'crystalline_materials', 'energy_nodes'],
            'faction_optimized_for' => ['aereth'],
        ],
        'stealth_angular' => [
            'name' => 'Stealth Angular',
            'description' => 'Radar-absorbing geometry, shadow-like aesthetics, minimal profile',
            'enabled_by_default' => false,
            'guidance_scale' => 7.0,
            'affects' => ['stealth_geometry', 'radar_absorption', 'minimal_profile'],
            'faction_optimized_for' => ['vel_ar'],
        ],
        'archival_geometric' => [
            'name' => 'Archival Geometric',
            'description' => 'Information storage emphasis, precise geometry, knowledge focus',
            'enabled_by_default' => false,
            'guidance_scale' => 6.0,
            'affects' => ['data_nodes', 'archival_structure', 'precise_geometry'],
            'faction_optimized_for' => ['zhareen'],
        ],
    ];
    
    public static function getPreset(string $presetKey): ?array {
        $key = strtolower(trim($presetKey));
        return self::PRESETS[$key] ?? null;
    }
    
    public static function getAllPresets(): array {
        return self::PRESETS;
    }
    
    /**
     * Get recommended LoRA styles for a faction
     */
    public static function getRecommendedForFaction(string $factionCode): array {
        $factionCode = strtolower(trim($factionCode));
        $recommended = ['faction_signature'];
        
        foreach (self::PRESETS as $key => $preset) {
            if ($key !== 'faction_signature' && isset($preset['faction_optimized_for'])) {
                if (in_array($factionCode, $preset['faction_optimized_for'])) {
                    $recommended[] = $key;
                }
            }
        }
        
        return $recommended;
    }
}

// ────────────────────────────────────────────────────────────────────────────

/**
 * Main prompt generator: Faction specs → TRELLIS2-ready prompt
 */
final class ShipDesignerPromptEngine {
    
    private PDO $db;
    private FactionSpecLoader $specLoader;
    
    public function __construct(PDO $db) {
        $this->db = $db;
        $this->specLoader = new FactionSpecLoader();
    }
    
    /**
     * Generate TRELLIS2 text-to-3D prompt from faction + ship class + player customization
     * 
     * @param array{
     *   faction_code: string,
     *   ship_class: string,
     *   name?: string,
     *   customization_prompt?: string,
     *   lora_styles?: list<string>,
     * } $config
     * @return array{prompt: string, metadata: array}
     * @throws \InvalidArgumentException
     */
    public function generatePrompt(array $config): array {
        $factionCode = $config['faction_code'] ?? '';
        $shipClass = $config['ship_class'] ?? 'corvette';
        $customizationPrompt = $config['customization_prompt'] ?? '';
        $loraStyles = $config['lora_styles'] ?? [];
        $shipName = $config['name'] ?? null;
        
        if (!$factionCode) {
            throw new \InvalidArgumentException('faction_code required');
        }
        
        // 1. Load faction spec
        try {
            $factionSpec = $this->specLoader->loadFactionSpec($factionCode);
        } catch (\Exception $e) {
            throw new \InvalidArgumentException("Faction not found: $factionCode");
        }
        
        // 2. Resolve ship class template
        $shipTemplate = ShipClassTemplate::getTemplate($shipClass);
        if (!$shipTemplate) {
            throw new \InvalidArgumentException("Ship class not supported: $shipClass");
        }
        
        // 3. Get faction visual signature
        $signature = FactionShipSignature::getSignature($factionCode);
        
        // 4. Build core prompt
        $lines = [];
        $lines[] = "Generate a high-quality 3D spaceship in GLB format for TRELLIS2.";
        $lines[] = '';
        
        // Faction context
        $lines[] = "## Faction Context";
        $lines[] = "Faction: " . ($factionSpec['display_name'] ?? $factionCode);
        $lines[] = "Type: " . ($factionSpec['faction_type'] ?? 'military');
        $lines[] = "Description: " . (($factionSpec['faction_description'] ?? 'A spacefaring faction.'));
        $lines[] = '';
        
        // Visual signature
        $lines[] = "## Visual Signature (MUST apply)";
        $lines[] = "Silhouette: " . $signature['silhouette'];
        $lines[] = "Materials: " . $signature['materials'];
        $lines[] = "Primary Color: " . $signature['color_primary'];
        $lines[] = "Secondary Color: " . $signature['color_secondary'];
        $lines[] = "Signature Parts: " . implode(', ', $signature['signature_parts']);
        $lines[] = '';
        
        // Ship class constraints
        $lines[] = "## Ship Class Specifications";
        $lines[] = "Class: " . $shipTemplate['title'];
        $lines[] = "Description: " . $shipTemplate['description'];
        $lines[] = "Role: " . $shipTemplate['role_descriptor'];
        $lines[] = "Scale Reference: " . $shipTemplate['scale_unit'] . " meters";
        $lines[] = "Triangle Budget: max " . $shipTemplate['tri_budget'] . " triangles (CRITICAL - optimize geometry)";
        $lines[] = "Silhouette Hint: " . $shipTemplate['silhouette_hint'];
        $lines[] = '';
        
        // LoRA style guidance
        if (!empty($loraStyles)) {
            $lines[] = "## Style Modifiers";
            foreach ($loraStyles as $style) {
                $preset = LoRAStylePreset::getPreset($style);
                if ($preset) {
                    $lines[] = "- " . $preset['description'];
                }
            }
            $lines[] = '';
        }
        
        // Player customization
        if ($customizationPrompt) {
            $lines[] = "## Player Customization";
            $lines[] = $customizationPrompt;
            $lines[] = '';
        }
        
        // Output requirements
        $lines[] = "## Output Requirements";
        $lines[] = "- Export as GLB format (binary .glb file)";
        $lines[] = "- All textures embedded or referenced with absolute paths";
        $lines[] = "- Recognize TRELLIS2 output structure: single root Mesh3D with materials";
        $lines[] = "- Ensure silhouette is instantly recognizable as faction: " . $factionCode;
        $lines[] = "- Apply all signature parts distinctly to avoid ambiguity";
        $lines[] = "- Maintain consistent materials across connected components";
        $lines[] = '';
        
        $prompt = implode("\n", $lines);
        
        $metadata = [
            'faction_code' => $factionCode,
            'faction_name' => $factionSpec['display_name'] ?? $factionCode,
            'ship_class' => $shipClass,
            'ship_name' => $shipName,
            'scale_reference' => $shipTemplate['scale_unit'],
            'tri_budget' => $shipTemplate['tri_budget'],
            'lora_styles' => $loraStyles,
            'signature_parts' => $signature['signature_parts'],
            'generated_at' => date('c'),
        ];
        
        return [
            'prompt' => $prompt,
            'metadata' => $metadata,
        ];
    }
    
    /**
     * Get all available ship templates grouped by class
     */
    public function getShipTemplates(): array {
        return ShipClassTemplate::getAllTemplates();
    }
    
    /**
     * Get faction-specific templates
     */
    public function getFactionShips(string $factionCode): array {
        try {
            $spec = $this->specLoader->loadFactionSpec($factionCode);
        } catch (\Exception $e) {
            return [];
        }
        
        $templates = ShipClassTemplate::getAllTemplates();
        $signature = FactionShipSignature::getSignature($factionCode);
        
        return [
            'faction' => [
                'code' => $factionCode,
                'name' => $spec['display_name'] ?? $factionCode,
                'type' => $spec['faction_type'] ?? 'unknown',
            ],
            'signature' => $signature,
            'available_classes' => array_keys($templates),
            'templates' => $templates,
        ];
    }
    
    /**
     * Get LoRA style recommendations for a faction
     */
    public function getLoRAStyles(string $factionCode = ''): array {
        $allPresets = LoRAStylePreset::getAllPresets();
        
        if ($factionCode) {
            $recommended = LoRAStylePreset::getRecommendedForFaction($factionCode);
            $result = [];
            foreach ($recommended as $key) {
                if (isset($allPresets[$key])) {
                    $result[$key] = $allPresets[$key];
                }
            }
            return $result;
        }
        
        return $allPresets;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// API Endpoint Handler
// ────────────────────────────────────────────────────────────────────────────

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    $action = $_GET['action'] ?? '';
    
    // Public endpoints (no auth required for demo mode)
    $publicActions = ['ship_templates', 'lora_styles', 'faction_ships', 'generate_prompt'];
    
    // Require auth only for non-public endpoints
    if (!in_array($action, $publicActions)) {
        $uid = require_auth();
    }
    
    $db = get_db();
    $engine = new ShipDesignerPromptEngine($db);
    
    try {
        switch ($action) {
            
            case 'generate_prompt':
                only_method('POST');
                $body = json_decode(file_get_contents('php://input'), true);
                $result = $engine->generatePrompt($body);
                json_ok($result);
                break;
            
            case 'ship_templates':
                only_method('GET');
                $templates = $engine->getShipTemplates();
                json_ok(['templates' => $templates]);
                break;
            
            case 'faction_ships':
                only_method('GET');
                $factionCode = $_GET['faction_code'] ?? '';
                if (!$factionCode) {
                    return json_error('faction_code required', 400);
                }
                $result = $engine->getFactionShips($factionCode);
                json_ok($result);
                break;
            
            case 'lora_styles':
                only_method('GET');
                $factionCode = $_GET['faction_code'] ?? '';
                $styles = $engine->getLoRAStyles($factionCode);
                json_ok(['styles' => $styles]);
                break;
            
            default:
                json_error("Unknown action: $action", 400);
        }
    } catch (\InvalidArgumentException $e) {
        json_error($e->getMessage(), 400);
    } catch (\Exception $e) {
        error_log("ShipDesignerEngine error: " . $e->getMessage());
        json_error("Internal server error", 500);
    }
}
?>
