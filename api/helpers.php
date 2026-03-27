<?php
/**
 * Shared helpers used by all API files.
 */
require_once __DIR__ . '/../config/db.php';

// ─── Session ────────────────────────────────────────────────────────────────
function session_start_secure(): void {
    if (session_status() === PHP_SESSION_NONE) {
        ini_set('session.cookie_httponly', '1');
        ini_set('session.use_strict_mode', '1');
        session_set_cookie_params([
            'lifetime' => SESSION_LIFETIME,
            'path'     => '/',
            'samesite' => 'Strict',
        ]);
        session_start();
    }
}

function current_user_id(): ?int {
    session_start_secure();
    return isset($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : null;
}

function require_auth(): int {
    $uid = current_user_id();
    if ($uid === null) {
        json_error('Not authenticated', 401);
    }
    return $uid;
}

// ─── Response helpers ────────────────────────────────────────────────────────
function json_response(array $data, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data);
    exit;
}

function json_error(string $message, int $code = 400): never {
    json_response(['success' => false, 'error' => $message], $code);
}

function json_ok(array $payload = []): never {
    json_response(array_merge(['success' => true], $payload));
}

// ─── CSRF ────────────────────────────────────────────────────────────────────
function csrf_token(): string {
    session_start_secure();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(CSRF_TOKEN_LENGTH));
    }
    return $_SESSION['csrf_token'];
}

function verify_csrf(): void {
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf_token'] ?? '');
    if (!hash_equals(csrf_token(), $token)) {
        json_error('Invalid CSRF token', 403);
    }
}

// ─── Input helpers ───────────────────────────────────────────────────────────
function get_json_body(): array {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function only_method(string ...$methods): void {
    if (!in_array($_SERVER['REQUEST_METHOD'], $methods, true)) {
        json_error('Method not allowed', 405);
    }
}
