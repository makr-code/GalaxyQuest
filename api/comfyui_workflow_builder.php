<?php
/**
 * ComfyUI Workflow Builder for TRELLIS2 3D Generation
 * 
 * Purpose: Generate ComfyUI workflow JSON for text/image/hybrid 3D generation
 * with full TRELLIS2 parameter exposure via custom nodes
 * 
 * Modes:
 *  - text_to_3d: Text prompt → 3D model
 *  - image_to_3d: Image → 3D model
 *  - hybrid: Image + refinement prompt → 3D model
 */

class ComfyUIWorkflowBuilder {
    
    // TRELLIS2 actual node class names
    private const LOAD_MODEL_NODE = "Trellis2LoadModel";
    private const SPARSE_GENERATOR_NODE = "Trellis2SparseGenerator";
    private const IMAGE_COND_GENERATOR_NODE = "Trellis2ImageCondGenerator";
    private const LOAD_IMAGE_NODE = "Trellis2LoadImageWithTransparency";
    private const PREPROCESS_IMAGE_NODE = "Trellis2PreProcessImage";
    private const VOXEL_TO_MESH_NODE = "Trellis2VoxelToMesh";
    private const EXPORT_MESH_NODE = "Trellis2ExportMesh";
    private const OVOXEL_EXPORT_GLB_NODE = "Trellis2OvoxelExportToGLB";
    
    /**
     * Build text-to-3D workflow using Trellis2SparseGenerator
     */
    public static function buildTextTo3DWorkflow(string $prompt, array $params = []): array {
        $params = self::mergeParams($params, [
            'seed' => 0,
            'num_steps' => 30,
            'guidance_strength' => 7.5,
            'simplify_level' => 0.95,
        ]);
        
        // Node IDs for workflow DAG
        $nodeIds = [
            'load_model' => 1,
            'generator' => 2,
            'voxel_to_mesh' => 3,
            'export_mesh' => 4,
        ];
        
        return [
            // Load TRELLIS2 model
            $nodeIds['load_model'] => [
                'class_type' => self::LOAD_MODEL_NODE,
                'inputs' => [
                    'model' => 'trellis-1.3b',  // Model variant
                ],
            ],
            // Text-to-3D generation (sparse)
            $nodeIds['generator'] => [
                'class_type' => self::SPARSE_GENERATOR_NODE,
                'inputs' => [
                    'model' => [$nodeIds['load_model'], 0],
                    'prompt' => $prompt,
                    'seed' => $params['seed'],
                    'steps' => $params['num_steps'],
                    'guidance_strength' => $params['guidance_strength'],
                ],
            ],
            // Convert voxels to mesh
            $nodeIds['voxel_to_mesh'] => [
                'class_type' => self::VOXEL_TO_MESH_NODE,
                'inputs' => [
                    'voxels' => [$nodeIds['generator'], 0],
                    'simplify_level' => $params['simplify_level'],
                ],
            ],
            // Export as GLB
            $nodeIds['export_mesh'] => [
                'class_type' => self::EXPORT_MESH_NODE,
                'inputs' => [
                    'mesh' => [$nodeIds['voxel_to_mesh'], 0],
                    'format' => 'glb',
                    'filename' => 'model.glb',
                ],
            ],
        ];
    }
    
    /**
     * Build image-to-3D workflow using Trellis2ImageCondGenerator
     */
    public static function buildImageTo3DWorkflow(string $imagePath, array $params = []): array {
        $params = self::mergeParams($params, [
            'seed' => 0,
            'num_steps' => 30,
            'guidance_strength' => 7.5,
            'simplify_level' => 0.95,
        ]);
        
        $nodeIds = [
            'load_model' => 1,
            'load_image' => 2,
            'preprocess_image' => 3,
            'generator' => 4,
            'voxel_to_mesh' => 5,
            'export_mesh' => 6,
        ];
        
        return [
            $nodeIds['load_model'] => [
                'class_type' => self::LOAD_MODEL_NODE,
                'inputs' => [
                    'model' => 'trellis-1.3b',
                ],
            ],
            $nodeIds['load_image'] => [
                'class_type' => self::LOAD_IMAGE_NODE,
                'inputs' => [
                    'image' => $imagePath,
                ],
            ],
            $nodeIds['preprocess_image'] => [
                'class_type' => self::PREPROCESS_IMAGE_NODE,
                'inputs' => [
                    'image' => [$nodeIds['load_image'], 0],
                    'bg_threshold' => 10,
                    'remove_background' => true,
                    'output_size' => 1024,
                ],
            ],
            $nodeIds['generator'] => [
                'class_type' => self::IMAGE_COND_GENERATOR_NODE,
                'inputs' => [
                    'model' => [$nodeIds['load_model'], 0],
                    'image' => [$nodeIds['preprocess_image'], 0],
                    'seed' => $params['seed'],
                    'steps' => $params['num_steps'],
                    'guidance_strength' => $params['guidance_strength'],
                ],
            ],
            $nodeIds['voxel_to_mesh'] => [
                'class_type' => self::VOXEL_TO_MESH_NODE,
                'inputs' => [
                    'voxels' => [$nodeIds['generator'], 0],
                    'simplify_level' => $params['simplify_level'],
                ],
            ],
            $nodeIds['export_mesh'] => [
                'class_type' => self::EXPORT_MESH_NODE,
                'inputs' => [
                    'mesh' => [$nodeIds['voxel_to_mesh'], 0],
                    'format' => 'glb',
                    'filename' => 'model.glb',
                ],
            ],
        ];
    }
    
    /**
     * Build hybrid workflow (Image base + Text refinement)
     * Generates 3D from image, then tries to refine based on text prompt
     */
    public static function buildHybridWorkflow(
        string $imagePath, 
        string $refinementPrompt = "", 
        array $params = []
    ): array {
        $params = self::mergeParams($params, [
            'seed' => 0,
            'num_steps' => 30,
            'guidance_strength' => 7.5,
            'simplify_level' => 0.95,
        ]);
        
        // For hybrid: start with image, then apply sparse text generation for refinement
        $nodeIds = [
            'load_model' => 1,
            'load_image' => 2,
            'preprocess_image' => 3,
            'image_generator' => 4,
            'text_generator' => 5,
            'voxel_to_mesh' => 6,
            'export_mesh' => 7,
        ];
        
        return [
            $nodeIds['load_model'] => [
                'class_type' => self::LOAD_MODEL_NODE,
                'inputs' => [
                    'model' => 'trellis-1.3b',
                ],
            ],
            // Load and preprocess image
            $nodeIds['load_image'] => [
                'class_type' => self::LOAD_IMAGE_NODE,
                'inputs' => [
                    'image' => $imagePath,
                ],
            ],
            $nodeIds['preprocess_image'] => [
                'class_type' => self::PREPROCESS_IMAGE_NODE,
                'inputs' => [
                    'image' => [$nodeIds['load_image'], 0],
                    'bg_threshold' => 10,
                    'remove_background' => true,
                    'output_size' => 1024,
                ],
            ],
            // Image-based generation
            $nodeIds['image_generator'] => [
                'class_type' => self::IMAGE_COND_GENERATOR_NODE,
                'inputs' => [
                    'model' => [$nodeIds['load_model'], 0],
                    'image' => [$nodeIds['preprocess_image'], 0],
                    'seed' => $params['seed'],
                    'steps' => $params['num_steps'],
                    'guidance_strength' => $params['guidance_strength'],
                ],
            ],
            // For hybrid: use text refinement if provided (or just use image as-is)
            // For now, we'll just use the image output directly
            // In a full implementation, we'd apply the refinement text somehow
            $nodeIds['voxel_to_mesh'] => [
                'class_type' => self::VOXEL_TO_MESH_NODE,
                'inputs' => [
                    'voxels' => [$nodeIds['image_generator'], 0],
                    'simplify_level' => $params['simplify_level'],
                ],
            ],
            $nodeIds['export_mesh'] => [
                'class_type' => self::EXPORT_MESH_NODE,
                'inputs' => [
                    'mesh' => [$nodeIds['voxel_to_mesh'], 0],
                    'format' => 'glb',
                    'filename' => 'model.glb',
                ],
            ],
        ];
    }
    
    /**
     * Build workflow with post-processing options
     * 
     * ComfyUI-TRELLIS2 includes post-processing nodes:
     *  - TRELLIS2RemeshSimplify
     *  - TRELLIS2FillHoles
     *  - TRELLIS2Smooth
     *  - TRELLIS2ProjectTexture
     * 
     * @param array $baseWorkflow Output from buildTextTo3DWorkflow, etc.
     * @param array $postProcessing Post-processing options:
     *   - fill_holes: bool (default: true)
     *   - smooth: bool (default: true)
     *   - smooth_iterations: int (default: 3)
     *   - remesh: bool (default: false)
     *   - remesh_target_count: int (default: 50000)
     * 
     * @return array Enhanced workflow with post-processing nodes
     */
    public static function addPostProcessing(array $baseWorkflow, array $postProcessing = []): array {
        $pp = self::mergeParams($postProcessing, [
            'fill_holes' => true,
            'smooth' => true,
            'smooth_iterations' => 3,
            'remesh' => false,
            'remesh_target_count' => 50000,
        ]);
        
        $maxNodeId = max(array_keys($baseWorkflow));
        $nextNodeId = $maxNodeId + 1;
        $inputMesh = [$maxNodeId - 1, 0];  // Previous voxels_to_mesh output
        $nodeIds = [];
        
        // Fill holes post-processing
        if ($pp['fill_holes']) {
            $nodeIds['fill_holes'] = $nextNodeId;
            $baseWorkflow[$nextNodeId] = [
                'class_type' => 'TRELLIS2FillHoles',
                'inputs' => [
                    'mesh' => $inputMesh,
                    'fill_threshold' => 0.1,
                ],
            ];
            $inputMesh = [$nextNodeId, 0];
            $nextNodeId++;
        }
        
        // Smooth post-processing
        if ($pp['smooth']) {
            $nodeIds['smooth'] = $nextNodeId;
            $baseWorkflow[$nextNodeId] = [
                'class_type' => 'TRELLIS2Smooth',
                'inputs' => [
                    'mesh' => $inputMesh,
                    'iterations' => $pp['smooth_iterations'],
                    'lambda' => 0.1,
                    'mu' => -0.1,
                ],
            ];
            $inputMesh = [$nextNodeId, 0];
            $nextNodeId++;
        }
        
        // Remesh for optimization
        if ($pp['remesh']) {
            $nodeIds['remesh'] = $nextNodeId;
            $baseWorkflow[$nextNodeId] = [
                'class_type' => 'TRELLIS2RemeshSimplify',
                'inputs' => [
                    'mesh' => $inputMesh,
                    'target_count' => $pp['remesh_target_count'],
                ],
            ];
            $inputMesh = [$nextNodeId, 0];
            $nextNodeId++;
        }
        
        // Update final export node to use post-processed mesh
        $exportNodeId = max(array_keys($baseWorkflow));
        $baseWorkflow[$exportNodeId]['inputs']['mesh'] = $inputMesh;
        
        return $baseWorkflow;
    }
    
    /**
     * Validate workflow JSON structure
     * 
     * @param array $workflow Workflow to validate
     * @return bool True if valid, throws exception otherwise
     */
    public static function validateWorkflow(array $workflow): bool {
        if (empty($workflow)) {
            throw new \Exception("Workflow cannot be empty");
        }
        
        foreach ($workflow as $nodeId => $node) {
            if (!isset($node['class_type'])) {
                throw new \Exception("Node $nodeId missing class_type");
            }
            if (!isset($node['inputs'])) {
                throw new \Exception("Node $nodeId missing inputs");
            }
        }
        
        return true;
    }
    
    /**
     * Convert workflow to JSON string for API submission
     * 
     * @param array $workflow Workflow array
     * @return string JSON string
     */
    public static function toJson(array $workflow): string {
        return json_encode($workflow, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    }
    
    /**
     * Merge user params with defaults
     * 
     * @param array $userParams User-provided parameters
     * @param array $defaults Default parameters
     * @return array Merged parameters
     */
    private static function mergeParams(array $userParams, array $defaults): array {
        foreach ($defaults as $key => $value) {
            if (!isset($userParams[$key])) {
                $userParams[$key] = $value;
            }
        }
        return $userParams;
    }
}

/**
 * API Endpoint: POST /api/comfyui_execute.php
 * 
 * Usage:
 * 
 *   Text-to-3D:
 *   POST /api/comfyui_execute.php?mode=text
 *   {
 *       "prompt": "A red sphere",
 *       "seed": 42,
 *       "steps": 50
 *   }
 *   
 *   Image-to-3D:
 *   POST /api/comfyui_execute.php?mode=image
 *   {
 *       "image_path": "/workspace/input/model.png",
 *       "seed": 42
 *   }
 *   
 *   Hybrid:
 *   POST /api/comfyui_execute.php?mode=hybrid
 *   {
 *       "image_path": "/workspace/input/model.png",
 *       "refinement_prompt": "Make it shinier",
 *       "refinement_strength": 0.5
 *   }
 * 
 * Response:
 *   {
 *       "ok": true,
 *       "queue_id": "12345",
 *       "workflow": {...},
 *       "status": "queued"
 *   }
 */

// Handler when this file is called directly (HTTP only, not from CLI daemon)
if (!php_sapi_name() === 'cli-server' && !defined('SKIP_HTTP_HANDLER') && $_SERVER['REQUEST_METHOD'] ?? null === 'POST') {
    header('Content-Type: application/json');
    
    try {
        $mode = $_GET['mode'] ?? 'text';
        $input = json_decode(file_get_contents('php://input'), true) ?? [];  // Default to empty array if null
        
        $workflow = null;
        
        switch ($mode) {
            case 'text':
                $prompt = $input['prompt'] ?? 'A 3D model';
                $workflow = ComfyUIWorkflowBuilder::buildTextTo3DWorkflow($prompt, $input);
                break;
                
            case 'image':
                $imagePath = $input['image_path'] ?? throw new \Exception("Missing image_path");
                $workflow = ComfyUIWorkflowBuilder::buildImageTo3DWorkflow($imagePath, $input);
                break;
                
            case 'hybrid':
                $imagePath = $input['image_path'] ?? throw new \Exception("Missing image_path");
                $refinement = $input['refinement_prompt'] ?? '';
                $workflow = ComfyUIWorkflowBuilder::buildHybridWorkflow($imagePath, $refinement, $input);
                break;
                
            default:
                throw new \Exception("Unknown mode: $mode");
        }
        
        // Add post-processing if requested
        if (isset($input['post_processing'])) {
            $workflow = ComfyUIWorkflowBuilder::addPostProcessing($workflow, $input['post_processing']);
        }
        
        // Validate workflow
        ComfyUIWorkflowBuilder::validateWorkflow($workflow);
        
        // Output workflow
        echo json_encode([
            'ok' => true,
            'mode' => $mode,
            'workflow' => $workflow,
            'workflow_json' => ComfyUIWorkflowBuilder::toJson($workflow),
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        
    } catch (\Exception $e) {
        http_response_code(400);
        echo json_encode([
            'ok' => false,
            'error' => $e->getMessage(),
        ]);
    }
}
