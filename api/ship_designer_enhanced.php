<?php
/**
 * Enhanced Ship Designer with Backend Base Assets
 * 
 * Workflow:
 * 1. Backend generates canonical components per faction (via TRELLIS2)
 * 2. Player selects faction → gets base hull + components
 * 3. Player customizes in Designer UI
 * 4. Optional: Player requests TRELLIS2 refinement
 * 5. Final ship saved to database
 * 
 * GET  /api/ship_designer_enhanced.php?action=get_base_assets&faction_code – Cached base components
 * POST /api/ship_designer_enhanced.php?action=customize_ship            – Player customization
 * POST /api/ship_designer_enhanced.php?action=refine_with_trellis2      – Queue AI refinement
 */
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/trellis2_generator.php';

// ────────────────────────────────────────────────────────────────────────────

/**
 * Enhanced Ship Designer combining Base Assets + Player Customization
 */
final class EnhancedShipDesigner {
    
    private PDO $db;
    private BaseShipComponentGenerator $componentGenerator;
    private TRELLIS2Client $trellis2;
    
    public function __construct(PDO $db, ?TRELLIS2Client $trellis2 = null) {
        $this->db = $db;
        $this->trellis2 = $trellis2 ?? new TRELLIS2Client();
        $this->componentGenerator = new BaseShipComponentGenerator($db, $this->trellis2);
    }
    
    /**
     * Get base assets for a faction (cached from backend generation)
     * 
     * Returns: hull GLB + component modules (weapons, engines, shields, sensors)
     */
    public function getBaseAssets(string $factionCode): array {
        $cacheKey = "base_assets_{$factionCode}";
        $cached = gq_cache_get($cacheKey, ['faction_code' => $factionCode]);
        
        if (is_array($cached)) {
            return $cached;
        }
        
        // Fetch from database
        $stmt = $this->db->prepare(
            'SELECT component_type, glb_path, metadata 
             FROM base_ship_components 
             WHERE faction_code = ?'
        );
        $stmt->execute([$factionCode]);
        
        $assets = [
            'faction_code' => $factionCode,
            'hull' => null,
            'components' => [],
        ];
        
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $row) {
            $type = $row['component_type'];
            $metadata = json_decode($row['metadata'], true) ?? [];
            
            // Read GLB file (or return path for streaming)
            $glbPath = $row['glb_path'];
            $glbExists = file_exists($glbPath);
            
            $asset = [
                'path' => $glbPath,
                'exists' => $glbExists,
                'metadata' => $metadata,
                'size' => $glbExists ? filesize($glbPath) : 0,
            ];
            
            if ($type === 'hull') {
                $assets['hull'] = $asset;
            } else {
                if (!isset($assets['components'][$type])) {
                    $assets['components'][$type] = [];
                }
                $assets['components'][$type][] = $asset;
            }
        }
        
        gq_cache_set($cacheKey, $assets, ['faction_code' => $factionCode], 3600);
        
        return $assets;
    }
    
    /**
     * Get playable avatar for a species
     */
    public function getSpeciesAvatar(string $speciesCode, string $gender = 'male'): array {
        $stmt = $this->db->prepare(
            'SELECT glb_path, metadata, thumbnail_path 
             FROM species_avatars 
             WHERE species_code = ? AND gender = ?'
        );
        $stmt->execute([$speciesCode, $gender]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        
        if (!$row) {
            return [
                'available' => false,
                'reason' => 'Avatar not yet generated for this species',
            ];
        }
        
        return [
            'available' => true,
            'glb_path' => $row['glb_path'],
            'thumbnail' => $row['thumbnail_path'],
            'metadata' => json_decode($row['metadata'], true),
            'gender' => $gender,
            'species_code' => $speciesCode,
        ];
    }
    
    /**
     * Player customizes ship:
     * - Selects which base components to use
     * - Specifies customization details (paint, decals, attachments)
     * - Names the ship
     */
    public function customizeShip(array $customization): array {
        $userId = $customization['user_id'] ?? null;
        $factionCode = $customization['faction_code'] ?? '';
        $shipClass = $customization['ship_class'] ?? 'corvette';
        $shipName = $customization['ship_name'] ?? 'Custom Ship';
        $selectedComponents = $customization['components'] ?? [];
        $customDetails = $customization['custom_details'] ?? '';
        
        if (!$factionCode || !$userId) {
            throw new \InvalidArgumentException('faction_code and user_id required');
        }
        
        // Validate selected components exist
        $baseAssets = $this->getBaseAssets($factionCode);
        if (!$baseAssets['hull']) {
            throw new \RuntimeException("Base hull not available for {$factionCode}");
        }
        
        // Store customization for later refinement
        $stmt = $this->db->prepare(
            'INSERT INTO user_ship_customizations 
             (user_id, faction_code, ship_class, ship_name, selected_components, custom_details, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())'
        );
        $stmt->execute([
            $userId,
            $factionCode,
            $shipClass,
            $shipName,
            json_encode($selectedComponents),
            $customDetails,
        ]);
        
        $customizationId = (int)$this->db->lastInsertId();
        
        return [
            'success' => true,
            'customization_id' => $customizationId,
            'base_hull' => $baseAssets['hull'],
            'selected_components' => $selectedComponents,
            'ready_for_refinement' => true,
        ];
    }
    
    /**
     * Queue TRELLIS2 refinement job
     * Takes base assets + customization → generates final ship
     */
    public function refineWithTRELLIS2(int $customizationId): array {
        // Load customization
        $stmt = $this->db->prepare(
            'SELECT user_id, faction_code, ship_class, ship_name, 
                    selected_components, custom_details
             FROM user_ship_customizations
             WHERE id = ?'
        );
        $stmt->execute([$customizationId]);
        $custom = $stmt->fetch(\PDO::FETCH_ASSOC);
        
        if (!$custom) {
            throw new \InvalidArgumentException("Customization $customizationId not found");
        }
        
        $baseAssets = $this->getBaseAssets($custom['faction_code']);
        $components = json_decode($custom['selected_components'], true) ?? [];
        
        // Build refinement prompt
        $prompt = $this->buildRefinementPrompt(
            $custom['faction_code'],
            $custom['ship_class'],
            $baseAssets,
            $components,
            $custom['custom_details']
        );
        
        // Queue generation
        $result = $this->trellis2->generateText2Model($prompt, ['sync' => false]);
        
        if (isset($result['error'])) {
            return [
                'success' => false,
                'error' => $result['error'],
            ];
        }
        
        $jobId = $result['job_id'] ?? null;
        if (!$jobId) {
            return ['success' => false, 'error' => 'No job_id from TRELLIS2'];
        }
        
        // Store job reference
        $stmt = $this->db->prepare(
            'INSERT INTO trellis2_refinement_jobs 
             (job_id, customization_id, user_id, status, created_at)
             VALUES (?, ?, ?, ?, NOW())'
        );
        $stmt->execute([$jobId, $customizationId, $custom['user_id'], 'queued']);
        
        return [
            'success' => true,
            'job_id' => $jobId,
            'customization_id' => $customizationId,
            'status' => 'queued',
        ];
    }
    
    /**
     * Build refinement prompt from customization
     */
    private function buildRefinementPrompt(
        string $factionCode,
        string $shipClass,
        array $baseAssets,
        array $components,
        string $customDetails
    ): string {
        $signature = $this->getFactionSignature($factionCode);
        $shipTemplate = $this->getShipTemplate($shipClass);
        
        $prompt = <<<PROMPT
Refine and assemble a custom spaceship from base components.

## Faction Context
Faction: {$factionCode}
Base Design: {$signature['silhouette']}
Materials: {$signature['materials']}
Colors: {$signature['color_primary']}, {$signature['color_secondary']}

## Ship Configuration
Class: {$shipClass}
Scale: {$shipTemplate['scale']}m reference length
Triangle Budget: {$shipTemplate['tri_budget']} triangles max

## Base Hull (MUST USE)
Path: {$baseAssets['hull']['path']}
This is the canonical hull form - DO NOT ALTER silhouette

## Selected Components to Assemble
PROMPT;
        
        foreach ($components as $componentType => $selectedVariant) {
            if (isset($baseAssets['components'][$componentType])) {
                $prompt .= "\n### {$componentType}\nVariant: {$selectedVariant}\n";
                foreach ($baseAssets['components'][$componentType] as $comp) {
                    $prompt .= "Available: {$comp['path']}\n";
                }
            }
        }
        
        $prompt .= <<<PROMPT

## Player Customization Details
{$customDetails}

## Assembly Instructions
1. Load base hull from path
2. Position and attach selected components at their mounting points
3. Ensure all components are visually integrated
4. Maintain faction aesthetic throughout
5. Respect triangle budget (optimize/LOD as needed)

## Output
- Final assembled ship as single GLB
- All components integrated into unified mesh
- Materials preserved from base assets
- Ready for game engine import

Export as GLB with embedded materials.
PROMPT;
        
        return $prompt;
    }
    
    // ─ Helper methods ──────────────────────────────────────────────────────
    
    private function getFactionSignature(string $factionCode): array {
        $sigs = [
            'vor_tak' => [
                'silhouette' => 'wedge-based, armored, front-heavy',
                'materials' => 'dark metals, bone plating, bronze accents',
                'color_primary' => '#8B4513',
                'color_secondary' => '#C0C0C0',
            ],
            'syl_nar' => [
                'silhouette' => 'flowing curves, tentacle-like, bioluminescent',
                'materials' => 'translucent shells, bio-luminescent veins',
                'color_primary' => '#4169E1',
                'color_secondary' => '#7FFFD4',
            ],
            // ... other factions
        ];
        return $sigs[$factionCode] ?? $sigs['vor_tak'];
    }
    
    private function getShipTemplate(string $shipClass): array {
        $templates = [
            'fighter' => ['scale' => 20, 'tri_budget' => 3000],
            'corvette' => ['scale' => 60, 'tri_budget' => 8000],
            'frigate' => ['scale' => 120, 'tri_budget' => 12000],
            'destroyer' => ['scale' => 180, 'tri_budget' => 18000],
            'freighter' => ['scale' => 150, 'tri_budget' => 15000],
            'capital' => ['scale' => 300, 'tri_budget' => 25000],
        ];
        return $templates[$shipClass] ?? $templates['corvette'];
    }
}

// ────────────────────────────────────────────────────────────────────────────
// API Endpoint Handler
// ────────────────────────────────────────────────────────────────────────────

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    $action = $_GET['action'] ?? '';
    $uid = require_auth();
    $db = get_db();
    
    $designer = new EnhancedShipDesigner($db);
    
    try {
        switch ($action) {
            case 'get_base_assets':
                only_method('GET');
                $factionCode = $_GET['faction_code'] ?? '';
                if (!$factionCode) {
                    return json_error('faction_code required', 400);
                }
                $assets = $designer->getBaseAssets($factionCode);
                json_ok(['base_assets' => $assets]);
                break;
            
            case 'get_avatar':
                only_method('GET');
                $speciesCode = $_GET['species_code'] ?? '';
                $gender = $_GET['gender'] ?? 'male';
                if (!$speciesCode) {
                    return json_error('species_code required', 400);
                }
                $avatar = $designer->getSpeciesAvatar($speciesCode, $gender);
                json_ok($avatar);
                break;
            
            case 'customize_ship':
                only_method('POST');
                $body = json_decode(file_get_contents('php://input'), true);
                $body['user_id'] = $uid;
                $result = $designer->customizeShip($body);
                json_ok($result);
                break;
            
            case 'refine_with_trellis2':
                only_method('POST');
                $body = json_decode(file_get_contents('php://input'), true);
                $customizationId = $body['customization_id'] ?? null;
                if (!$customizationId) {
                    return json_error('customization_id required', 400);
                }
                $result = $designer->refineWithTRELLIS2((int)$customizationId);
                json_ok($result);
                break;
            
            default:
                json_error("Unknown action: $action", 400);
        }
    } catch (\InvalidArgumentException $e) {
        json_error($e->getMessage(), 400);
    } catch (\Exception $e) {
        error_log("EnhancedShipDesigner error: " . $e->getMessage());
        json_error("Internal server error", 500);
    }
}
?>
