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

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'csrf':
        only_method('GET');
        json_ok(['token' => csrf_token()]);
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

    // Seed achievement tracker and run first check
    ensure_user_achievements_seeded($db, $userId);

    session_start_secure();
    session_regenerate_id(true);
    $_SESSION['user_id']  = $userId;
    $_SESSION['username'] = $username;

    json_ok([
        'user'          => ['id' => $userId, 'username' => $username],
        'homeworld_id'  => $planet,
    ]);
}

function handle_login(): void {
    verify_csrf();
    $body     = get_json_body();
    $username = trim($body['username'] ?? '');
    $password = $body['password'] ?? '';

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

    json_ok(['user' => ['id' => (int)$user['id'], 'username' => $user['username']]]);
}

function handle_logout(): void {
    session_start_secure();
    $_SESSION = [];
    session_destroy();
    json_ok();
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a homeworld at a random free position and seed default buildings.
 */
function create_homeworld(int $userId): int {
    $db = get_db();

    // Find a free slot
    [$g, $s, $p] = find_free_position($db);

    $db->prepare(
        'INSERT INTO planets (user_id, name, galaxy, system, position, type, is_homeworld,
                              metal, crystal, deuterium, last_update)
         VALUES (?, ?, ?, ?, ?, \'terrestrial\', 1, 500, 300, 100, NOW())'
    )->execute([$userId, 'Homeworld', $g, $s, $p]);
    $planetId = (int)$db->lastInsertId();

    // Default buildings
    $defaultBuildings = [
        'metal_mine'       => 1,
        'crystal_mine'     => 1,
        'deuterium_synth'  => 0,
        'solar_plant'      => 1,
        'fusion_reactor'   => 0,
        'robotics_factory' => 0,
        'shipyard'         => 0,
        'metal_storage'    => 0,
        'crystal_storage'  => 0,
        'deuterium_tank'   => 0,
        'research_lab'     => 0,
        'missile_silo'     => 0,
        'nanite_factory'   => 0,
        'terraformer'      => 0,
    ];
    $ins = $db->prepare(
        'INSERT INTO buildings (planet_id, type, level) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE level = VALUES(level)'
    );
    foreach ($defaultBuildings as $type => $level) {
        $ins->execute([$planetId, $type, $level]);
    }

    // Default research
    $defaultResearch = [
        'energy_tech', 'laser_tech', 'ion_tech', 'hyperspace_tech',
        'plasma_tech', 'combustion_drive', 'impulse_drive', 'hyperspace_drive',
        'espionage_tech', 'computer_tech', 'astrophysics', 'intergalactic_network',
        'graviton_tech', 'weapons_tech', 'shielding_tech', 'armor_tech',
    ];
    $resIns = $db->prepare(
        'INSERT IGNORE INTO research (user_id, type, level) VALUES (?, ?, 0)'
    );
    foreach ($defaultResearch as $type) {
        $resIns->execute([$userId, $type]);
    }

    return $planetId;
}

function find_free_position(PDO $db): array {
    // Try up to 100 random positions
    for ($attempt = 0; $attempt < 100; $attempt++) {
        $g = random_int(1, GALAXY_MAX);
        $s = random_int(1, SYSTEM_MAX);
        $p = random_int(1, POSITION_MAX);
        $stmt = $db->prepare(
            'SELECT id FROM planets WHERE galaxy = ? AND system = ? AND position = ?'
        );
        $stmt->execute([$g, $s, $p]);
        if (!$stmt->fetch()) {
            return [$g, $s, $p];
        }
    }
    // Fallback: linear scan
    for ($g = 1; $g <= GALAXY_MAX; $g++) {
        for ($s = 1; $s <= SYSTEM_MAX; $s++) {
            for ($p = 1; $p <= POSITION_MAX; $p++) {
                $stmt = $db->prepare(
                    'SELECT id FROM planets WHERE galaxy = ? AND system = ? AND position = ?'
                );
                $stmt->execute([$g, $s, $p]);
                if (!$stmt->fetch()) {
                    return [$g, $s, $p];
                }
            }
        }
    }
    json_error('Galaxy is full!', 503);
}
