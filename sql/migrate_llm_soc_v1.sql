-- GalaxyQuest - LLM SoC model migration v1
-- Adds prompt-profile persistence and request logging.

USE galaxyquest;

CREATE TABLE IF NOT EXISTS llm_prompt_profiles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    profile_key VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    description TEXT NOT NULL,
    system_prompt MEDIUMTEXT NOT NULL,
    user_template MEDIUMTEXT NOT NULL,
    input_schema_json JSON DEFAULT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    source VARCHAR(32) NOT NULL DEFAULT 'db',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_llm_prompt_profiles_active (active, profile_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS llm_request_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    profile_key VARCHAR(64) NOT NULL,
    model VARCHAR(128) NOT NULL,
    prompt_hash CHAR(64) NOT NULL,
    prompt_preview TEXT NOT NULL,
    response_preview MEDIUMTEXT NOT NULL,
    latency_ms INT NOT NULL DEFAULT 0,
    status ENUM('ok','error') NOT NULL DEFAULT 'ok',
    error_message VARCHAR(512) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_llm_request_log_user_time (user_id, created_at),
    INDEX idx_llm_request_log_profile_time (profile_key, created_at),
    INDEX idx_llm_request_log_status_time (status, created_at)
) ENGINE=InnoDB;
