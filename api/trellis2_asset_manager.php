<?php
/**
 * TRELLIS2 Asset Manager
 * 
 * Handles vessel design lifecycle:
 * - Creating/loading user designs
 * - Queuing 3D generation jobs
 * - Tracking generation status
 * - Managing quotas and storage
 * 
 * Usage:
 *   $manager = new TRELLIS2AssetManager($db);
 *   $design = $manager->createDesign($user_id, 'kryltha', $customizations);
 *   $job_id = $manager->queueGeneration($design['id']);
 *   $status = $manager->getGenerationStatus($job_id);
 */
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

final class TRELLIS2AssetManager {
    
    private PDO $db;
    private string $designsBasePath;
    private int $maxRetries = 3;

    public function __construct(
        PDO $db,
        ?string $designsBasePath = null
    ) {
        $this->db = $db;
        $this->designsBasePath = $designsBasePath ?? __DIR__ . '/../generated/designs';
    }
    
    /**
     * Create a new vessel design for a user
     * 
     * @param int $user_id
     * @param string $species_code (e.g., 'kryltha', 'sylnar')
     * @param array $customizations {carapace_color, detail_level, ...}
     * @param string $design_name
     * @return array{id: int, design_json_path: string}
     */
    public function createDesign(
        int $user_id,
        string $species_code,
        array $customizations = [],
        string $design_name = 'Unnamed Design'
    ): array {
        // Validate user exists
        $stmt = $this->db->prepare('SELECT id FROM users WHERE id = ?');
        $stmt->execute([$user_id]);
        if (!$stmt->fetch()) {
            throw new \InvalidArgumentException("User {$user_id} not found");
        }
        
        // Create design JSON structure
        $designState = [
            'species_code' => $species_code,
            'customizations' => $customizations,
            'enhancement_history' => [],
            'created_at' => date('c'),
            'version' => 1,
        ];
        
        // Save to filesystem
        $timestamp = date('YmdHis');
        $designPath = "{$this->designsBasePath}/{$user_id}/{$design_name}_{$timestamp}.json";
        
        $designDirectory = dirname($designPath);
        if (!is_dir($designDirectory) && !mkdir($designDirectory, 0755, true) && !is_dir($designDirectory)) {
            throw new \RuntimeException('Failed to create vessel design storage directory');
        }

        $designJson = json_encode($designState, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        if ($designJson === false || file_put_contents($designPath, $designJson) === false) {
            throw new \RuntimeException('Failed to write vessel design file');
        }
        
        // Calculate JSON hash for deduplication
        $designHash = hash('sha256', json_encode($designState, JSON_UNESCAPED_SLASHES));
        
        // Store in database
        $stmt = $this->db->prepare(
            'INSERT INTO vessel_designs
             (user_id, design_name, species_code, design_json_path, design_json_hash, customizations_json, enhancement_history_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        
        $stmt->execute([
            $user_id,
            $design_name,
            $species_code,
            $designPath,
            $designHash,
            json_encode($customizations),
            json_encode([]),
        ]);
        
        $designId = (int)$this->db->lastInsertId();
        
        return [
            'id' => $designId,
            'design_json_path' => $designPath,
            'design_json_hash' => $designHash,
        ];
    }
    
    /**
     * Load existing design from database
     */
    public function getDesign(int $design_id, ?int $user_id = null): array
    {
        $query = 'SELECT * FROM vessel_designs WHERE id = ? AND is_deleted = 0';
        $params = [$design_id];
        if ($user_id !== null) {
            $query .= ' AND user_id = ?';
            $params[] = $user_id;
        }

        $stmt = $this->db->prepare($query);
        $stmt->execute($params);
        $design = $stmt->fetch(\PDO::FETCH_ASSOC);
        
        if (!$design) {
            throw new \OutOfBoundsException("Design {$design_id} not found");
        }

        return $design;
    }
    
    /**
     * Queue a 3D generation job for a design
     * 
     * @param int $design_id
     * @param string $prompt_text TRELLIS2-formatted prompt
     * @param int $priority Higher = processed sooner
     * @return int Queue ID for polling
     */
    public function queueGeneration(
        int $design_id,
        string $prompt_text,
        int $priority = 0
    ): int {
        $design = $this->getDesign($design_id);
        $user_id = (int)$design['user_id'];
        
        // Check user quota
        $this->validateQuota($user_id);
        
        // Calculate prompt hash for deduplication
        $promptHash = hash('sha256', $prompt_text);
        
        // Check if this prompt was already generated
        $stmt = $this->db->prepare(
            'SELECT id FROM asset_generations 
             WHERE prompt_hash = ? AND status = "complete" AND is_deleted = 0 
             LIMIT 1'
        );
        $stmt->execute([$promptHash]);
        $existingGen = $stmt->fetch(\PDO::FETCH_ASSOC);
        
        if ($existingGen) {
            // Cache hit: reuse existing generation
            $generationId = (int)$existingGen['id'];
            
            // Update vessel_designs to point to this generation
            $stmt = $this->db->prepare(
                'UPDATE vessel_designs SET latest_generation_id = ? WHERE id = ?'
            );
            $stmt->execute([$generationId, $design_id]);
            
            error_log("[TRELLIS2AssetManager] Cache hit for prompt hash {$promptHash} → generation {$generationId}");
            return $generationId;
        }
        
        // No cache hit: queue new generation
        $stmt = $this->db->prepare(
            'INSERT INTO generation_queue
             (user_id, vessel_design_id, prompt_text, prompt_hash, status, priority)
             VALUES (?, ?, ?, ?, "queued", ?)'
        );
        
        $stmt->execute([
            $user_id,
            $design_id,
            $prompt_text,
            $promptHash,
            $priority,
        ]);
        
        $queueId = (int)$this->db->lastInsertId();
        
        // Log audit event
        $this->logAuditEvent('queued', null, $queueId, $design_id, $user_id, 'Generation queued');
        
        error_log("[TRELLIS2AssetManager] Queued generation for design {$design_id}, queue_id={$queueId}");
        return $queueId;
    }
    
    /**
     * Get generation queue position and estimated completion
     */
    public function getQueueStatus(int $queue_id, int $user_id): array {
        $stmt = $this->db->prepare(
            'SELECT
                queue.id, queue.status, queue.priority, queue.created_at,
                queue.estimated_completion_ms, queue.generation_id, queue.error_message,
                CASE
                    WHEN queue.status = \'queued\' THEN 1 + (
                        SELECT COUNT(*)
                        FROM generation_queue AS ahead
                        WHERE ahead.status = \'queued\'
                          AND (
                              ahead.priority > queue.priority
                              OR (
                                  ahead.priority = queue.priority
                                  AND (
                                      ahead.created_at < queue.created_at
                                      OR (
                                          ahead.created_at = queue.created_at
                                          AND ahead.id < queue.id
                                      )
                                  )
                              )
                          )
                    )
                    ELSE 0
                END AS queue_position,
                (
                    SELECT COUNT(*)
                    FROM generation_queue AS active
                    WHERE active.status IN (\'queued\', \'processing\')
                ) AS total_in_queue
             FROM generation_queue AS queue
             WHERE queue.id = ? AND queue.user_id = ?'
        );
        $stmt->execute([$queue_id, $user_id]);
        return $stmt->fetch(\PDO::FETCH_ASSOC) ?? [];
    }
    
    /**
     * Get generation status (from asset_generations table)
     */
    public function getGenerationStatus(int $generation_id, int $user_id): array {
        $stmt = $this->db->prepare(
            'SELECT 
                id, user_id, generation_uuid, status, glb_path, glb_file_size,
                thumbnail_path, metadata_json,
                generation_time_ms, completed_at, error_message,
                created_at
             FROM asset_generations
             WHERE id = ? AND user_id = ? AND is_deleted = 0'
        );
        $stmt->execute([$generation_id, $user_id]);
        return $stmt->fetch(\PDO::FETCH_ASSOC) ?? [];
    }
    
    /**
     * Register a completed generation (called by worker/GPU service)
     * 
     * @param int $queue_id From generation_queue
     * @param array $result {glb_path, thumbnail_path, metadata, generation_time_ms}
     * @return int generation_id
     */
    public function registerGeneration(int $queue_id, array $result): int {
        // Get queue entry
        $stmt = $this->db->prepare('SELECT * FROM generation_queue WHERE id = ?');
        $stmt->execute([$queue_id]);
        $queueEntry = $stmt->fetch(\PDO::FETCH_ASSOC);
        
        if (!$queueEntry) {
            throw new \RuntimeException("Queue entry {$queue_id} not found");
        }
        
        // Create asset_generations record
        $generationUuid = $result['generation_uuid'] ?? bin2hex(random_bytes(16));
        $glbSize = filesize($result['glb_path'] ?? '') ?: 0;
        
        $stmt = $this->db->prepare(
            'INSERT INTO asset_generations
             (generation_uuid, user_id, vessel_design_id, prompt_text, prompt_hash, 
              glb_path, glb_file_size, thumbnail_path, metadata_json,
              trellis2_model_variant, generation_time_ms, status, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "complete", NOW())'
        );
        
        $stmt->execute([
            $generationUuid,
            $queueEntry['user_id'],
            $queueEntry['vessel_design_id'],
            $queueEntry['prompt_text'],
            $queueEntry['prompt_hash'] ?? hash('sha256', $queueEntry['prompt_text']),
            $result['glb_path'],
            $glbSize,
            $result['thumbnail_path'] ?? null,
            json_encode($result['metadata'] ?? new \stdClass()),
            $result['model_variant'] ?? 'text-base',
            $result['generation_time_ms'] ?? 0,
        ]);
        
        $generationId = (int)$this->db->lastInsertId();
        
        // Update queue entry
        $stmt = $this->db->prepare(
            'UPDATE generation_queue SET status = "complete", generation_id = ? WHERE id = ?'
        );
        $stmt->execute([$generationId, $queue_id]);
        
        // Update vessel_designs to point to new generation
        if ($queueEntry['vessel_design_id']) {
            $stmt = $this->db->prepare(
                'UPDATE vessel_designs SET latest_generation_id = ? WHERE id = ?'
            );
            $stmt->execute([$generationId, $queueEntry['vessel_design_id']]);
        }
        
        // Log audit event
        $this->logAuditEvent('completed', $generationId, $queue_id, 
            $queueEntry['vessel_design_id'], $queueEntry['user_id'], 
            'Generation completed');
        
        error_log("[TRELLIS2AssetManager] Registered generation {$generationId} from queue {$queue_id}");
        return $generationId;
    }
    
    /**
     * Register generation failure and potentially retry
     */
    public function failGeneration(int $queue_id, string $errorMessage): void {
        $stmt = $this->db->prepare(
            'SELECT retry_count, max_retries FROM generation_queue WHERE id = ?'
        );
        $stmt->execute([$queue_id]);
        $entry = $stmt->fetch(\PDO::FETCH_ASSOC);
        
        if (!$entry) return;
        
        $retryCount = (int)$entry['retry_count'] + 1;
        $maxRetries = (int)$entry['max_retries'];
        
        if ($retryCount < $maxRetries) {
            // Retry: reset to queued
            $stmt = $this->db->prepare(
                'UPDATE generation_queue 
                 SET status = "queued", retry_count = ?, error_message = NULL
                 WHERE id = ?'
            );
            $stmt->execute([$retryCount, $queue_id]);
            
            error_log("[TRELLIS2AssetManager] Generation failed, retrying (attempt {$retryCount}/{$maxRetries})");
        } else {
            // Give up: mark as failed
            $stmt = $this->db->prepare(
                'UPDATE generation_queue 
                 SET status = "failed", error_message = ?
                 WHERE id = ?'
            );
            $stmt->execute([$errorMessage, $queue_id]);
            
            error_log("[TRELLIS2AssetManager] Generation failed after {$maxRetries} retries: {$errorMessage}");
        }
    }
    
    /**
     * Get user design list with latest generation status
     */
    public function getUserDesigns(int $user_id, int $limit = 50, int $offset = 0): array {
        $limit = max(1, min(100, $limit));
        $offset = max(0, $offset);
        $stmt = $this->db->prepare(
            'SELECT
                design.id,
                design.user_id,
                design.design_name,
                design.species_code,
                design.created_at,
                design.updated_at,
                generation.id AS generation_id,
                generation.status AS generation_status,
                generation.glb_path,
                generation.thumbnail_path,
                generation.completed_at
             FROM vessel_designs AS design
             LEFT JOIN asset_generations AS generation
                ON design.latest_generation_id = generation.id
                AND generation.user_id = design.user_id
                AND generation.is_deleted = 0
             WHERE design.user_id = ? AND design.is_deleted = 0
             ORDER BY design.created_at DESC
             LIMIT ? OFFSET ?'
        );
        $stmt->bindValue(1, $user_id, \PDO::PARAM_INT);
        $stmt->bindValue(2, $limit, \PDO::PARAM_INT);
        $stmt->bindValue(3, $offset, \PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }
    
    /**
     * Delete design and associated generations
     */
    public function deleteDesign(int $design_id): void {
        $stmt = $this->db->prepare(
            'UPDATE vessel_designs SET is_deleted = 1, deleted_at = NOW() WHERE id = ?'
        );
        $stmt->execute([$design_id]);
        
        // Optionally mark associated generations as deleted too
        $stmt = $this->db->prepare(
            'UPDATE asset_generations SET is_deleted = 1, deleted_at = NOW() 
             WHERE vessel_design_id = ?'
        );
        $stmt->execute([$design_id]);
    }
    
    /**
     * Check if user has quota for generation
     */
    private function validateQuota(int $user_id): void {
        // Ensure quota entry exists
        $stmt = $this->db->prepare(
            'INSERT IGNORE INTO user_asset_quotas (user_id) VALUES (?)'
        );
        $stmt->execute([$user_id]);
        
        // Check monthly generation limit
        $stmt = $this->db->prepare(
            'SELECT monthly_generations_used, monthly_generation_limit
             FROM user_asset_quotas
             WHERE user_id = ?'
        );
        $stmt->execute([$user_id]);
        $quota = $stmt->fetch(\PDO::FETCH_ASSOC);
        
        if ($quota && (int)$quota['monthly_generations_used'] >= (int)$quota['monthly_generation_limit']) {
            throw new \RuntimeException(
                "Monthly generation quota exceeded ({$quota['monthly_generations_used']}/{$quota['monthly_generation_limit']})"
            );
        }
        
        // Check storage quota
        $stmt = $this->db->prepare(
            'SELECT storage_used_gb, storage_limit_gb
             FROM user_asset_quotas
             WHERE user_id = ?'
        );
        $stmt->execute([$user_id]);
        $storage = $stmt->fetch(\PDO::FETCH_ASSOC);
        
        if ($storage && (float)$storage['storage_used_gb'] >= (float)$storage['storage_limit_gb']) {
            throw new \RuntimeException(
                "Storage quota exceeded ({$storage['storage_used_gb']}/{$storage['storage_limit_gb']} GB)"
            );
        }
    }
    
    /**
     * Get user quota and usage statistics
     */
    public function getUserQuota(int $user_id): array {
        $stmt = $this->db->prepare(
            'SELECT
                COALESCE(usage.storage_limit_gb, 5.0) AS storage_limit_gb,
                COALESCE(usage.storage_used_gb, 0) AS storage_used_gb,
                COALESCE(quota.monthly_generation_limit, 100) AS monthly_generation_limit,
                COALESCE(quota.monthly_generations_used, 0) AS monthly_generations_used,
                COALESCE(quota.priority_level, \'free\') AS priority_level,
                usage.design_count,
                usage.generation_count
             FROM v_user_storage_usage AS usage
             LEFT JOIN user_asset_quotas AS quota ON quota.user_id = usage.user_id
             WHERE usage.user_id = ?'
        );
        $stmt->execute([$user_id]);
        $quota = $stmt->fetch(\PDO::FETCH_ASSOC);
        if ($quota === false) {
            throw new \RuntimeException('Quota data unavailable');
        }

        return $quota;
    }
    
    /**
     * Log audit event for compliance/debugging
     */
    private function logAuditEvent(
        string $eventType,
        ?int $generation_id,
        ?int $queue_id,
        ?int $design_id,
        int $user_id,
        string $message
    ): void {
        $stmt = $this->db->prepare(
            'INSERT INTO generation_audit_log
             (event_type, generation_id, queue_id, vessel_design_id, user_id, event_message)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        
        $stmt->execute([$eventType, $generation_id, $queue_id, $design_id, $user_id, $message]);
    }
    
    /**
     * Get generation history for a design
     */
    public function getDesignGenerations(int $design_id, int $user_id): array {
        $stmt = $this->db->prepare(
            'SELECT generation.*
             FROM asset_generations AS generation
             INNER JOIN vessel_designs AS design
                ON design.id = generation.vessel_design_id
                AND design.user_id = generation.user_id
                AND design.is_deleted = 0
             WHERE design.id = ?
               AND design.user_id = ?
               AND generation.user_id = ?
               AND generation.is_deleted = 0
             ORDER BY generation.completed_at DESC'
        );
        $stmt->execute([$design_id, $user_id, $user_id]);
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }
}
