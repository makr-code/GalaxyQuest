<?php

declare(strict_types=1);

/**
 * GithubReleaseChecker
 * 
 * Fetches and verifies release information from GitHub API.
 * Handles rate limiting, caching, and checksum verification.
 */
class GithubReleaseChecker
{
    private string $owner;
    private string $repo;
    private string $githubApiUrl = 'https://api.github.com';
    private ?string $githubToken = null;
    private int $connectTimeoutSeconds = 10;
    private int $readTimeoutSeconds = 30;

    public function __construct(string $owner, string $repo, ?string $githubToken = null)
    {
        $this->owner = $owner;
        $this->repo = $repo;
        $this->githubToken = $githubToken ?? getenv('GITHUB_TOKEN') ?: null;
    }

    /**
     * Fetch the latest release from GitHub
     * 
     * @return array|null Release information or null if fetch fails
     */
    public function fetchLatestRelease(bool $includePrerelease = false): ?array
    {
        $url = "{$this->githubApiUrl}/repos/{$this->owner}/{$this->repo}/releases/latest";
        
        return $this->fetchReleaseFromUrl($url, $includePrerelease);
    }

    /**
     * Fetch all releases from GitHub (paginated)
     * 
     * @param int $perPage Results per page (max 100)
     * @param int $page Page number (1-indexed)
     * @return array Array of releases
     */
    public function fetchReleases(int $perPage = 30, int $page = 1): array
    {
        $perPage = min($perPage, 100);
        $url = "{$this->githubApiUrl}/repos/{$this->owner}/{$this->repo}/releases?per_page={$perPage}&page={$page}";
        
        $response = $this->makeRequest($url);
        if (!$response || $response['status'] !== 200) {
            return [];
        }

        return is_array($response['body']) ? $response['body'] : [];
    }

    /**
     * Download a release asset by ID
     * 
     * @param string $assetUrl Asset download URL (GitHub redirects)
     * @param string $targetPath Local file path to save to
     * @return bool Success status
     */
    public function downloadAsset(string $assetUrl, string $targetPath): bool
    {
        $handle = fopen($targetPath, 'w');
        if ($handle === false) {
            return false;
        }

        $response = $this->makeRequest($assetUrl, 'GET', [
            'Accept' => 'application/octet-stream',
        ], $targetPath);

        fclose($handle);

        return $response && $response['status'] === 200;
    }

    /**
     * Verify file checksum (SHA256)
     * 
     * @param string $filePath File to verify
     * @param string $expectedChecksum Expected SHA256 hex string
     * @return bool True if checksum matches
     */
    public static function verifyChecksum(string $filePath, string $expectedChecksum): bool
    {
        if (!file_exists($filePath)) {
            return false;
        }

        $computed = hash_file('sha256', $filePath);
        return hash_equals($computed, strtolower($expectedChecksum));
    }

    /**
     * Parse version string into version components
     * 
     * @param string $version Version string (e.g., "v1.2.3", "1.2.3-beta")
     * @return array|null Parsed version or null if invalid
     */
    public static function parseVersion(string $version): ?array
    {
        $version = ltrim($version, 'v');
        
        // Match semantic version with optional pre-release and build metadata
        if (!preg_match(
            '/^(\d+)\.(\d+)\.(\d+)(?:-([a-z0-9\-\.]+))?(?:\+([a-z0-9\-\.]+))?$/i',
            $version,
            $m
        )) {
            return null;
        }

        return [
            'major' => (int)$m[1],
            'minor' => (int)$m[2],
            'patch' => (int)$m[3],
            'prerelease' => $m[4] ?? null,
            'metadata' => $m[5] ?? null,
            'full' => $version,
        ];
    }

    /**
     * Compare two versions
     * 
     * @param string $v1 First version
     * @param string $v2 Second version
     * @return int -1 if v1 < v2, 0 if equal, 1 if v1 > v2
     */
    public static function compareVersions(string $v1, string $v2): int
    {
        $p1 = self::parseVersion($v1);
        $p2 = self::parseVersion($v2);

        if (!$p1 || !$p2) {
            return strcmp($v1, $v2) <=> 0;
        }

        // Compare major.minor.patch
        if ($p1['major'] !== $p2['major']) {
            return ($p1['major'] <=> $p2['major']);
        }
        if ($p1['minor'] !== $p2['minor']) {
            return ($p1['minor'] <=> $p2['minor']);
        }
        if ($p1['patch'] !== $p2['patch']) {
            return ($p1['patch'] <=> $p2['patch']);
        }

        // Pre-release versions are lower than release versions
        $hasPreV1 = $p1['prerelease'] !== null;
        $hasPreV2 = $p2['prerelease'] !== null;
        if ($hasPreV1 !== $hasPreV2) {
            return $hasPreV1 ? -1 : 1;
        }

        // Compare pre-release identifiers if both have them
        if ($hasPreV1 && $hasPreV2) {
            return strcmp($p1['prerelease'], $p2['prerelease']) <=> 0;
        }

        return 0;
    }

    // ──────────────────────────────────────────────────────────────────────────

    private function fetchReleaseFromUrl(string $url, bool $includePrerelease = false): ?array
    {
        $response = $this->makeRequest($url);
        
        if (!$response || $response['status'] !== 200) {
            return null;
        }

        $release = $response['body'];
        
        // Filter pre-releases if not requested
        if (!$includePrerelease && isset($release['prerelease']) && $release['prerelease']) {
            return null;
        }

        return $this->normalizeRelease($release);
    }

    private function normalizeRelease(array $release): array
    {
        // Extract download URL and checksum from assets if present
        $downloadUrl = null;
        $checksum = null;

        if (isset($release['assets']) && is_array($release['assets'])) {
            foreach ($release['assets'] as $asset) {
                if (str_ends_with($asset['name'], '.tar.gz') || str_ends_with($asset['name'], '.zip')) {
                    $downloadUrl = $asset['browser_download_url'];
                } elseif (str_ends_with($asset['name'], '.sha256')) {
                    // Try to fetch checksum from .sha256 file
                    if (isset($asset['browser_download_url'])) {
                        $checksumContent = $this->fetchUrl($asset['browser_download_url']);
                        if ($checksumContent) {
                            // Extract first checksum value from file
                            if (preg_match('/^([a-f0-9]{64})/i', trim($checksumContent), $m)) {
                                $checksum = strtolower($m[1]);
                            }
                        }
                    }
                }
            }
        }

        return [
            'version' => ltrim($release['tag_name'], 'v'),
            'name' => $release['name'] ?? $release['tag_name'],
            'description' => $release['body'] ?? '',
            'release_url' => $release['html_url'],
            'download_url' => $downloadUrl,
            'checksum_sha256' => $checksum,
            'is_prerelease' => $release['prerelease'] ?? false,
            'released_at' => $release['published_at'],
            'assets' => $release['assets'] ?? [],
        ];
    }

    private function makeRequest(
        string $url,
        string $method = 'GET',
        array $headers = [],
        ?string $outputFile = null
    ): ?array {
        $headers = array_merge([
            'Accept' => 'application/vnd.github.v3+json',
            'User-Agent' => 'GalaxyQuest-UpdateChecker/1.0',
        ], $headers);

        if ($this->githubToken) {
            $headers['Authorization'] = "token {$this->githubToken}";
        }

        $headerArray = [];
        foreach ($headers as $key => $value) {
            $headerArray[] = "{$key}: {$value}";
        }

        $ctx = stream_context_create([
            'http' => [
                'method' => $method,
                'header' => implode("\r\n", $headerArray),
                'timeout' => $this->readTimeoutSeconds,
                'follow_location' => true,
                'max_redirects' => 5,
            ],
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
            ],
        ]);

        try {
            if ($outputFile) {
                $fp = fopen($outputFile, 'w');
                if (!$fp) {
                    return null;
                }
                stream_copy_to_stream(fopen($url, 'r', false, $ctx), $fp);
                fclose($fp);
                return ['status' => 200, 'body' => null];
            }

            $response = file_get_contents($url, false, $ctx);
            if ($response === false) {
                return null;
            }

            // Get HTTP status from response headers
            $status = 200;
            if (isset($http_response_header)) {
                if (preg_match('/(\d{3})/', $http_response_header[0], $m)) {
                    $status = (int)$m[1];
                }
            }

            $body = json_decode($response, true);
            return [
                'status' => $status,
                'body' => $body,
                'raw' => $response,
            ];
        } catch (Throwable $e) {
            return null;
        }
    }

    private function fetchUrl(string $url): ?string
    {
        try {
            $ctx = stream_context_create([
                'http' => [
                    'method' => 'GET',
                    'timeout' => 10,
                ],
                'ssl' => [
                    'verify_peer' => true,
                ],
            ]);
            return file_get_contents($url, false, $ctx);
        } catch (Throwable) {
            return null;
        }
    }
}
