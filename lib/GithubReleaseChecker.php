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
    private const RELEASES_PER_PAGE = 100;
    private const MAX_PRERELEASE_PAGES = 10;
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
        if ($includePrerelease) {
            return $this->fetchLatestPrerelease();
        }

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
        if (
            !is_file($filePath)
            || preg_match('/\A[a-f0-9]{64}\z/i', $expectedChecksum) !== 1
        ) {
            return false;
        }

        $computed = hash_file('sha256', $filePath);
        return is_string($computed) && hash_equals($computed, strtolower($expectedChecksum));
    }

    /**
     * Parse version string into version components
     * 
     * @param string $version Version string (e.g., "v1.2.3", "1.2.3-beta")
     * @return array|null Parsed version or null if invalid
     */
    public static function parseVersion(string $version): ?array
    {
        $pattern = '/\Av?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)'
            . '(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?'
            . '(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?\z/';
        if (!preg_match($pattern, $version, $m)) {
            return null;
        }

        $prerelease = ($m[4] ?? '') !== '' ? $m[4] : null;
        if ($prerelease !== null) {
            foreach (explode('.', $prerelease) as $identifier) {
                if (ctype_digit($identifier) && strlen($identifier) > 1 && $identifier[0] === '0') {
                    return null;
                }
            }
        }

        return [
            'major' => $m[1],
            'minor' => $m[2],
            'patch' => $m[3],
            'prerelease' => $prerelease,
            'metadata' => ($m[5] ?? '') !== '' ? $m[5] : null,
            'full' => preg_replace('/\Av/', '', $version),
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

        foreach (['major', 'minor', 'patch'] as $component) {
            $comparison = self::compareNumericIdentifiers($p1[$component], $p2[$component]);
            if ($comparison !== 0) {
                return $comparison;
            }
        }

        // Pre-release versions are lower than release versions
        $hasPreV1 = $p1['prerelease'] !== null;
        $hasPreV2 = $p2['prerelease'] !== null;
        if ($hasPreV1 !== $hasPreV2) {
            return $hasPreV1 ? -1 : 1;
        }

        // Compare pre-release identifiers if both have them
        if ($hasPreV1 && $hasPreV2) {
            $identifiers1 = explode('.', $p1['prerelease']);
            $identifiers2 = explode('.', $p2['prerelease']);
            $commonLength = min(count($identifiers1), count($identifiers2));

            for ($index = 0; $index < $commonLength; $index++) {
                $identifier1 = $identifiers1[$index];
                $identifier2 = $identifiers2[$index];
                $numeric1 = ctype_digit($identifier1);
                $numeric2 = ctype_digit($identifier2);

                if ($numeric1 && $numeric2) {
                    $comparison = self::compareNumericIdentifiers($identifier1, $identifier2);
                } elseif ($numeric1 !== $numeric2) {
                    $comparison = $numeric1 ? -1 : 1;
                } else {
                    $comparison = strcmp($identifier1, $identifier2) <=> 0;
                }

                if ($comparison !== 0) {
                    return $comparison;
                }
            }

            return count($identifiers1) <=> count($identifiers2);
        }

        return 0;
    }

    // ──────────────────────────────────────────────────────────────────────────

    private static function compareNumericIdentifiers(string $left, string $right): int
    {
        if (strlen($left) !== strlen($right)) {
            return strlen($left) <=> strlen($right);
        }

        return strcmp($left, $right) <=> 0;
    }

    private function fetchLatestPrerelease(): ?array
    {
        $latest = null;
        for ($page = 1; $page <= self::MAX_PRERELEASE_PAGES + 1; $page++) {
            $url = "{$this->githubApiUrl}/repos/{$this->owner}/{$this->repo}/releases"
                . '?per_page=' . self::RELEASES_PER_PAGE . '&page=' . $page;
            $response = $this->makeRequest($url);

            if (
                !$response
                || $response['status'] !== 200
                || !is_array($response['body'])
                || !array_is_list($response['body'])
                || count($response['body']) > self::RELEASES_PER_PAGE
            ) {
                throw new RuntimeException('Unable to read complete GitHub release history.');
            }

            if ($page > self::MAX_PRERELEASE_PAGES) {
                if ($response['body'] !== []) {
                    throw new RuntimeException('GitHub release history exceeds the 1,000-release search limit.');
                }
                return $latest === null ? null : $this->normalizeRelease($latest);
            }

            foreach ($response['body'] as $release) {
                if (
                    !is_array($release)
                    || ($release['prerelease'] ?? false) !== true
                    || ($release['draft'] ?? null) !== false
                    || !is_string($release['tag_name'] ?? null)
                    || !is_string($release['html_url'] ?? null)
                    || !is_string($release['published_at'] ?? null)
                ) {
                    continue;
                }

                $version = self::parseVersion($release['tag_name']);
                if ($version === null || $version['prerelease'] === null) {
                    continue;
                }

                if (
                    $latest === null
                    || self::compareVersions($release['tag_name'], $latest['tag_name']) > 0
                ) {
                    $latest = $release;
                }
            }

            if (count($response['body']) < self::RELEASES_PER_PAGE) {
                return $latest === null ? null : $this->normalizeRelease($latest);
            }
        }

        return null;
    }

    private function fetchReleaseFromUrl(string $url, bool $includePrerelease = false): ?array
    {
        $response = $this->makeRequest($url);
        
        if (!$response || $response['status'] !== 200) {
            return null;
        }

        $release = $response['body'];

        if (
            !is_array($release)
            || !is_string($release['tag_name'] ?? null)
            || !is_string($release['html_url'] ?? null)
            || !is_string($release['published_at'] ?? null)
        ) {
            return null;
        }

        // Filter pre-releases if not requested
        if (!$includePrerelease && isset($release['prerelease']) && $release['prerelease']) {
            return null;
        }

        return $this->normalizeRelease($release);
    }

    private function normalizeRelease(array $release): array
    {
        // Only accept one archive with a checksum sidecar bound to its filename.
        $downloadUrl = null;
        $checksum = null;
        $archiveAssets = [];
        $checksumAssets = [];

        if (isset($release['assets']) && is_array($release['assets'])) {
            foreach ($release['assets'] as $asset) {
                if (
                    !is_array($asset)
                    || !is_string($asset['name'] ?? null)
                    || !is_string($asset['browser_download_url'] ?? null)
                ) {
                    continue;
                }

                $assetName = strtolower($asset['name']);
                if (str_ends_with($assetName, '.tar.gz') || str_ends_with($assetName, '.zip')) {
                    $archiveAssets[] = $asset;
                } elseif (str_ends_with($assetName, '.sha256')) {
                    $checksumAssets[] = $asset;
                }
            }
        }

        if (count($archiveAssets) === 1) {
            $archive = $archiveAssets[0];
            $archiveName = $archive['name'];
            $checksumName = preg_replace('/\.(?:tar\.gz|zip)\z/i', '.sha256', $archiveName);
            $matchingChecksums = array_values(array_filter(
                $checksumAssets,
                static fn (array $asset): bool => $asset['name'] === $checksumName
            ));

            if (count($matchingChecksums) === 1) {
                $checksumContent = $this->fetchUrl($matchingChecksums[0]['browser_download_url']);
                if ($checksumContent !== null) {
                    $checksum = self::parseChecksumFile($checksumContent, $archiveName);
                    if ($checksum !== null) {
                        $downloadUrl = $archive['browser_download_url'];
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

    private static function parseChecksumFile(string $contents, string $archiveName): ?string
    {
        if (
            preg_match('/\A([a-f0-9]{64})[ \t]+\*?([^\r\n]+)\r?\n?\z/i', $contents, $matches) !== 1
            || $matches[2] !== $archiveName
        ) {
            return null;
        }

        return strtolower($matches[1]);
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
                'ignore_errors' => true,
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
