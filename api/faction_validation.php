<?php
/**
 * Faction Relations Validation & Debug Endpoint
 * 
 * For development & validation of FACTION_RELATIONS.yaml
 * 
 * GET /api/faction_validation.php?action=verify         – Validate YAML structure
 * GET /api/faction_validation.php?action=standing_matrix – Full matrix dump
 * GET /api/faction_validation.php?action=endgame_check   – Check endgame scenarios
 */

require_once __DIR__ . '/helpers.php';

function verify_faction_relations() {
    $yaml_path = dirname(__DIR__) . '/FACTION_RELATIONS.yaml';
    
    if (!file_exists($yaml_path)) {
        return ['status' => 'error', 'message' => 'FACTION_RELATIONS.yaml not found'];
    }
    
    $content = file_get_contents($yaml_path);
    $lines = count(explode("\n", $content));
    
    // Basic validation
    $issues = [];
    
    // Check required sections
    $required_sections = ['factions:', 'npc_factions:', 'relationships:', 'trade_routes:', 'conflict_triggers:', 'diplomatic_events:', 'dynamic_ai_events:', 'endgame_scenarios:'];
    foreach ($required_sections as $section) {
        if (strpos($content, $section) === false) {
            $issues[] = "Missing section: $section";
        }
    }
    
    // Count factions
    preg_match_all('/\n\s+\w+:/', $content, $matches);
    $faction_count = count($matches[0]);
    
    // Validate standing ranges
    preg_match_all('/standing["\']?\s*:?\s*(-?\d+)/', $content, $standings);
    $standing_values = array_map('intval', $standings[1]);
    $min_standing = min($standing_values);
    $max_standing = max($standing_values);
    
    if ($min_standing < -10 || $max_standing > 10) {
        $issues[] = "Standing values out of range [-10, 10]. Found: [$min_standing, $max_standing]";
    }
    
    return [
        'status' => count($issues) > 0 ? 'warning' : 'ok',
        'yaml_file' => $yaml_path,
        'file_size_bytes' => filesize($yaml_path),
        'file_lines' => $lines,
        'estimated_factions' => $faction_count,
        'standing_range' => [$min_standing, $max_standing],
        'issues' => $issues,
    ];
}

function dump_standing_matrix() {
    $yaml_path = dirname(__DIR__) . '/FACTION_RELATIONS.yaml';
    
    if (!file_exists($yaml_path)) {
        return ['error' => 'YAML not found'];
    }
    
    // Simple YAML section extraction
    $content = file_get_contents($yaml_path);
    $start = strpos($content, 'relationships:');
    if ($start === false) return ['error' => 'No relationships section'];
    
    $section = substr($content, $start, 5000);  // Next ~5KB
    
    return [
        'preview' => trim($section),
        'note' => 'This is a preview. Use faction_relations.php API for full data.',
    ];
}

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    $action = strtolower($_GET['action'] ?? 'verify');
    
    // Allow unauthenticated debug access (remove in production)
    header('Content-Type: application/json');
    
    switch ($action) {
        case 'verify':
            echo json_encode(verify_faction_relations(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            break;
        
        case 'standing_matrix':
            echo json_encode(dump_standing_matrix(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            break;
        
        case 'endgame_check':
            $yaml_path = dirname(__DIR__) . '/FACTION_RELATIONS.yaml';
            $scenarios = [];
            if (file_exists($yaml_path)) {
                $content = file_get_contents($yaml_path);
                if (preg_match('/endgame_scenarios:(.*?)(?=\n[a-z]|$)/s', $content, $m)) {
                    $scenarios = $m[1];
                }
            }
            echo json_encode([
                'status' => 'ok',
                'endgame_scenarios_found' => count(explode('condition:', $scenarios)) - 1,
                'preview' => substr($scenarios, 0, 500),
            ], JSON_PRETTY_PRINT);
            break;
        
        default:
            http_response_code(400);
            echo json_encode(['error' => "Unknown action: $action"]);
    }
}
