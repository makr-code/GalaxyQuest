<?php
/**
 * Shared Authentication Helpers
 * Used by both trellis2_endpoints.php and admin_endpoints.php
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

/**
 * Get current user ID from the session or an active API key.
 */
function getCurrentUserId(): ?int {
    // 1. Session-based auth (primary)
    session_start_secure();
    if (!empty($_SESSION['user_id'])) {
        return (int)$_SESSION['user_id'];
    }
    
    // 3. API key (X-API-Key header)
    $apiKey = $_SERVER['HTTP_X_API_KEY'] ?? null;
    if ($apiKey) {
        return verifyAPIKey($apiKey);
    }
    
    return null;
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
            'message' => 'Please provide a valid session or X-API-Key header'
        ]);
        exit;
    }
    return $userId;
}

/**
 * Check if user is admin
 */
function isAdminUser(int $userId): bool {
    $adminKey = $_SERVER['HTTP_X_ADMIN_KEY'] ?? null;
    if ($adminKey && $adminKey === getenv('ADMIN_API_KEY')) {
        return true;
    }

    return is_admin_user(getDatabase(), $userId);
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
    return get_db();
}
