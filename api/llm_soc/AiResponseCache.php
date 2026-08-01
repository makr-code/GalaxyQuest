<?php
/**
 * AI Response Caching System
 * Supports file-based and Redis caching with TTL
 * Reduces API calls and improves response time for repeated queries
 */

class AiResponseCache
{
    private string $storage;
    private string $cache_dir;
    private int $ttl_seconds;
    private \Redis $redis;

    public function __construct(array $config)
    {
        $this->storage = $config['storage'] ?? 'file';
        $this->cache_dir = __DIR__ . '/../../' . ($config['file_path'] ?? 'cache/ai_responses');
        $this->ttl_seconds = (int) ($config['ttl_seconds'] ?? 3600);

        if ($this->storage === 'file' && !is_dir($this->cache_dir)) {
            @mkdir($this->cache_dir, 0755, true);
        }

        if ($this->storage === 'redis') {
            $this->redis = new \Redis();
            try {
                $this->redis->connect(
                    $config['redis_host'] ?? 'localhost',
                    (int) ($config['redis_port'] ?? 6379),
                    1 // timeout
                );
            } catch (\Exception $e) {
                error_log("Redis connection failed: " . $e->getMessage());
                $this->storage = 'file'; // Fallback to file
            }
        }
    }

    /**
     * Generate cache key from prompt/messages
     */
    private function generateKey(string $model, array $messages, array $options = []): string
    {
        $key_data = [
            'model' => $model,
            'messages' => array_map(fn($m) => $m['role'] . ':' . substr($m['content'], 0, 100), $messages),
            'options' => $options,
        ];
        return 'ai_' . md5(json_encode($key_data));
    }

    /**
     * Get cached response
     */
    public function get(string $model, array $messages, array $options = []): ?array
    {
        $key = $this->generateKey($model, $messages, $options);

        if ($this->storage === 'file') {
            return $this->getFileCache($key);
        } elseif ($this->storage === 'redis') {
            return $this->getRedisCache($key);
        }

        return null;
    }

    private function getFileCache(string $key): ?array
    {
        $file = $this->cache_dir . '/' . $key . '.json';

        if (!file_exists($file)) {
            return null;
        }

        $data = json_decode(file_get_contents($file), true);
        if (!is_array($data)) {
            return null;
        }

        // Check expiration
        if ((int) ($data['expires_at'] ?? 0) < time()) {
            @unlink($file);
            return null;
        }

        return $data['response'] ?? null;
    }

    private function getRedisCache(string $key): ?array
    {
        try {
            $cached = $this->redis->get($key);
            if ($cached === false) {
                return null;
            }
            return json_decode($cached, true);
        } catch (\Exception $e) {
            error_log("Redis get failed: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Store response in cache
     */
    public function set(string $model, array $messages, array $response, array $options = []): bool
    {
        $key = $this->generateKey($model, $messages, $options);

        if ($this->storage === 'file') {
            return $this->setFileCache($key, $response);
        } elseif ($this->storage === 'redis') {
            return $this->setRedisCache($key, $response);
        }

        return false;
    }

    private function setFileCache(string $key, array $response): bool
    {
        $file = $this->cache_dir . '/' . $key . '.json';
        $data = [
            'response' => $response,
            'expires_at' => time() + $this->ttl_seconds,
            'created_at' => time(),
        ];

        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        return (bool) file_put_contents($file, $json);
    }

    private function setRedisCache(string $key, array $response): bool
    {
        try {
            $json = json_encode($response, JSON_UNESCAPED_UNICODE);
            return (bool) $this->redis->setex($key, $this->ttl_seconds, $json);
        } catch (\Exception $e) {
            error_log("Redis set failed: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Invalidate specific cache entry
     */
    public function invalidate(string $model, array $messages, array $options = []): bool
    {
        $key = $this->generateKey($model, $messages, $options);

        if ($this->storage === 'file') {
            $file = $this->cache_dir . '/' . $key . '.json';
            return @unlink($file);
        } elseif ($this->storage === 'redis') {
            try {
                return (bool) $this->redis->del($key);
            } catch (\Exception $e) {
                error_log("Redis del failed: " . $e->getMessage());
                return false;
            }
        }

        return false;
    }

    /**
     * Clear all cached responses (for maintenance)
     */
    public function clearAll(): int
    {
        if ($this->storage === 'file') {
            $count = 0;
            if (is_dir($this->cache_dir)) {
                foreach (glob($this->cache_dir . '/*.json') as $file) {
                    if (@unlink($file)) {
                        $count++;
                    }
                }
            }
            return $count;
        } elseif ($this->storage === 'redis') {
            try {
                $keys = $this->redis->keys('ai_*');
                if (!empty($keys)) {
                    return $this->redis->del(...$keys);
                }
            } catch (\Exception $e) {
                error_log("Redis clear failed: " . $e->getMessage());
            }
        }

        return 0;
    }

    /**
     * Get cache statistics
     */
    public function getStats(): array
    {
        if ($this->storage === 'file') {
            $files = glob($this->cache_dir . '/*.json') ?: [];
            $size = array_sum(array_map('filesize', $files));
            return [
                'storage' => 'file',
                'entries' => count($files),
                'size_bytes' => $size,
                'path' => $this->cache_dir,
            ];
        } elseif ($this->storage === 'redis') {
            try {
                $keys = $this->redis->keys('ai_*');
                return [
                    'storage' => 'redis',
                    'entries' => count($keys),
                    'host' => $this->redis->getHost(),
                    'port' => $this->redis->getPort(),
                ];
            } catch (\Exception $e) {
                return ['error' => $e->getMessage()];
            }
        }

        return [];
    }
}
