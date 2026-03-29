<?php
// api/alliances.php – Alliance system: create, join, manage, diplomacy
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../api/helpers.php';

header('Content-Type: application/json; charset=utf-8');

$uid = require_auth();
$db = get_db();
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec('SET sql_notes = 0');
ensure_alliance_schema($db);
$action = $_GET['action'] ?? '';

match ($action) {
    'list'              => action_list($db, $uid),
    'details'           => action_details($db, $uid),
    'create'            => action_create($db, $uid),
    'join'              => action_join($db, $uid),
    'accept_member'     => action_accept_member($db, $uid),
    'leave'             => action_leave($db, $uid),
    'disband'           => action_disband($db, $uid),
    'remove_member'     => action_remove_member($db, $uid),
    'set_role'          => action_set_role($db, $uid),
    'contribute'        => action_contribute($db, $uid),
    'withdraw'          => action_withdraw($db, $uid),
    'relations'         => action_relations($db, $uid),
    'war_map'           => action_war_map($db, $uid),
    'declare_war'       => action_declare_war($db, $uid),
    'declare_nap'       => action_declare_nap($db, $uid),
    'declare_alliance'  => action_declare_alliance($db, $uid),
    'revoke_relation'   => action_revoke_relation($db, $uid),
    'set_relation'      => action_set_relation($db, $uid),
    'get_messages'      => action_get_messages($db, $uid),
    'send_message'      => action_send_message($db, $uid),
    default             => json_error('Unknown action: ' . $action, 400),
};

function ensure_alliance_schema(PDO $db): void {
    $db->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS alliances (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(64) NOT NULL,
            tag VARCHAR(4) NOT NULL UNIQUE,
            leader_user_id INT NOT NULL,
            description TEXT DEFAULT NULL,
            treasury_metal DECIMAL(20,4) NOT NULL DEFAULT 0,
            treasury_crystal DECIMAL(20,4) NOT NULL DEFAULT 0,
            treasury_deuterium DECIMAL(20,4) NOT NULL DEFAULT 0,
            treasury_dark_matter INT UNSIGNED NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (leader_user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_leader (leader_user_id),
            INDEX idx_tag (tag)
        ) ENGINE=InnoDB
    SQL);

    $db->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS alliance_members (
            id INT AUTO_INCREMENT PRIMARY KEY,
            alliance_id INT NOT NULL,
            user_id INT NOT NULL,
            role ENUM('leader','diplomat','officer','member') NOT NULL DEFAULT 'member',
            joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            contributed_resources DECIMAL(20,4) NOT NULL DEFAULT 0,
            FOREIGN KEY (alliance_id) REFERENCES alliances(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE KEY unique_membership (alliance_id, user_id),
            INDEX idx_user_alliance (user_id, alliance_id)
        ) ENGINE=InnoDB
    SQL);

    $db->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS alliance_relations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            alliance_id INT NOT NULL,
            other_alliance_id INT,
            other_user_id INT,
            relation_type ENUM('nap','alliance','war','enemy','neutral') NOT NULL DEFAULT 'neutral',
            declared_by_user_id INT NOT NULL,
            declared_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME DEFAULT NULL,
            FOREIGN KEY (alliance_id) REFERENCES alliances(id) ON DELETE CASCADE,
            FOREIGN KEY (other_alliance_id) REFERENCES alliances(id) ON DELETE SET NULL,
            FOREIGN KEY (other_user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (declared_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_alliance_relations (alliance_id, relation_type),
            INDEX idx_other_relations (other_alliance_id, relation_type)
        ) ENGINE=InnoDB
    SQL);

    $db->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS alliance_messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            alliance_id INT NOT NULL,
            author_id INT NOT NULL,
            message_text TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (alliance_id) REFERENCES alliances(id) ON DELETE CASCADE,
            FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_alliance_time (alliance_id, created_at)
        ) ENGINE=InnoDB
    SQL);
}

// ─── Action handlers ──────────────────────────────────────────────────────────

function action_list(PDO $db, int $uid): never {
    // Get list of all alliances (paginated, with member count)
    $stmt = $db->prepare(<<<SQL
        SELECT
            a.id, a.name, a.tag, a.leader_user_id, a.description,
            a.treasury_metal, a.treasury_crystal, a.treasury_deuterium, a.treasury_dark_matter,
            a.created_at, a.updated_at,
            COUNT(DISTINCT am.user_id) as member_count,
            u.username as leader_name
        FROM alliances a
        LEFT JOIN alliance_members am ON am.alliance_id = a.id
        LEFT JOIN users u ON u.id = a.leader_user_id
        GROUP BY a.id
        ORDER BY a.updated_at DESC
        LIMIT 50
    SQL);
    $stmt->execute();
    $alliances = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Get current user's alliance membership
    $userAllianceStmt = $db->prepare('SELECT alliance_id FROM alliance_members WHERE user_id = ? LIMIT 1');
    $userAllianceStmt->execute([$uid]);
    $userAlliance = $userAllianceStmt->fetchColumn();

    json_ok([
        'alliances' => array_map(function ($a) {
            return [
                'id' => (int)$a['id'],
                'name' => $a['name'],
                'tag' => $a['tag'],
                'leader_id' => (int)$a['leader_user_id'],
                'leader_name' => $a['leader_name'],
                'description' => $a['description'],
                'member_count' => (int)$a['member_count'],
                'treasury' => [
                    'metal' => (float)$a['treasury_metal'],
                    'crystal' => (float)$a['treasury_crystal'],
                    'deuterium' => (float)$a['treasury_deuterium'],
                    'dark_matter' => (int)$a['treasury_dark_matter'],
                ],
                'created_at' => $a['created_at'],
            ];
        }, $alliances),
        'user_alliance_id' => $userAlliance ? (int)$userAlliance : null,
    ]);
}

function action_details(PDO $db, int $uid): never {
    $allianceId = (int)($_GET['alliance_id'] ?? 0);
    if ($allianceId <= 0) {
        json_error('Invalid alliance ID.', 400);
    }

    // Fetch alliance
    $stmt = $db->prepare('SELECT * FROM alliances WHERE id = ?');
    $stmt->execute([$allianceId]);
    $alliance = $stmt->fetch();

    if (!$alliance) {
        json_error('Alliance not found.', 404);
    }

    // Fetch members with user details
    $stmt = $db->prepare(<<<SQL
        SELECT am.*, u.username, u.rank_points
        FROM alliance_members am
        JOIN users u ON u.id = am.user_id
        WHERE am.alliance_id = ?
        ORDER BY am.role DESC, am.joined_at ASC
    SQL);
    $stmt->execute([$allianceId]);
    $members = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Check if user is member
    $isMember = false;
    $userRole = null;
    foreach ($members as $m) {
        if ((int)$m['user_id'] === $uid) {
            $isMember = true;
            $userRole = $m['role'];
            break;
        }
    }

    json_ok([
        'alliance' => [
            'id' => (int)$alliance['id'],
            'name' => $alliance['name'],
            'tag' => $alliance['tag'],
            'leader_id' => (int)$alliance['leader_user_id'],
            'description' => $alliance['description'],
            'treasury' => [
                'metal' => (float)$alliance['treasury_metal'],
                'crystal' => (float)$alliance['treasury_crystal'],
                'deuterium' => (float)$alliance['treasury_deuterium'],
                'dark_matter' => (int)$alliance['treasury_dark_matter'],
            ],
            'created_at' => $alliance['created_at'],
        ],
        'members' => array_map(function ($m) {
            return [
                'user_id' => (int)$m['user_id'],
                'username' => $m['username'],
                'role' => $m['role'],
                'rank_points' => (int)$m['rank_points'],
                'joined_at' => $m['joined_at'],
                'contributed' => (float)$m['contributed_resources'],
            ];
        }, $members),
        'is_member' => $isMember,
        'user_role' => $userRole,
    ]);
}

function action_create(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $name = trim(String($body['name'] ?? ''));
    $tag = trim(String($body['tag'] ?? ''));
    $description = trim(String($body['description'] ?? ''));

    if (strlen($name) < 3 || strlen($name) > 64) {
        json_error('Alliance name must be 3–64 characters.', 400);
    }
    if (strlen($tag) < 2 || strlen($tag) > 4) {
        json_error('Alliance tag must be 2–4 characters.', 400);
    }

    // Check if user already in alliance
    $stmt = $db->prepare('SELECT alliance_id FROM alliance_members WHERE user_id = ? LIMIT 1');
    $stmt->execute([$uid]);
    if ($stmt->fetchColumn()) {
        json_error('You are already in an alliance. Leave first.', 409);
    }

    // Check if tag already exists
    $stmt = $db->prepare('SELECT id FROM alliances WHERE tag = ?');
    $stmt->execute([$tag]);
    if ($stmt->fetchColumn()) {
        json_error('Alliance tag already taken.', 409);
    }

    // Create alliance
    $stmt = $db->prepare(<<<SQL
        INSERT INTO alliances (name, tag, leader_user_id, description)
        VALUES (?, ?, ?, ?)
    SQL);
    $stmt->execute([$name, $tag, $uid, $description]);
    $allianceId = (int)$db->lastInsertId();

    // Add creator as leader member
    $stmt = $db->prepare(<<<SQL
        INSERT INTO alliance_members (alliance_id, user_id, role)
        VALUES (?, ?, 'leader')
    SQL);
    $stmt->execute([$allianceId, $uid]);

    json_ok([
        'alliance_id' => $allianceId,
        'name' => $name,
        'tag' => $tag,
    ]);
}

function action_join(PDO $db, int $uid): never {
    $allianceId = (int)($_POST['alliance_id'] ?? 0);
    if ($allianceId <= 0) {
        json_error('Invalid alliance ID.', 400);
    }

    // Check if user already in an alliance
    $stmt = $db->prepare('SELECT alliance_id FROM alliance_members WHERE user_id = ? LIMIT 1');
    $stmt->execute([$uid]);
    if ($stmt->fetchColumn()) {
        json_error('You are already in an alliance.', 409);
    }

    // Check alliance exists
    $stmt = $db->prepare('SELECT id FROM alliances WHERE id = ?');
    $stmt->execute([$allianceId]);
    if (!$stmt->fetchColumn()) {
        json_error('Alliance not found.', 404);
    }

    // Add as member
    $stmt = $db->prepare(<<<SQL
        INSERT INTO alliance_members (alliance_id, user_id, role)
        VALUES (?, ?, 'member')
    SQL);
    try {
        $stmt->execute([$allianceId, $uid]);
    } catch (PDOException $e) {
        json_error('Already a member or join failed.', 409);
    }

    json_ok(['joined' => true]);
}

function action_accept_member(PDO $db, int $uid): never {
    // Leader/officer accepts pending member (placeholder for future invite system)
    json_error('Not yet implemented.', 501);
}

function action_remove_member(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $allianceId = (int)($body['alliance_id'] ?? 0);
    $targetUserId = (int)($body['user_id'] ?? 0);

    if ($allianceId <= 0 || $targetUserId <= 0) {
        json_error('Invalid alliance or user ID.', 400);
    }

    // Verify user is leader or diplomat
    $stmt = $db->prepare('SELECT role FROM alliance_members WHERE alliance_id = ? AND user_id = ?');
    $stmt->execute([$allianceId, $uid]);
    $member = $stmt->fetch();

    if (!$member || !in_array($member['role'], ['leader', 'diplomat'])) {
        json_error('Only leaders and diplomats can remove members.', 403);
    }

    // Prevent removing leader
    $stmt = $db->prepare('SELECT role FROM alliance_members WHERE alliance_id = ? AND user_id = ?');
    $stmt->execute([$allianceId, $targetUserId]);
    $target = $stmt->fetch();

    if ($target && $target['role'] === 'leader') {
        json_error('Cannot remove the alliance leader.', 400);
    }

    // Remove member
    $stmt = $db->prepare('DELETE FROM alliance_members WHERE alliance_id = ? AND user_id = ?');
    $stmt->execute([$allianceId, $targetUserId]);

    json_ok(['removed' => true, 'message' => 'Member removed from alliance.']);
}

function action_set_role(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $allianceId = (int)($body['alliance_id'] ?? 0);
    $targetUserId = (int)($body['user_id'] ?? 0);
    $role = strtolower(String($body['role'] ?? ''));

    if ($allianceId <= 0 || $targetUserId <= 0) {
        json_error('Invalid alliance or user ID.', 400);
    }

    if (!in_array($role, ['leader', 'diplomat', 'officer', 'member'])) {
        json_error('Invalid role.', 400);
    }

    // Verify user is leader
    $stmt = $db->prepare('SELECT role FROM alliance_members WHERE alliance_id = ? AND user_id = ?');
    $stmt->execute([$allianceId, $uid]);
    $member = $stmt->fetch();

    if (!$member || $member['role'] !== 'leader') {
        json_error('Only alliance leader can set roles.', 403);
    }

    // Update role
    $stmt = $db->prepare('UPDATE alliance_members SET role = ? WHERE alliance_id = ? AND user_id = ?');
    $stmt->execute([$role, $allianceId, $targetUserId]);

    json_ok(['role_set' => true, 'role' => $role]);
}

function action_contribute(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $allianceId = (int)($body['alliance_id'] ?? 0);
    $metal = (float)($body['metal'] ?? 0);
    $crystal = (float)($body['crystal'] ?? 0);
    $deuterium = (float)($body['deuterium'] ?? 0);

    if ($allianceId <= 0) {
        json_error('Invalid alliance ID.', 400);
    }

    if ($metal < 0 || $crystal < 0 || $deuterium < 0) {
        json_error('Resources must be non-negative.', 400);
    }

    if ($metal == 0 && $crystal == 0 && $deuterium == 0) {
        json_error('Must contribute at least one resource.', 400);
    }

    // Verify membership
    $stmt = $db->prepare('SELECT id FROM alliance_members WHERE user_id = ? AND alliance_id = ?');
    $stmt->execute([$uid, $allianceId]);
    if (!$stmt->fetchColumn()) {
        json_error('Not a member of this alliance.', 403);
    }

    // Get user's homeworld
    $stmt = $db->prepare(
        'SELECT id, metal, crystal, deuterium FROM colonies WHERE user_id = ? AND is_homeworld = 1 LIMIT 1'
    );
    $stmt->execute([$uid]);
    $hw = $stmt->fetch();

    if (!$hw) {
        json_error('No homeworld found.', 400);
    }

    if ($hw['metal'] < $metal || $hw['crystal'] < $crystal || $hw['deuterium'] < $deuterium) {
        json_error('Insufficient resources on homeworld.', 400);
    }

    // Deduct from colony
    $stmt = $db->prepare(
        'UPDATE colonies SET metal = metal - ?, crystal = crystal - ?, deuterium = deuterium - ? WHERE id = ?'
    );
    $stmt->execute([$metal, $crystal, $deuterium, $hw['id']]);

    // Add to treasury
    $stmt = $db->prepare(
        'UPDATE alliances SET 
            treasury_metal = treasury_metal + ?,
            treasury_crystal = treasury_crystal + ?,
            treasury_deuterium = treasury_deuterium + ?
         WHERE id = ?'
    );
    $stmt->execute([$metal, $crystal, $deuterium, $allianceId]);

    // Update member contribution record
    $stmt = $db->prepare(
        'UPDATE alliance_members 
         SET contributed_resources = contributed_resources + ? 
         WHERE alliance_id = ? AND user_id = ?'
    );
    $totalContrib = $metal + $crystal + $deuterium;
    $stmt->execute([$totalContrib, $allianceId, $uid]);

    json_ok(['contributed' => true, 'message' => 'Resources contributed to alliance treasury.']);
}

function action_withdraw(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $allianceId = (int)($body['alliance_id'] ?? 0);
    $metal = (float)($body['metal'] ?? 0);
    $crystal = (float)($body['crystal'] ?? 0);
    $deuterium = (float)($body['deuterium'] ?? 0);

    if ($allianceId <= 0) {
        json_error('Invalid alliance ID.', 400);
    }

    if ($metal < 0 || $crystal < 0 || $deuterium < 0) {
        json_error('Resources must be non-negative.', 400);
    }

    if ($metal == 0 && $crystal == 0 && $deuterium == 0) {
        json_error('Must withdraw at least one resource.', 400);
    }

    // Verify user is leader or officer
    $stmt = $db->prepare('SELECT role FROM alliance_members WHERE alliance_id = ? AND user_id = ?');
    $stmt->execute([$allianceId, $uid]);
    $member = $stmt->fetch();

    if (!$member || !in_array($member['role'], ['leader', 'officer'])) {
        json_error('Only leaders and officers can withdraw resources.', 403);
    }

    // Check treasury balance
    $stmt = $db->prepare(
        'SELECT treasury_metal, treasury_crystal, treasury_deuterium FROM alliances WHERE id = ?'
    );
    $stmt->execute([$allianceId]);
    $treasury = $stmt->fetch();

    if (!$treasury || $treasury['treasury_metal'] < $metal 
        || $treasury['treasury_crystal'] < $crystal 
        || $treasury['treasury_deuterium'] < $deuterium) {
        json_error('Insufficient resources in alliance treasury.', 400);
    }

    // Get alliance leader's homeworld
    $stmt = $db->prepare('SELECT leader_user_id FROM alliances WHERE id = ?');
    $stmt->execute([$allianceId]);
    $alliance = $stmt->fetch();
    $leader_id = $alliance['leader_user_id'];

    $stmt = $db->prepare('SELECT id FROM colonies WHERE user_id = ? AND is_homeworld = 1 LIMIT 1');
    $stmt->execute([$leader_id]);
    $hwId = $stmt->fetchColumn();

    if (!$hwId) {
        json_error('Leader has no homeworld.', 400);
    }

    // Deduct from treasury
    $stmt = $db->prepare(
        'UPDATE alliances SET
            treasury_metal = treasury_metal - ?,
            treasury_crystal = treasury_crystal - ?,
            treasury_deuterium = treasury_deuterium - ?
         WHERE id = ?'
    );
    $stmt->execute([$metal, $crystal, $deuterium, $allianceId]);

    // Add to leader's homeworld
    $stmt = $db->prepare(
        'UPDATE colonies SET metal = metal + ?, crystal = crystal + ?, deuterium = deuterium + ? WHERE id = ?'
    );
    $stmt->execute([$metal, $crystal, $deuterium, $hwId]);

    json_ok(['withdrawn' => true, 'message' => 'Resources withdrawn to leader\'s homeworld.']);
}
function action_relations(PDO $db, int $uid): never {
    $allianceId = (int)($_GET['alliance_id'] ?? 0);
    if ($allianceId <= 0) {
        json_error('Invalid alliance ID.', 400);
    }

    // Verify membership
    $stmt = $db->prepare('SELECT id FROM alliance_members WHERE user_id = ? AND alliance_id = ?');
    $stmt->execute([$uid, $allianceId]);
    if (!$stmt->fetchColumn()) {
        json_error('Not a member of this alliance.', 403);
    }

    // Get all relations
    $stmt = $db->prepare(<<<SQL
        SELECT ar.*,
               a2.name AS other_alliance_name, a2.tag AS other_alliance_tag,
               u.username AS other_user_name
        FROM alliance_relations ar
        LEFT JOIN alliances a2 ON a2.id = ar.other_alliance_id
        LEFT JOIN users u ON u.id = ar.other_user_id
        WHERE ar.alliance_id = ?
        ORDER BY ar.relation_type DESC, ar.declared_at DESC
    SQL);
    $stmt->execute([$allianceId]);
    $relations = $stmt->fetchAll(PDO::FETCH_ASSOC);

    json_ok(['relations' => array_map(function ($r) {
        return [
            'id' => (int)$r['id'],
            'relation_type' => $r['relation_type'],
            'other_alliance_id' => $r['other_alliance_id'] ? (int)$r['other_alliance_id'] : null,
            'other_alliance_name' => $r['other_alliance_name'],
            'other_alliance_tag' => $r['other_alliance_tag'],
            'other_user_id' => $r['other_user_id'] ? (int)$r['other_user_id'] : null,
            'other_user_name' => $r['other_user_name'],
            'declared_at' => $r['declared_at'],
            'expires_at' => $r['expires_at'],
        ];
    }, $relations)]);
}

function action_war_map(PDO $db, int $uid): never {
    $galaxy = max(1, (int)($_GET['galaxy'] ?? 1));
    $from = max(1, (int)($_GET['from'] ?? 1));
    $to = max($from, (int)($_GET['to'] ?? 499));

    $stmt = $db->prepare('SELECT alliance_id FROM alliance_members WHERE user_id = ? LIMIT 1');
    $stmt->execute([$uid]);
    $myAllianceId = (int)($stmt->fetchColumn() ?: 0);

    if ($myAllianceId <= 0) {
        json_ok([
            'galaxy' => $galaxy,
            'from' => $from,
            'to' => $to,
            'my_alliance_id' => null,
            'war_targets' => [],
            'claims' => [],
        ]);
    }

    $relStmt = $db->prepare(<<<SQL
        SELECT ar.other_alliance_id,
               ar.other_user_id,
               a.name AS other_alliance_name,
               a.tag  AS other_alliance_tag,
               u.username AS other_user_name
        FROM alliance_relations ar
        LEFT JOIN alliances a ON a.id = ar.other_alliance_id
        LEFT JOIN users u ON u.id = ar.other_user_id
        WHERE ar.alliance_id = ?
          AND ar.relation_type = 'war'
          AND (ar.expires_at IS NULL OR ar.expires_at > NOW())
    SQL);
    $relStmt->execute([$myAllianceId]);
    $warRows = $relStmt->fetchAll(PDO::FETCH_ASSOC);

    $enemyAllianceIds = [];
    $enemyUserIds = [];
    $warTargets = [];
    foreach ($warRows as $row) {
        $oa = (int)($row['other_alliance_id'] ?? 0);
        $ou = (int)($row['other_user_id'] ?? 0);
        if ($oa > 0) $enemyAllianceIds[$oa] = true;
        if ($ou > 0) $enemyUserIds[$ou] = true;
        $warTargets[] = [
            'other_alliance_id' => $oa > 0 ? $oa : null,
            'other_alliance_name' => $row['other_alliance_name'] ?? null,
            'other_alliance_tag' => $row['other_alliance_tag'] ?? null,
            'other_user_id' => $ou > 0 ? $ou : null,
            'other_user_name' => $row['other_user_name'] ?? null,
        ];
    }

    $enemyAllianceList = array_keys($enemyAllianceIds);
    $enemyUserList = array_keys($enemyUserIds);

    $where = ['p.galaxy = ?', 'p.system BETWEEN ? AND ?'];
    $params = [$galaxy, $from, $to];

    $scope = ['am.alliance_id = ?'];
    $params[] = $myAllianceId;

    if (count($enemyAllianceList) > 0) {
        $scope[] = 'am.alliance_id IN (' . implode(',', array_fill(0, count($enemyAllianceList), '?')) . ')';
        $params = array_merge($params, $enemyAllianceList);
    }
    if (count($enemyUserList) > 0) {
        $scope[] = 'c.user_id IN (' . implode(',', array_fill(0, count($enemyUserList), '?')) . ')';
        $params = array_merge($params, $enemyUserList);
    }
    $where[] = '(' . implode(' OR ', $scope) . ')';

    $sql = <<<SQL
        SELECT p.galaxy, p.system, p.position,
               c.user_id, u.username,
               am.alliance_id,
               a.name AS alliance_name,
               a.tag AS alliance_tag
        FROM colonies c
        JOIN planets p ON p.id = c.planet_id
        JOIN users u ON u.id = c.user_id
        LEFT JOIN alliance_members am ON am.user_id = c.user_id
        LEFT JOIN alliances a ON a.id = am.alliance_id
        WHERE %s
        ORDER BY p.system ASC, p.position ASC
    SQL;

    $stmt = $db->prepare(sprintf($sql, implode(' AND ', $where)));
    $stmt->execute($params);
    $claims = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $allianceId = (int)($row['alliance_id'] ?? 0);
        $userId = (int)($row['user_id'] ?? 0);
        $relation = 'neutral';
        if ($allianceId === $myAllianceId) {
            $relation = 'own';
        } elseif (isset($enemyAllianceIds[$allianceId]) || isset($enemyUserIds[$userId])) {
            $relation = 'war';
        }
        $claims[] = [
            'galaxy' => (int)$row['galaxy'],
            'system' => (int)$row['system'],
            'position' => (int)$row['position'],
            'user_id' => $userId,
            'username' => $row['username'],
            'alliance_id' => $allianceId > 0 ? $allianceId : null,
            'alliance_name' => $row['alliance_name'] ?? null,
            'alliance_tag' => $row['alliance_tag'] ?? null,
            'relation' => $relation,
        ];
    }

    json_ok([
        'galaxy' => $galaxy,
        'from' => $from,
        'to' => $to,
        'my_alliance_id' => $myAllianceId,
        'war_targets' => $warTargets,
        'claims' => $claims,
    ]);
}

function action_declare_war(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $allianceId = (int)($body['alliance_id'] ?? 0);
    $targetAllianceId = isset($body['target_alliance_id']) ? (int)$body['target_alliance_id'] : null;
    $targetUserId = isset($body['target_user_id']) ? (int)$body['target_user_id'] : null;

    if ($allianceId <= 0) {
        json_error('Invalid alliance ID.', 400);
    }

    if ((!$targetAllianceId && !$targetUserId) || ($targetAllianceId && $targetUserId)) {
        json_error('Specify either target_alliance_id or target_user_id, not both.', 400);
    }

    // Verify leadership
    $stmt = $db->prepare('SELECT id FROM alliances WHERE id = ? AND leader_user_id = ?');
    $stmt->execute([$allianceId, $uid]);
    if (!$stmt->fetchColumn()) {
        json_error('Only alliance leader can declare war.', 403);
    }

    // Insert relation
    $stmt = $db->prepare(<<<SQL
        INSERT INTO alliance_relations
            (alliance_id, other_alliance_id, other_user_id, relation_type, declared_by_user_id)
        VALUES (?, ?, ?, 'war', ?)
        ON DUPLICATE KEY UPDATE
            relation_type = 'war',
            declared_at = NOW()
    SQL);
    $stmt->execute([$allianceId, $targetAllianceId, $targetUserId, $uid]);

    json_ok(['war_declared' => true, 'message' => 'War declared!']);
}

function action_declare_nap(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $allianceId = (int)($body['alliance_id'] ?? 0);
    $targetAllianceId = isset($body['target_alliance_id']) ? (int)$body['target_alliance_id'] : null;
    $targetUserId = isset($body['target_user_id']) ? (int)$body['target_user_id'] : null;
    $days = (int)($body['days'] ?? 7);

    if ($allianceId <= 0) {
        json_error('Invalid alliance ID.', 400);
    }

    if ($days < 1 || $days > 365) {
        json_error('NAP duration must be 1–365 days.', 400);
    }

    if ((!$targetAllianceId && !$targetUserId) || ($targetAllianceId && $targetUserId)) {
        json_error('Specify either target_alliance_id or target_user_id, not both.', 400);
    }

    // Verify leadership
    $stmt = $db->prepare('SELECT id FROM alliances WHERE id = ? AND leader_user_id = ?');
    $stmt->execute([$allianceId, $uid]);
    if (!$stmt->fetchColumn()) {
        json_error('Only alliance leader can declare NAP.', 403);
    }

    $expiresAt = date('Y-m-d H:i:s', strtotime("+$days days"));

    // Insert relation with expiration
    $stmt = $db->prepare(<<<SQL
        INSERT INTO alliance_relations
            (alliance_id, other_alliance_id, other_user_id, relation_type, declared_by_user_id, expires_at)
        VALUES (?, ?, ?, 'nap', ?, ?)
        ON DUPLICATE KEY UPDATE
            relation_type = 'nap',
            expires_at = VALUES(expires_at),
            declared_at = NOW()
    SQL);
    $stmt->execute([$allianceId, $targetAllianceId, $targetUserId, $uid, $expiresAt]);

    json_ok(['nap_declared' => true, 'expires_at' => $expiresAt, 'message' => "Non-aggression pact declared for $days days."]);
}

function action_declare_alliance(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $allianceId = (int)($body['alliance_id'] ?? 0);
    $targetAllianceId = (int)($body['target_alliance_id'] ?? 0);

    if ($allianceId <= 0 || $targetAllianceId <= 0) {
        json_error('Invalid alliance IDs.', 400);
    }

    if ($allianceId === $targetAllianceId) {
        json_error('Cannot declare alliance with self.', 400);
    }

    // Verify leadership
    $stmt = $db->prepare('SELECT id FROM alliances WHERE id = ? AND leader_user_id = ?');
    $stmt->execute([$allianceId, $uid]);
    if (!$stmt->fetchColumn()) {
        json_error('Only alliance leader can declare alliance.', 403);
    }

    // Check if target exists
    $stmt = $db->prepare('SELECT id FROM alliances WHERE id = ?');
    $stmt->execute([$targetAllianceId]);
    if (!$stmt->fetchColumn()) {
        json_error('Target alliance not found.', 404);
    }

    // Insert relation
    $stmt = $db->prepare(<<<SQL
        INSERT INTO alliance_relations
            (alliance_id, other_alliance_id, relation_type, declared_by_user_id)
        VALUES (?, ?, 'alliance', ?)
        ON DUPLICATE KEY UPDATE
            relation_type = 'alliance',
            declared_at = NOW()
    SQL);
    $stmt->execute([$allianceId, $targetAllianceId, $uid]);

    json_ok(['alliance_proposed' => true, 'message' => 'Alliance proposed!']);
}

function action_revoke_relation(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $allianceId = (int)($body['alliance_id'] ?? 0);
    $relationId = (int)($body['relation_id'] ?? 0);

    if ($allianceId <= 0 || $relationId <= 0) {
        json_error('Invalid alliance or relation ID.', 400);
    }

    // Verify leadership
    $stmt = $db->prepare('SELECT id FROM alliances WHERE id = ? AND leader_user_id = ?');
    $stmt->execute([$allianceId, $uid]);
    if (!$stmt->fetchColumn()) {
        json_error('Only alliance leader can revoke relations.', 403);
    }

    // Verify relation belongs to alliance
    $stmt = $db->prepare('SELECT id FROM alliance_relations WHERE id = ? AND alliance_id = ?');
    $stmt->execute([$relationId, $allianceId]);
    if (!$stmt->fetchColumn()) {
        json_error('Relation not found or does not belong to this alliance.', 404);
    }

    // Delete relation
    $stmt = $db->prepare('DELETE FROM alliance_relations WHERE id = ?');
    $stmt->execute([$relationId]);

    json_ok(['revoked' => true, 'message' => 'Relation revoked.']);
}

function action_leave(PDO $db, int $uid): never {
    $allianceId = (int)($_POST['alliance_id'] ?? 0);

    // Check membership
    $stmt = $db->prepare('SELECT id, role FROM alliance_members WHERE user_id = ? AND alliance_id = ?');
    $stmt->execute([$uid, $allianceId]);
    $member = $stmt->fetch();

    if (!$member) {
        json_error('You are not a member of this alliance.', 404);
    }

    // Check if leader (can't leave while leading)
    if ($member['role'] === 'leader') {
        json_error('Leader cannot leave. Disband or transfer leadership first.', 409);
    }

    // Remove member
    $stmt = $db->prepare('DELETE FROM alliance_members WHERE user_id = ? AND alliance_id = ?');
    $stmt->execute([$uid, $allianceId]);

    json_ok(['left' => true]);
}

function action_disband(PDO $db, int $uid): never {
    $allianceId = (int)($_POST['alliance_id'] ?? 0);

    // Verify is leader
    $stmt = $db->prepare('SELECT id FROM alliances WHERE id = ? AND leader_user_id = ?');
    $stmt->execute([$allianceId, $uid]);
    if (!$stmt->fetchColumn()) {
        json_error('Only alliance leader can disband.', 403);
    }

    // Delete alliance (cascade removes members, messages, relations)
    $stmt = $db->prepare('DELETE FROM alliances WHERE id = ?');
    $stmt->execute([$allianceId]);

    json_ok(['disbanded' => true]);
}

function action_set_relation(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $allianceId = (int)($body['alliance_id'] ?? 0);
    $otherAllianceId = (int)($body['other_alliance_id'] ?? 0);
    $relationType = String($body['relation_type'] ?? '');

    if (!in_array($relationType, ['nap', 'alliance', 'war', 'enemy', 'neutral'])) {
        json_error('Invalid relation type.', 400);
    }

    // Verify leadership
    $stmt = $db->prepare('SELECT id FROM alliances WHERE id = ? AND leader_user_id = ?');
    $stmt->execute([$allianceId, $uid]);
    if (!$stmt->fetchColumn()) {
        json_error('Only alliance leader can modify relations.', 403);
    }

    if ($allianceId === $otherAllianceId) {
        json_error('Cannot set relation with self.', 400);
    }

    // Set or update relation
    $stmt = $db->prepare(<<<SQL
        INSERT INTO alliance_relations
            (alliance_id, other_alliance_id, relation_type, declared_by_user_id)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            relation_type = VALUES(relation_type),
            declared_at = NOW()
    SQL);
    $stmt->execute([$allianceId, $otherAllianceId, $relationType, $uid]);

    json_ok(['relation_set' => true, 'relation_type' => $relationType]);
}

function action_get_messages(PDO $db, int $uid): never {
    $allianceId = (int)($_GET['alliance_id'] ?? 0);

    // Verify membership
    $stmt = $db->prepare('SELECT id FROM alliance_members WHERE user_id = ? AND alliance_id = ?');
    $stmt->execute([$uid, $allianceId]);
    if (!$stmt->fetchColumn()) {
        json_error('Not a member of this alliance.', 403);
    }

    // Fetch messages
    $stmt = $db->prepare(<<<SQL
        SELECT am.id, am.author_id, am.message_text, am.created_at,
               u.username
        FROM alliance_messages am
        JOIN users u ON u.id = am.author_id
        WHERE am.alliance_id = ?
        ORDER BY am.created_at DESC
        LIMIT 100
    SQL);
    $stmt->execute([$allianceId]);
    $messages = $stmt->fetchAll(PDO::FETCH_ASSOC);

    json_ok([
        'messages' => array_reverse(array_map(function ($m) {
            return [
                'id' => (int)$m['id'],
                'author_id' => (int)$m['author_id'],
                'author_name' => $m['username'],
                'text' => $m['message_text'],
                'created_at' => $m['created_at'],
            ];
        }, $messages)),
    ]);
}

function action_send_message(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $allianceId = (int)($body['alliance_id'] ?? 0);
    $text = trim(String($body['message'] ?? ''));

    if (strlen($text) === 0 || strlen($text) > 1000) {
        json_error('Message must be 1–1000 characters.', 400);
    }

    // Verify membership
    $stmt = $db->prepare('SELECT id FROM alliance_members WHERE user_id = ? AND alliance_id = ?');
    $stmt->execute([$uid, $allianceId]);
    if (!$stmt->fetchColumn()) {
        json_error('Not a member of this alliance.', 403);
    }

    // Insert message
    $stmt = $db->prepare(<<<SQL
        INSERT INTO alliance_messages (alliance_id, author_id, message_text)
        VALUES (?, ?, ?)
    SQL);
    $stmt->execute([$allianceId, $uid, $text]);
    $msgId = (int)$db->lastInsertId();

    json_ok(['message_id' => $msgId]);
}
