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
    private const SHAPE_GENERATOR_NODE = "Trellis2ShapeGenerator";
    private const DECODE_LATENTS_NODE = "Trellis2DecodeLatents";
    private const RECONSTRUCT_MESH_NODE = "Trellis2ReconstructMeshWithQuad";
    private const SIMPLIFY_MESH_NODE = "Trellis2SimplifyMesh";
    private const FILL_HOLES_NODE = "Trellis2FillHolesNicelyWithMeshlib";
    private const MESH_TO_TRIMESH_NODE = "Trellis2MeshWithVoxelToTrimesh";
    
    /**
     * Build text-to-3D workflow using Trellis2SparseGenerator
     */
    public static function buildTextTo3DWorkflow(string $prompt, array $params = []): array {
        $params = self::mergeParams($params, [
            'image_path' => self::findFallbackPromptImageName(),
            'seed' => 0,
            'max_views' => 1,
            'sparse_structure_steps' => 12,
            'sparse_structure_guidance_strength' => 7.5,
            'sparse_structure_guidance_rescale' => 0.01,
            'sparse_structure_rescale_t' => 5,
            'sparse_structure_sampler' => 'heun',
            'sparse_structure_resolution' => 32,
            'sparse_structure_guidance_interval_start' => 0.1,
            'sparse_structure_guidance_interval_end' => 1.0,
            'fill_holes' => true,
            'hole_iterations' => 1,
            'verbose' => false,
            'dino_lock' => 1,
            'dino_substeps' => 8,
            'hole_fill_algorithm' => 'flood_fill',
            'dino_foundation_cap' => 1,
            'keep_only_shell' => true,
            'shape_resolution' => 1024,
            'shape_steps' => 12,
            'shape_guidance_strength' => 7.5,
            'shape_guidance_rescale' => 0.01,
            'shape_rescale_t' => 3,
            'shape_sampler' => 'heun',
            'shape_guidance_interval_start' => 0.1,
            'shape_guidance_interval_end' => 1.0,
            'shape_verbose' => false,
            'shape_dino_lock' => 0.0,
            'shape_dino_substeps' => 4,
            'shape_dino_foundation_cap' => 1,
            'use_tiled_decoder' => true,
            'reconstruct_remesh_band' => 1.0,
            'reconstruct_resolution' => 1024,
            'reconstruct_remove_floaters' => true,
            'reconstruct_remove_inner_faces' => true,
            'simplify_target_face_num' => 500000,
            'simplify_method' => 'Cumesh',
            'trimesh_reorient_vertices' => '90 degrees',
            'filename_prefix' => 'GalaxyQuest/Trellis2',
            'file_format' => 'glb',
        ]);

        $nodeIds = [
            'load_model' => 1,
            'load_image' => 2,
            'preprocess_image' => 3,
            'image_cond' => 4,
            'sparse_generator' => 5,
            'shape_generator' => 6,
            'decode_latents' => 7,
            'reconstruct_mesh' => 8,
            'simplify_mesh' => 9,
            'fill_holes' => 10,
            'simplify_mesh_2' => 11,
            'mesh_to_trimesh' => 12,
            'export_mesh' => 13,
        ];

        $workflow = [
            $nodeIds['load_model'] => [
                'class_type' => self::LOAD_MODEL_NODE,
                'inputs' => [
                    'modelname' => 'microsoft/TRELLIS.2-4B',
                    'backend' => 'sdpa',
                    'device' => 'cuda',
                    'low_vram' => true,
                    'keep_models_loaded' => false,
                    'conv_backend' => 'flex_gemm',
                    'sparse_backend' => 'sdpa',
                    'use_reconviagen' => false,
                ],
            ],
            $nodeIds['load_image'] => [
                'class_type' => self::LOAD_IMAGE_NODE,
                'inputs' => [
                    'image' => self::normalizeComfyInputImage($params['image_path']),
                ],
            ],
            $nodeIds['preprocess_image'] => [
                'class_type' => self::PREPROCESS_IMAGE_NODE,
                'inputs' => [
                    // Trellis2PreProcessImage expects an alpha-capable tensor; use image_with_alpha output.
                    'image' => [$nodeIds['load_image'], 2],
                    'padding' => 0,
                    'remove_background' => false,
                    'max_size' => 2048,
                ],
            ],
            $nodeIds['image_cond'] => [
                'class_type' => self::IMAGE_COND_GENERATOR_NODE,
                'inputs' => [
                    'pipeline' => [$nodeIds['load_model'], 0],
                    'image' => [$nodeIds['preprocess_image'], 0],
                    'max_views' => $params['max_views'],
                ],
            ],
            $nodeIds['sparse_generator'] => [
                'class_type' => self::SPARSE_GENERATOR_NODE,
                'inputs' => [
                    'pipeline' => [$nodeIds['image_cond'], 2],
                    'image_cond' => [$nodeIds['image_cond'], 0],
                    'seed' => $params['seed'],
                    'sparse_structure_steps' => $params['sparse_structure_steps'],
                    'sparse_structure_guidance_strength' => $params['sparse_structure_guidance_strength'],
                    'sparse_structure_guidance_rescale' => $params['sparse_structure_guidance_rescale'],
                    'sparse_structure_rescale_t' => $params['sparse_structure_rescale_t'],
                    'sparse_structure_sampler' => $params['sparse_structure_sampler'],
                    'sparse_structure_resolution' => $params['sparse_structure_resolution'],
                    'sparse_structure_guidance_interval_start' => $params['sparse_structure_guidance_interval_start'],
                    'sparse_structure_guidance_interval_end' => $params['sparse_structure_guidance_interval_end'],
                    'fill_holes' => $params['fill_holes'],
                    'hole_iterations' => $params['hole_iterations'],
                    'verbose' => $params['verbose'],
                    'dino_lock' => $params['dino_lock'],
                    'dino_substeps' => $params['dino_substeps'],
                    'hole_fill_algorithm' => $params['hole_fill_algorithm'],
                    'dino_foundation_cap' => $params['dino_foundation_cap'],
                    'keep_only_shell' => $params['keep_only_shell'],
                ],
            ],
            $nodeIds['shape_generator'] => [
                'class_type' => self::SHAPE_GENERATOR_NODE,
                'inputs' => [
                    'pipeline' => [$nodeIds['sparse_generator'], 2],
                    'image_cond' => [$nodeIds['image_cond'], 1],
                    'coords' => [$nodeIds['sparse_generator'], 0],
                    'resolution' => $params['shape_resolution'],
                    'shape_steps' => $params['shape_steps'],
                    'shape_guidance_strength' => $params['shape_guidance_strength'],
                    'shape_guidance_rescale' => $params['shape_guidance_rescale'],
                    'shape_rescale_t' => $params['shape_rescale_t'],
                    'shape_sampler' => $params['shape_sampler'],
                    'shape_guidance_interval_start' => $params['shape_guidance_interval_start'],
                    'shape_guidance_interval_end' => $params['shape_guidance_interval_end'],
                    'verbose' => $params['shape_verbose'],
                    'dino_lock' => $params['shape_dino_lock'],
                    'dino_substeps' => $params['shape_dino_substeps'],
                    'dino_foundation_cap' => $params['shape_dino_foundation_cap'],
                ],
            ],
            $nodeIds['decode_latents'] => [
                'class_type' => self::DECODE_LATENTS_NODE,
                'inputs' => [
                    'pipeline' => [$nodeIds['shape_generator'], 2],
                    'shape_slat' => [$nodeIds['shape_generator'], 0],
                    'resolution' => [$nodeIds['shape_generator'], 1],
                    'use_tiled_decoder' => $params['use_tiled_decoder'],
                ],
            ],
            $nodeIds['reconstruct_mesh'] => [
                'class_type' => self::RECONSTRUCT_MESH_NODE,
                'inputs' => [
                    'mesh' => [$nodeIds['decode_latents'], 0],
                    'remesh_band' => $params['reconstruct_remesh_band'],
                    'resolution' => $params['reconstruct_resolution'],
                    'remove_floaters' => $params['reconstruct_remove_floaters'],
                    'remove_inner_faces' => $params['reconstruct_remove_inner_faces'],
                ],
            ],
            $nodeIds['simplify_mesh'] => [
                'class_type' => self::SIMPLIFY_MESH_NODE,
                'inputs' => [
                    'mesh' => [$nodeIds['reconstruct_mesh'], 0],
                    'target_face_num' => $params['simplify_target_face_num'],
                    'method' => $params['simplify_method'],
                ],
            ],
            $nodeIds['fill_holes'] => [
                'class_type' => self::FILL_HOLES_NODE,
                'inputs' => [
                    'mesh' => [$nodeIds['simplify_mesh'], 0],
                ],
            ],
            $nodeIds['simplify_mesh_2'] => [
                'class_type' => self::SIMPLIFY_MESH_NODE,
                'inputs' => [
                    'mesh' => [$nodeIds['fill_holes'], 0],
                    'target_face_num' => $params['simplify_target_face_num'],
                    'method' => $params['simplify_method'],
                ],
            ],
            $nodeIds['mesh_to_trimesh'] => [
                'class_type' => self::MESH_TO_TRIMESH_NODE,
                'inputs' => [
                    'mesh' => [$nodeIds['simplify_mesh_2'], 0],
                    'reorient_vertices' => $params['trimesh_reorient_vertices'],
                ],
            ],
            $nodeIds['export_mesh'] => [
                'class_type' => self::EXPORT_MESH_NODE,
                'inputs' => [
                    'trimesh' => [$nodeIds['mesh_to_trimesh'], 0],
                    'filename_prefix' => $params['filename_prefix'],
                    'file_format' => $params['file_format'],
                ],
            ],
        ];

        return self::normalizeWorkflowNodeIds($workflow);
    }
    
    /**
     * Build image-to-3D workflow using Trellis2ImageCondGenerator
     */
    public static function buildImageTo3DWorkflow(string $imagePath, array $params = []): array {
        $params['image_path'] = self::normalizeComfyInputImage($imagePath);
        return self::buildTextTo3DWorkflow('', $params);
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
        $params['image_path'] = self::normalizeComfyInputImage($imagePath);
        return self::buildTextTo3DWorkflow($refinementPrompt, $params);
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
        $baseWorkflow[$exportNodeId]['inputs']['trimesh'] = $inputMesh;
        
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

    private static function findFallbackPromptImageName(): string {
        $candidates = [
            __DIR__ . '/../generated/comfyui/input/trellis2_rgba_seed.png',
            __DIR__ . '/../generated/comfyui/input/input_6a7065114ad0b_1785750801.png',
            __DIR__ . '/../generated/comfyui/input/input_6a70651b8e023_1785750811.png',
            __DIR__ . '/../generated/comfyui/input/input_6a70683e655f7_1785751614.png',
            __DIR__ . '/../generated/comfyui/input/input_6a70683e69f8a_1785751614.png',
        ];

        foreach ($candidates as $candidate) {
            if (is_file($candidate)) {
                return basename($candidate);
            }
        }

        return 'input_6a7065114ad0b_1785750801.png';
    }

    private static function normalizeComfyInputImage(string $imagePath): string {
        $normalized = str_replace('\\\\', '/', $imagePath);
        if (strpos($normalized, '/') !== false) {
            return basename($normalized);
        }
        return $normalized;
    }

    /**
     * ComfyUI expects prompt node IDs as string keys, and link references as
     * ["node_id", output_index]. Using integer node references can trigger
     * KeyError during prompt validation.
     */
    private static function normalizeWorkflowNodeIds(array $workflow): array {
        $normalized = [];

        foreach ($workflow as $nodeId => $node) {
            $stringNodeId = (string) $nodeId;

            if (isset($node['inputs']) && is_array($node['inputs'])) {
                foreach ($node['inputs'] as $inputKey => $inputValue) {
                    if (
                        is_array($inputValue)
                        && array_key_exists(0, $inputValue)
                        && array_key_exists(1, $inputValue)
                        && is_scalar($inputValue[0])
                        && is_int($inputValue[1])
                    ) {
                        $node['inputs'][$inputKey] = [(string) $inputValue[0], $inputValue[1]];
                    }
                }
            }

            $normalized[$stringNodeId] = $node;
        }

        return $normalized;
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
