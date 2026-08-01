-- Game Guide NPC Database Schema
-- Tracks tutorial progress, help usage, and guide interactions

CREATE TABLE IF NOT EXISTS `game_guide_progress` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `checkpoint_id` VARCHAR(100) NOT NULL,
  `checkpoint_category` VARCHAR(50),
  `completed_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_user_checkpoint` (`user_id`, `checkpoint_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_category` (`checkpoint_category`),
  KEY `idx_completed_at` (`completed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `game_guide_help_usage` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `help_type` VARCHAR(100) NOT NULL,
  `times_used` INT DEFAULT 1,
  `last_used_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_user_help_type` (`user_id`, `help_type`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_help_type` (`help_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `game_guide_interactions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `interaction_type` VARCHAR(100),
  `topic_category` VARCHAR(50),
  `question_asked` TEXT,
  `guide_response` LONGTEXT,
  `player_feedback` ENUM('helpful', 'not_helpful', 'neutral') DEFAULT 'neutral',
  `interaction_duration_seconds` INT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_interaction_type` (`interaction_type`),
  KEY `idx_topic` (`topic_category`),
  KEY `idx_feedback` (`player_feedback`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `game_guide_state` (
  `user_id` INT UNSIGNED NOT NULL PRIMARY KEY,
  `player_level` INT DEFAULT 1,
  `is_new_player` TINYINT(1) DEFAULT 1,
  `tutorial_completed` TINYINT(1) DEFAULT 0,
  `time_played_hours` INT DEFAULT 0,
  `guides_used` INT DEFAULT 0,
  `last_guide_interaction` TIMESTAMP NULL,
  `last_assessment_at` TIMESTAMP NULL,
  `current_issue_critical` VARCHAR(100),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `game_guide_milestones` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `milestone_type` VARCHAR(100) NOT NULL,
  `milestone_data` JSON,
  `reached_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_milestone_type` (`milestone_type`),
  KEY `idx_reached_at` (`reached_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
