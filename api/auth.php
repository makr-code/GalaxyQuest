<?php
/**
 * Authentication API
 * POST /api/auth.php?action=register
 * POST /api/auth.php?action=login
 * POST /api/auth.php?action=logout
 * GET  /api/auth.php?action=me
 * GET  /api/auth.php?action=csrf
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/achievements.php';
require_once __DIR__ . '/galaxy_seed.php';
require_once __DIR__ . '/game_engine.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'csrf':
        only_method('GET');
        json_ok(['token' => csrf_token()]);
        break;

    case 'dev_tools_status':
        only_method('GET');
        handle_dev_tools_status();
        break;

    case 'register':
        only_method('POST');
        handle_register();
        break;

    case 'login':
        only_method('POST');
        handle_login();
        break;

    case 'logout':
        only_method('POST');
        handle_logout();
        break;

    case 'me':
        only_method('GET');
        handle_me();
        break;

    case 'dev_reset_password':
        only_method('POST');
        handle_dev_reset_password();
        break;

    default:
        json_error('Unknown action');
}

// ─── Handlers ────────────────────────────────────────────────────────────────

function handle_register(): void {
    verify_csrf();
    $body     = get_json_body();
    $username = trim($body['username'] ?? '');
    $email    = trim($body['email'] ?? '');
    $password = $body['password'] ?? '';
    $remember = !empty($body['remember']);

    if (!preg_match('/^[A-Za-z0-9_]{3,32}$/', $username)) {
        json_error('Username must be 3-32 alphanumeric characters or underscores.');
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        json_error('Invalid email address.');
    }
    if (strlen($password) < 8) {
        json_error('Password must be at least 8 characters.');
    }

    $db   = get_db();
    $stmt = $db->prepare('SELECT id FROM users WHERE username = ? OR email = ?');
    $stmt->execute([$username, $email]);
    if ($stmt->fetch()) {
        json_error('Username or email already taken.');
    }

    $hash = password_hash($password, PASSWORD_BCRYPT);
    $db->prepare(
        'INSERT INTO users (username, email, password_hash, protection_until)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))'
    )->execute([$username, $email, $hash]);
    $userId = (int)$db->lastInsertId();

    // Create homeworld
    $planet = create_homeworld($userId);

    // Seed achievement tracker if the optional achievements tables exist.
    try {
        ensure_user_achievements_seeded($db, $userId);
    } catch (Throwable $e) {
        // Keep registration working on partial/legacy schemas.
    }

    session_start_secure();
    session_regenerate_id(true);
    $_SESSION['user_id']  = $userId;
    $_SESSION['username'] = $username;

    if ($remember) {
        issue_remember_me_token($userId);
    } else {
        revoke_remember_me_token_from_cookie();
    }

    json_ok([
        'user'               => ['id' => $userId, 'username' => $username],
        'homeworld_colony_id' => $planet,
    ]);
}

function handle_login(): void {
    verify_csrf();
    $body     = get_json_body();
    $username = trim($body['username'] ?? '');
    $password = $body['password'] ?? '';
    $remember = !empty($body['remember']);

    if ($username === '' || $password === '') {
        json_error('Username and password required.');
    }

    $db   = get_db();
    $stmt = $db->prepare('SELECT id, username, password_hash FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        json_error('Invalid username or password.', 401);
    }

    $db->prepare('UPDATE users SET last_login = NOW() WHERE id = ?')->execute([$user['id']]);

    session_start_secure();
    session_regenerate_id(true);
    $_SESSION['user_id']  = (int)$user['id'];
    $_SESSION['username'] = $user['username'];

    if ($remember) {
        issue_remember_me_token((int)$user['id']);
    } else {
        revoke_remember_me_token_from_cookie();
    }

    json_ok(['user' => ['id' => (int)$user['id'], 'username' => $user['username']]]);
}

function handle_logout(): void {
    // Verify CSRF token for security
    verify_csrf();
    
    // Clear remember-me token from DB and cookie
    revoke_remember_me_token_from_cookie();
    
    // Start and clear session data
    session_start_secure();
    $_SESSION = [];
    
    // Explicitly delete session cookie
    clear_session_cookies();
    
    // Destroy session on server
    session_destroy();
    
    // Confirm logout to client
    json_ok(['message' => 'Logged out successfully']);
}

function handle_me(): void {
    $uid = require_auth();
    $db   = get_db();
    $stmt = $db->prepare(
        'SELECT id, username, email, dark_matter, rank_points,
                protection_until, vacation_mode, pvp_mode, created_at, last_login
         FROM users WHERE id = ?'
    );
    $stmt->execute([$uid]);
    $user = $stmt->fetch();
    if (!$user) {
        json_error('User not found', 404);
    }
    // Count unclaimed completed achievements for badge
    $badge = $db->prepare(
        'SELECT COUNT(*) FROM user_achievements
         WHERE user_id = ? AND completed = 1 AND reward_claimed = 0'
    );
    $badge->execute([$uid]);
    $user['unclaimed_quests'] = (int)$badge->fetchColumn();
    json_ok(['user' => $user]);
}

function handle_dev_tools_status(): void {
    json_ok(['enabled' => ENABLE_DEV_AUTH_TOOLS === 1]);
}

function handle_dev_reset_password(): void {
    if (ENABLE_DEV_AUTH_TOOLS !== 1) {
        json_error('Dev auth tools disabled.', 403);
    }
    verify_csrf();
    enforce_dev_reset_rate_limit();
    $body = get_json_body();
    $username = trim($body['username'] ?? '');
    $newPassword = $body['password'] ?? '';

    if (!preg_match('/^[A-Za-z0-9_]{3,32}$/', $username)) {
        json_error('Invalid username format.');
    }
    if (strlen($newPassword) < 8) {
        json_error('Password must be at least 8 characters.');
    }

    $db = get_db();
    $stmt = $db->prepare('SELECT id FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $userId = $stmt->fetchColumn();
    if (!$userId) {
        json_error('User not found.', 404);
    }

    $hash = password_hash($newPassword, PASSWORD_BCRYPT);
    $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$hash, $userId]);

    // Revoke all remember-me sessions for this account after password reset.
    $db->prepare('DELETE FROM remember_tokens WHERE user_id = ?')->execute([$userId]);

    json_ok(['message' => 'Password reset for ' . $username]);
}

function enforce_dev_reset_rate_limit(): void {
    // Dev-only limiter: max 5 reset attempts per 10 minutes per browser session.
    $windowSeconds = 600;
    $maxAttempts = 5;
    $now = time();

    session_start_secure();
    $attempts = $_SESSION['dev_reset_attempts'] ?? [];
    if (!is_array($attempts)) {
        $attempts = [];
    }

    $attempts = array_values(array_filter($attempts, fn($ts) => is_int($ts) && ($now - $ts) < $windowSeconds));

    if (count($attempts) >= $maxAttempts) {
        $retryAfter = $windowSeconds - ($now - $attempts[0]);
        header('Retry-After: ' . max(1, $retryAfter));
        json_error('Too many reset attempts. Please wait a few minutes.', 429);
    }

    $attempts[] = $now;
    $_SESSION['dev_reset_attempts'] = $attempts;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function starter_homeworld_config(string $username): array {
    $defaults = [
        'colony_name_template' => "{username}'s Homeworld",
        'colony_type' => 'balanced',
        'resources' => [
            'metal' => 500,
            'crystal' => 300,
            'deuterium' => 100,
            'rare_earth' => 0,
            'food' => 200,
            'energy' => 0,
        ],
        'population' => [
            'population' => 100,
            'max_population' => 500,
            'happiness' => 70,
            'public_services' => 0,
        ],
        'buildings' => [
            'metal_mine' => 1,
            'crystal_mine' => 1,
            'deuterium_synth' => 0,
            'rare_earth_drill' => 0,
            'solar_plant' => 1,
            'fusion_reactor' => 0,
            'hydroponic_farm' => 0,
            'food_silo' => 0,
            'habitat' => 0,
            'hospital' => 0,
            'school' => 0,
            'security_post' => 0,
            'robotics_factory' => 0,
            'shipyard' => 0,
            'metal_storage' => 0,
            'crystal_storage' => 0,
            'deuterium_tank' => 0,
            'research_lab' => 0,
            'missile_silo' => 0,
            'nanite_factory' => 0,
            'terraformer' => 0,
            'colony_hq' => 0,
        ],
        'ships' => [
            'small_cargo' => 1,
            'espionage_probe' => 1,
        ],
        'story' => [
            'messages' => [
                [
                    'subject' => 'Welcome Commander',
                    'body' => "Commander {username}, your story begins on {colony_name}.",
                    'quest_hook' => 'Review your world and prepare your first moves.',
                ],
            ],
            'subject' => 'Welcome Commander',
            'body' => "Commander {username},\\n\\nWelcome to {colony_name}. Your people await your first orders.",
        ],
    ];

    $path = __DIR__ . '/../config/galaxy_config.json';
    if (is_file($path)) {
        $raw = file_get_contents($path);
        $json = json_decode($raw ?: '', true);
        if (is_array($json) && isset($json['starter_homeworld']) && is_array($json['starter_homeworld'])) {
            $defaults = array_replace_recursive($defaults, $json['starter_homeworld']);
        }
    }

    $template = (string)($defaults['colony_name_template'] ?? "{username}'s Homeworld");
    $defaults['colony_name'] = str_replace('{username}', $username, $template);
    return $defaults;
}

function ensure_homeworld_support_tables(PDO $db): void {
    // Legacy/partial schemas may miss these tables in dev environments.
    $db->exec(
        'CREATE TABLE IF NOT EXISTS ships (
            id INT AUTO_INCREMENT PRIMARY KEY,
            colony_id INT NOT NULL,
            type VARCHAR(64) NOT NULL,
            count INT NOT NULL DEFAULT 0,
            FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
            UNIQUE KEY unique_ship (colony_id, type)
        ) ENGINE=InnoDB'
    );

    $db->exec(
        'CREATE TABLE IF NOT EXISTS messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sender_id INT DEFAULT NULL,
            receiver_id INT NOT NULL,
            subject VARCHAR(255) NOT NULL DEFAULT \'\',
            body TEXT NOT NULL,
            is_read TINYINT(1) NOT NULL DEFAULT 0,
            sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB'
    );
}

function render_story_template(string $template, string $username, string $colonyName, ?string $questHook = null): string {
    $replacements = [
        '{username}' => $username,
        '{colony_name}' => $colonyName,
        '{quest_hook}' => $questHook ?? '',
    ];
    return strtr($template, $replacements);
}

function seed_homeworld_story(PDO $db, int $userId, string $username, string $colonyName, array $story): void {
    $messages = $story['messages'] ?? null;
    if (!is_array($messages) || count($messages) === 0) {
        $messages = [[
            'subject' => (string)($story['subject'] ?? 'Welcome Commander'),
            'body' => (string)($story['body'] ?? 'Commander {username}, your story begins on {colony_name}.'),
            'quest_hook' => null,
        ]];
    }

    $insert = $db->prepare(
        'INSERT INTO messages (sender_id, receiver_id, subject, body) VALUES (NULL, ?, ?, ?)'
    );

    foreach ($messages as $message) {
        if (!is_array($message)) {
            continue;
        }
        $subject = render_story_template(
            (string)($message['subject'] ?? 'Story Update'),
            $username,
            $colonyName,
            isset($message['quest_hook']) ? (string)$message['quest_hook'] : null
        );
        $body = render_story_template(
            (string)($message['body'] ?? ''),
            $username,
            $colonyName,
            isset($message['quest_hook']) ? (string)$message['quest_hook'] : null
        );
        $questHook = trim((string)($message['quest_hook'] ?? ''));
        if ($questHook !== '') {
            $body .= "\n\nQuest Hook: " . $questHook;
        }
        $insert->execute([$userId, $subject, $body]);
    }
}

/**
 * Create a homeworld at a random free position and seed default buildings.
 */
function create_homeworld(int $userId): int {
    $db = get_db();
    ensure_homeworld_support_tables($db);
    ensure_galaxy_bootstrap_progress($db);

    // Username for colony name
    $uRow = $db->prepare('SELECT username FROM users WHERE id = ?');
    $uRow->execute([$userId]);
    $username = $uRow->fetchColumn() ?: 'Commander';
    $starter = starter_homeworld_config((string)$username);
    $colonyName = (string)($starter['colony_name'] ?? ($username . "'s Homeworld"));
    $colonyType = (string)($starter['colony_type'] ?? 'balanced');

    // Find a free slot (position not already occupied by a colony)
    [$g, $s, $p] = find_free_position($db);
    seed_user_start_region($db, $g, $s);

    // Create or reuse a planet record (pure astronomical object – no user data)
    $pCheck = $db->prepare('SELECT id FROM planets WHERE galaxy=? AND `system`=? AND position=?');
    $pCheck->execute([$g, $s, $p]);
    $existingPlanet = $pCheck->fetch();
    if ($existingPlanet) {
        $planetId = (int)$existingPlanet['id'];
    } else {
        $db->prepare(
            'INSERT INTO planets (galaxy, `system`, position, type) VALUES (?, ?, ?, \'terrestrial\')'
        )->execute([$g, $s, $p]);
        $planetId = (int)$db->lastInsertId();
    }

    $resources = $starter['resources'] ?? [];
    $population = $starter['population'] ?? [];

    // Create the homeworld colony with configurable starter values.
    $db->prepare(
        'INSERT INTO colonies
            (planet_id, user_id, name, colony_type, is_homeworld,
             metal, crystal, deuterium, rare_earth, food, energy,
             population, max_population, happiness, public_services, last_update)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())'
    )->execute([
        $planetId,
        $userId,
        $colonyName,
        $colonyType,
        (float)($resources['metal'] ?? 500),
        (float)($resources['crystal'] ?? 300),
        (float)($resources['deuterium'] ?? 100),
        (float)($resources['rare_earth'] ?? 0),
        (float)($resources['food'] ?? 200),
        (int)($resources['energy'] ?? 0),
        (int)($population['population'] ?? 100),
        (int)($population['max_population'] ?? 500),
        (int)($population['happiness'] ?? 70),
        (int)($population['public_services'] ?? 0),
    ]);
    $colonyId = (int)$db->lastInsertId();

    // Homeworld is always fully visible for its owner
    touch_system_visibility($db, $userId, $g, $s, 'own', null, null);

    // Seed default buildings on the colony
    $defaultBuildings = is_array($starter['buildings'] ?? null) ? $starter['buildings'] : [];
    $ins = $db->prepare(
        'INSERT INTO buildings (colony_id, type, level) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE level = VALUES(level)'
    );
    foreach ($defaultBuildings as $type => $level) {
        $ins->execute([$colonyId, $type, $level]);
    }

    // Default research entries (per user, not per colony)
    $defaultResearch = [
        'energy_tech', 'laser_tech', 'ion_tech', 'hyperspace_tech',
        'plasma_tech', 'combustion_drive', 'impulse_drive', 'hyperspace_drive',
        'espionage_tech', 'computer_tech', 'astrophysics', 'intergalactic_network',
        'graviton_tech', 'weapons_tech', 'shielding_tech', 'armor_tech',
    ];
    $resIns = $db->prepare('INSERT IGNORE INTO research (user_id, type, level) VALUES (?, ?, 0)');
    foreach ($defaultResearch as $type) {
        $resIns->execute([$userId, $type]);
    }

    // Seed starter ships.
    $starterShips = is_array($starter['ships'] ?? null) ? $starter['ships'] : [];
    $shipIns = $db->prepare(
        'INSERT INTO ships (colony_id, type, count) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE count = VALUES(count)'
    );
    foreach ($starterShips as $type => $count) {
        $shipIns->execute([$colonyId, $type, max(0, (int)$count)]);
    }

    // Narrative intro messages / story chapters.
    $story = is_array($starter['story'] ?? null) ? $starter['story'] : [];
    try {
        seed_homeworld_story($db, $userId, (string)$username, $colonyName, $story);
    } catch (Throwable $e) {
        // Keep registration resilient on unusual legacy setups.
    }

    return $colonyId;
}

function find_free_position(PDO $db): array {
    $systemLimit = galaxy_system_limit();
    // Check whether a position has a colony on it
    $check = $db->prepare(
        'SELECT c.id FROM colonies c
         JOIN planets p ON p.id = c.planet_id
            WHERE p.galaxy = ? AND p.`system` = ? AND p.position = ?'
    );
    // Random tries first
    for ($attempt = 0; $attempt < 100; $attempt++) {
        $g = random_int(1, GALAXY_MAX);
        $s = random_int(1, $systemLimit);
        $p = random_int(1, POSITION_MAX);
        $check->execute([$g, $s, $p]);
        if (!$check->fetch()) {
            return [$g, $s, $p];
        }
    }
    // Fallback: linear scan
    for ($g = 1; $g <= GALAXY_MAX; $g++) {
        for ($s = 1; $s <= $systemLimit; $s++) {
            for ($p = 1; $p <= POSITION_MAX; $p++) {
                $check->execute([$g, $s, $p]);
                if (!$check->fetch()) {
                    return [$g, $s, $p];
                }
            }
        }
    }
    json_error('Galaxy is full!', 503);
}
