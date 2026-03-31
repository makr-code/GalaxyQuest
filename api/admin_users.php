<?php
/**
 * Admin User CRUD API
 *
 * All endpoints require an active admin session.
 *
 * GET    /api/admin_users.php?action=list[&page=1&limit=50&q=search]
 * GET    /api/admin_users.php?action=get&id=N
 * POST   /api/admin_users.php?action=create
 *        Body: { username, email, password?, is_admin?, control_type?, auth_enabled? }
 * POST   /api/admin_users.php?action=update
 *        Body: { id, username?, email?, is_admin?, password? }
 * POST   /api/admin_users.php?action=delete
 *        Body: { id }
 *        Scrubs PII, converts the row to a ghost NPC so all FK-linked
 *        game data (colonies, fleets, research, …) is preserved.
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/achievements.php';
require_once __DIR__ . '/galaxy_seed.php';
require_once __DIR__ . '/character_profile_generator.php';

$action = $_GET['action'] ?? '';

// All admin-users endpoints require a valid admin session.
$uid = require_auth();
$db  = get_db();

if (!is_admin_user($db, $uid)) {
    json_error('Admin access required.', 403);
}

switch ($action) {
    case 'list':
        only_method('GET');
        handle_list($db);
        break;

    case 'get':
        only_method('GET');
        handle_get($db);
        break;

    case 'create':
        only_method('POST');
        verify_csrf();
        handle_create($db);
        break;

    case 'update':
        only_method('POST');
        verify_csrf();
        handle_update($db, $uid);
        break;

    case 'delete':
        only_method('POST');
        verify_csrf();
        handle_delete($db, $uid);
        break;

    default:
        json_error('Unknown action');
}

// ─── Handlers ────────────────────────────────────────────────────────────────

function handle_list(PDO $db): void
{
    $page  = max(1, (int)($_GET['page']  ?? 1));
    $limit = min(200, max(1, (int)($_GET['limit'] ?? 50)));
    $q     = trim($_GET['q'] ?? '');
    $showDeleted = ($_GET['show_deleted'] ?? '0') === '1';
    $offset = ($page - 1) * $limit;

    $whereParts = [];
    $bindings   = [];

    if (!$showDeleted) {
        $whereParts[] = 'deleted_at IS NULL';
    }

    if ($q !== '') {
        $whereParts[] = '(username LIKE ? OR email LIKE ?)';
        $like = '%' . $q . '%';
        $bindings[]   = $like;
        $bindings[]   = $like;
    }

    $where = $whereParts ? ('WHERE ' . implode(' AND ', $whereParts)) : '';

    $countStmt = $db->prepare("SELECT COUNT(*) FROM users {$where}");
    $countStmt->execute($bindings);
    $total = (int)$countStmt->fetchColumn();

    $dataStmt = $db->prepare(
        "SELECT u.id, u.username, u.email, u.is_admin, u.control_type, u.auth_enabled,
                u.dark_matter, u.rank_points, u.created_at, u.last_login, u.deleted_at,
                COUNT(c.id) AS colony_count
         FROM users u
         LEFT JOIN colonies c ON c.user_id = u.id
         {$where}
         GROUP BY u.id, u.username, u.email, u.is_admin, u.control_type, u.auth_enabled,
                  u.dark_matter, u.rank_points, u.created_at, u.last_login, u.deleted_at
         ORDER BY u.id DESC
         LIMIT {$limit} OFFSET {$offset}"
    );
    $dataStmt->execute($bindings);
    $users = $dataStmt->fetchAll(PDO::FETCH_ASSOC);

    // Cast types for cleaner JSON.
    foreach ($users as &$u) {
        $u['id']          = (int)$u['id'];
        $u['is_admin']    = (int)$u['is_admin'];
        $u['auth_enabled'] = (int)$u['auth_enabled'];
        $u['colony_count'] = (int)$u['colony_count'];
        $u['dark_matter'] = (int)$u['dark_matter'];
        $u['rank_points'] = (int)$u['rank_points'];
    }
    unset($u);

    json_ok([
        'users' => $users,
        'total' => $total,
        'page'  => $page,
        'limit' => $limit,
        'pages' => (int)ceil($total / $limit),
    ]);
}

function handle_get(PDO $db): void
{
    $id = (int)($_GET['id'] ?? 0);
    if ($id <= 0) {
        json_error('Invalid id.', 400);
    }

    $stmt = $db->prepare(
        'SELECT id, username, email, is_admin, control_type, auth_enabled,
                dark_matter, rank_points, protection_until,
                vacation_mode, pvp_mode, created_at, last_login,
                deleted_at, deleted_by
         FROM users WHERE id = ?'
    );
    $stmt->execute([$id]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        json_error('User not found.', 404);
    }

    // Colony count
    $colStmt = $db->prepare('SELECT COUNT(*) FROM colonies WHERE user_id = ?');
    $colStmt->execute([$id]);
    $user['colony_count'] = (int)$colStmt->fetchColumn();

    $user['id']       = (int)$user['id'];
    $user['is_admin'] = (int)$user['is_admin'];
    $user['auth_enabled'] = (int)$user['auth_enabled'];

    json_ok(['user' => $user]);
}

function handle_create(PDO $db): void
{
    $body = get_json_body();

    $username    = trim((string)($body['username'] ?? ''));
    $email       = trim((string)($body['email'] ?? ''));
    $password    = (string)($body['password'] ?? '');
    $controlType = trim((string)($body['control_type'] ?? 'human'));
    $authEnabled = !empty($body['auth_enabled']) ? 1 : 0;
    $isAdmin     = !empty($body['is_admin']) ? 1 : 0;

    if (!in_array($controlType, ['human', 'npc_engine'], true)) {
        json_error('Invalid control type.', 400);
    }
    if (!preg_match('/^[A-Za-z0-9_]{3,32}$/', $username)) {
        json_error('Username must be 3-32 alphanumeric characters or underscores.');
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        json_error('Invalid email address.');
    }

    if ($controlType !== 'human') {
        $authEnabled = 0;
        $isAdmin = 0;
    }

    $chk = $db->prepare('SELECT id FROM users WHERE username = ? OR email = ?');
    $chk->execute([$username, $email]);
    if ($chk->fetch()) {
        json_error('Username or email already taken.', 409);
    }

    if ($controlType === 'human' && $authEnabled === 1 && strlen($password) < 8) {
        json_error('Password must be at least 8 characters for login-enabled human actors.');
    }

    $effectivePassword = $password;
    if ($effectivePassword === '') {
        $effectivePassword = bin2hex(random_bytes(24));
    }

    $hash = password_hash($effectivePassword, PASSWORD_BCRYPT);
    $isNpc = $controlType === 'npc_engine' ? 1 : 0;

    $db->prepare(
        'INSERT INTO users (username, email, password_hash, is_admin, protection_until, is_npc, control_type, auth_enabled)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), ?, ?, ?)'
    )->execute([$username, $email, $hash, $isAdmin, $isNpc, $controlType, $authEnabled]);

    $userId = (int)$db->lastInsertId();
    $planet = create_homeworld($userId);

    try {
        ensure_user_character_profile($db, $userId, $isNpc === 1, $username);
    } catch (Throwable $e) {
        error_log('character profile generation failed for admin-created user ' . $userId . ': ' . $e->getMessage());
    }

    try {
        ensure_user_achievements_seeded($db, $userId);
    } catch (Throwable $e) {
        // Keep create working on partial/legacy schemas.
    }

    json_ok([
        'message' => 'Actor created.',
        'user' => [
            'id' => $userId,
            'username' => $username,
            'control_type' => $controlType,
            'auth_enabled' => $authEnabled,
        ],
        'homeworld_colony_id' => $planet,
    ]);
}

function handle_update(PDO $db, int $adminUid): void
{
    $body = get_json_body();
    $id   = (int)($body['id'] ?? 0);

    if ($id <= 0) {
        json_error('Invalid id.', 400);
    }

    // Prevent self-demotion from admin.
    if ($id === $adminUid && isset($body['is_admin']) && (int)$body['is_admin'] === 0) {
        json_error('You cannot remove your own admin privileges.', 403);
    }

    if ($id === $adminUid && isset($body['control_type']) && (string)$body['control_type'] !== 'human') {
        json_error('You cannot convert your own account to a non-human actor.', 403);
    }

    if ($id === $adminUid && array_key_exists('auth_enabled', $body) && (int)!empty($body['auth_enabled']) === 0) {
        json_error('You cannot disable login for your own account.', 403);
    }

    $stmt = $db->prepare('SELECT id, control_type, auth_enabled, deleted_at FROM users WHERE id = ?');
    $stmt->execute([$id]);
    $existing = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$existing) {
        json_error('User not found.', 404);
    }
    if ($existing['deleted_at'] !== null) {
        json_error('Cannot update a deleted (ghost) account.', 409);
    }

    $setClauses = [];
    $bindings   = [];

    if (isset($body['username'])) {
        $username = trim((string)$body['username']);
        if (!preg_match('/^[A-Za-z0-9_]{3,32}$/', $username)) {
            json_error('Username must be 3-32 alphanumeric characters or underscores.');
        }
        // Check uniqueness (excluding own row).
        $chk = $db->prepare('SELECT id FROM users WHERE username = ? AND id != ?');
        $chk->execute([$username, $id]);
        if ($chk->fetch()) {
            json_error('Username already taken.', 409);
        }
        $setClauses[] = 'username = ?';
        $bindings[]   = $username;
    }

    if (isset($body['email'])) {
        $email = trim((string)$body['email']);
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            json_error('Invalid email address.');
        }
        $chk = $db->prepare('SELECT id FROM users WHERE email = ? AND id != ?');
        $chk->execute([$email, $id]);
        if ($chk->fetch()) {
            json_error('Email already taken.', 409);
        }
        $setClauses[] = 'email = ?';
        $bindings[]   = $email;
    }

    if (isset($body['is_admin'])) {
        $setClauses[] = 'is_admin = ?';
        $bindings[]   = (int)(bool)$body['is_admin'];
    }

    if (isset($body['control_type'])) {
        $controlType = trim((string)$body['control_type']);
        if (!in_array($controlType, ['human', 'npc_engine'], true)) {
            json_error('Invalid control type.', 400);
        }
        $setClauses[] = 'control_type = ?';
        $bindings[]   = $controlType;
        $setClauses[] = 'is_npc = ?';
        $bindings[]   = $controlType === 'npc_engine' ? 1 : 0;

        if ($controlType !== 'human') {
            $setClauses[] = 'auth_enabled = 0';
            $setClauses[] = 'is_admin = 0';
            $setClauses[] = 'totp_enabled = 0';
            $setClauses[] = 'totp_secret = NULL';
            $setClauses[] = 'totp_pending_secret = NULL';
        }
    }

    if (array_key_exists('auth_enabled', $body)) {
        $authEnabled = !empty($body['auth_enabled']) ? 1 : 0;
        $controlTypeForAuth = (string)($body['control_type'] ?? $existing['control_type'] ?? 'human');
        if ($controlTypeForAuth !== 'human') {
            $authEnabled = 0;
        }
        $setClauses[] = 'auth_enabled = ?';
        $bindings[]   = $authEnabled;
    }

    if (isset($body['password'])) {
        $pw = (string)$body['password'];
        if (strlen($pw) < 8) {
            json_error('Password must be at least 8 characters.');
        }
        $setClauses[] = 'password_hash = ?';
        $bindings[]   = password_hash($pw, PASSWORD_BCRYPT);
        // Revoke all remember-me tokens on password change.
        $db->prepare('DELETE FROM remember_tokens WHERE user_id = ?')->execute([$id]);
        $db->prepare('DELETE FROM totp_pending_sessions WHERE user_id = ?')->execute([$id]);
    }

    if (empty($setClauses)) {
        json_error('No fields to update.', 400);
    }

    $bindings[] = $id;
    $db->prepare('UPDATE users SET ' . implode(', ', $setClauses) . ' WHERE id = ?')
       ->execute($bindings);

    json_ok(['message' => 'User updated.']);
}

/**
 * Soft-deletes a user account:
 *  1. Scrubs PII: email → ghost address, clears password + TOTP.
 *  2. Converts the row to an engine-controlled NPC placeholder so all FK-linked
 *     game data (colonies, fleets, research, …) is transparently preserved.
 *  3. Terminates active sessions / remember-me tokens.
 *  4. Marks deleted_at so login is refused from this point on.
 */
function handle_delete(PDO $db, int $adminUid): void
{
    $body = get_json_body();
    $id   = (int)($body['id'] ?? 0);

    if ($id <= 0) {
        json_error('Invalid id.', 400);
    }
    if ($id === $adminUid) {
        json_error('You cannot delete your own account via admin tools.', 403);
    }

    $stmt = $db->prepare('SELECT id, username, is_admin, deleted_at FROM users WHERE id = ?');
    $stmt->execute([$id]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        json_error('User not found.', 404);
    }
    if ($user['deleted_at'] !== null) {
        json_error('Account is already deleted.', 409);
    }

    // ── 1  Revoke all live credentials ────────────────────────────────────────
    $db->prepare('DELETE FROM remember_tokens          WHERE user_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM totp_pending_sessions    WHERE user_id = ?')->execute([$id]);

    // ── 2  Delete user-personal data that has no game-world value ────────────
    $db->prepare('DELETE FROM user_achievements        WHERE user_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM user_character_profiles  WHERE user_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM user_faction_quests      WHERE user_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM user_wormhole_unlocks    WHERE user_id = ?')->execute([$id]);

    // ── 3  Alliance cleanup ───────────────────────────────────────────────────
    // If this user leads an alliance, let the oldest remaining member inherit it;
    // if none, disband the alliance.
    $allianceStmt = $db->prepare('SELECT id FROM alliances WHERE leader_user_id = ?');
    $allianceStmt->execute([$id]);
    $alliance = $allianceStmt->fetch(PDO::FETCH_ASSOC);
    if ($alliance) {
        $allianceId = (int)$alliance['id'];
        $nextLeader = $db->prepare(
            'SELECT user_id FROM alliance_members
             WHERE alliance_id = ? AND user_id != ?
             ORDER BY joined_at ASC LIMIT 1'
        );
        $nextLeader->execute([$allianceId, $id]);
        $successor = $nextLeader->fetchColumn();
        if ($successor) {
            $db->prepare('UPDATE alliances SET leader_user_id = ? WHERE id = ?')
               ->execute([$successor, $allianceId]);
        } else {
            // No members left – disband entirely.
            $db->prepare('DELETE FROM alliance_members  WHERE alliance_id = ?')->execute([$allianceId]);
            $db->prepare('DELETE FROM alliance_messages WHERE alliance_id = ?')->execute([$allianceId]);
            $db->prepare('DELETE FROM alliance_relations WHERE alliance_id = ?')->execute([$allianceId]);
            $db->prepare('DELETE FROM alliances         WHERE id = ?')->execute([$allianceId]);
        }
    }
    // Remove from any other alliance they belong to.
    $db->prepare('DELETE FROM alliance_members WHERE user_id = ?')->execute([$id]);

    // ── 4  Anonymise relational history (keep game-world data intact) ─────────
    // Messages: keep delivered/received records but blank out content for deleted sender.
    $db->prepare(
        "UPDATE messages SET body = '[deleted]', subject = '[deleted]'
         WHERE sender_id = ?"
    )->execute([$id]);

    // Diplomacy rows for this user are no longer valid.
    $db->prepare('DELETE FROM diplomacy WHERE user_id = ?')->execute([$id]);

    // ── 5  Convert the user row to a ghost NPC (preserves all other FKs) ─────
    // Because we update the same row in-place (same user_id), all FK-linked
    // tables (colonies, fleets, research, leaders, …) continue to point at
    // the ghost NPC without any reassignment needed.
    $ghostUsername = '[Deleted-' . $id . ']';
    $ghostEmail    = 'ghost-' . $id . '@deleted.invalid';

    $db->prepare(
        "UPDATE users SET
            username            = ?,
            email               = ?,
            password_hash       = '',
            is_npc              = 1,
            control_type        = 'npc_engine',
            auth_enabled        = 0,
            is_admin            = 0,
            totp_enabled        = 0,
            totp_secret         = NULL,
            totp_pending_secret = NULL,
            deleted_at          = NOW(),
            deleted_by          = ?,
            vacation_mode       = 0,
            pvp_mode            = 0
         WHERE id = ?"
    )->execute([$ghostUsername, $ghostEmail, $adminUid, $id]);

    json_ok(['message' => 'User account deleted. Game-world data preserved as ghost NPC.']);
}
