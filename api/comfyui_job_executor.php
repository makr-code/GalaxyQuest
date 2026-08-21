<?php
/**
 * ComfyUI Job Executor for TRELLIS2 3D Generation Daemon
 * 
 * Purpose: Submit and monitor ComfyUI workflow jobs for 3D model generation
 * 
 * Integration with daemon_trellis2_jobs_v2.php:
 *  1. submitComfyUIJob() - Submit workflow to ComfyUI API
 *  2. checkComfyUIJob() - Monitor job progress via WebSocket queue
 *  3. extractComfyUIOutput() - Get GLB file path from completed job
 * 
 * Workflow:
 *  1. Daemon fetches job from DB with job_type='comfyui'
 *  2. Builds workflow JSON via ComfyUIWorkflowBuilder
 *  3. Submits to ComfyUI via HTTP POST to /api/prompt
 *  4. ComfyUI returns prompt_id (queue number)
 *  5. Stores prompt_id in metadata JSON
 *  6. Next cycle: Checks job_history for prompt_id completion
 *  7. On completion: Extracts GLB path, updates DB status='completed'
 */

class ComfyUIJobExecutor {
    
    private string $comfyuiUrl;
    private int $timeout;
    
    /**
     * @param string $comfyuiUrl Base URL to ComfyUI server (e.g., http://comfyui:8188)
     * @param int $timeout HTTP timeout in seconds (default: 30)
     */
    public function __construct(string $comfyuiUrl = "http://comfyui:8188", int $timeout = 30) {
        $this->comfyuiUrl = rtrim($comfyuiUrl, '/');
        $this->timeout = $timeout;
    }
    
    /**
     * Submit ComfyUI workflow job
     * 
     * @param array $workflow Workflow JSON (from ComfyUIWorkflowBuilder)
     * @param string $clientId Optional client ID for WebSocket tracking
     * 
     * @return array ['ok' => bool, 'prompt_id' => string, 'error' => string]
     */
    public function submitWorkflow(array $workflow, string $clientId = ""): array {
        if (empty($clientId)) {
            $clientId = uniqid('comfyui_', true);
        }
        
        $payload = [
            'prompt' => $workflow,
            'client_id' => $clientId,
        ];
        
        $ch = curl_init($this->comfyuiUrl . '/api/prompt');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode($payload),
        ]);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        
        if ($curlError) {
            return [
                'ok' => false,
                'prompt_id' => null,
                'error' => "cURL error: $curlError",
            ];
        }
        
        if ($httpCode !== 200) {
            return [
                'ok' => false,
                'prompt_id' => null,
                'error' => "HTTP $httpCode: $response",
            ];
        }
        
        $result = json_decode($response, true);
        if (!isset($result['prompt_id'])) {
            return [
                'ok' => false,
                'prompt_id' => null,
                'error' => "Missing prompt_id in response: $response",
            ];
        }
        
        return [
            'ok' => true,
            'prompt_id' => $result['prompt_id'],
            'client_id' => $clientId,
        ];
    }
    
    /**
     * Check job completion via job history
     * 
     * @param string $promptId Prompt ID from submitWorkflow
     * 
     * @return array [
     *     'ok' => bool,
     *     'status' => 'pending|processing|completed|failed',
     *     'progress' => float (0.0-1.0),
     *     'output_path' => string (if completed),
     *     'error' => string (if failed),
     * ]
     */
    public function checkJobProgress(string $promptId): array {
        // Get system stats for current queue status
        $ch = curl_init($this->comfyuiUrl . '/system_stats');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeout,
        ]);
        
        $statsResponse = curl_exec($ch);
        $statsCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        if ($statsCode !== 200) {
            return [
                'ok' => false,
                'status' => 'unknown',
                'error' => "Could not reach ComfyUI system stats",
            ];
        }
        
        $stats = json_decode($statsResponse, true);
        
        // Get job history to check if prompt completed
        $ch = curl_init($this->comfyuiUrl . '/history/' . urlencode($promptId));
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeout,
        ]);
        
        $historyResponse = curl_exec($ch);
        $historyCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        // 404 = prompt not found yet (still in queue)
        // 200 = prompt found with results
        
        if ($historyCode === 404) {
            // Still in queue or processing
            $queueSize = $stats['queue_pending'][0] ?? 0;
            $progress = $queueSize > 0 ? min(0.5, 0.1 + (0.4 * ($queueSize / 10))) : 0.1;
            
            return [
                'ok' => true,
                'status' => 'processing',
                'progress' => $progress,
                'queue_position' => $queueSize,
            ];
        }
        
        if ($historyCode !== 200) {
            return [
                'ok' => false,
                'status' => 'unknown',
                'error' => "HTTP $historyCode fetching job history",
            ];
        }
        
        // Parse history - it's an object with prompt_id as key
        $history = json_decode($historyResponse, true);
        
        if (!isset($history[$promptId])) {
            return [
                'ok' => true,
                'status' => 'processing',
                'progress' => 0.5,
            ];
        }
        
        $jobHistory = $history[$promptId];
        
        // Check if there were errors
        if (isset($jobHistory['outputs'])) {
            // Job completed - find output file (GLB)
            $output = $jobHistory['outputs'];
            
            // TRELLIS2 nodes output to /workspace/output/
            // Look for GLB file in outputs
            if (isset($output['images']) && !empty($output['images'])) {
                $outputFile = $output['images'][0]['filename'] ?? null;
                
                return [
                    'ok' => true,
                    'status' => 'completed',
                    'progress' => 1.0,
                    'output_file' => $outputFile,
                    'output_path' => $this->comfyuiUrl . '/view/' . urlencode($outputFile),
                ];
            }
            
            // Some outputs might be in different format
            // Look for any generated files
            foreach ($output as $key => $value) {
                if (is_array($value) && isset($value['filename'])) {
                    return [
                        'ok' => true,
                        'status' => 'completed',
                        'progress' => 1.0,
                        'output_file' => $value['filename'],
                        'output_path' => $this->comfyuiUrl . '/view/' . urlencode($value['filename']),
                    ];
                }
            }
            
            // Output found but no specific file
            return [
                'ok' => true,
                'status' => 'completed',
                'progress' => 1.0,
            ];
        }
        
        // Check for errors
        if (isset($jobHistory['outputs']) === false && isset($jobHistory['errors'])) {
            return [
                'ok' => false,
                'status' => 'failed',
                'error' => implode('; ', (array)$jobHistory['errors']),
            ];
        }
        
        // Still processing
        return [
            'ok' => true,
            'status' => 'processing',
            'progress' => 0.75,
        ];
    }
    
    /**
     * Cancel a job (remove from queue)
     * 
     * @param string $promptId Prompt ID to cancel
     * 
     * @return array ['ok' => bool, 'error' => string]
     */
    public function cancelJob(string $promptId): array {
        $ch = curl_init($this->comfyuiUrl . '/api/interrupt');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_POST => true,
        ]);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        
        if ($curlError || $httpCode !== 200) {
            return [
                'ok' => false,
                'error' => "Failed to cancel: $curlError (HTTP $httpCode)",
            ];
        }
        
        return ['ok' => true];
    }
    
    /**
     * Get ComfyUI system info and queue status
     * 
     * @return array ['ok' => bool, 'stats' => array, 'queue' => array]
     */
    public function getSystemStatus(): array {
        $ch = curl_init($this->comfyuiUrl . '/system_stats');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeout,
        ]);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        
        if ($curlError || $httpCode !== 200) {
            return [
                'ok' => false,
                'error' => "ComfyUI unavailable: $curlError (HTTP $httpCode)",
            ];
        }
        
        $stats = json_decode($response, true);
        
        return [
            'ok' => true,
            'system' => [
                'gpu_memory' => $stats['system'][0] ?? null,
                'ram_memory' => $stats['system'][1] ?? null,
            ],
            'queue' => [
                'pending' => $stats['queue_pending'][0] ?? 0,
                'executing' => $stats['queue_pending'][1] ?? 0,
            ],
        ];
    }
}

/**
 * Usage in daemon_trellis2_jobs_v2.php:
 * 
 * // Initialize executor
 * $comfyui = new ComfyUIJobExecutor('http://comfyui:8188');
 * 
 * // Build and submit workflow
 * require_once 'api/comfyui_workflow_builder.php';
 * $workflow = ComfyUIWorkflowBuilder::buildTextTo3DWorkflow($prompt, $params);
 * $result = $comfyui->submitWorkflow($workflow);
 * 
 * if ($result['ok']) {
 *     // Store prompt_id in DB metadata
 *     $metadata['comfyui_prompt_id'] = $result['prompt_id'];
 *     $db->query("UPDATE generation_queue SET metadata = ? WHERE id = ?",
 *         json_encode($metadata), $queueId);
 * }
 * 
 * // Check progress in next daemon cycle
 * $progress = $comfyui->checkJobProgress($promptId);
 * if ($progress['status'] === 'completed') {
 *     // Extract GLB path and mark as completed
 *     $db->query("UPDATE generation_queue SET status = ?, updated_at = ? WHERE id = ?",
 *         'completed', date('Y-m-d H:i:s'), $queueId);
 * }
 */
