-- GalaxyQuest - Generation Queue v2 Dual-Mode (TRELLIS2 + ComfyUI)
-- Adds views and audit logging for dual-mode support
-- Schema columns already exist from previous migration
-- Safe to run multiple times

USE galaxyquest;

-- ─────────────────────────────────────────────────────────────────────────────
-- Create view for queue status dashboard
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS v_generation_queue_dual_mode;

CREATE VIEW v_generation_queue_dual_mode AS
SELECT 
    id,
    user_id,
    vessel_design_id,
    prompt_text,
    input_mode,
    status,
    JSON_EXTRACT(metadata, '$.job_type') as job_type,
    JSON_EXTRACT(metadata, '$.trellis2_event_id') as trellis2_event_id,
    JSON_EXTRACT(metadata, '$.comfyui_prompt_id') as comfyui_prompt_id,
    JSON_EXTRACT(metadata, '$.type') as generation_type,
    created_at,
    started_at,
    completed_at,
    TIMESTAMPDIFF(SECOND, created_at, COALESCE(completed_at, NOW())) as elapsed_seconds
FROM generation_queue
ORDER BY created_at DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit log for debugging
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS generation_queue_audit (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    queue_id BIGINT NOT NULL,
    action VARCHAR(50) COMMENT 'submitted|status_changed|failed|completed',
    old_status VARCHAR(20),
    new_status VARCHAR(20),
    job_type VARCHAR(20) COMMENT 'trellis2|comfyui',
    event_id VARCHAR(64),
    prompt_id VARCHAR(64),
    metadata_snapshot JSON,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (queue_id) REFERENCES generation_queue(id) ON DELETE CASCADE,
    INDEX idx_queue_time (queue_id, created_at),
    INDEX idx_action_time (action, created_at),
    INDEX idx_job_type (job_type, created_at)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────────────────
-- Success marker
-- ─────────────────────────────────────────────────────────────────────────────

SELECT 
    'Generation Queue v2 Migration Complete ✅' as migration_status,
    COUNT(*) as queue_jobs,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
    COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
    MAX(created_at) as latest_job
FROM generation_queue;
