-- Initialize ship designer tables
SET FOREIGN_KEY_CHECKS=0;

DROP TABLE IF EXISTS asset_generations;
DROP TABLE IF EXISTS generation_queue;
DROP TABLE IF EXISTS vessel_designs;

SET FOREIGN_KEY_CHECKS=1;

CREATE TABLE vessel_designs (
    design_id VARCHAR(16) NOT NULL PRIMARY KEY,
    user_id VARCHAR(64),
    faction_code VARCHAR(50),
    design_name VARCHAR(255),
    customizations LONGTEXT,
    description LONGTEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE generation_queue (
    queue_id VARCHAR(16) NOT NULL PRIMARY KEY,
    design_id VARCHAR(16),
    user_id VARCHAR(64),
    prompt_text LONGTEXT,
    status VARCHAR(20) DEFAULT 'pending',
    generation_id VARCHAR(16),
    priority INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE asset_generations (
    generation_id VARCHAR(16) NOT NULL PRIMARY KEY,
    user_id VARCHAR(64),
    design_id VARCHAR(16),
    queue_id VARCHAR(16),
    model_path VARCHAR(500),
    status VARCHAR(20) DEFAULT 'pending',
    metadata LONGTEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;
