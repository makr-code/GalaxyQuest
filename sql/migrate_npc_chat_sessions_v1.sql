-- Migration: Create NPC Chat Sessions table for multi-tenant support
-- Purpose: Store conversation history with game context for player-NPC interactions

CREATE TABLE IF NOT EXISTS `npc_chat_sessions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `session_id` VARCHAR(255) NOT NULL UNIQUE COMMENT 'user_X_npc_Y_faction_Z hash',
    `user_id` BIGINT UNSIGNED NOT NULL COMMENT 'Player user ID',
    `npc_id` VARCHAR(100) NOT NULL COMMENT 'NPC identifier (character class + ID)',
    `faction` VARCHAR(100) NOT NULL COMMENT 'NPC faction affiliation',
    `messages_json` LONGTEXT NOT NULL COMMENT 'JSON array of {role, content, timestamp} messages',
    `context_summary` TEXT COMMENT 'Compressed summary of old conversation context',
    `context_depth_override` INT COMMENT 'Optional per-session context depth override',
    `game_context_json` JSON COMMENT 'Last known game state (relations, conflicts, tech level)',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes for efficient querying
    KEY `idx_user_id` (`user_id`),
    KEY `idx_npc_id` (`npc_id`),
    KEY `idx_faction` (`faction`),
    KEY `idx_updated_at` (`updated_at`),
    KEY `idx_user_npc_faction` (`user_id`, `npc_id`, `faction`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Multi-tenant NPC dialogue sessions with caching support';
