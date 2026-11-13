<?php

declare(strict_types=1);

/**
 * UpdateManager
 * 
 * Core update system logic: checking for updates, downloading, verifying,
 * and managing update state and history.
 */
class UpdateManager
{
    public const MUTATION_UNAVAILABLE =
        'Installation and rollback are disabled: deployment, backup and restore are not implemented.';

    private PDO $db;
    private string $appRoot;
    private GithubReleaseChecker $checker;
    private string $currentVersion;
    private string $updatesDir;
    private int $maxBackups = 3;

    public function __construct(PDO $db, string $appRoot, string $currentVersion)
    {
        $this->db = $db;
        $this->appRoot = rtrim($appRoot, '/');
        $this->currentVersion = $currentVersion;
        $this->updatesDir = $this->appRoot . '/updates';

        $config = $this->getConfig('github_owner') . '/' . $this->getConfig('github_repo');
        [$owner, $repo] = explode('/', $config);
        
        $this->checker = new GithubReleaseChecker(
            $owner,
            $repo,
            getenv('GITHUB_TOKEN') ?: null
        );

        $this->ensureUpdateDirectories();
    }

    /**
     * Check for available updates
     * 
     * @return array|null Latest release info or null if no update available
     */
    public function checkForUpdates(bool $includePrerelease = false): ?array
    {
        try {
            $release = $this->checker->fetchLatestRelease($includePrerelease);
        } catch (RuntimeException $e) {
            $this->logOperation('check', null, null, 'failed', $e->getMessage());
            throw $e;
        }
        if (!$release) {
            $this->logOperation('check', null, null, 'failed', 'Failed to fetch release from GitHub');
            return null;
        }

        // Update release in database
        $this->storeRelease($release);

        // Compare versions
        if (GithubReleaseChecker::compareVersions($release['version'], $this->currentVersion) <= 0) {
            return null; // No newer version available
        }

        $this->logOperation('check', null, $release['version'], 'success');
        return $release;
    }

    /**
     * Download and verify a release
     * 
     * @param string $version Version to download
     * @return array|null Download result with path or error info
     */
    public function downloadRelease(string $version): ?array
    {
        $release = $this->getReleaseInfo($version);
        if (!$release) {
            $this->logOperation('download', null, $version, 'failed', 'Release not found');
            return null;
        }

        if (!$release['download_url']) {
            $this->logOperation('download', null, $version, 'failed', 'No download URL in release');
            return null;
        }

        $expectedChecksum = $release['checksum_sha256'] ?? null;
        if (!is_string($expectedChecksum) || preg_match('/\A[a-f0-9]{64}\z/i', $expectedChecksum) !== 1) {
            $this->logOperation('download', null, $version, 'failed', 'Valid SHA-256 checksum unavailable');
            return null;
        }

        $downloadDir = $this->updatesDir . '/downloads';
        @mkdir($downloadDir, 0755, true);

        $filename = basename(parse_url($release['download_url'], PHP_URL_PATH));
        $targetPath = $downloadDir . '/' . $filename;

        try {
            // Download the file
            if (!$this->checker->downloadAsset($release['download_url'], $targetPath)) {
                $this->logOperation('download', null, $version, 'failed', 'Download failed');
                return null;
            }

            if (!GithubReleaseChecker::verifyChecksum($targetPath, $expectedChecksum)) {
                @unlink($targetPath);
                $this->logOperation('download', null, $version, 'failed', 'Checksum verification failed');
                return null;
            }

            // Verify file integrity
            if (!$this->verifyArchiveIntegrity($targetPath)) {
                @unlink($targetPath);
                $this->logOperation('download', null, $version, 'failed', 'Archive integrity check failed');
                return null;
            }

            $this->logOperation('download', null, $version, 'success', null, [
                'filename' => $filename,
                'size' => filesize($targetPath),
                'checksum' => $expectedChecksum,
            ]);

            return [
                'success' => true,
                'path' => $targetPath,
                'filename' => $filename,
                'version' => $version,
                'size' => filesize($targetPath),
                'checksum' => $expectedChecksum,
            ];
        } catch (Throwable $e) {
            @unlink($targetPath);
            $this->logOperation('download', null, $version, 'failed', $e->getMessage());
            return null;
        }
    }

    /**
     * Verify system health before update
     * 
     * @return array Status with 'healthy' bool and 'checks' array
     */
    public function performHealthChecks(): array
    {
        $checks = [];

        // Check disk space (need 2x version size + buffer)
        $freeSpace = disk_free_space($this->appRoot);
        $checks['disk_space'] = [
            'status' => $freeSpace !== false && $freeSpace > (500 * 1024 * 1024), // 500MB minimum
            'free_bytes' => $freeSpace ?: 0,
            'required_bytes' => 500 * 1024 * 1024,
        ];

        // Check database connectivity
        try {
            $this->db->query('SELECT 1');
            $checks['database'] = ['status' => true];
        } catch (Throwable) {
            $checks['database'] = ['status' => false, 'error' => 'Cannot connect to database'];
        }

        // Check if app directories are writable
        $checks['writable_dirs'] = [
            'status' => is_writable($this->appRoot),
            'paths' => [
                'app_root' => is_writable($this->appRoot),
                'updates' => is_writable($this->updatesDir),
                'config' => is_writable($this->appRoot . '/config'),
            ],
        ];

        $healthy = $checks['disk_space']['status'] 
            && $checks['database']['status'] 
            && $checks['writable_dirs']['status'];

        return [
            'healthy' => $healthy,
            'checks' => $checks,
            'timestamp' => date('c'),
        ];
    }

    /**
     * Installation is unavailable until deployment and recovery are implemented.
     * 
     * @param string $version Version to install
     * @param string $archivePath Path to downloaded archive
     * @param bool $dryRun Preview without making changes
     * @throws LogicException
     */
    public function installRelease(string $version, string $archivePath, bool $dryRun = false): ?array
    {
        throw new LogicException(self::MUTATION_UNAVAILABLE);
    }

    /**
     * Rollback is unavailable until deployment and recovery are implemented.
     * 
     * @param string $targetVersion Version to rollback to (null = previous)
     * @throws LogicException
     */
    public function rollback(?string $targetVersion = null): ?array
    {
        throw new LogicException(self::MUTATION_UNAVAILABLE);
    }

    /**
     * Get update status
     */
    public function getStatus(): array
    {
        $latestRelease = $this->db->query(
            "SELECT * FROM update_releases ORDER BY released_at DESC LIMIT 1"
        )->fetch(PDO::FETCH_ASSOC);

        $updateAvailable = false;
        if ($latestRelease && GithubReleaseChecker::compareVersions($latestRelease['version'], $this->currentVersion) > 0) {
            $updateAvailable = true;
        }

        return [
            'current_version' => $this->currentVersion,
            'update_available' => $updateAvailable,
            'latest_release' => $latestRelease,
            'health' => $this->performHealthChecks(),
            'last_check' => $this->getConfig('last_check_at'),
        ];
    }

    // ──────────────────────────────────────────────────────────────────────────

    private function ensureUpdateDirectories(): void
    {
        $dirs = [
            $this->updatesDir,
            $this->updatesDir . '/downloads',
            $this->updatesDir . '/staging',
            $this->updatesDir . '/versions',
            $this->updatesDir . '/logs',
        ];

        foreach ($dirs as $dir) {
            @mkdir($dir, 0755, true);
        }
    }

    private function verifyArchiveIntegrity(string $path): bool
    {
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        
        try {
            if ($ext === 'gz' || str_ends_with($path, '.tar.gz')) {
                new PharData($path);
            } elseif ($ext === 'zip') {
                $zip = new ZipArchive();
                if ($zip->open($path) !== true) {
                    return false;
                }
                $zip->close();
            }
            return true;
        } catch (Throwable) {
            return false;
        }
    }

    private function storeRelease(array $release): void
    {
        try {
            $stmt = $this->db->prepare("
                INSERT INTO update_releases 
                (version, release_name, description, release_url, download_url, checksum_sha256, is_prerelease, released_at, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    release_name = VALUES(release_name),
                    description = VALUES(description),
                    download_url = VALUES(download_url),
                    checksum_sha256 = VALUES(checksum_sha256),
                    fetched_at = NOW()
            ");

            $stmt->execute([
                $release['version'],
                $release['name'],
                $release['description'],
                $release['release_url'],
                $release['download_url'],
                $release['checksum_sha256'],
                $release['is_prerelease'] ? 1 : 0,
                $release['released_at'],
            ]);
        } catch (Throwable) {
            // Silently fail on database errors
        }
    }

    private function getReleaseInfo(string $version): ?array
    {
        $stmt = $this->db->prepare("
            SELECT * FROM update_releases WHERE version = ? LIMIT 1
        ");
        $stmt->execute([$version]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    private function logOperation(
        string $type,
        ?string $fromVersion,
        ?string $toVersion,
        string $status,
        ?string $errorMessage = null,
        ?array $details = null
    ): void {
        try {
            $stmt = $this->db->prepare("
                INSERT INTO update_history (operation_type, from_version, to_version, status, error_message, details, started_at)
                VALUES (?, ?, ?, ?, ?, ?, NOW())
            ");

            $stmt->execute([
                $type,
                $fromVersion,
                $toVersion,
                $status,
                $errorMessage,
                $details ? json_encode($details) : null,
            ]);
        } catch (Throwable) {
            // Silently fail on logging errors
        }
    }

    private function getConfig(string $key): string
    {
        try {
            $stmt = $this->db->prepare("SELECT config_value FROM update_configuration WHERE config_key = ? LIMIT 1");
            $stmt->execute([$key]);
            $result = $stmt->fetch(PDO::FETCH_ASSOC);
            return $result['config_value'] ?? '';
        } catch (Throwable) {
            return '';
        }
    }
}
