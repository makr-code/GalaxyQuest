<?php
/**
 * Database Migration: TRELLIS2 Generation Queue
 * 
 * Usage: php tools/run_migration.php trellis2_generation_queue
 */

return function(PDO $db): bool {
    $sql = <<<SQL
        -- TRELLIS2 Generation Job Queue
        CREATE TABLE IF NOT EXISTS trellis2_generation_queue (
            id INT AUTO_INCREMENT PRIMARY KEY,
            job_id VARCHAR(128) NOT NULL UNIQUE,
            component_type VARCHAR(32) NOT NULL,
            faction_code VARCHAR(32) NOT NULL,
            prompt LONGTEXT,
            metadata JSON,
            status ENUM('queued', 'processing', 'completed', 'failed') DEFAULT 'queued',
            glb_path VARCHAR(255),
            error_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL,
            
            INDEX idx_faction_type (faction_code, component_type),
            INDEX idx_status (status),
            INDEX idx_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        
        -- Base Ship Components (cached)
        CREATE TABLE IF NOT EXISTS base_ship_components (
            id INT AUTO_INCREMENT PRIMARY KEY,
            faction_code VARCHAR(32) NOT NULL UNIQUE,
            component_type VARCHAR(32) NOT NULL,
            glb_path VARCHAR(255) NOT NULL,
            glb_cache_key VARCHAR(64),
            metadata JSON,
            version INT DEFAULT 1,
            checksum VARCHAR(64),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            
            INDEX idx_faction (faction_code),
            INDEX idx_type (component_type),
            UNIQUE KEY unique_faction_type (faction_code, component_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        
        -- Species Avatars (cached)
        CREATE TABLE IF NOT EXISTS species_avatars (
            id INT AUTO_INCREMENT PRIMARY KEY,
            species_code VARCHAR(32) NOT NULL,
            gender ENUM('male', 'female') NOT NULL,
            glb_path VARCHAR(255) NOT NULL,
            glb_cache_key VARCHAR(64),
            metadata JSON,
            thumbnail_path VARCHAR(255),
            version INT DEFAULT 1,
            checksum VARCHAR(64),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            
            INDEX idx_species (species_code),
            INDEX idx_gender (gender),
            UNIQUE KEY unique_species_gender (species_code, gender)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        
        -- User-Generated Ships (extends existing)
        ALTER TABLE user_generated_ships 
        ADD COLUMN IF NOT EXISTS base_hull_id INT AFTER faction_id,
        ADD COLUMN IF NOT EXISTS components JSON AFTER metadata,
        ADD COLUMN IF NOT EXISTS customizations JSON AFTER components,
        ADD FOREIGN KEY (base_hull_id) REFERENCES base_ship_components(id);
    SQL;
    
    try {
        $db->exec($sql);
        return true;
    } catch (\Exception $e) {
        error_log("Migration failed: " . $e->getMessage());
        return false;
    }
};
