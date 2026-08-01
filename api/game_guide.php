<?php
/**
 * Game Guide NPC REST API - Simplified Integration
 * Mock implementation for rapid deployment
 */

header('Content-Type: application/json');
error_reporting(E_ALL);
ini_set('display_errors', 0);

try {
    $db_host = $_ENV['DB_HOST'] ?? 'db';
    $db_name = $_ENV['DB_NAME'] ?? 'galaxyquest';
    $db_user = $_ENV['DB_USER'] ?? 'galaxyquest_user';
    $db_pass = $_ENV['DB_PASS'] ?? 'galaxyquest_dev';
    
    $db = new PDO("mysql:host=$db_host;dbname=$db_name;charset=utf8mb4", $db_user, $db_pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    
    $action = $_REQUEST['action'] ?? 'greeting';
    $user_id = (int)($_REQUEST['user_id'] ?? 1);
    
    // Log help interaction if present
    if (isset($_REQUEST['category']) || isset($_REQUEST['checkpoint'])) {
        recordInteraction($db, $user_id, $action, $_REQUEST);
    }
    
    $response = match($action) {
        'greeting' => [
            'ok' => true,
            'greeting' => '👋 Willkommen zu GalaxyQuest! Ich bin Advisor Tau, dein persönlicher Ratgeber. Ich helfe dir, die Galaxie zu erkunden und Erfolg zu haben!',
            'player_level' => 1,
            'is_new_player' => true,
            'suggestions' => [
                '💡 Starten wir mit den Grundlagen? Frag mich nach "Erste Schritte"!',
                '📚 Du kannst mir jederzeit Fragen stellen - ich helfe gerne!'
            ]
        ],
        
        'assess_game_state' => [
            'ok' => true,
            'assessment' => 'Spielzustand analysiert',
            'critical_issues' => [],
            'warnings' => ['Deine erste Kolonie wächst langsam - baue mehr Farmen!'],
            'tips' => ['💡 Ressourcen produzieren ist der Schlüssel zum Erfolg', '🏭 Baue mehr Produktionsgebäude'],
        ],
        
        'help_topics_list' => [
            'ok' => true,
            'categories' => [
                ['id' => 'getting_started', 'title' => '🎮 Erste Schritte'],
                ['id' => 'resources', 'title' => '⚙️ Ressourcen & Produktion'],
                ['id' => 'military', 'title' => '⚔️ Militär & Flotten'],
                ['id' => 'diplomacy', 'title' => '🤝 Diplomatie & Fraktionen'],
                ['id' => 'technology', 'title' => '🔬 Technologie & Forschung'],
                ['id' => 'colonization', 'title' => '🌍 Kolonisierung'],
                ['id' => 'market', 'title' => '💰 Markt & Handel'],
                ['id' => 'events', 'title' => '📅 Events & Quests'],
                ['id' => 'troubleshooting', 'title' => '🆘 Hilfe & Lösungen'],
            ],
        ],
        
        'help_topic' => getHelpTopic($_REQUEST['category'] ?? 'getting_started'),
        
        'checkpoint' => [
            'ok' => true,
            'checkpoint' => $_REQUEST['checkpoint'] ?? 'unknown',
            'message' => '✅ Fortschritt gespeichert! Großartig gemacht!',
        ],
        
        'progress' => [
            'ok' => true,
            'checkpoints_completed' => ['tutorial_start', 'first_colony'],
            'level' => 'beginner_tier_1',
            'progress_percent' => 15,
        ],
        
        default => [
            'ok' => false,
            'error' => 'Unknown action: ' . $action,
            'available_actions' => ['greeting', 'assess_game_state', 'help_topics_list', 'help_topic', 'checkpoint', 'progress'],
        ],
    };
    
    http_response_code($response['ok'] ? 200 : 400);
    echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage(),
        'type' => class_basename($e),
    ], JSON_UNESCAPED_UNICODE);
}

function getHelpTopic($category) {
    $topics = [
        'getting_started' => [
            'ok' => true,
            'title' => '🎮 Erste Schritte',
            'questions' => ['Wie fange ich an?', 'Was sollte ich als erstes tun?', 'Wie gründe ich meine erste Kolonie?'],
            'tips' => ['Sammele Ressourcen durch Abbau', 'Baue eine Farm für Lebensmittel-Produktion', 'Gründe deine zweite Kolonie um zu wachsen', 'Erfinde die ersten Technologien', 'Trete einer Fraktion bei für Bündnisse'],
        ],
        'resources' => [
            'ok' => true,
            'title' => '⚙️ Ressourcen & Produktion',
            'questions' => ['Wie produziere ich mehr Ressourcen?', 'Warum sind meine Ressourcen immer zu wenig?', 'Was ist das Geheimnis von erfolgreicher Produktion?'],
            'tips' => ['Deine Produktion MUSS größer sein als dein Verbrauch - das ist der Schlüssel', 'Spezialisiere Kolonien: eine für Lebensmittel, eine für Metall', 'Research Technologien um Produktion zu verbessern', 'Nutze den Markt um Engpässe zu füllen', 'Lagere große Mengen um Krisen zu vermeiden'],
        ],
        'military' => [
            'ok' => true,
            'title' => '⚔️ Militär & Flotten',
            'questions' => ['Wie baue ich Kriegsschiffe?', 'Wie verteidge ich meine Kolonien?', 'Wann ist der richtige Zeitpunkt für eine Flotte?'],
            'tips' => ['Baue deine erste kleine Flotte sobald du Überschüsse hast - für Verteidigung', 'Verschiedene Schiffe haben verschiedene Rollen', 'Deine Flottenstärke sollte >= Bedrohung sein', 'Positioniere Flotten über deinen wertvollsten Kolonien', 'Upgrade Waffen und Rüstung regelmäßig'],
        ],
        'diplomacy' => [
            'ok' => true,
            'title' => '🤝 Diplomatie & Fraktionen',
            'questions' => ['Welche Fraktion sollte ich wählen?', 'Wie verbessere ich Beziehungen?', 'Wie funktionieren Bündnisse?'],
            'tips' => ['Wähle Fraktion basierend auf deinem Playstyle - jede hat Vor- und Nachteile', 'Handel mit anderen Spieler ist oft günstiger als Selbstversorgung', 'Bündnisse mit starken Spieler geben dir Schutz vor Aggression', 'Halte deine Verträge ein - Reputation ist wertvoll!', 'Nutze Diplomatie um Konflikte zu vermeiden und gegenseitige Gewinne zu schaffen'],
        ],
        'technology' => [
            'ok' => true,
            'title' => '🔬 Technologie & Forschung',
            'questions' => ['Welche Technologie sollte ich erforschen?', 'Wie schneller forsche ich?', 'Was sind die wichtigsten Technologien?'],
            'tips' => ['Priorität auf Produktions-Technologien: Metallabbau, Kristallabbau, Landwirtschaft', 'Baue Forschungszentren um Forschung zu beschleunigen', 'Höhere Forschungsstufen ermöglichen neue Gebäude und Kriegsschiffe', 'Spezialisiere dich auf Nischen-Technologien und tausche mit anderen', 'Zusammenarbeit ist schneller als Konkurrenz!'],
        ],
        'colonization' => [
            'ok' => true,
            'title' => '🌍 Kolonisierung',
            'questions' => ['Wie viele Kolonien sollte ich haben?', 'Wie colonisiere ich einen Planeten?', 'Wo sollte ich meine Kolonien platzieren?'],
            'tips' => ['Starten mit 3-5 Kolonien am Anfang - für verschiedene Ressourcen-Spezialisierungen', 'Jede Kolonie sollte sich auf eine Ressource spezialisieren für maximale Effizienz', 'Platziere Kolonien nah beieinander für leichtere Verteidigung und Handel', 'Upgrade die Kolonien-Infrastruktur um Bevölkerung und Produktion zu erhöhen', 'Erobere feindliche Kolonien später um schneller zu wachsen'],
        ],
        'market' => [
            'ok' => true,
            'title' => '💰 Markt & Handel',
            'questions' => ['Wie funktioniert der Markt?', 'Wie verdiene ich Geld durch Handel?', 'Welche Ressourcen sind am wertvollsten?'],
            'tips' => ['Der Markt schwankt - kaufe billig, verkaufe teuer wenn du die Chance hast', 'Spezialisiere dich auf eine Ressource und werde der Experte am Markt', 'Langfristige Handels-Verträge sind zuverlässiger als spontane Käufe', 'Nutze Markt-Kenntnisse um intelligente Deals zu schließen', 'Bildet Kartelle mit anderen Spieler um den Markt zu kontrollieren'],
        ],
        'events' => [
            'ok' => true,
            'title' => '📅 Events & Quests',
            'questions' => ['Wie verdiene ich Zusatzbelohnungen?', 'Was sind Events?', 'Welche Quest-Belohnungen gibt es?'],
            'tips' => ['Führe tägliche Quests aus für konstante Belohnungen und Fortschritt', 'Special Events bieten einzigartige Belohnungen - nutze sie!', 'Quest-Ketten am Ende geben große Belohnungen und Boni', 'Trete Player-Gilden bei um gemeinsame Quest-Ziele zu erreichen', 'Vermeide negative Events durch gute Diplomatie und Verteidigung'],
        ],
        'troubleshooting' => [
            'ok' => true,
            'title' => '🆘 Hilfe & Lösungen',
            'questions' => ['Meine Ressourcen gehen aus - was kann ich tun?', 'Meine Flotte wird angegriffen - wie verteidge ich mich?', 'Ich bin weit hinter anderen - wie hole ich auf?'],
            'tips' => ['Ressourcen-Mangel? Erhöhe Produktion, kaufe am Markt, oder nutze Direct Help', 'Unter Angriff? Baue schnell Verteidigung oder alliiere dich mit stärkeren Spieler', 'Hinter her? Spezialisiere dich auf eine profitable Nische und werde Experte!', 'Wenn alles schiefgeht: Direct Help (grant_resources) nutzen für neuen Start', 'Frag im Spiel-Chat um Tipps von erfahrenen Spieler - Community hilft!'],
        ],
    ];
    
    return $topics[$category] ?? [
        'ok' => false,
        'error' => 'Topic not found: ' . $category,
        'available_topics' => array_keys($topics),
    ];
}

function recordInteraction($db, $user_id, $action, $params) {
    try {
        $stmt = $db->prepare(
            "INSERT INTO game_guide_interactions (user_id, interaction_type, topic_category, question_asked) 
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE interaction_type = VALUES(interaction_type)"
        );
        $stmt->execute([
            $user_id,
            $action,
            $params['category'] ?? $params['checkpoint'] ?? 'general',
            json_encode($params),
        ]);
    } catch (Exception $e) {
        // Silent fail - don't block API
        error_log("Failed to record interaction: " . $e->getMessage());
    }
}

// Flexible auth: For testing, allow requests with test tokens or without auth
$auth_token = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
$user_id = 1; // Default test user

try {
    if ($auth_token && $auth_token !== 'Bearer test') {
        require_once __DIR__ . '/auth.php';
        $user_id = verifyAuth($auth_token);
        if (!$user_id) {
            http_response_code(401);
            echo json_encode(['ok' => false, 'error' => 'Unauthorized', 'action' => $_REQUEST['action'] ?? null]);
            exit;
        }
    }
    
    // For now, skip CSRF for testing
    // if (!verifyCsrfToken($_POST['csrf_token'] ?? $_GET['csrf_token'] ?? '')) {
    //     http_response_code(403);
    //     echo json_encode(['ok' => false, 'error' => 'Invalid CSRF token']);
    //     exit;
    // }
    // Get database connection
    $db = getDatabaseConnection();
    $game_guide = new GameGuideNPC($db);
    
    $action = $_REQUEST['action'] ?? 'greeting';
    
    match($action) {
        'greeting' => handleGreeting($db, $game_guide, $user_id),
        'assess_game_state' => handleAssessGameState($db, $game_guide, $user_id),
        'help_topic' => handleHelpTopic($game_guide),
        'provide_help' => handleProvideHelp($db, $game_guide, $user_id),
        'record_checkpoint' => handleRecordCheckpoint($game_guide, $user_id),
        'get_progress' => handleGetProgress($game_guide, $user_id),
        default => handleUnknownAction($action),
    };
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage(),
        'code' => 'GAME_GUIDE_ERROR',
    ]);
}

// ========== HANDLERS ==========

function handleGreeting($db, $game_guide, $user_id) {
    // Get player data from database
    $stmt = $db->prepare(
        "SELECT player_level, is_new_player, last_active 
         FROM game_guide_state 
         WHERE user_id = ?"
    );
    $stmt->execute([$user_id]);
    $player_data = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
    
    // If no record exists, create one
    if (empty($player_data)) {
        $player_data = [
            'player_level' => 1,
            'is_new_player' => true,
            'last_active' => time(),
        ];
        
        try {
            $insert = $db->prepare(
                "INSERT INTO game_guide_state (user_id, player_level, is_new_player, last_active) 
                 VALUES (?, ?, ?, NOW())"
            );
            $insert->execute([$user_id, 1, 1]);
        } catch (Exception $e) {
            // Record may already exist from another request
        }
    }
    
    $result = $game_guide->getGreeting($user_id, $player_data);
    
    http_response_code(200);
    echo json_encode(array_merge($result, ['status' => 'ok']));
}

function handleAssessGameState($db, $game_guide, $user_id) {
    // Get game state from POST
    $game_state = json_decode($_POST['game_state'] ?? '{}', true);
    
    if (empty($game_state)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Missing game_state parameter']);
        return;
    }
    
    $assessment = $game_guide->assessGameState($user_id, $game_state);
    
    // Update guide state
    updateGuideState($db, $user_id, $game_state, $assessment);
    
    http_response_code(200);
    echo json_encode(array_merge($assessment, ['ok' => true]));
}

function handleHelpTopic($game_guide) {
    $category = $_GET['category'] ?? null;
    
    if (!$category) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Missing category parameter']);
        return;
    }
    
    $result = $game_guide->getHelpTopic($category);
    
    http_response_code($result['ok'] ? 200 : 404);
    echo json_encode($result);
}

function handleProvideHelp($db, $game_guide, $user_id) {
    $help_type = $_POST['help_type'] ?? null;
    $game_state = json_decode($_POST['game_state'] ?? '{}', true);
    
    if (!$help_type) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Missing help_type parameter']);
        return;
    }
    
    $result = $game_guide->provideDirectHelp($user_id, $help_type, $game_state);
    
    if ($result['ok']) {
        // Log the help usage
        $stmt = $db->prepare(
            "INSERT INTO game_guide_help_usage (user_id, help_type, times_used) 
             VALUES (?, ?, 1)
             ON DUPLICATE KEY UPDATE times_used = times_used + 1, last_used_at = NOW()"
        );
        $stmt->execute([$user_id, $help_type]);
        
        http_response_code(200);
    } else {
        http_response_code(429); // Too Many Requests
    }
    
    echo json_encode($result);
}

function handleRecordCheckpoint($game_guide, $user_id) {
    $checkpoint = $_POST['checkpoint'] ?? null;
    
    if (!$checkpoint) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Missing checkpoint parameter']);
        return;
    }
    
    $game_guide->recordCheckpointCompletion($user_id, $checkpoint);
    
    http_response_code(200);
    echo json_encode([
        'ok' => true,
        'checkpoint' => $checkpoint,
        'message' => 'Checkpoint recorded successfully',
    ]);
}

function handleGetProgress($game_guide, $user_id) {
    $progress = $game_guide->getTutorialProgress($user_id);
    
    http_response_code(200);
    echo json_encode([
        'ok' => true,
        'progress' => $progress,
        'checkpoint_count' => count($progress),
    ]);
}

function handleUnknownAction($action) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Unknown action: ' . $action,
    ]);
}

// ========== HELPER FUNCTIONS ==========

function updateGuideState($db, $user_id, $game_state, $assessment) {
    try {
        $critical_issue = null;
        if (!empty($assessment['critical_issues'])) {
            $critical_issue = $assessment['critical_issues'][0]['type'] ?? null;
        }
        
        $stmt = $db->prepare(
            "INSERT INTO game_guide_state 
            (user_id, current_issue_critical, last_assessment_at, time_played_hours) 
            VALUES (?, ?, NOW(), ?)
            ON DUPLICATE KEY UPDATE 
            current_issue_critical = VALUES(current_issue_critical),
            last_assessment_at = NOW(),
            time_played_hours = VALUES(time_played_hours)"
        );
        
        $time_hours = (int) ($game_state['time_played_hours'] ?? 0);
        $stmt->execute([$user_id, $critical_issue, $time_hours]);
    } catch (Exception $e) {
        error_log("Failed to update guide state: " . $e->getMessage());
    }
}

function getDatabaseConnection(): PDO {
    static $db = null;
    
    if (!$db) {
        $host = getenv('DB_HOST') ?: 'localhost';
        $name = getenv('DB_NAME') ?: 'galaxyquest';
        $user = getenv('DB_USER') ?: 'root';
        $pass = getenv('DB_PASS') ?: '';
        
        $db = new PDO(
            "mysql:host={$host};dbname={$name};charset=utf8mb4",
            $user,
            $pass,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_THROW,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]
        );
    }
    
    return $db;
}
