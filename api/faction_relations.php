<?php
/**
 * Faction Relations & Diplomacy AI Engine
 * 
 * Loads FACTION_RELATIONS.yaml and provides:
 * - Dynamic faction relationship calculations
 * - Conflict/alliance prediction
 * - Economic trade simulation
 * - AI-driven event generation
 * 
 * GET  /api/faction_relations.php?action=standing     – player's standing with all factions (incl. trust/threat)
 * GET  /api/faction_relations.php?action=relationships – faction-to-faction matrix
 * GET  /api/faction_relations.php?action=trade_routes  – active trade network
 * GET  /api/faction_relations.php?action=conflicts    – predicted conflicts
 * POST /api/faction_relations.php?action=update_standing body: {faction_id, delta}
 * GET  /api/faction_relations.php?action=diplomacy_events – AI-driven events
 * GET  /api/faction_relations.php?action=trust_threat  – trust+threat for all/one faction
 * POST /api/faction_relations.php?action=update_trust_threat body: {faction_id, trust_delta?, threat_delta?}
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/../lib/ThemisDbClient.php';
require_once __DIR__ . '/../lib/ThemisDbDualWriteService.php';

// ═══════════════════════════════════════════════════════════════════════════════
// YAML Parsing (fallback to JSON if YAML not available)
// ═══════════════════════════════════════════════════════════════════════════════

function load_faction_relations_yaml() {
    $yaml_path = dirname(__DIR__) . '/FACTION_RELATIONS.yaml';
    
    if (!file_exists($yaml_path)) {
        return null;  // Will create minimal fallback
    }
    
    // Try php-yaml if available
    if (function_exists('yaml_parse_file')) {
        return @yaml_parse_file($yaml_path);
    }
    
    // Fallback: manual YAML parsing for our specific structure
    return parse_faction_yaml_manual($yaml_path);
}

function parse_faction_yaml_manual($path) {
    $content = file_get_contents($path);
    if (!$content) return null;
    
    $result = [
        'factions' => [],
        'npc_factions' => [],
        'relationships' => [],
        'trade_routes' => [],
        'conflict_triggers' => [],
        'diplomatic_events' => [],
        'dynamic_ai_events' => [],
        'endgame_scenarios' => [],
    ];
    
    // Parse main sections
    $lines = explode("\n", $content);
    $current_section = null;
    $section_content = [];
    
    foreach ($lines as $line) {
        $trimmed = trim($line);
        
        // Section header (e.g., "factions:")
        if (preg_match('/^([a-z_]+):\s*$/', $trimmed, $m)) {
            if ($current_section && $section_content) {
                $result[$current_section] = parse_yaml_section($section_content);
            }
            $current_section = $m[1];
            $section_content = [];
        } elseif ($current_section) {
            $section_content[] = $line;
        }
    }
    
    // Last section
    if ($current_section && $section_content) {
        $result[$current_section] = parse_yaml_section($section_content);
    }
    
    return $result;
}

function parse_yaml_section($lines) {
    $result = [];
    $current_key = null;
    $current_value = [];
    $indent_level = 0;
    
    foreach ($lines as $line) {
        if (trim($line) === '' || strpos(trim($line), '#') === 0) {
            continue;
        }
        
        // Measure indent
        $spaces = strlen($line) - strlen(ltrim($line));
        
        // Top-level key
        if ($spaces <= 2 && preg_match('/^(\w+):\s*(.*)$/', trim($line), $m)) {
            if ($current_key && $current_value) {
                $result[$current_key] = parse_yaml_value($current_value);
            }
            $current_key = $m[1];
            $current_value = [];
            if ($m[2]) {
                $current_value[] = $m[2];
            }
        } elseif ($current_key) {
            $current_value[] = $line;
        }
    }
    
    if ($current_key && $current_value) {
        $result[$current_key] = parse_yaml_value($current_value);
    }
    
    return $result;
}

function parse_yaml_value($lines) {
    $text = implode("\n", $lines);
    $text = trim($text);
    
    // Try numeric
    if (is_numeric($text)) {
        return (int)$text;
    }
    
    // Try boolean
    if ($text === 'true') return true;
    if ($text === 'false') return false;
    
    // Try array notation [item1, item2]
    if (strpos($text, '[') === 0) {
        preg_match_all('/\[([^\]]+)\]/', $text, $m);
        if ($m[1]) {
            return array_map('trim', explode(',', $m[1][0]));
        }
    }
    
    return $text;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Get faction standing (player vs. faction)
// ═══════════════════════════════════════════════════════════════════════════════

function get_player_faction_standing($db, $uid, $faction_id) {
    $stmt = $db->prepare('
        SELECT standing FROM diplomacy 
        WHERE user_id = ? AND faction_id = ?
        LIMIT 1
    ');
    $stmt->execute([$uid, $faction_id]);
    $row = $stmt->fetch();
    return $row ? (int)$row['standing'] : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Update faction standing (with historical tracking)
// ═══════════════════════════════════════════════════════════════════════════════

function update_faction_standing($db, $uid, $faction_id, $delta, $reason = 'player_action') {
    if ($delta == 0) return;
    
    ensure_diplomacy_rows($db, $uid);
    
    $current = get_player_faction_standing($db, $uid, $faction_id);
    $new_standing = max(-10, min(10, $current + $delta));  // Clamp to [-10, 10]
    
    $stmt = $db->prepare('
        UPDATE diplomacy 
        SET standing = ?, last_event = ?, last_event_at = NOW()
        WHERE user_id = ? AND faction_id = ?
    ');
    $stmt->execute([$new_standing, $reason, $uid, $faction_id]);
    
    // Log to diplomacy_history for audit trail
    if (function_exists('get_table_list') && in_array('diplomacy_history', get_table_list($db))) {
        $hist = $db->prepare('
            INSERT INTO diplomacy_history 
            (user_id, faction_id, standing_delta, standing_before, standing_after, reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
        ');
        $hist->execute([$uid, $faction_id, $delta, $current, $new_standing, $reason]);
    }
    
    return $new_standing;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Calculate faction-to-faction relations (for NPC interactions)
// ═══════════════════════════════════════════════════════════════════════════════

function get_faction_to_faction_standing($relations_data, $faction_a, $faction_b) {
    if (!isset($relations_data['relationships'][$faction_a])) {
        return 0;
    }
    
    $standing = $relations_data['relationships'][$faction_a][$faction_b] ?? 0;
    return (int)$standing;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Predict conflicts based on standing divergence
// ═══════════════════════════════════════════════════════════════════════════════

function predict_conflicts($db, $relations_data) {
    $conflicts = [];
    
    // Check all faction pairs
    foreach ($relations_data['relationships'] as $factionA => $relations) {
        foreach ($relations as $factionB => $standing_AB) {
            $standing_BA = $relations_data['relationships'][$factionB][$factionA] ?? 0;
            $divergence = abs($standing_AB - $standing_BA);
            
            // High divergence indicates potential conflict
            if ($divergence >= 10) {
                $conflicts[] = [
                    'faction_a' => $factionA,
                    'faction_b' => $factionB,
                    'standing_a_to_b' => (int)$standing_AB,
                    'standing_b_to_a' => (int)$standing_BA,
                    'divergence' => $divergence,
                    'conflict_probability' => min(1.0, $divergence / 20),  // 0-1 scale
                    'predicted_cause' => predict_conflict_cause($standing_AB, $standing_BA),
                ];
            }
            
            // Existential threats
            if ($standing_AB <= -8 || $standing_BA <= -8) {
                $conflicts[] = [
                    'faction_a' => $factionA,
                    'faction_b' => $factionB,
                    'standing_a_to_b' => (int)$standing_AB,
                    'standing_b_to_a' => (int)$standing_BA,
                    'divergence' => $divergence,
                    'conflict_probability' => 0.95,
                    'predicted_cause' => 'existential_threat',
                    'severity' => 'critical',
                ];
            }
        }
    }
    
    return $conflicts;
}

function predict_conflict_cause($standing_a, $standing_b) {
    if ($standing_a < -5 || $standing_b < -5) {
        return 'ideological_opposition';
    }
    if ($standing_a > 7 && $standing_b > 7) {
        return 'resource_competition_between_allies';
    }
    if ($standing_a < 0 && $standing_b > 3) {
        return 'asymmetric_hostility';
    }
    return 'escalating_tension';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Generate AI-driven diplomatic events
// ═══════════════════════════════════════════════════════════════════════════════

function generate_diplomatic_event($db, $uid, $relations_data) {
    // Weighted RNG based on standings and config
    $player_standings = $db->prepare('
        SELECT faction_id, standing FROM diplomacy WHERE user_id = ?
    ');
    $player_standings->execute([$uid]);
    $standings = [];
    while ($row = $player_standings->fetch()) {
        $standings[(int)$row['faction_id']] = (int)$row['standing'];
    }
    
    // Determine event type based on overall standing distribution
    $avg_standing = count($standings) > 0 ? array_sum($standings) / count($standings) : 0;
    
    if ($avg_standing > 5) {
        return [
            'type' => 'alliance_proposal',
            'title' => 'Fraktionen proklamieren Bündnis',
            'description' => 'Mehrere wohlgesonnene Fraktionen einigen sich auf gemeinsame Verteidigung',
            'player_choice' => ['join', 'decline', 'negotiate'],
            'standing_impact' => [
                'join' => [['all_allies', 2]],
                'decline' => [['all_allies', -1]],
            ],
        ];
    } elseif ($avg_standing < -3) {
        return [
            'type' => 'war_declaration',
            'title' => 'Kriegserklärung eines Fraktionsundes',
            'description' => 'Vereinigte Fraktionen erklären Krieg gegen Sie oder einen gemeinsamen Feind',
            'player_choice' => ['join', 'stay_neutral', 'support_enemy'],
            'standing_impact' => [
                'join' => [['aggressors', 2], ['enemies', -2]],
                'stay_neutral' => [['aggressors', -1]],
                'support_enemy' => [['aggressors', -5]],
            ],
        ];
    } else {
        return [
            'type' => 'trade_boom',
            'title' => 'Großer Handelsbonus aktiviert',
            'description' => 'Friedliche Bedingungen fördern wirtschaftliche Blüte',
            'player_choice' => ['capitalize', 'invest_militarily', 'ignore'],
            'standing_impact' => null,
            'economic_impact' => ['profit_multiplier' => 1.5],
        ];
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// API Dispatcher
// Supported actions:
//   standing          – player standings from MySQL (authoritative)
//   relationships     – faction-to-faction matrix from YAML
//   trade_routes      – active trade routes from YAML
//   conflicts         – conflict prediction via PHP/MySQL loop
//   update_standing   – update standing (dual-write: MySQL + ThemisDB)
//   diplomacy_events  – AI-driven diplomatic events
//   graph_conflicts   – ThemisDB: graph traversal conflict query
//   graph_path        – ThemisDB: shortest diplomatic path between factions
//   graph_clusters    – ThemisDB: alliance community clusters
//   compare_conflicts – side-by-side MySQL vs ThemisDB comparison
//   seed_themisdb     – populate ThemisDB graph from live MySQL data
//   db_status         – health of both MySQL and ThemisDB
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// Diplomatic stance derived from trust + threat (mirrors COMBAT_SYSTEM_DESIGN §6.1)
// ═══════════════════════════════════════════════════════════════════════════════

function _diplo_stance(float $trust, float $threat): string {
    if ($trust >= 75 && $threat < 20) return 'ALLY';
    if ($trust >= 40 && $threat < 40) return 'FRIENDLY';
    if ($threat >= 75)                return 'HOSTILE';
    if ($threat >= 50)                return 'TENSE';
    return 'NEUTRAL';
}

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    $action = strtolower($_GET['action'] ?? 'standing');
    $uid = require_auth();
    $db = get_db();
    // Parallel-DB service (dual-write + ThemisDB graph reads).
    $dualSvc = ThemisDbDualWriteService::instance($db);

    // Load relations data
    $relations_data = load_faction_relations_yaml();
    if (!$relations_data) {
        $relations_data = ['relationships' => [], 'factions' => []];
    }

    $cache_key = 'faction_relations_' . $action;

    switch ($action) {

        // ── MySQL-backed reads ──────────────────────────────────────────────

        // Player's standing with all factions (MySQL authoritative)
        case 'standing':
            only_method('GET');
            ensure_diplomacy_rows($db, $uid);

            $standings = $db->prepare('
                SELECT f.id, f.name,
                       COALESCE(d.standing, 0)      as standing,
                       COALESCE(d.trust_level, 0.0)  as trust_level,
                       COALESCE(d.threat_level, 0.0) as threat_level
                FROM npc_factions f
                LEFT JOIN diplomacy d ON d.faction_id = f.id AND d.user_id = ?
                ORDER BY f.id
            ');
            $standings->execute([$uid]);

            $result = [];
            while ($row = $standings->fetch()) {
                $result[] = [
                    'faction_id'   => (int)$row['id'],
                    'faction_name' => $row['name'],
                    'standing'     => (int)$row['standing'],
                    'trust_level'  => (float)$row['trust_level'],
                    'threat_level' => (float)$row['threat_level'],
                ];
            }
            json_ok(['standings' => $result]);
            break;

        // Trust + Threat values for one or all factions
        // GET ?action=trust_threat               → all factions
        // GET ?action=trust_threat&faction_id=N  → single faction
        case 'trust_threat':
            only_method('GET');
            ensure_diplomacy_rows($db, $uid);

            $faction_id_filter = (int)($_GET['faction_id'] ?? 0);
            if ($faction_id_filter > 0) {
                $stmt = $db->prepare('
                    SELECT faction_id,
                           COALESCE(trust_level,  0.0) as trust_level,
                           COALESCE(threat_level, 0.0) as threat_level,
                           COALESCE(trust_decay_rate, 0.5) as trust_decay_rate
                    FROM diplomacy
                    WHERE user_id = ? AND faction_id = ?
                    LIMIT 1
                ');
                $stmt->execute([$uid, $faction_id_filter]);
                $row = $stmt->fetch();
                json_ok($row
                    ? ['faction_id' => (int)$row['faction_id'],
                       'trust_level' => (float)$row['trust_level'],
                       'threat_level' => (float)$row['threat_level'],
                       'trust_decay_rate' => (float)$row['trust_decay_rate']]
                    : ['error' => 'Faction not found', 'faction_id' => $faction_id_filter]);
                break;
            }

            $stmt = $db->prepare('
                SELECT f.id AS faction_id, f.name AS faction_name,
                       COALESCE(d.trust_level,  0.0) as trust_level,
                       COALESCE(d.threat_level, 0.0) as threat_level,
                       COALESCE(d.trust_decay_rate, 0.5) as trust_decay_rate
                FROM npc_factions f
                LEFT JOIN diplomacy d ON d.faction_id = f.id AND d.user_id = ?
                ORDER BY f.id
            ');
            $stmt->execute([$uid]);
            $rows = $stmt->fetchAll();
            $out = [];
            foreach ($rows as $r) {
                $out[] = [
                    'faction_id'       => (int)$r['faction_id'],
                    'faction_name'     => $r['faction_name'],
                    'trust_level'      => (float)$r['trust_level'],
                    'threat_level'     => (float)$r['threat_level'],
                    'trust_decay_rate' => (float)$r['trust_decay_rate'],
                    'stance'           => _diplo_stance((float)$r['trust_level'], (float)$r['threat_level']),
                ];
            }
            json_ok(['trust_threat' => $out]);
            break;

        // Update trust and/or threat for a faction
        // POST ?action=update_trust_threat  body: { faction_id, trust_delta?, threat_delta? }
        case 'update_trust_threat':
            only_method('POST');
            verify_csrf();
            $body = get_json_body();

            $faction_id   = (int)($body['faction_id']   ?? 0);
            $trust_delta  = (float)($body['trust_delta']  ?? 0.0);
            $threat_delta = (float)($body['threat_delta'] ?? 0.0);
            $reason       = trim($body['reason'] ?? 'player_action');

            if ($faction_id <= 0) {
                json_error('Invalid faction_id', 400);
            }

            $verify = $db->prepare('SELECT id FROM npc_factions WHERE id = ? LIMIT 1');
            $verify->execute([$faction_id]);
            if (!$verify->fetch()) {
                json_error('Faction not found', 404);
            }

            ensure_diplomacy_rows($db, $uid);

            // Clamp deltas to reasonable per-event limits
            $trust_delta  = max(-50.0, min(50.0, $trust_delta));
            $threat_delta = max(-50.0, min(50.0, $threat_delta));

            $upd = $db->prepare('
                UPDATE diplomacy
                SET trust_level  = LEAST(100, GREATEST(0, trust_level  + ?)),
                    threat_level = LEAST(100, GREATEST(0, threat_level + ?)),
                    last_event   = ?,
                    last_event_at = NOW()
                WHERE user_id = ? AND faction_id = ?
            ');
            $upd->execute([$trust_delta, $threat_delta, $reason, $uid, $faction_id]);

            // Read back new values
            $sel = $db->prepare('
                SELECT trust_level, threat_level
                FROM diplomacy WHERE user_id = ? AND faction_id = ? LIMIT 1
            ');
            $sel->execute([$uid, $faction_id]);
            $new = $sel->fetch();

            gq_cache_delete('faction_relations_standing', ['uid' => $uid]);

            json_ok([
                'faction_id'   => $faction_id,
                'trust_delta'  => $trust_delta,
                'threat_delta' => $threat_delta,
                'trust_level'  => (float)($new['trust_level']  ?? 0),
                'threat_level' => (float)($new['threat_level'] ?? 0),
                'stance'       => _diplo_stance((float)($new['trust_level'] ?? 0), (float)($new['threat_level'] ?? 0)),
                'reason'       => $reason,
            ]);
            break;

        // Faction-to-faction relationship matrix
        case 'relationships':
            only_method('GET');
            $cached = gq_cache_get($cache_key, ['uid' => $uid], CACHE_TTL_FACTIONS);
            if ($cached) {
                json_ok($cached);
            }
            $payload = ['relationships' => $relations_data['relationships'] ?? []];
            gq_cache_set($cache_key, ['uid' => $uid], $payload, CACHE_TTL_FACTIONS);
            json_ok($payload);
            break;

        // Predicted conflicts (classic PHP/MySQL loop)
        case 'conflicts':
            only_method('GET');
            $cached = gq_cache_get($cache_key, ['uid' => $uid], CACHE_TTL_FACTIONS);
            if ($cached) {
                json_ok($cached);
            }
            $conflicts = predict_conflicts($db, $relations_data);
            $payload = ['conflicts' => $conflicts];
            gq_cache_set($cache_key, ['uid' => $uid], $payload, CACHE_TTL_FACTIONS);
            json_ok($payload);
            break;

        // Trade routes
        case 'trade_routes':
            only_method('GET');
            json_ok(['routes' => $relations_data['trade_routes'] ?? []]);
            break;

        // ── Write path (dual-write: MySQL primary + ThemisDB mirror) ────────

        // Update player standing
        case 'update_standing':
            only_method('POST');
            verify_csrf();
            $body = get_json_body();

            $faction_id = (int)($body['faction_id'] ?? 0);
            $delta      = (int)($body['delta']      ?? 0);
            $reason     = trim($body['reason']      ?? 'unknown');

            if ($faction_id <= 0 || abs($delta) > 10) {
                json_error('Invalid faction_id or delta', 400);
            }
            $verify = $db->prepare('SELECT id FROM npc_factions WHERE id = ? LIMIT 1');
            $verify->execute([$faction_id]);
            if (!$verify->fetch()) {
                json_error('Faction not found', 404);
            }

            $new_standing = update_faction_standing($db, $uid, $faction_id, $delta, $reason);

            // Dual-write: mirror the updated standing to ThemisDB (fire-and-forget).
            $dualSvc->writeDiplomacyStanding($uid, $faction_id, $new_standing, $reason);

            gq_cache_delete('faction_relations_standing', ['uid' => $uid]);

            json_ok([
                'faction_id'     => $faction_id,
                'standing_delta' => $delta,
                'new_standing'   => $new_standing,
                'reason'         => $reason,
            ]);
            break;

        // ── AI-driven diplomatic events ────────────────────────────────────

        case 'diplomacy_events':
            only_method('GET');
            $event = generate_diplomatic_event($db, $uid, $relations_data);
            json_ok(['event' => $event]);
            break;

        // ── ThemisDB graph-native reads ────────────────────────────────────

        // Graph conflict query – ThemisDB Property Graph traversal.
        // Optional: ?threshold=-50
        case 'graph_conflicts':
            only_method('GET');
            $threshold = (int)($_GET['threshold'] ?? -50);
            $conflicts = $dualSvc->graphFactionConflicts($threshold);
            json_ok(['conflicts' => $conflicts, 'source' => 'themisdb_graph', 'threshold' => $threshold]);
            break;

        // Shortest diplomatic path between two factions.
        // Required: ?from=vor_tak&to=aereth  Optional: ?min_standing=0
        case 'graph_path':
            only_method('GET');
            $from        = trim($_GET['from']          ?? '');
            $to          = trim($_GET['to']            ?? '');
            $minStanding = (int)($_GET['min_standing'] ?? 0);

            if ($from === '' || $to === '') {
                json_error('Query params "from" and "to" are required.', 400);
            }
            $path = $dualSvc->graphShortestDiplomaticPath($from, $to, $minStanding);
            if ($path === null) {
                json_ok(['path' => null, 'message' => 'No diplomatic path found.', 'source' => 'themisdb_graph']);
            }
            json_ok(['path' => $path, 'source' => 'themisdb_graph']);
            break;

        // Alliance clusters – graph community detection.
        // Optional: ?min_standing=3
        case 'graph_clusters':
            only_method('GET');
            $minStanding = (int)($_GET['min_standing'] ?? 3);
            $clusters = $dualSvc->graphAllianceClusters($minStanding);
            json_ok(['clusters' => $clusters, 'source' => 'themisdb_graph', 'min_standing' => $minStanding]);
            break;

        // Side-by-side comparison: MySQL PHP loop vs ThemisDB graph traversal.
        // Optional: ?threshold=-50
        case 'compare_conflicts':
            only_method('GET');
            $threshold = (int)($_GET['threshold'] ?? -50);
            $comparison = $dualSvc->compareConflictPrediction(
                $relations_data['relationships'] ?? [],
                $threshold
            );
            json_ok($comparison);
            break;

        // Seed ThemisDB graph collections from live MySQL data.
        // Body (optional): { "seed_player_diplomacy": true }
        case 'seed_themisdb':
            only_method('POST');
            verify_csrf();
            $body = get_json_body();

            $factionResult   = $dualSvc->seedFactions();
            $relationsResult = $dualSvc->seedFactionRelationsGraph($relations_data['relationships'] ?? []);

            $playerResult = ['seeded' => 0, 'errors' => 0];
            if ($body['seed_player_diplomacy'] ?? false) {
                $playerResult = $dualSvc->seedPlayerDiplomacy($uid);
            }

            json_ok([
                'factions_seeded'         => $factionResult['seeded'],
                'relation_edges_seeded'   => $relationsResult['seeded'],
                'player_diplomacy_seeded' => $playerResult['seeded'],
                'errors'                  => $factionResult['errors'] + $relationsResult['errors'] + $playerResult['errors'],
            ]);
            break;

        // Health status of both database backends.
        case 'db_status':
            only_method('GET');
            json_ok($dualSvc->status());
            break;

        default:
            json_error("Unknown action: $action", 400);
    }
}
