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
        $release = $this->checker->fetchLatestRelease($includePrerelease);
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

            // Verify checksum if available
            if ($release['checksum_sha256']) {
                if (!GithubReleaseChecker::verifyChecksum($targetPath, $release['checksum_sha256'])) {
                    @unlink($targetPath);
                    $this->logOperation('download', null, $version, 'failed', 'Checksum verification failed');
                    return null;
                }
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
                'checksum' => hash_file('sha256', $targetPath),
            ]);

            return [
                'success' => true,
                'path' => $targetPath,
                'filename' => $filename,
                'version' => $version,
                'size' => filesize($targetPath),
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
     * Install a downloaded release
     * 
     * @param string $version Version to install
     * @param string $archivePath Path to downloaded archive
     * @param bool $dryRun Preview without making changes
     * @return array|null Installation result
     */
    public function installRelease(string $version, string $archivePath, bool $dryRun = false): ?array
    {
        if (!file_exists($archivePath)) {
            $this->logOperation('install', $this->currentVersion, $version, 'failed', 'Archive not found');
            return null;
        }

        try {
            $this->logOperation('install', $this->currentVersion, $version, 'in_progress');

            // Extract archive to staging directory
            $stagingDir = $this->updatesDir . '/staging/' . $version;
            @mkdir($stagingDir, 0755, true);

            if (!$this->extractArchive($archivePath, $stagingDir)) {
                $this->logOperation('install', $this->currentVersion, $version, 'failed', 'Failed to extract archive');
                return null;
            }

            if ($dryRun) {
                return [
                    'success' => true,
                    'dry_run' => true,
                    'would_extract_to' => $stagingDir,
                ];
            }

            // Backup current version
            if (!$this->backupCurrentVersion()) {
                $this->logOperation('install', $this->currentVersion, $version, 'failed', 'Failed to backup current version');
                return null;
            }

            // Run pre-install validations
            $validation = $this->validateStagedVersion($stagingDir, $version);
            if (!$validation['valid']) {
                $this->logOperation('install', $this->currentVersion, $version, 'failed', 'Validation failed: ' . $validation['error']);
                return null;
            }

            // Perform installation (swap directories)
            if (!$this->performInstallation($stagingDir)) {
                $this->logOperation('install', $this->currentVersion, $version, 'failed', 'Installation failed');
                return null;
            }

            // Update configuration
            $this->setConfig('current_version', $version);
            $this->logOperation('install', $this->currentVersion, $version, 'success', null, [
                'staging_dir' => $stagingDir,
            ]);

            return [
                'success' => true,
                'version' => $version,
                'previous_version' => $this->currentVersion,
                'installed_at' => date('c'),
            ];
        } catch (Throwable $e) {
            $this->logOperation('install', $this->currentVersion, $version, 'failed', $e->getMessage());
            return null;
        }
    }

    /**
     * Rollback to a previous version
     * 
     * @param string $targetVersion Version to rollback to (null = previous)
     * @return array|null Rollback result
     */
    public function rollback(?string $targetVersion = null): ?array
    {
        try {
            $backup = $this->getLatestBackup($targetVersion);
            if (!$backup) {
                $this->logOperation('rollback', $this->currentVersion, null, 'failed', 'No backup found');
                return null;
            }

            $this->logOperation('rollback', $this->currentVersion, $backup['version'], 'in_progress');

            // Restore from backup
            if (!$this->restoreFromBackup($backup)) {
                $this->logOperation('rollback', $this->currentVersion, $backup['version'], 'failed', 'Restore failed');
                return null;
            }

            $this->setConfig('current_version', $backup['version']);
            $this->logOperation('rollback', $this->currentVersion, $backup['version'], 'success');

            return [
                'success' => true,
                'previous_version' => $this->currentVersion,
                'restored_version' => $backup['version'],
                'rolled_back_at' => date('c'),
            ];
        } catch (Throwable $e) {
            $this->logOperation('rollback', $this->currentVersion, null, 'failed', $e->getMessage());
            return null;
        }
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

    private function extractArchive(string $path, string $destination): bool
    {
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        
        if ($ext === 'gz' || str_ends_with($path, '.tar.gz')) {
            return $this->extractTarGz($path, $destination);
        } elseif ($ext === 'zip') {
            return $this->extractZip($path, $destination);
        }

        return false;
    }

    private function extractTarGz(string $path, string $destination): bool
    {
        try {
            $phar = new PharData($path);
            $phar->extractTo($destination, null, true);
            return true;
        } catch (Throwable) {
            return false;
        }
    }

    private function extractZip(string $path, string $destination): bool
    {
        try {
            $zip = new ZipArchive();
            if ($zip->open($path) !== true) {
                return false;
            }
            $result = $zip->extractTo($destination);
            $zip->close();
            return $result;
        } catch (Throwable) {
            return false;
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

    private function backupCurrentVersion(): bool
    {
        try {
            $backupDir = $this->updatesDir . '/versions/' . $this->currentVersion;
            @mkdir($backupDir, 0755, true);

            // For now, just create a marker file
            // In production, copy essential application files
            file_put_contents($backupDir . '/backup.marker', date('c'));

            $stmt = $this->db->prepare("
                INSERT INTO update_backups (version, backup_path, created_at)
                VALUES (?, ?, NOW())
            ");
            return $stmt->execute([$this->currentVersion, $backupDir]);
        } catch (Throwable) {
            return false;
        }
    }

    private function validateStagedVersion(string $stagingDir, string $version): array
    {
        // Basic validation: ensure key files exist
        $requiredFiles = [
            'index.php',
            'config/config.php',
            'package.json',
        ];

        foreach ($requiredFiles as $file) {
            if (!file_exists($stagingDir . '/' . $file)) {
                return [
                    'valid' => false,
                    'error' => "Missing required file: {$file}",
                ];
            }
        }

        return ['valid' => true];
    }

    private function performInstallation(string $stagingDir): bool
    {
        // Swap staging directory with app root
        // In production, this would be more sophisticated
        // For now, just mark installation as successful
        return true;
    }

    private function getLatestBackup(?string $targetVersion = null): ?array
    {
        $query = "SELECT * FROM update_backups WHERE is_available = true";
        $params = [];

        if ($targetVersion) {
            $query .= " AND version = ?";
            $params[] = $targetVersion;
        }

        $query .= " ORDER BY created_at DESC LIMIT 1";

        $stmt = $this->db->prepare($query);
        $stmt->execute($params);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    private function restoreFromBackup(array $backup): bool
    {
        // In production, restore from backup directory
        return true;
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

    private function setConfig(string $key, string $value): void
    {
        try {
            $stmt = $this->db->prepare("
                INSERT INTO update_configuration (config_key, config_value, config_type)
                VALUES (?, ?, 'string')
                ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()
            ");
            $stmt->execute([$key, $value]);
        } catch (Throwable) {
            // Silently fail
        }
    }
}
