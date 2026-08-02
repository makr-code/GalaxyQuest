#!/usr/bin/env php
<?php
/**
 * TRELLIS2 → Game Backend Asset Integration
 * 
 * Seeding generated 3D models into GalaxyQuest game database
 * Converts TRELLIS2 GLB files into game ship/station/faction assets
 */

// Configuration
define('GENERATED_ROOT', __DIR__ . '/../generated/trellis2');
define('IMPORTED_ASSETS_DIR', GENERATED_ROOT . '/imported');
define('LOGS_FILE', GENERATED_ROOT . '/logs/backend_integration.jsonl');

class TRELLIS2BackendIntegration {
    
    private $generated_root;
    private $logs_file;
    
    public function __construct($generated_root = GENERATED_ROOT) {
        $this->generated_root = $generated_root;
        $this->logs_file = $generated_root . '/logs/backend_integration.jsonl';
        
        // Ensure logs directory exists
        @mkdir(dirname($this->logs_file), 0755, true);
    }
    
    /**
     * Log integration events
     */
    private function log_event($event_type, $details = []) {
        $entry = [
            'timestamp' => date('c'),
            'event_type' => $event_type,
            'details' => $details
        ];
        
        file_put_contents(
            $this->logs_file,
            json_encode($entry) . "\n",
            FILE_APPEND
        );
    }
    
    /**
     * Register asset in game database
     * 
     * @param array $asset Asset metadata
     * @param array $faction_config Faction configuration
     * @return array Result with asset_id or error
     */
    public function register_asset($asset, $faction_config = []) {
        try {
            $asset_id = $asset['id'] ?? null;
            if (!$asset_id) {
                throw new Exception("Missing asset_id");
            }
            
            // Validate GLB file exists
            $glb_path = $asset['glb_path'] ?? null;
            if (!$glb_path || !file_exists($glb_path)) {
                throw new Exception("GLB file not found: {$glb_path}");
            }
            
            // Calculate asset fingerprint
            $fingerprint = hash_file('sha256', $glb_path);
            $file_size = filesize($glb_path);
            
            // Create asset record for database
            $asset_record = [
                'asset_id' => $asset_id,
                'fingerprint' => $fingerprint,
                'glb_path' => $glb_path,
                'file_size_bytes' => $file_size,
                'asset_type' => $faction_config['asset_type'] ?? 'ship',
                'faction' => $faction_config['faction'] ?? 'terran',
                'variant' => $faction_config['variant'] ?? 'default',
                'metadata' => [
                    'source' => 'trellis2_generated',
                    'generation_timestamp' => $asset['metadata']['import_date'] ?? date('c'),
                    'prompt' => $asset['metadata']['metadata']['prompt'] ?? null,
                    'generation_time_sec' => $asset['metadata']['metadata']['generation_time'] ?? null,
                ]
            ];
            
            // In real implementation, would insert into database:
            // INSERT INTO game_assets (asset_id, fingerprint, glb_path, ...) VALUES (...)
            
            $this->log_event('asset_registered', [
                'asset_id' => $asset_id,
                'fingerprint' => $fingerprint,
                'file_size_mb' => round($file_size / (1024 ** 2), 2),
                'faction' => $asset_record['faction'],
                'status' => 'ready'
            ]);
            
            return ['success' => true, 'asset_id' => $asset_id, 'record' => $asset_record];
            
        } catch (Exception $e) {
            $this->log_event('asset_registration_error', [
                'error' => $e->getMessage(),
                'asset_id' => $asset['id'] ?? 'unknown'
            ]);
            
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }
    
    /**
     * Discover and list all assets ready for import
     */
    public function discover_assets() {
        $assets = [];
        
        try {
            if (!is_dir(IMPORTED_ASSETS_DIR)) {
                return $assets;
            }
            
            // Scan asset hierarchy: type/faction/variant/files
            foreach (scandir(IMPORTED_ASSETS_DIR) as $type_dir) {
                $type_path = IMPORTED_ASSETS_DIR . '/' . $type_dir;
                if (!is_dir($type_path) || $type_dir[0] === '.') continue;
                
                foreach (scandir($type_path) as $faction_dir) {
                    $faction_path = $type_path . '/' . $faction_dir;
                    if (!is_dir($faction_path) || $faction_dir[0] === '.') continue;
                    
                    foreach (scandir($faction_path) as $variant_dir) {
                        $variant_path = $faction_path . '/' . $variant_dir;
                        if (!is_dir($variant_path) || $variant_dir[0] === '.') continue;
                        
                        // Scan for GLB and JSON pairs
                        foreach (glob("$variant_path/*.glb") as $glb_file) {
                            $asset_id = basename($glb_file, '.glb');
                            $json_file = "$variant_path/$asset_id.json";
                            
                            $metadata = file_exists($json_file) 
                                ? json_decode(file_get_contents($json_file), true)
                                : [];
                            
                            $assets[] = [
                                'id' => $asset_id,
                                'type' => $type_dir,
                                'faction' => $faction_dir,
                                'variant' => $variant_dir,
                                'glb_path' => $glb_file,
                                'glb_size_mb' => round(filesize($glb_file) / (1024 ** 2), 2),
                                'metadata' => $metadata
                            ];
                        }
                    }
                }
            }
        } catch (Exception $e) {
            $this->log_event('discovery_error', ['error' => $e->getMessage()]);
        }
        
        return $assets;
    }
    
    /**
     * Import all discovered assets
     */
    public function import_all_assets() {
        $assets = $this->discover_assets();
        $results = [
            'total' => count($assets),
            'success' => 0,
            'failed' => 0,
            'assets' => []
        ];
        
        foreach ($assets as $asset) {
            $faction_config = [
                'asset_type' => $asset['type'],
                'faction' => $asset['faction'],
                'variant' => $asset['variant']
            ];
            
            $result = $this->register_asset($asset, $faction_config);
            
            if ($result['success']) {
                $results['success']++;
            } else {
                $results['failed']++;
            }
            
            $results['assets'][] = [
                'id' => $asset['id'],
                'success' => $result['success']
            ];
        }
        
        $this->log_event('batch_import_complete', $results);
        
        return $results;
    }
    
    /**
     * Generate SQL for bulk asset import (for game database)
     */
    public function generate_sql_import($assets = null) {
        if (!$assets) {
            $assets = $this->discover_assets();
        }
        
        $sql_file = $this->generated_root . '/sql/trellis2_assets_import.sql';
        @mkdir(dirname($sql_file), 0755, true);
        
        $sql = "-- TRELLIS2 Generated Assets Import\n";
        $sql .= "-- Generated: " . date('Y-m-d H:i:s') . "\n";
        $sql .= "-- Total Assets: " . count($assets) . "\n\n";
        
        foreach ($assets as $asset) {
            $asset_id = mysqli_real_escape_string($asset['id']);
            $faction = mysqli_real_escape_string($asset['faction']);
            $type = mysqli_real_escape_string($asset['type']);
            $variant = mysqli_real_escape_string($asset['variant']);
            $glb_path = mysqli_real_escape_string($asset['glb_path']);
            $fingerprint = hash_file('sha256', $asset['glb_path']);
            
            $sql .= "INSERT INTO game_3d_assets (asset_id, faction, type, variant, glb_path, fingerprint, created_at) VALUES\n";
            $sql .= "  ('$asset_id', '$faction', '$type', '$variant', '$glb_path', '$fingerprint', NOW())\n";
            $sql .= "  ON DUPLICATE KEY UPDATE updated_at = NOW();\n\n";
        }
        
        file_put_contents($sql_file, $sql);
        $this->log_event('sql_generated', ['output_file' => $sql_file, 'count' => count($assets)]);
        
        return $sql_file;
    }
}


// CLI Interface
if (php_sapi_name() === 'cli') {
    $action = $argv[1] ?? 'discover';
    $integrator = new TRELLIS2BackendIntegration();
    
    switch ($action) {
        case 'discover':
            $assets = $integrator->discover_assets();
            printf("\n✅ Discovered %d assets\n\n", count($assets));
            
            foreach ($assets as $asset) {
                printf("  [%s] %s/%s/%s\n", 
                    $asset['id'],
                    $asset['faction'],
                    $asset['type'],
                    $asset['variant']
                );
            }
            break;
        
        case 'import':
            $result = $integrator->import_all_assets();
            printf("\n📊 Import Results:\n");
            printf("  Total:    %d\n", $result['total']);
            printf("  ✅ Success: %d\n", $result['success']);
            printf("  ❌ Failed:  %d\n\n", $result['failed']);
            break;
        
        case 'sql':
            $sql_file = $integrator->generate_sql_import();
            printf("\n📝 SQL generated: %s\n", $sql_file);
            printf("  Usage: mysql game_db < %s\n\n", $sql_file);
            break;
        
        case 'logs':
            if (file_exists(LOGS_FILE)) {
                $logs = file_get_contents(LOGS_FILE);
                echo "\n📋 Integration Logs:\n";
                echo $logs;
            } else {
                echo "No logs found\n";
            }
            break;
        
        default:
            echo "Usage: php trellis2_backend_integration.php [discover|import|sql|logs]\n";
    }
}
