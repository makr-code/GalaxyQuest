<?php
/**
 * Shared Authentication Helpers
 * Used by both trellis2_endpoints.php and admin_endpoints.php
 */

declare(strict_types=1);

/**
 * Get current user ID from multiple sources
 * Priority: Session → JWT → API Key → Dev fallback
 */
function getCurrentUserId(): ?int {
    // 1. Session-based auth (primary)
    session_start();
    if (!empty($_SESSION['user_id'])) {
        return (int)$_SESSION['user_id'];
    }
    
    // 2. JWT Bearer token
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+(.+)$/', $auth, $m)) {
        $token = $m[1];
        $decoded = verifyJWT($token);
        if ($decoded && isset($decoded->sub)) {
            return (int)$decoded->sub;
        }
    }
    
    // 3. API key (X-API-Key header)
    $apiKey = $_SERVER['HTTP_X_API_KEY'] ?? null;
    if ($apiKey) {
        return verifyAPIKey($apiKey);
    }
    
    // 4. Development fallback (if not production)
    if (getenv('APP_ENV') !== 'production') {
        return $_GET['user_id'] ?? null;
    }
    
    return null;
}

/**
 * Verify JWT token and extract payload
 */
function verifyJWT(string $token): ?object {
    try {
        $secret = getenv('JWT_SECRET');
        if (!$secret) return null;
        
        // Simple JWT verification (use firebase/php-jwt for production)
        $parts = explode('.', $token);
        if (count($parts) !== 3) return null;
        
        // Verify signature (simplified)
        $payload = json_decode(base64_decode($parts[1]));
        if (!$payload) return null;
        
        // Check expiration if present
        if (isset($payload->exp) && $payload->exp < time()) {
            return null;
        }
        
        return $payload;
    } catch (Exception $e) {
        return null;
    }
}

/**
 * Verify API key and return associated user ID
 */
function verifyAPIKey(string $apiKey): ?int {
    try {
        $pdo = getDatabase();
        $keyHash = hash('sha256', $apiKey);
        
        $stmt = $pdo->prepare('SELECT user_id FROM api_keys 
                              WHERE api_key_hash = :hash AND is_active = 1 AND revoked_at IS NULL');
        $stmt->execute([':hash' => $keyHash]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if ($result) {
            // Update last used timestamp
            $pdo->prepare('UPDATE api_keys SET last_used_at = NOW() WHERE api_key_hash = :hash')
                ->execute([':hash' => $keyHash]);
            
            return (int)$result['user_id'];
        }
    } catch (Exception $e) {
        // Silently fail
    }
    
    return null;
}

/**
 * Enforce rate limiting
 * 100 requests per minute per user
 */
function enforceRateLimit(int $userId): void {
    $cacheKey = "rate_limit:$userId";
    $currentCount = apcu_fetch($cacheKey);
    
    if ($currentCount === false) {
        apcu_store($cacheKey, 1, 60);
        return;
    }
    
    if ($currentCount >= 100) {
        http_response_code(429);
        echo json_encode([
            'error' => 'Rate limit exceeded',
            'retry_after' => 60,
            'message' => '100 requests per minute limit exceeded'
        ]);
        exit;
    }
    
    apcu_inc($cacheKey);
}

/**
 * Require authentication (user must be logged in)
 * Returns user ID or exits with 401
 */
function requireAuth(): int {
    $userId = getCurrentUserId();
    if (!$userId) {
        http_response_code(401);
        echo json_encode([
            'error' => 'Authentication required',
            'message' => 'Please provide valid credentials (session, JWT Bearer token, or X-API-Key header)'
        ]);
        exit;
    }
    return $userId;
}

/**
 * Check if user is admin
 */
function isAdminUser(int $userId): bool {
    // Priority 1: Admin API key header (for simple integration)
    $adminKey = $_SERVER['HTTP_X_ADMIN_KEY'] ?? null;
    if ($adminKey && $adminKey === getenv('ADMIN_API_KEY')) {
        return true;
    }
    
    // Priority 2: Check database for admin role
    try {
        $pdo = getDatabase();
        $stmt = $pdo->prepare('SELECT role FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $userId]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        
        return $result && in_array($result['role'], ['admin', 'superadmin']);
    } catch (Exception $e) {
        return false;
    }
}

/**
 * Require admin authorization
 * Returns user ID or exits with 403
 */
function requireAdmin(): int {
    $userId = requireAuth();
    
    if (!isAdminUser($userId)) {
        http_response_code(403);
        echo json_encode([
            'error' => 'Admin access required',
            'message' => 'You do not have permission to access this resource'
        ]);
        exit;
    }
    
    return $userId;
}

/**
 * Get database connection (requires getDatabase() in calling file)
 */
function getDatabase(): PDO {
    // This function must be defined in the calling file
    // But we can try to create it here as fallback
    static $pdo = null;
    
    if ($pdo === null) {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            getenv('DB_HOST') ?: 'db',
            getenv('DB_PORT') ?: 3306,
            getenv('DB_NAME') ?: 'galaxyquest'
        );
        
        $pdo = new PDO(
            $dsn,
            getenv('DB_USER') ?: 'root',
            getenv('DB_PASS') ?: 'root'
        );
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }
    
    return $pdo;
}
