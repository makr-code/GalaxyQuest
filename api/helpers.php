<?php
/**
 * Shared helpers used by all API files.
 */
require_once __DIR__ . '/../config/db.php';

const REMEMBER_COOKIE_NAME = 'gq_remember';

if (!defined('GQ_API_ERROR_HANDLERS_READY')) {
    define('GQ_API_ERROR_HANDLERS_READY', true);

    set_exception_handler(function (Throwable $e): void {
        gq_api_handle_uncaught_throwable($e);
    });

    set_error_handler(function (int $severity, string $message, string $file = '', int $line = 0): bool {
        if (!(error_reporting() & $severity)) {
            return false;
        }
        throw new ErrorException($message, 0, $severity, $file, $line);
    });

    register_shutdown_function(function (): void {
        $error = error_get_last();
        if (!$error) {
            return;
        }

        $fatalTypes = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
        if (!in_array((int)($error['type'] ?? 0), $fatalTypes, true)) {
            return;
        }

        $message = (string)($error['message'] ?? 'Fatal error');
        $file = (string)($error['file'] ?? 'unknown');
        $line = (int)($error['line'] ?? 0);
        $exception = new ErrorException($message, 0, (int)$error['type'], $file, $line);
        gq_api_handle_uncaught_throwable($exception);
    });
}

function gq_api_handle_uncaught_throwable(Throwable $e): never {
    $message = APP_ENV === 'production'
        ? 'Internal server error'
        : sprintf('%s: %s in %s:%d', get_class($e), $e->getMessage(), basename($e->getFile()), $e->getLine());

    error_log('[GalaxyQuest API] ' . $message);

    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }

    echo json_encode([
        'success' => false,
        'error' => $message,
        'code' => 'E_INTERNAL',
    ]);
    exit;
}

    function gq_validate_api_version_request(): void {
        $requestUri = (string)($_SERVER['REQUEST_URI'] ?? '');
        if ($requestUri === '') {
            return;
        }

        $path = (string)(parse_url($requestUri, PHP_URL_PATH) ?? '');
        if ($path === '' || strpos($path, '/api/') !== 0) {
            return;
        }

        $versionPrefix = defined('API_VERSION_PREFIX')
            ? (string)API_VERSION_PREFIX
            : ('/api/' . (defined('API_VERSION') ? (string)API_VERSION : 'v1') . '/');

        if (strpos($path, $versionPrefix) === 0) {
            return;
        }

        // Keep legacy /api/*.php working while surfacing deprecation to callers.
        if (defined('API_ALLOW_LEGACY') && API_ALLOW_LEGACY) {
            if (!headers_sent()) {
                header('X-API-Legacy-Route: 1');
                header('X-API-Recommended-Prefix: ' . $versionPrefix);
            }
            return;
        }

        if (!headers_sent()) {
            http_response_code(426);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode([
            'success' => false,
            'error' => 'Unsupported API version',
            'required_prefix' => $versionPrefix,
        ]);
        exit;
    }

    gq_validate_api_version_request();

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
    if (!isset($_SESSION['user_id'])) {
        try_auto_login_from_cookie();
    }
    return isset($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : null;
}

function is_admin_user(PDO $db, int $uid): bool {
    $stmt = $db->prepare('SELECT is_admin FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$uid]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row !== false && (int)$row['is_admin'] === 1;
}

function is_https_request(): bool {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        return true;
    }
    return (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function read_remember_cookie(): ?array {
    $raw = $_COOKIE[REMEMBER_COOKIE_NAME] ?? '';
    if (!preg_match('/^[a-f0-9]{18}:[a-f0-9]{64}$/', $raw)) {
        return null;
    }
    [$selector, $validator] = explode(':', $raw, 2);
    return [$selector, $validator];
}

function set_remember_cookie(string $selector, string $validator, int $expiresTs): void {
    setcookie(REMEMBER_COOKIE_NAME, $selector . ':' . $validator, [
        'expires'  => $expiresTs,
        'path'     => '/',
        'secure'   => is_https_request(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function clear_remember_cookie(): void {
    setcookie(REMEMBER_COOKIE_NAME, '', [
        'expires'  => time() - 3600,
        'path'     => '/',
        'secure'   => is_https_request(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    unset($_COOKIE[REMEMBER_COOKIE_NAME]);
}

function clear_session_cookies(): void {
    if (session_status() === PHP_SESSION_ACTIVE) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires'  => time() - 3600,
            'path'     => $params['path'] ?? '/',
            'domain'   => $params['domain'] ?? '',
            'secure'   => (bool)($params['secure'] ?? false),
            'httponly' => (bool)($params['httponly'] ?? true),
            'samesite' => $params['samesite'] ?? 'Strict',
        ]);
        unset($_COOKIE[session_name()]);
    }
}

function issue_remember_me_token(int $userId): void {
    $selector  = bin2hex(random_bytes(9));
    $validator = bin2hex(random_bytes(32));
    $tokenHash = hash('sha256', $validator);
    $days      = max(1, REMEMBER_ME_DAYS);
    $expiresTs = time() + ($days * 86400);
    $expiresAt = date('Y-m-d H:i:s', $expiresTs);

    try {
        $db = get_db();
        $db->prepare('DELETE FROM remember_tokens WHERE user_id = ? AND expires_at <= NOW()')
           ->execute([$userId]);
        $db->prepare(
            'INSERT INTO remember_tokens (user_id, selector, token_hash, expires_at)
             VALUES (?, ?, ?, ?)'
        )->execute([$userId, $selector, $tokenHash, $expiresAt]);
        set_remember_cookie($selector, $validator, $expiresTs);
    } catch (Throwable $e) {
        clear_remember_cookie();
    }
}

function revoke_remember_me_token_from_cookie(): void {
    $parts = read_remember_cookie();
    if ($parts) {
        [$selector] = $parts;
        try {
            get_db()->prepare('DELETE FROM remember_tokens WHERE selector = ?')->execute([$selector]);
        } catch (Throwable $e) {
            // Ignore DB errors during logout cleanup.
        }
    }
    clear_remember_cookie();
}

function revoke_all_remember_me_tokens_for_user(int $userId): void {
    if ($userId <= 0) return;
    try {
        get_db()->prepare('DELETE FROM remember_tokens WHERE user_id = ?')->execute([$userId]);
    } catch (Throwable $e) {
        // Ignore DB errors during logout cleanup.
    }
}

function try_auto_login_from_cookie(): bool {
    if (isset($_SESSION['user_id'])) {
        return true;
    }

    $parts = read_remember_cookie();
    if (!$parts) {
        return false;
    }

    [$selector, $validator] = $parts;

    try {
        $db = get_db();
        $stmt = $db->prepare(
            'SELECT rt.id, rt.token_hash, rt.user_id, u.username
             FROM remember_tokens rt
             JOIN users u ON u.id = rt.user_id
             WHERE rt.selector = ? AND rt.expires_at > NOW()'
        );
        $stmt->execute([$selector]);
        $row = $stmt->fetch();

        if (!$row) {
            clear_remember_cookie();
            return false;
        }

        $expected = hash('sha256', $validator);
        if (!hash_equals($row['token_hash'], $expected)) {
            $db->prepare('DELETE FROM remember_tokens WHERE selector = ?')->execute([$selector]);
            clear_remember_cookie();
            return false;
        }

        session_regenerate_id(true);
        $_SESSION['user_id']  = (int)$row['user_id'];
        $_SESSION['username'] = $row['username'];

        // Rotate validator after each successful auto-login.
        $newValidator = bin2hex(random_bytes(32));
        $newHash      = hash('sha256', $newValidator);
        $days         = max(1, REMEMBER_ME_DAYS);
        $newExpiresTs = time() + ($days * 86400);
        $newExpiresAt = date('Y-m-d H:i:s', $newExpiresTs);

        $db->prepare(
            'UPDATE remember_tokens
             SET token_hash = ?, expires_at = ?, last_used_at = NOW()
             WHERE id = ?'
        )->execute([$newHash, $newExpiresAt, $row['id']]);

        set_remember_cookie($selector, $newValidator, $newExpiresTs);
        return true;
    } catch (Throwable $e) {
        clear_remember_cookie();
        return false;
    }
}

function require_auth(): int {
    $uid = current_user_id();
    if ($uid === null) {
        json_error('Not authenticated', 401);
    }
    return $uid;
}

// ─── Security headers ────────────────────────────────────────────────────────
function send_security_headers(): void {
    if (headers_sent()) return;
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    header('Referrer-Policy: strict-origin-when-cross-origin');
}

// ─── Response helpers ────────────────────────────────────────────────────────
function json_response(array $data, int $code = 200): never {
    send_security_headers();
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

function positive_int(mixed $value, int $default = 0): int {
    $i = filter_var($value, FILTER_VALIDATE_INT);
    return ($i !== false && $i > 0) ? (int)$i : $default;
}

/**
 * Returns the list of playable faction codes by scanning fractions/{code}/spec.json for
 * entries where meta.playable === true.  The result is cached in a static variable
 * so repeated calls within the same request are free.
 *
 * @param  string|null $fractionsDir  Override the default fractions/ directory (for testing).
 * @return list<string>
 */
function get_playable_faction_codes(?string $fractionsDir = null): array {
    static $cache = null;
    if ($fractionsDir === null && $cache !== null) {
        return $cache;
    }

    $dir   = $fractionsDir ?? dirname(__DIR__) . '/fractions';
    $codes = [];

    if (!is_dir($dir)) {
        return [];
    }

    foreach (scandir($dir) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $specPath = $dir . '/' . $entry . '/spec.json';
        if (!is_file($specPath)) {
            continue;
        }
        $raw = file_get_contents($specPath);
        if ($raw === false) {
            continue;
        }
        $spec = json_decode($raw, true);
        if (!is_array($spec)) {
            continue;
        }
        $meta = $spec['meta'] ?? [];
        if (is_array($meta) && ($meta['playable'] ?? false) === true) {
            $code = (string) ($spec['species_code'] ?? $spec['faction_code'] ?? $entry);
            if ($code !== '') {
                $codes[] = $code;
            }
        }
    }

    sort($codes);

    if ($fractionsDir === null) {
        $cache = $codes;
    }
    return $codes;
}
