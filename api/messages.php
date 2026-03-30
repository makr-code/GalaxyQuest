<?php
/**
 * Messages API
 * GET  /api/messages.php?action=inbox
 * GET  /api/messages.php?action=read&id=X
 * POST /api/messages.php?action=send   body: {to_username, subject, body}
 * POST /api/messages.php?action=delete body: {id}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/projection.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {
    case 'users':
        only_method('GET');
        $q = trim((string)($_GET['q'] ?? ''));
        $db = get_db();
        if ($q === '') {
            $stmt = $db->prepare(
                'SELECT username
                 FROM users
                 WHERE id <> ?
                 ORDER BY last_login DESC, username ASC
                 LIMIT 12'
            );
            $stmt->execute([$uid]);
            json_ok(['users' => array_map(static fn($r) => (string)$r['username'], $stmt->fetchAll())]);
            break;
        }

        $stmt = $db->prepare(
            'SELECT username
             FROM users
             WHERE id <> ? AND username LIKE ?
             ORDER BY username ASC
             LIMIT 12'
        );
        $stmt->execute([$uid, $q . '%']);
        json_ok(['users' => array_map(static fn($r) => (string)$r['username'], $stmt->fetchAll())]);
        break;

    case 'inbox':
        only_method('GET');
        $db   = get_db();
        $stmt = $db->prepare(
            'SELECT m.id, m.subject, m.body, m.is_read, m.sent_at,
                    COALESCE(u.username, \'System\') AS sender
             FROM messages m
             LEFT JOIN users u ON u.id = m.sender_id
             WHERE m.receiver_id = ?
             ORDER BY m.sent_at DESC
             LIMIT 100'
        );
        $stmt->execute([$uid]);
        json_ok(['messages' => $stmt->fetchAll()]);
        break;

    case 'read':
        only_method('GET');
        $id   = (int)($_GET['id'] ?? 0);
        $db   = get_db();
        $stmt = $db->prepare(
            'SELECT m.*, COALESCE(u.username, \'System\') AS sender
             FROM messages m
             LEFT JOIN users u ON u.id = m.sender_id
             WHERE m.id = ? AND m.receiver_id = ?'
        );
        $stmt->execute([$id, $uid]);
        $msg = $stmt->fetch();
        if (!$msg) json_error('Message not found', 404);
        $db->prepare('UPDATE messages SET is_read = 1 WHERE id = ?')->execute([$id]);
        json_ok(['message' => $msg]);
        break;

    case 'send':
        only_method('POST');
        verify_csrf();
        $body    = get_json_body();
        $to      = trim($body['to_username'] ?? '');
        $subject = trim($body['subject']     ?? '');
        $msgBody = trim($body['body']        ?? '');

        if ($subject === '' || $msgBody === '') {
            json_error('Subject and body are required.');
        }

        $db   = get_db();
        $stmt = $db->prepare('SELECT id FROM users WHERE username = ?');
        $stmt->execute([$to]);
        $receiver = $stmt->fetch();
        if (!$receiver) json_error('Recipient not found.', 404);

        $db->prepare(
            'INSERT INTO messages (sender_id, receiver_id, subject, body) VALUES (?, ?, ?, ?)'
        )->execute([$uid, $receiver['id'], $subject, $msgBody]);

        enqueue_dirty_user($db, (int)$receiver['id'], 'message_received');
        json_ok(['message_id' => (int)$db->lastInsertId()]);
        break;

    case 'delete':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $id   = (int)($body['id'] ?? 0);
        $db   = get_db();
        $db->prepare('DELETE FROM messages WHERE id = ? AND receiver_id = ?')->execute([$id, $uid]);
        json_ok();
        break;

    default:
        json_error('Unknown action');
}
