<?php
/**
 * User Quota API
 * Returns user's current storage and generation quotas
 * 
 * GET /api/user_quota.php — Get current user's quota info
 */
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

// Allow requests without authentication (dev mode)
if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    only_method('GET');
    
    // Try to get user ID, but allow anonymous access
    $uid = current_user_id();
    
    // Default quotas (free tier)
    $defaultQuota = [
        'storage_limit_gb' => 5,
        'storage_used_gb' => 0,
        'generations_per_month' => 100,
        'generations_used_this_month' => 0,
        'tier' => 'free',
        'is_authenticated' => $uid !== null,
        'user_id' => $uid,
    ];
    
    // If user is authenticated, fetch real quota from database
    if ($uid !== null) {
        try {
            $db = get_db();
            
            // Get user quota
            $stmt = $db->prepare(<<<'SQL'
                SELECT 
                    COALESCE(storage_limit_gb, 5) as storage_limit_gb,
                    COALESCE(storage_used_gb, 0) as storage_used_gb,
                    COALESCE(generations_per_month, 100) as generations_per_month,
                    COALESCE(generations_used_this_month, 0) as generations_used_this_month,
                    COALESCE(tier, 'free') as tier
                FROM user_asset_quotas
                WHERE user_id = ?
                LIMIT 1
            SQL);
            $stmt->execute([$uid]);
            $quota = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if ($quota) {
                $defaultQuota = array_merge($defaultQuota, $quota);
                $defaultQuota['user_id'] = $uid;
                $defaultQuota['is_authenticated'] = true;
            }
        } catch (\PDOException $e) {
            error_log("QuotaAPI error: " . $e->getMessage());
            // Fall back to defaults if DB fails
        }
    }
    
    // Add calculated fields
    $defaultQuota['storage_percent_used'] = $defaultQuota['storage_limit_gb'] > 0 
        ? round(($defaultQuota['storage_used_gb'] / $defaultQuota['storage_limit_gb']) * 100, 1)
        : 0;
    
    $defaultQuota['generations_percent_used'] = $defaultQuota['generations_per_month'] > 0
        ? round(($defaultQuota['generations_used_this_month'] / $defaultQuota['generations_per_month']) * 100, 1)
        : 0;
    
    $defaultQuota['can_generate'] = 
        $defaultQuota['storage_used_gb'] < $defaultQuota['storage_limit_gb'] &&
        $defaultQuota['generations_used_this_month'] < $defaultQuota['generations_per_month'];
    
    json_ok($defaultQuota);
}
?>
