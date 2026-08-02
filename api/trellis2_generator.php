<?php
/**
 * TRELLIS2 Backend Generator
 * 
 * Server-seitige Integration mit TRELLIS2 für:
 * - Basis-Schiff-Komponenten-Generierung (pro Spezies)
 * - Spezies-Avatar-Generierung
 * - Waffensysteme, Antriebe, Hüllen, Schilde, etc.
 * - Async Job Queue für lange Generierungen
 * - GLB-Caching und Versionierung
 * 
 * GET  /api/trellis2_generator.php?action=status                  – Container health check
 * POST /api/trellis2_generator.php?action=generate_species_base    – Queue base ship gen
 * GET  /api/trellis2_generator.php?action=generation_status&job_id – Check job progress
 * GET  /api/trellis2_generator.php?action=base_components&faction_code – List cached components
 */
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/../lib/MiniYamlParser.php';
require_once __DIR__ . '/llm_soc/FactionSpecLoader.php';
require_once __DIR__ . '/ship_component_prompts.php';

// ────────────────────────────────────────────────────────────────────────────

/**
 * TRELLIS2 Docker Container Client
 * Communicates with TRELLIS2 WebApp via HTTP REST API
 */
final class TRELLIS2Client {
    
    private string $baseUrl;
    private int $timeoutSeconds = 300;
    
    public function __construct(?string $baseUrl = null) {
        // Default to Docker service name (can be overridden for dev/prod)
        $this->baseUrl = $baseUrl ?? getenv('TRELLIS2_API_URL') ?: 'http://trellis2:7862';
    }
    
    /**
     * Health check: is TRELLIS2 container running and responsive?
     */
    public function healthCheck(): bool {
        try {
            $response = $this->request('GET', '/api/health', [], 5);
            return $response !== null && isset($response['status']) && $response['status'] === 'ok';
        } catch (\Exception $e) {
            error_log("[TRELLIS2Client] Health check failed: " . $e->getMessage());
            return false;
        }
    }
    
    /**
     * Generate 3D model from text prompt
     * Returns job_id for polling, or GLB buffer if sync=true
     * 
     * @param string $prompt TRELLIS2-formatted text prompt
     * @param array{sync?: bool, timeout?: int} $opts
     * @return array{job_id?: string, glb_buffer?: string, error?: string}
     */
    public function generateText2Model(string $prompt, array $opts = []): array {
        $sync = $opts['sync'] ?? false;
        $timeout = $opts['timeout'] ?? 60;
        
        try {
            $payload = [
                'text' => $prompt,
                'wait_for_completion' => $sync,
            ];
            
            $response = $this->request('POST', '/api/predict', $payload, $timeout);
            
            if (!$response) {
                return ['error' => 'No response from TRELLIS2'];
            }
            
            // TRELLIS2 returns GLB as base64 or job_id
            if (isset($response['output']) && isset($response['output'][0])) {
                $glbBase64 = $response['output'][0];
                $glbBuffer = base64_decode($glbBase64, true);
                return ['glb_buffer' => $glbBuffer];
            }
            
            if (isset($response['job_id'])) {
                return ['job_id' => $response['job_id']];
            }
            
            return ['error' => 'Unexpected TRELLIS2 response format'];
        } catch (\Exception $e) {
            return ['error' => $e->getMessage()];
        }
    }
    
    /**
     * Poll job status
     */
    public function getJobStatus(string $jobId): array {
        try {
            $response = $this->request('GET', "/api/queue?job={$jobId}", [], 10);
            return $response ?? ['status' => 'unknown'];
        } catch (\Exception $e) {
            return ['error' => $e->getMessage()];
        }
    }
    
    /**
     * Get completed output (after job finishes)
     */
    public function getJobOutput(string $jobId): ?string {
        try {
            $response = $this->request('GET', "/api/output?job={$jobId}", [], 10);
            if ($response && isset($response['output'])) {
                return base64_decode($response['output'], true);
            }
            return null;
        } catch (\Exception $e) {
            error_log("[TRELLIS2Client] Get job output failed: " . $e->getMessage());
            return null;
        }
    }
    
    /**
     * HTTP request with timeout
     */
    private function request(string $method, string $path, array $payload = [], int $timeout = 30): ?array {
        $url = $this->baseUrl . $path;
        $ch = curl_init($url);
        
        curl_setopt_array($ch, [
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        ]);
        
        if ($method === 'POST' && !empty($payload)) {
            curl_setopt($ch, CURLOPT_POST, 1);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        }
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        if ($httpCode < 200 || $httpCode >= 300) {
            throw new \Exception("TRELLIS2 HTTP {$httpCode}: {$response}");
        }
        
        return json_decode($response, true);
    }
}

// ────────────────────────────────────────────────────────────────────────────

/**
 * Base Ship Component Generator
 * Creates canonical 3D components per species/faction
 */
final class BaseShipComponentGenerator {
    
    private TRELLIS2Client $trellis2;
    private PDO $db;
    
    public function __construct(PDO $db, ?TRELLIS2Client $trellis2 = null) {
        $this->db = $db;
        $this->trellis2 = $trellis2 ?? new TRELLIS2Client();
    }
    
    /**
     * Generate canonical base hull for a faction
     * Uses detailed geometry + texture specifications from ShipComponentPromptLibrary
     */
    public function generateBaseHull(string $factionCode): array {
        try {
            $prompt = ShipComponentPromptLibrary::getHullPrompt($factionCode);
        } catch (\Exception $e) {
            error_log("[BaseShipComponentGenerator] Prompt library error: " . $e->getMessage());
            // Fallback to basic prompt
            $prompt = $this->getFallbackHullPrompt($factionCode);
        }
        
        return $this->queueGeneration('base_hull', $factionCode, $prompt, [
            'component_type' => 'hull',
            'faction_code' => $factionCode,
            'source' => 'ShipComponentPromptLibrary',
        ]);
    }
    
    /**
     * Fallback prompt if library is unavailable
     */
    private function getFallbackHullPrompt(string $factionCode): string {
        $signature = $this->getSignatureForFaction($factionCode);
        
        return <<<PROMPT
Generate a canonical base hull form for the {$signature['faction_name']} faction.

DESIGN SPECIFICATIONS:
Silhouette: {$signature['silhouette']}
Materials: {$signature['materials']}
Primary Color: {$signature['color_primary']}
Secondary Color: {$signature['color_secondary']}

This is the CORE FORM - the foundation that all ships of this faction will be built upon.
Scale: 100 meters reference length
Quality: High (8,000 triangles max)
Output: Single unified mesh representing the hull form only (no weapons, no engines)

Export as GLB with embedded materials.
PROMPT;
    }
    
    /**
     * Generate weapon hardpoint templates
     * Uses detailed weapon module specifications
     */
    public function generateWeaponHardpoints(string $factionCode): array {
        // Generate 3 variants (small, medium, large)
        $prompts = [
            'small' => ShipComponentPromptLibrary::getComponentPrompt('weapons', $factionCode, 'small'),
            'medium' => ShipComponentPromptLibrary::getComponentPrompt('weapons', $factionCode, 'medium'),
            'large' => ShipComponentPromptLibrary::getComponentPrompt('weapons', $factionCode, 'large'),
        ];
        
        // Queue as one job with all 3 variants
        $prompt = <<<PROMPT
Generate 3 weapon hardpoint module variants for {$factionCode} faction:

{$prompts['small']}

---

{$prompts['medium']}

---

{$prompts['large']}

Each variant should be a separate GLB file with clear attachment point at base.
PROMPT;
        
        return $this->queueGeneration('weapon_hardpoints', $factionCode, $prompt, [
            'component_type' => 'weapons',
            'faction_code' => $factionCode,
            'variants' => ['small', 'medium', 'large'],
            'source' => 'ShipComponentPromptLibrary',
        ]);
    }
    
    /**
     * Generate engine/thruster modules
     * Uses detailed engine specifications with PBR textures
     */
    public function generateEngineModules(string $factionCode): array {
        $prompts = [
            'small' => ShipComponentPromptLibrary::getComponentPrompt('engines', $factionCode, 'small'),
            'medium' => ShipComponentPromptLibrary::getComponentPrompt('engines', $factionCode, 'medium'),
            'large' => ShipComponentPromptLibrary::getComponentPrompt('engines', $factionCode, 'large'),
        ];
        
        $prompt = <<<PROMPT
Generate 3 engine/thruster module variants for {$factionCode} faction:

{$prompts['small']}

---

{$prompts['medium']}

---

{$prompts['large']}

Each variant includes heat-damaged nozzles, radiator fins, and faction-specific aesthetic.
Export as separate GLB files with mounting face at base.
PROMPT;
        
        return $this->queueGeneration('engine_modules', $factionCode, $prompt, [
            'component_type' => 'engines',
            'faction_code' => $factionCode,
            'variants' => ['small', 'medium', 'large'],
            'source' => 'ShipComponentPromptLibrary',
        ]);
    }
    
    /**
     * Generate shield generator modules
     * Uses detailed shield specifications
     */
    public function generateShieldModules(string $factionCode): array {
        $prompt = ShipComponentPromptLibrary::getComponentPrompt('shields', $factionCode, 'medium');
        
        return $this->queueGeneration('shield_modules', $factionCode, $prompt, [
            'component_type' => 'shields',
            'faction_code' => $factionCode,
            'source' => 'ShipComponentPromptLibrary',
        ]);
    }
    
    /**
     * Generate sensor/communication array
     * Uses detailed sensor specifications
     */
    public function generateSensorArray(string $factionCode): array {
        $prompt = ShipComponentPromptLibrary::getComponentPrompt('sensors', $factionCode, 'medium');
        
        return $this->queueGeneration('sensor_array', $factionCode, $prompt, [
            'component_type' => 'sensors',
            'faction_code' => $factionCode,
            'source' => 'ShipComponentPromptLibrary',
        ]);
    }
    
    /**
     * Queue a generation job for async processing
     */
    private function queueGeneration(
        string $componentType,
        string $factionCode,
        string $prompt,
        array $metadata
    ): array {
        try {
            $result = $this->trellis2->generateText2Model($prompt, ['sync' => false]);
            
            if (isset($result['error'])) {
                return [
                    'success' => false,
                    'error' => $result['error'],
                ];
            }
            
            $jobId = $result['job_id'] ?? null;
            if (!$jobId) {
                return [
                    'success' => false,
                    'error' => 'No job_id returned from TRELLIS2',
                ];
            }
            
            // Store in database for tracking
            $stmt = $this->db->prepare(
                'INSERT INTO trellis2_generation_queue 
                 (job_id, component_type, faction_code, prompt, metadata, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())'
            );
            $stmt->execute([
                $jobId,
                $componentType,
                $factionCode,
                $prompt,
                json_encode($metadata),
                'queued',
            ]);
            
            return [
                'success' => true,
                'job_id' => $jobId,
                'component_type' => $componentType,
                'faction_code' => $factionCode,
            ];
        } catch (\Exception $e) {
            error_log("[BaseShipComponentGenerator] Generation error: " . $e->getMessage());
            return [
                'success' => false,
                'error' => $e->getMessage(),
            ];
        }
    }
    
    /**
     * Poll and finalize a generation job
     */
    public function finalizeJob(string $jobId): array {
        try {
            // Check status
            $status = $this->trellis2->getJobStatus($jobId);
            
            if ($status['status'] !== 'done') {
                return [
                    'complete' => false,
                    'status' => $status['status'] ?? 'unknown',
                    'progress' => $status['progress'] ?? 0,
                ];
            }
            
            // Get output
            $glbBuffer = $this->trellis2->getJobOutput($jobId);
            if (!$glbBuffer) {
                return [
                    'complete' => false,
                    'error' => 'Failed to retrieve GLB output',
                ];
            }
            
            // Store GLB in filesystem
            $storagePath = $this->getStoragePath($jobId);
            file_put_contents($storagePath, $glbBuffer);
            
            // Update database
            $stmt = $this->db->prepare(
                'UPDATE trellis2_generation_queue 
                 SET status = ?, glb_path = ?, completed_at = NOW()
                 WHERE job_id = ?'
            );
            $stmt->execute(['completed', $storagePath, $jobId]);
            
            return [
                'complete' => true,
                'glb_path' => $storagePath,
                'file_size' => filesize($storagePath),
            ];
        } catch (\Exception $e) {
            error_log("[BaseShipComponentGenerator] Finalization error: " . $e->getMessage());
            return [
                'complete' => false,
                'error' => $e->getMessage(),
            ];
        }
    }
    
    /**
     * Get all cached components for a faction
     */
    public function getCachedComponents(string $factionCode): array {
        $stmt = $this->db->prepare(
            'SELECT component_type, glb_path, metadata, completed_at
             FROM trellis2_generation_queue
             WHERE faction_code = ? AND status = ?
             ORDER BY component_type'
        );
        $stmt->execute([$factionCode, 'completed']);
        
        $components = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $row) {
            $type = $row['component_type'];
            $components[$type] = [
                'glb_path' => $row['glb_path'],
                'metadata' => json_decode($row['metadata'], true),
                'cached_at' => $row['completed_at'],
            ];
        }
        
        return $components;
    }
    
    // ─ Helper methods ──────────────────────────────────────────────────────
    
    private function getSignatureForFaction(string $factionCode): array {
        $signatures = [
            'vor_tak' => [
                'faction_name' => "Vor'Tak",
                'silhouette' => 'wedge-based, heavily armored, front-heavy',
                'materials' => 'dark industrial metals, bone plating, bronze accents',
                'color_primary' => '#8B4513',
                'color_secondary' => '#C0C0C0',
                'accent_color' => '#FF6600',
                'signature_parts' => ['jaw_bridge', 'dorsal_spine', 'armor_scales'],
            ],
            'syl_nar' => [
                'faction_name' => "Syl'Nar",
                'silhouette' => 'soft orbital, flowing curves, tentacle-like',
                'materials' => 'translucent shells, bioluminescent veins, glossy',
                'color_primary' => '#4169E1',
                'color_secondary' => '#7FFFD4',
                'accent_color' => '#00FF00',
                'signature_parts' => ['halo_tentacles', 'lumen_veins', 'tide_fins'],
            ],
            'aereth' => [
                'faction_name' => 'Aereth',
                'silhouette' => 'sleek crystalline, angular precision',
                'materials' => 'polished crystals, energy conduits, luminous edges',
                'color_primary' => '#2288EE',
                'color_secondary' => '#FFFFFF',
                'accent_color' => '#FFD700',
                'signature_parts' => ['crystal_core', 'energy_vanes', 'sensor_crown'],
            ],
            // ... other factions
        ];
        
        return $signatures[$factionCode] ?? $signatures['vor_tak'];
    }
    
    private function getStoragePath(string $jobId): string {
        $dir = realpath(__DIR__ . '/../generated/trellis2/components') ?: '';
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        return "{$dir}/{$jobId}.glb";
    }
}

// ────────────────────────────────────────────────────────────────────────────

/**
 * Species Avatar Generator
 * Creates 3D avatars for each playable species
 */
final class SpeciesAvatarGenerator {
    
    private TRELLIS2Client $trellis2;
    private PDO $db;
    
    public function __construct(PDO $db, ?TRELLIS2Client $trellis2 = null) {
        $this->db = $db;
        $this->trellis2 = $trellis2 ?? new TRELLIS2Client();
    }
    
    /**
     * Generate 3D avatar for a species (both genders)
     */
    public function generateSpeciesAvatar(string $speciesCode, string $gender = 'both'): array {
        $speciesProfile = $this->getSpeciesProfile($speciesCode);
        
        $genders = $gender === 'both' ? ['male', 'female'] : [$gender];
        $results = [];
        
        foreach ($genders as $g) {
            $prompt = $this->buildAvatarPrompt($speciesProfile, $g);
            $result = $this->queueGeneration('avatar', $speciesCode, $g, $prompt);
            $results[$g] = $result;
        }
        
        return $results;
    }
    
    /**
     * Build TRELLIS2 prompt for species avatar
     */
    private function buildAvatarPrompt(array $speciesProfile, string $gender): string {
        $colors = $speciesProfile[$gender . '_colors'] ?? $speciesProfile['colors'];
        
        return <<<PROMPT
Generate a detailed 3D character avatar for the {$speciesProfile['display_name']} species.

BIOTYPE: {$gender}

PHYSICAL DESCRIPTION:
Form: {$speciesProfile['form']}
Head: {$speciesProfile['head_description']}
Body: {$speciesProfile['body_description']}
Limbs: {$speciesProfile['limbs_description']}

VISUAL PALETTE:
Primary Color: {$colors['primary']}
Secondary Color: {$colors['secondary']}
Accent Color: {$colors['accent']}
Texture Style: {$speciesProfile['texture_style']}

OUTPUT REQUIREMENTS:
- Full body character mesh (T-pose, arms to sides)
- Height: ~1.8 meters (human reference)
- Include head, torso, arms, legs
- Smooth proportions for game engine
- 5,000-8,000 triangles budget
- Embedded materials with PBR workflow

Gender-specific features:
{$gender === 'male' ? '- More angular, defined musculature' : '- Curves emphasized, flowing elegance'}
- Distinct silhouette from opposite gender

Export as GLB with all materials embedded.
PROMPT;
    }
    
    private function queueGeneration(
        string $type,
        string $speciesCode,
        string $gender,
        string $prompt
    ): array {
        try {
            $result = $this->trellis2->generateText2Model($prompt, ['sync' => false]);
            
            if (isset($result['error'])) {
                return ['success' => false, 'error' => $result['error']];
            }
            
            $jobId = $result['job_id'] ?? null;
            if (!$jobId) {
                return ['success' => false, 'error' => 'No job_id from TRELLIS2'];
            }
            
            $stmt = $this->db->prepare(
                'INSERT INTO trellis2_generation_queue 
                 (job_id, component_type, faction_code, metadata, status, created_at)
                 VALUES (?, ?, ?, ?, ?, NOW())'
            );
            $stmt->execute([
                $jobId,
                'avatar',
                $speciesCode,
                json_encode(['species_code' => $speciesCode, 'gender' => $gender]),
                'queued',
            ]);
            
            return [
                'success' => true,
                'job_id' => $jobId,
                'species_code' => $speciesCode,
                'gender' => $gender,
            ];
        } catch (\Exception $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }
    
    private function getSpeciesProfile(string $speciesCode): array {
        // In production, load from species_profiles table
        $profiles = [
            'vor_tak' => [
                'display_name' => "Vor'Tak",
                'form' => 'Reptilian bipedal, scaled, powerful frame',
                'head_description' => 'Wedge-shaped, prominent jaw, ridge eyes',
                'body_description' => 'Muscular torso with segmented armor-like scales',
                'limbs_description' => 'Strong legs, clawed hands, tail vestigial',
                'male_colors' => ['primary' => '#8B4513', 'secondary' => '#DAA520', 'accent' => '#FFD700'],
                'female_colors' => ['primary' => '#654321', 'secondary' => '#B8860B', 'accent' => '#FF8C00'],
                'texture_style' => 'Rough scales with metallic bronze sheen',
            ],
            'syl_nar' => [
                'display_name' => "Syl'Nar",
                'form' => 'Cephalopod-inspired, graceful, flowing',
                'head_description' => 'Bulbous with chromatophore patterns, bioluminescent spots',
                'body_description' => 'Smooth, tapered torso with muscle definition',
                'limbs_description' => 'Eight flowing tentacle-like appendages',
                'male_colors' => ['primary' => '#1E90FF', 'secondary' => '#4169E1', 'accent' => '#00FF7F'],
                'female_colors' => ['primary' => '#7FFFD4', 'secondary' => '#00CED1', 'accent' => '#20B2AA'],
                'texture_style' => 'Iridescent skin with bioluminescent accents',
            ],
            // ... other species
        ];
        
        return $profiles[$speciesCode] ?? $profiles['vor_tak'];
    }
}

// ────────────────────────────────────────────────────────────────────────────
// API Endpoint Handler
// ────────────────────────────────────────────────────────────────────────────

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    $action = $_GET['action'] ?? '';
    $uid = require_auth();
    $db = get_db();
    
    try {
        switch ($action) {
            case 'status':
                only_method('GET');
                $trellis2 = new TRELLIS2Client();
                $health = $trellis2->healthCheck();
                json_ok([
                    'trellis2_ready' => $health,
                    'status' => $health ? 'operational' : 'unavailable',
                    'timestamp' => date('c'),
                ]);
                break;
            
            case 'generate_base_hull':
                only_method('POST');
                $body = json_decode(file_get_contents('php://input'), true);
                $factionCode = $body['faction_code'] ?? '';
                if (!$factionCode) {
                    return json_error('faction_code required', 400);
                }
                $generator = new BaseShipComponentGenerator($db);
                $result = $generator->generateBaseHull($factionCode);
                json_ok($result);
                break;
            
            case 'generate_components':
                only_method('POST');
                $body = json_decode(file_get_contents('php://input'), true);
                $factionCode = $body['faction_code'] ?? '';
                $componentType = $body['component_type'] ?? 'all';
                
                $generator = new BaseShipComponentGenerator($db);
                $results = [];
                
                if ($componentType === 'all' || $componentType === 'hull') {
                    $results['hull'] = $generator->generateBaseHull($factionCode);
                }
                if ($componentType === 'all' || $componentType === 'weapons') {
                    $results['weapons'] = $generator->generateWeaponHardpoints($factionCode);
                }
                if ($componentType === 'all' || $componentType === 'engines') {
                    $results['engines'] = $generator->generateEngineModules($factionCode);
                }
                if ($componentType === 'all' || $componentType === 'shields') {
                    $results['shields'] = $generator->generateShieldModules($factionCode);
                }
                if ($componentType === 'all' || $componentType === 'sensors') {
                    $results['sensors'] = $generator->generateSensorArray($factionCode);
                }
                
                json_ok(['generation_jobs' => $results]);
                break;
            
            case 'generation_status':
                only_method('GET');
                $jobId = $_GET['job_id'] ?? '';
                if (!$jobId) {
                    return json_error('job_id required', 400);
                }
                
                $generator = new BaseShipComponentGenerator($db);
                $result = $generator->finalizeJob($jobId);
                json_ok($result);
                break;
            
            case 'base_components':
                only_method('GET');
                $factionCode = $_GET['faction_code'] ?? '';
                if (!$factionCode) {
                    return json_error('faction_code required', 400);
                }
                
                $generator = new BaseShipComponentGenerator($db);
                $components = $generator->getCachedComponents($factionCode);
                json_ok(['components' => $components]);
                break;
            
            case 'generate_avatar':
                only_method('POST');
                $body = json_decode(file_get_contents('php://input'), true);
                $speciesCode = $body['species_code'] ?? '';
                $gender = $body['gender'] ?? 'both';
                
                $generator = new SpeciesAvatarGenerator($db);
                $result = $generator->generateSpeciesAvatar($speciesCode, $gender);
                json_ok(['avatar_jobs' => $result]);
                break;
            
            default:
                json_error("Unknown action: $action", 400);
        }
    } catch (\Exception $e) {
        error_log("TRELLIS2Generator error: " . $e->getMessage());
        json_error("Internal server error", 500);
    }
}
?>
