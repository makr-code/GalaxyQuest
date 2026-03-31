<?php
/**
 * Authentication API
 * POST /api/auth.php?action=register
 * POST /api/auth.php?action=login
 * POST /api/auth.php?action=logout
 * GET  /api/auth.php?action=me
 * GET  /api/auth.php?action=csrf
 *
 * TOTP 2FA:
 * GET  /api/auth.php?action=totp_status
 * GET  /api/auth.php?action=totp_begin_setup
 * POST /api/auth.php?action=totp_confirm_setup
 * POST /api/auth.php?action=totp_disable
 * POST /api/auth.php?action=totp_login_challenge
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/achievements.php';
require_once __DIR__ . '/galaxy_seed.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/character_profile_generator.php';
require_once __DIR__ . '/totp.php';

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

    // ── TOTP 2FA ────────────────────────────────────────────────────────────
    case 'totp_status':
        only_method('GET');
        handle_totp_status();
        break;

    case 'totp_begin_setup':
        only_method('POST');
        handle_totp_begin_setup();
        break;

    case 'totp_confirm_setup':
        only_method('POST');
        handle_totp_confirm_setup();
        break;

    case 'totp_disable':
        only_method('POST');
        handle_totp_disable();
        break;

    case 'totp_login_challenge':
        only_method('POST');
        handle_totp_login_challenge();
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
        'INSERT INTO users (username, email, password_hash, protection_until, control_type, auth_enabled)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), ?, 1)'
    )->execute([$username, $email, $hash, 'human']);
    $userId = (int)$db->lastInsertId();

    // Create homeworld
    $planet = create_homeworld($userId);

    // Generate and persist initial character dossier + portrait assets.
    try {
        ensure_user_character_profile($db, $userId, false, $username);
    } catch (Throwable $e) {
        error_log('character profile generation failed for user ' . $userId . ': ' . $e->getMessage());
    }

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

    $db       = get_db();
    $clientIp = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $ipHash   = hash('sha256', $clientIp);

    // Expire stale attempt counters outside the rolling window.
    $db->prepare(
        'DELETE FROM login_attempts
         WHERE ip_hash = ?
           AND first_attempt_at < DATE_SUB(NOW(), INTERVAL ? SECOND)
           AND (locked_until IS NULL OR locked_until <= NOW())'
    )->execute([$ipHash, LOGIN_WINDOW_SECONDS]);

    // Enforce active lockout.
    $stmt = $db->prepare('SELECT attempt_count, locked_until FROM login_attempts WHERE ip_hash = ?');
    $stmt->execute([$ipHash]);
    $attempts = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($attempts && $attempts['locked_until'] !== null) {
        $lockedUntil = strtotime($attempts['locked_until']);
        if ($lockedUntil > time()) {
            $minsLeft = (int)ceil(($lockedUntil - time()) / 60);
            json_error("Too many failed login attempts. Try again in {$minsLeft} minute(s).", 429);
        }
    }

    $stmt = $db->prepare('SELECT id, username, password_hash, is_admin, COALESCE(totp_enabled, 0) AS totp_enabled, deleted_at, control_type, auth_enabled FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        // Record failed attempt; lock account after LOGIN_MAX_ATTEMPTS consecutive failures.
        $newCount    = (int)($attempts['attempt_count'] ?? 0) + 1;
        $lockedUntil = $newCount >= LOGIN_MAX_ATTEMPTS
            ? date('Y-m-d H:i:s', time() + LOGIN_LOCKOUT_SECONDS)
            : null;
        $db->prepare(
            'INSERT INTO login_attempts (ip_hash, attempt_count, first_attempt_at, locked_until)
             VALUES (?, 1, NOW(), NULL)
             ON DUPLICATE KEY UPDATE attempt_count = ?, locked_until = ?'
        )->execute([$ipHash, $newCount, $lockedUntil]);
        json_error('Invalid username or password.', 401);
    }

    // Successful login — clear any recorded failures for this IP.
    $db->prepare('DELETE FROM login_attempts WHERE ip_hash = ?')->execute([$ipHash]);

    // Refuse non-auth actors and deleted accounts.
    if ($user['deleted_at'] !== null || (int)($user['auth_enabled'] ?? 0) !== 1 || (string)($user['control_type'] ?? 'human') !== 'human') {
        json_error('Invalid username or password.', 401);
    }

    // ── TOTP 2FA challenge ────────────────────────────────────────────────────
    $totpEnabled = (int)($user['totp_enabled'] ?? 0);

    if ($totpEnabled === 1) {
        // Issue a short-lived half-auth token instead of a full session.
        $halfToken = bin2hex(random_bytes(32));
        $db->prepare(
            'DELETE FROM totp_pending_sessions WHERE user_id = ?'
        )->execute([(int)$user['id']]);
        $db->prepare(
            'INSERT INTO totp_pending_sessions (token, user_id, expires_at, remember_me)
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), ?)'
        )->execute([$halfToken, (int)$user['id'], $remember ? 1 : 0]);

        json_ok([
            'requires_2fa'  => true,
            'totp_session'  => $halfToken,
            'user'          => [
                'id'       => (int)$user['id'],
                'username' => $user['username'],
            ],
        ]);
    }
    // ── Full login (no 2FA) ─────────────────────────────────────────────────

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

    json_ok(['user' => ['id' => (int)$user['id'], 'username' => $user['username'], 'is_admin' => (int)($user['is_admin'] ?? 0)]]);
}

function handle_logout(): void {
    // Logout must remain resilient even when CSRF/session state is stale.
    // We intentionally do not enforce CSRF here to prevent "stuck logged-in" states.
    session_start_secure();
    $uid = isset($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : 0;

    if ($uid > 0) {
        revoke_all_remember_me_tokens_for_user($uid);
    }
    revoke_remember_me_token_from_cookie();

    $_SESSION = [];

    clear_session_cookies();

    session_destroy();

    json_ok(['message' => 'Logged out successfully']);
}

function handle_me(): void {
    $uid = require_auth();
    $db   = get_db();
    $stmt = $db->prepare(
        'SELECT id, username, email, dark_matter, rank_points,
                protection_until, vacation_mode, pvp_mode, created_at, last_login, is_admin
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

// ─── TOTP Handlers ───────────────────────────────────────────────────────────

/** GET /api/auth.php?action=totp_status  (requires active session) */
function handle_totp_status(): void {
    $uid = require_auth();
    $db  = get_db();
    $row = $db->prepare('SELECT totp_enabled FROM users WHERE id = ?');
    $row->execute([$uid]);
    $data = $row->fetch(PDO::FETCH_ASSOC);
    json_ok(['enabled' => (bool)(int)($data['totp_enabled'] ?? 0)]);
}

/**
 * GET /api/auth.php?action=totp_begin_setup  (requires active session)
 *
 * Generates a new random secret, stores it as PENDING (not yet activated)
 * and returns the otpauth:// URI so the frontend can render a QR code.
 */
function handle_totp_begin_setup(): void {
    verify_csrf();
    $uid      = require_auth();
    $db       = get_db();
    $secret   = totp_generate_secret();

    // Store the pending secret; it becomes active only after totp_confirm_setup.
    $db->prepare('UPDATE users SET totp_pending_secret = ? WHERE id = ?')
        ->execute([$secret, $uid]);

    $usernameRow = $db->prepare('SELECT username FROM users WHERE id = ?');
    $usernameRow->execute([$uid]);
    $username = $usernameRow->fetchColumn() ?: 'Commander';

    json_ok([
        'uri'    => totp_uri($secret, $username),
        'secret' => $secret, // shown as manual entry key in the frontend
    ]);
}

/**
 * POST /api/auth.php?action=totp_confirm_setup  (requires active session)
 *
 * Verifies that the user successfully scanned the QR code by confirming
 * the first TOTP code. Activates 2FA on success.
 *
 * Body: { code: "123456", csrf: ... }
 */
function handle_totp_confirm_setup(): void {
    verify_csrf();
    $uid  = require_auth();
    $body = get_json_body();
    $code = trim($body['code'] ?? '');

    $db  = get_db();
    $row = $db->prepare('SELECT totp_pending_secret FROM users WHERE id = ?');
    $row->execute([$uid]);
    $pendingSecret = $row->fetchColumn();

    if (!$pendingSecret) {
        json_error('No pending 2FA setup found. Please start setup again.', 400);
    }

    if (!totp_verify($pendingSecret, $code)) {
        json_error('Invalid code. Please try again.', 422);
    }

    // Activate 2FA.
    $db->prepare(
        'UPDATE users SET totp_enabled = 1, totp_secret = ?, totp_pending_secret = NULL WHERE id = ?'
    )->execute([$pendingSecret, $uid]);

    json_ok(['message' => '2FA successfully enabled.']);
}

/**
 * POST /api/auth.php?action=totp_disable  (requires active session + valid TOTP)
 *
 * Body: { code: "123456", csrf: ... }
 */
function handle_totp_disable(): void {
    verify_csrf();
    $uid  = require_auth();
    $body = get_json_body();
    $code = trim($body['code'] ?? '');

    $db  = get_db();
    $row = $db->prepare('SELECT totp_secret FROM users WHERE id = ? AND totp_enabled = 1');
    $row->execute([$uid]);
    $secret = $row->fetchColumn();

    if (!$secret) {
        json_error('2FA is not currently enabled for this account.', 400);
    }

    if (!totp_verify($secret, $code)) {
        json_error('Invalid code. 2FA remains active.', 422);
    }

    $db->prepare(
        'UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_pending_secret = NULL WHERE id = ?'
    )->execute([$uid]);

    json_ok(['message' => '2FA successfully disabled.']);
}

/**
 * POST /api/auth.php?action=totp_login_challenge  (no session required yet)
 *
 * Second step of the login flow when 2FA is active.
 * Validates the half-auth token and the TOTP code, then creates a full session.
 *
 * Body: { totp_session: "hex…", code: "123456", csrf: ... }
 */
function handle_totp_login_challenge(): void {
    verify_csrf();
    $body        = get_json_body();
    $halfToken   = trim($body['totp_session'] ?? '');
    $code        = trim($body['code'] ?? '');

    if ($halfToken === '' || strlen($halfToken) !== 64) {
        json_error('Invalid 2FA session.', 400);
    }

    $db = get_db();

    // Clean up expired pending sessions.
    $db->prepare('DELETE FROM totp_pending_sessions WHERE expires_at <= NOW()')->execute();

    $row = $db->prepare(
        'SELECT user_id, attempts, remember_me FROM totp_pending_sessions WHERE token = ?'
    );
    $row->execute([$halfToken]);
    $pending = $row->fetch(PDO::FETCH_ASSOC);

    if (!$pending) {
        json_error('2FA session expired or not found. Please log in again.', 401);
    }

    // Rate-limit TOTP brute-force: max 5 attempts per pending session.
    if ((int)$pending['attempts'] >= 5) {
        $db->prepare('DELETE FROM totp_pending_sessions WHERE token = ?')->execute([$halfToken]);
        json_error('Too many incorrect codes. Please log in again.', 429);
    }

    $uid     = (int)$pending['user_id'];
    $userRow = $db->prepare('SELECT id, username, is_admin, totp_secret FROM users WHERE id = ?');
    $userRow->execute([$uid]);
    $user = $userRow->fetch(PDO::FETCH_ASSOC);

    if (!$user || !$user['totp_secret']) {
        $db->prepare('DELETE FROM totp_pending_sessions WHERE token = ?')->execute([$halfToken]);
        json_error('Account data error. Please contact support.', 500);
    }

    if (!totp_verify($user['totp_secret'], $code)) {
        // Increment attempt counter.
        $db->prepare(
            'UPDATE totp_pending_sessions SET attempts = attempts + 1 WHERE token = ?'
        )->execute([$halfToken]);
        json_error('Invalid code. Please try again.', 422);
    }

    // TOTP verified – promote to full session.
    $db->prepare('DELETE FROM totp_pending_sessions WHERE token = ?')->execute([$halfToken]);
    $db->prepare('UPDATE users SET last_login = NOW() WHERE id = ?')->execute([$uid]);

    session_start_secure();
    session_regenerate_id(true);
    $_SESSION['user_id']  = $uid;
    $_SESSION['username'] = $user['username'];

    // Honour the remember-me preference passed through the half-auth token.
    $remember = (int)($pending['remember_me'] ?? 0) === 1;
    if ($remember) {
        issue_remember_me_token($uid);
    } else {
        revoke_remember_me_token_from_cookie();
    }

    json_ok([
        'user' => [
            'id'       => $uid,
            'username' => $user['username'],
            'is_admin' => (int)($user['is_admin'] ?? 0),
        ],
    ]);
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

    // Hard migration path: colony identity is anchored on celestial_bodies.id.
    $bodyUid = sprintf('legacy-p-%d-%d-%d', $g, $s, $p);
    $bodyStmt = $db->prepare('SELECT id FROM celestial_bodies WHERE body_uid = ? LIMIT 1');
    $bodyStmt->execute([$bodyUid]);
    $bodyId = (int)($bodyStmt->fetchColumn() ?: 0);
    if ($bodyId <= 0) {
        $db->prepare(
            'INSERT INTO celestial_bodies
                (body_uid, galaxy_index, system_index, position, body_type, parent_body_type,
                 name, planet_class, can_colonize, payload_json)
             VALUES (?, ?, ?, ?, \'planet\', \'star\', ?, \'terrestrial\', 1, JSON_OBJECT(\'legacy_planet_id\', ?))'
        )->execute([
            $bodyUid,
            $g,
            $s,
            $p,
            'Planet ' . $p,
            $planetId,
        ]);
        $bodyId = (int)$db->lastInsertId();
    }

    $resources = $starter['resources'] ?? [];
    $population = $starter['population'] ?? [];

    // Create the homeworld colony with configurable starter values.
    $db->prepare(
        'INSERT INTO colonies
            (planet_id, body_id, user_id, name, colony_type, is_homeworld,
             metal, crystal, deuterium, rare_earth, food, energy,
             population, max_population, happiness, public_services, last_update)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())'
    )->execute([
        $planetId,
        $bodyId,
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
        'nano_materials', 'genetic_engineering', 'quantum_computing',
        'dark_energy_tap', 'wormhole_theory', 'terraforming_tech', 'stealth_tech',
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
        'SELECT c.id
         FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         WHERE cb.galaxy_index = ? AND cb.system_index = ? AND cb.position = ?'
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
