-- GalaxyQuest - TRELLIS2 Asset Management Integration v1
-- Adds database schema for user designs, asset generation, and quota management
-- Safe to run multiple times (uses CREATE TABLE IF NOT EXISTS, etc.)

USE galaxyquest;

-- ─────────────────────────────────────────────────────────────────────────────
-- VESSEL DESIGNS: User customizations + enhancement history
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vessel_designs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    design_name VARCHAR(255) NOT NULL,
    
    -- Reference to species template (YAML, not copied to DB)
    species_code VARCHAR(64) NOT NULL,
    
    -- Filesystem reference to immutable JSON design state
    design_json_path VARCHAR(255) NOT NULL,      -- generated/designs/{user_id}/{id}_{timestamp}.json
    design_json_hash VARCHAR(64),                 -- SHA-256 hash of design JSON for deduplication
    
    -- Serialized customization state
    customizations_json JSON,                     -- {"carapace_color": "#2d5f4f", "detail_level": 85, ...}
    enhancement_history_json JSON,                -- Array of applied enhancements with timestamps
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT DEFAULT 1,
    is_public TINYINT(1) DEFAULT 0,
    description TEXT,
    
    -- Link to latest generated 3D asset (if exists)
    latest_generation_id BIGINT,
    
    -- Lifecycle
    is_deleted TINYINT(1) DEFAULT 0,
    deleted_at TIMESTAMP NULL,
    
    -- Search & indexing
    INDEX idx_user_designs (user_id, created_at),
    INDEX idx_user_species (user_id, species_code),
    INDEX idx_design_hash (design_json_hash),
    INDEX idx_public_designs (is_public, created_at),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────────────────
-- ASSET GENERATIONS: TRELLIS2 output jobs and 3D model metadata
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_generations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    
    -- Job lifecycle
    generation_uuid VARCHAR(36) UNIQUE NOT NULL,     -- UUID for directory naming
    status ENUM('queued', 'processing', 'complete', 'failed') DEFAULT 'queued',
    
    -- Relationship to design
    vessel_design_id BIGINT,                          -- Parent design (can be NULL for orphaned assets)
    user_id INT NOT NULL,
    
    -- TRELLIS2 Prompt (immutable record)
    prompt_text LONGTEXT NOT NULL,
    prompt_hash VARCHAR(64) UNIQUE,                   -- SHA-256 for deduplication
    
    -- Output file paths (stored on filesystem, not in DB)
    glb_path VARCHAR(255),                            -- generated/trellis2/models/{generation_uuid}/model.glb
    glb_file_size BIGINT DEFAULT 0,                   -- For quota tracking
    thumbnail_path VARCHAR(255),                      -- ...model.thumbnail.png (Web display)
    texture_pack_path VARCHAR(255),                   -- Optional: textures.zip or individual .png files
    
    -- Model metadata (extracted from GLB)
    metadata_json JSON,                               -- {width_cm, height_cm, triangle_count, material_count, ...}
    
    -- Generation parameters
    trellis2_model_variant VARCHAR(64),               -- 'text-base' | 'text-large' | 'image-to-3d'
    generation_time_ms INT,                           -- Time taken for TRELLIS2 to generate
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    queued_at TIMESTAMP NULL,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    
    -- Audit trail
    ip_address VARCHAR(45),
    user_agent VARCHAR(512),
    
    -- Error handling
    error_message TEXT,
    retry_count SMALLINT DEFAULT 0,
    max_retries SMALLINT DEFAULT 3,
    
    -- Lifecycle
    is_deleted TINYINT(1) DEFAULT 0,
    deleted_at TIMESTAMP NULL,
    
    -- Search & indexing
    INDEX idx_status (status, created_at),
    INDEX idx_user_status (user_id, status),
    INDEX idx_prompt_hash (prompt_hash),
    INDEX idx_generation_uuid (generation_uuid),
    INDEX idx_vessel_design (vessel_design_id),
    INDEX idx_completed (completed_at DESC),
    
    FOREIGN KEY (vessel_design_id) REFERENCES vessel_designs(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Add foreign key if it doesn't already exist
-- (This constraint is added after both tables are created to maintain referential integrity)
SET @fk_exists = 0;
SELECT COUNT(*) INTO @fk_exists FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
WHERE TABLE_NAME = 'vessel_designs' AND CONSTRAINT_NAME = 'fk_vessel_latest_generation';

-- Only add the constraint if it doesn't already exist
IF @fk_exists = 0 THEN
  ALTER TABLE vessel_designs 
  ADD CONSTRAINT fk_vessel_latest_generation 
  FOREIGN KEY (latest_generation_id) 
  REFERENCES asset_generations(id) 
  ON DELETE SET NULL;
END IF;

-- ─────────────────────────────────────────────────────────────────────────────
-- GENERATION QUEUE: Async job queue for TRELLIS2 worker processing
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS generation_queue (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    
    -- Job status
    status ENUM('queued', 'processing', 'complete', 'failed') DEFAULT 'queued',
    priority SMALLINT DEFAULT 0,
    
    -- What to generate
    user_id INT NOT NULL,
    vessel_design_id BIGINT,
    prompt_text LONGTEXT NOT NULL,
    
    -- Worker tracking
    worker_id VARCHAR(64),                        -- Which container/worker is processing this
    container_instance VARCHAR(128),              -- Docker container name/ID
    
    -- Timing
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    estimated_completion_ms INT,                 -- ETA based on model size
    
    -- Result reference (once complete)
    generation_id BIGINT,
    
    -- Error handling
    error_message TEXT,
    retry_count SMALLINT DEFAULT 0,
    max_retries SMALLINT DEFAULT 3,
    
    -- Search & indexing
    INDEX idx_status_priority (status, priority, created_at),
    INDEX idx_user_queued (user_id, status),
    INDEX idx_worker (worker_id, status),
    INDEX idx_generation_id (generation_id),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (vessel_design_id) REFERENCES vessel_designs(id) ON DELETE CASCADE,
    FOREIGN KEY (generation_id) REFERENCES asset_generations(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────────────────
-- CACHED ASSETS: Fast retrieval for common/preview assets (no re-generation needed)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cached_assets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    asset_type ENUM('species_base', 'component_base', 'enhancement_preview', 'faction_ship') NOT NULL,
    
    -- Unique key for this cached asset combination
    -- e.g., SHA-256 of (species_code="kryltha" + enhancement_pattern="bioluminescence_glow" + params={...})
    cache_key_hash VARCHAR(64) UNIQUE NOT NULL,
    
    -- Filesystem paths
    asset_path VARCHAR(255) NOT NULL,            -- generated/trellis2/cache/{type}/{cache_key_hash}.glb
    thumbnail_path VARCHAR(255),                 -- ...cache/{cache_key_hash}.thumbnail.png
    
    -- Metadata for display
    metadata_json JSON,                          -- {width, height, triangles, ...}
    
    -- Cache lifecycle
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL,                   -- TTL for automatic eviction
    hit_count INT DEFAULT 0,                      -- For popularity/retention metrics
    
    -- Search & indexing
    INDEX idx_asset_type (asset_type),
    INDEX idx_expires (expires_at),
    INDEX idx_popularity (asset_type, hit_count DESC)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────────────────
-- USER ASSET QUOTAS: Storage and generation limits per user
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_asset_quotas (
    user_id INT PRIMARY KEY,
    
    -- Storage quota (in GB)
    storage_limit_gb DECIMAL(5,2) DEFAULT 5.0,
    storage_used_gb DECIMAL(12,4) DEFAULT 0,
    storage_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Monthly generation quota
    monthly_generation_limit INT DEFAULT 100,
    monthly_generations_used INT DEFAULT 0,
    monthly_reset_at TIMESTAMP,
    
    -- Generation queue priority (higher = faster processing)
    priority_level ENUM('free', 'supporter', 'premium', 'admin') DEFAULT 'free',
    
    -- Lifecycle
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_priority (priority_level),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Populate quotas for existing users
INSERT IGNORE INTO user_asset_quotas (user_id)
SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM user_asset_quotas);

-- ─────────────────────────────────────────────────────────────────────────────
-- GENERATION AUDIT LOG: Immutable history for compliance and debugging
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS generation_audit_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    
    -- Event metadata
    event_type ENUM('queued', 'started', 'completed', 'failed', 'retried', 'cancelled') NOT NULL,
    
    -- References
    generation_id BIGINT,
    queue_id BIGINT,
    vessel_design_id BIGINT,
    user_id INT,
    
    -- Event details
    event_message TEXT,
    event_data_json JSON,                        -- {worker_id, container, duration_ms, ...}
    
    -- Timestamp
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Search & indexing
    INDEX idx_generation (generation_id, created_at),
    INDEX idx_user (user_id, created_at),
    INDEX idx_event_type (event_type, created_at),
    
    FOREIGN KEY (generation_id) REFERENCES asset_generations(id) ON DELETE CASCADE,
    FOREIGN KEY (queue_id) REFERENCES generation_queue(id) ON DELETE CASCADE,
    FOREIGN KEY (vessel_design_id) REFERENCES vessel_designs(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER VIEWS: Common queries made easy
-- ─────────────────────────────────────────────────────────────────────────────

-- User designs with latest generation status
CREATE OR REPLACE VIEW v_user_designs_with_status AS
SELECT 
    vd.id,
    vd.user_id,
    vd.design_name,
    vd.species_code,
    vd.created_at,
    vd.updated_at,
    ag.id AS generation_id,
    ag.status AS generation_status,
    ag.glb_path,
    ag.thumbnail_path,
    ag.completed_at
FROM vessel_designs vd
LEFT JOIN asset_generations ag ON vd.latest_generation_id = ag.id
WHERE vd.is_deleted = 0;

-- Pending work in queue
CREATE OR REPLACE VIEW v_generation_queue_status AS
SELECT 
    gq.id,
    gq.user_id,
    gq.status,
    gq.priority,
    gq.created_at,
    gq.estimated_completion_ms,
    COUNT(*) OVER (PARTITION BY gq.status) AS count_in_status,
    ROW_NUMBER() OVER (ORDER BY gq.priority DESC, gq.created_at ASC) AS queue_position
FROM generation_queue gq
WHERE gq.status IN ('queued', 'processing');

-- User storage utilization
CREATE OR REPLACE VIEW v_user_storage_usage AS
SELECT 
    u.id AS user_id,
    u.username,
    uaq.storage_limit_gb,
    uaq.storage_used_gb,
    ROUND(100.0 * uaq.storage_used_gb / uaq.storage_limit_gb, 1) AS percent_used,
    ROUND(uaq.storage_limit_gb - uaq.storage_used_gb, 2) AS storage_remaining_gb,
    COUNT(DISTINCT vd.id) AS design_count,
    COUNT(DISTINCT ag.id) AS generation_count
FROM users u
LEFT JOIN user_asset_quotas uaq ON u.id = uaq.user_id
LEFT JOIN vessel_designs vd ON u.id = vd.user_id AND vd.is_deleted = 0
LEFT JOIN asset_generations ag ON u.id = ag.user_id AND ag.is_deleted = 0
GROUP BY u.id, u.username, uaq.storage_limit_gb, uaq.storage_used_gb;

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES FOR PERFORMANCE
-- ─────────────────────────────────────────────────────────────────────────────

-- Commonly needed: "Show me all generations for a user, most recent first"
CREATE INDEX IF NOT EXISTS idx_generations_user_time 
ON asset_generations(user_id, completed_at);

-- "Show me queue backlog by priority"
CREATE INDEX IF NOT EXISTS idx_queue_priority_time 
ON generation_queue(priority, created_at);

-- "Find design by hash for deduplication"
CREATE INDEX IF NOT EXISTS idx_design_hash_status 
ON vessel_designs(design_json_hash, is_deleted);

-- Cache hit optimization
CREATE INDEX IF NOT EXISTS idx_cache_hit_type 
ON cached_assets(asset_type, hit_count);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGERS FOR MAINTENANCE
-- ─────────────────────────────────────────────────────────────────────────────

-- Update user quota storage when generation completes
DELIMITER $$

CREATE TRIGGER IF NOT EXISTS trg_update_storage_on_generation_complete
AFTER UPDATE ON asset_generations
FOR EACH ROW
BEGIN
    IF NEW.status = 'complete' AND OLD.status != 'complete' AND NEW.glb_file_size > 0 THEN
        UPDATE user_asset_quotas
        SET storage_used_gb = storage_used_gb + (NEW.glb_file_size / 1024.0 / 1024.0 / 1024.0),
            storage_updated_at = NOW()
        WHERE user_id = NEW.user_id;
    END IF;
END$$

-- Update user monthly generation count
CREATE TRIGGER IF NOT EXISTS trg_update_monthly_generations
AFTER INSERT ON asset_generations
FOR EACH ROW
BEGIN
    IF NEW.status = 'complete' THEN
        UPDATE user_asset_quotas
        SET monthly_generations_used = monthly_generations_used + 1
        WHERE user_id = NEW.user_id;
    END IF;
END$$

-- Audit log on generation completion
CREATE TRIGGER IF NOT EXISTS trg_audit_generation_complete
AFTER UPDATE ON asset_generations
FOR EACH ROW
BEGIN
    IF NEW.status = 'complete' AND OLD.status != 'complete' THEN
        INSERT INTO generation_audit_log (
            event_type, generation_id, user_id, event_message, event_data_json
        ) VALUES (
            'completed',
            NEW.id,
            NEW.user_id,
            CONCAT('Generation completed in ', NEW.generation_time_ms, 'ms'),
            JSON_OBJECT(
                'glb_size_bytes', NEW.glb_file_size,
                'generation_time_ms', NEW.generation_time_ms,
                'model_variant', NEW.trellis2_model_variant
            )
        );
    END IF;
END$$

DELIMITER ;

-- ─────────────────────────────────────────────────────────────────────────────
-- FINAL VERIFICATION
-- ─────────────────────────────────────────────────────────────────────────────

-- Show created tables
SELECT 
    TABLE_NAME,
    TABLE_ROWS AS estimated_rows,
    ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'vessel_designs',
    'asset_generations',
    'generation_queue',
    'cached_assets',
    'user_asset_quotas',
    'generation_audit_log'
)
ORDER BY TABLE_NAME;
