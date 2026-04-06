<?php

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers.php';

function ensure_default_admin(PDO $db): int {
    $select = $db->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
    $select->execute(['administrator']);
    $row = $select->fetch(PDO::FETCH_ASSOC);

    $passwordHash = password_hash('Admin!23456', PASSWORD_BCRYPT);

    if ($row) {
        $userId = (int) $row['id'];
        $db->prepare(
            'UPDATE users
                SET email = ?,
                    password_hash = ?,
                    is_admin = 1,
                    control_type = ?,
                    auth_enabled = 1,
                    deleted_at = NULL,
                    deleted_by = NULL,
                    protection_until = COALESCE(protection_until, DATE_ADD(NOW(), INTERVAL 7 DAY))
              WHERE id = ?'
        )->execute([
            'administrator@local.dev',
            $passwordHash,
            'human',
            $userId,
        ]);

        return $userId;
    }

    $db->prepare(
        'INSERT INTO users (username, email, password_hash, is_admin, control_type, auth_enabled, protection_until, deleted_at, created_at)
         VALUES (?, ?, ?, 1, ?, 1, DATE_ADD(NOW(), INTERVAL 7 DAY), NULL, NOW())'
    )->execute([
        'administrator',
        'administrator@local.dev',
        $passwordHash,
        'human',
    ]);

    return (int) $db->lastInsertId();
}

if (PHP_SAPI === 'cli' && realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    $db = get_db();
    $adminId = ensure_default_admin($db);

    echo 'Administrator ensured: id=' . $adminId . PHP_EOL;
}