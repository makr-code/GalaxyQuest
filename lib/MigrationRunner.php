<?php

/**
 * MigrationRunner – database migration runner for GalaxyQuest.
 *
 * Features
 * ─────────
 *  • Tracks applied migrations in the `schema_migrations` table.
 *  • Applies pending migrations in canonical manifest order (config/migrations_manifest.php).
 *  • Uses PDO transactions where supported; MySQL DDL commits implicitly and
 *    cannot be rolled back. Failed DDL migrations may leave partial changes.
 *  • Supports dry-run mode (no DB changes, shows what would run).
 *  • Supports rollback via companion `*_down.sql` files.
 *  • Records checksum (MD5), execution time, and environment per migration.
 *  • Serializes MySQL bootstrap/up/rollback via a nonblocking database-scoped session lock.
 *  • Rejects changed applied forward files and preflights selected pending files.
 *
 * Typical usage (via scripts/migrate.php):
 *   php scripts/migrate.php status
 *   php scripts/migrate.php up
 *   php scripts/migrate.php up --step=3 --dry-run
 *   php scripts/migrate.php rollback --step=1 --dry-run
 *
 * @see scripts/migrate.php
 * @see config/migrations_manifest.php
 * @see docs/technical/DATABASE_MIGRATIONS.md
 */

declare(strict_types=1);

use GalaxyQuest\Migrations\ActorMigrationAdoption;
use GalaxyQuest\Migrations\BodyMigrationAdoption;
use GalaxyQuest\Migrations\LegacyV2MigrationAdoption;
use GalaxyQuest\Migrations\EconomyMigrationAdoption;
use GalaxyQuest\Migrations\AuthMigrationAdoption;
use GalaxyQuest\Migrations\VesselBlueprintMigrationAdoption;
use GalaxyQuest\Migrations\WarHistoryMigrationAdoption;

class MigrationRunner
{
    private const TRACKING_TABLE = 'schema_migrations';

    private PDO $db;
    private string $sqlDir;
    private string $environment;
    /** @var list<string> */
    private array $manifest;
    private bool $migrationLockHeld = false;

    /**
     * @param PDO    $db          Open PDO connection (MySQL / MariaDB).
     * @param string $sqlDir      Absolute path to the directory that contains the *.sql files.
     * @param string $environment Deployment environment label, e.g. "DEV" or "PROD".
     * @param string $manifestFile Absolute path to the migrations_manifest.php file.
     */
    public function __construct(
        PDO $db,
        string $sqlDir,
        string $environment = 'unknown',
        string $manifestFile = ''
    ) {
        $this->db          = $db;
        $this->sqlDir      = rtrim($sqlDir, '/\\');
        $this->environment = $environment;
        if (strtoupper($environment) === 'ADOPTED') {
            throw new InvalidArgumentException('ADOPTED is reserved for verified legacy adoption.');
        }

        if ($manifestFile === '') {
            $manifestFile = dirname(__DIR__) . '/config/migrations_manifest.php';
        }

        $loaded = require $manifestFile;
        if (!is_array($loaded) || !array_is_list($loaded)) {
            throw new InvalidArgumentException('Migration manifest must return a list of SQL filenames.');
        }
        $seen = [];
        foreach ($loaded as $name) {
            if (
                !is_string($name) || !preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/D', $name)
                || str_ends_with(strtolower($name), '_down.sql')
            ) {
                throw new InvalidArgumentException('Migration manifest contains an invalid forward SQL filename.');
            }
            $identity = strtolower($name);
            if (isset($seen[$identity])) {
                throw new InvalidArgumentException('Duplicate migration in manifest: ' . $name);
            }
            $seen[$identity] = true;
        }
        $this->manifest = $loaded;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Public API
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Bootstrap the schema_migrations tracking table if it does not exist yet.
     * Safe to call on every run; the CREATE TABLE uses IF NOT EXISTS.
     */
    public function bootstrap(): void
    {
        $this->withMigrationLock(function (): void {
            $this->bootstrapTrackingTable();
        });
    }

    private function bootstrapTrackingTable(): void
    {
        $ddl = file_get_contents($this->sqlDir . '/schema_migrations.sql');
        if ($ddl === false) {
            throw new RuntimeException(
                'Cannot read ' . $this->sqlDir . '/schema_migrations.sql'
            );
        }
        $this->db->exec($ddl);
    }

    /**
     * Return the status of every migration in the manifest.
     *
     * @return list<array{name:string,status:string,applied_at:string|null,checksum:string|null,
     *     environment:string|null,execution_kind?:string}>
     */
    public function getStatus(): array
    {
        $applied = $this->loadAppliedMigrations();
        $result  = [];

        foreach ($this->manifest as $name) {
            if (isset($applied[$name])) {
                $row = $applied[$name];
                if ($row['environment'] === 'ADOPTED') {
                    $this->verifyAppliedChecksums([$name => $row]);
                }
                $result[] = [
                    'name'        => $name,
                    'status'      => 'applied',
                    'applied_at'  => $row['applied_at'],
                    'checksum'    => $row['checksum'],
                    'environment' => $row['environment'],
                    'execution_kind' => $row['environment'] === 'ADOPTED' ? 'adopted' : 'executed',
                ];
            } else {
                $result[] = [
                    'name'        => $name,
                    'status'      => 'pending',
                    'applied_at'  => null,
                    'checksum'    => null,
                    'environment' => null,
                ];
            }
        }

        return $result;
    }

    /**
     * Apply pending migrations (up direction).
     *
     * @param int|null $steps   Max number of pending migrations to apply (null = all).
     * @param bool     $dryRun  When true, show what would happen without changing the DB.
     * @return list<array{name:string,statements:int,execution_ms:int,skipped:bool}>
     */
    public function runUp(?int $steps = null, bool $dryRun = false): array
    {
        if ($steps !== null && $steps < 1) {
            throw new InvalidArgumentException('Migration steps must be positive.');
        }
        return $this->withMigrationLock(fn(): array => $this->runUpLocked($steps, $dryRun));
    }

    /** @return array{adopted:list<string>,evidence:array<string,mixed>,dry_run:bool} */
    public function adoptActorHistory(bool $dryRun = true): array
    {
        require_once __DIR__ . '/ActorMigrationAdoption.php';
        return $this->adoptValidatedHistory(ActorMigrationAdoption::class, $dryRun);
    }

    /** @return array{adopted:list<string>,evidence:array<string,mixed>,dry_run:bool} */
    public function adoptBodyHistory(bool $dryRun = true): array
    {
        require_once __DIR__ . '/BodyMigrationAdoption.php';
        return $this->adoptValidatedHistory(BodyMigrationAdoption::class, $dryRun);
    }

    /** @return array{adopted:list<string>,evidence:array<string,mixed>,dry_run:bool} */
    public function adoptLegacyV2History(bool $dryRun = true): array
    {
        require_once __DIR__ . '/LegacyV2MigrationAdoption.php';
        return $this->adoptValidatedHistory(LegacyV2MigrationAdoption::class, $dryRun);
    }

    /** @return array{adopted:list<string>,evidence:array<string,mixed>,dry_run:bool} */
    public function adoptEconomyHistory(bool $dryRun = true): array
    {
        require_once __DIR__ . '/EconomyMigrationAdoption.php';
        return $this->adoptValidatedHistory(EconomyMigrationAdoption::class, $dryRun);
    }

    /** @return array{adopted:list<string>,evidence:array<string,mixed>,dry_run:bool} */
    public function adoptAuthHistory(bool $dryRun = true): array
    {
        require_once __DIR__ . '/AuthMigrationAdoption.php';
        return $this->adoptValidatedHistory(AuthMigrationAdoption::class, $dryRun);
    }

    /** @return array{adopted:list<string>,evidence:array<string,mixed>,dry_run:bool} */
    public function adoptVesselBlueprintHistory(bool $dryRun = true): array
    {
        require_once __DIR__ . '/VesselBlueprintMigrationAdoption.php';
        return $this->adoptValidatedHistory(VesselBlueprintMigrationAdoption::class, $dryRun);
    }

    /** @return array{adopted:list<string>,evidence:array<string,mixed>,dry_run:bool} */
    public function adoptWarHistory(bool $dryRun = true): array
    {
        require_once __DIR__ . '/WarHistoryMigrationAdoption.php';
        return $this->adoptValidatedHistory(WarHistoryMigrationAdoption::class, $dryRun);
    }

    /**
     * @param class-string<ActorMigrationAdoption>|class-string<BodyMigrationAdoption>
     *     |class-string<LegacyV2MigrationAdoption>|class-string<EconomyMigrationAdoption>
     *     |class-string<AuthMigrationAdoption>|class-string<VesselBlueprintMigrationAdoption>
     *     |class-string<WarHistoryMigrationAdoption> $contract
     * @return array{adopted:list<string>,evidence:array<string,mixed>,dry_run:bool}
     */
    private function adoptValidatedHistory(string $contract, bool $dryRun): array
    {
        return $this->withMigrationLock(function () use ($contract, $dryRun): array {
            if (!$this->ensureTrackingTable(true)) {
                throw new RuntimeException('Adoption requires existing migration tracking.');
            }
            $applied = $this->loadAppliedMigrations();
            foreach ($applied as $name => $row) {
                if (!in_array($name, $this->manifest, true)) {
                    throw new RuntimeException('Foreign migration blocks legacy adoption: ' . $name);
                }
            }
            $this->verifyAppliedChecksums($applied);
            $pending = [];
            foreach ($contract::SOURCES as $name => $pin) {
                if (!in_array($name, $this->manifest, true)) {
                    throw new RuntimeException('Legacy adoption source is absent from the manifest.');
                }
                $hash = hash('sha256', str_replace("\r\n", "\n", $this->readMigrationSql($name)));
                if (!hash_equals($pin, $hash)) {
                    throw new RuntimeException('Legacy adoption contract does not cover changed SQL: ' . $name);
                }
                if (!isset($applied[$name])) {
                    $pending[] = $name;
                }
            }
            if (!$dryRun && $pending !== []) {
                $sql = file_get_contents($this->sqlDir . '/schema_migration_adoptions.sql');
                if ($sql === false) {
                    throw new RuntimeException('Cannot read adoption infrastructure schema.');
                }
                $this->db->exec($sql);
                $engine = $this->db->query(
                    "SELECT ENGINE FROM information_schema.TABLES
                     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migration_adoptions'"
                )->fetchColumn();
                if ($engine !== 'InnoDB') {
                    throw new RuntimeException('Adoption evidence requires InnoDB.');
                }
            }
            $this->db->beginTransaction();
            try {
                $evidence = $contract::validate($this->db);
                if (!$dryRun) {
                    foreach ($pending as $name) {
                        $this->db->prepare(
                            'INSERT INTO schema_migration_adoptions
                             (migration_name,contract_id,source_sha256,evidence_json,deployment_environment)
                             VALUES (?,?,?,?,?)'
                        )->execute([$name, $contract::CONTRACT, $contract::SOURCES[$name],
                            json_encode($evidence, JSON_THROW_ON_ERROR), $this->environment]);
                        $this->db->prepare(
                            "INSERT INTO schema_migrations (migration_name,checksum,environment,execution_ms)
                             VALUES (?,?,'ADOPTED',0)"
                        )->execute([$name, md5($this->readMigrationSql($name))]);
                    }
                }
                $this->db->commit();
            } catch (Throwable $error) {
                if ($this->db->inTransaction()) {
                    $this->db->rollBack();
                }
                throw $error;
            }
            return ['adopted' => $pending, 'evidence' => $evidence, 'dry_run' => $dryRun];
        });
    }

    /**
     * Verify the complete deployment manifest and its exact applied bytes without writing SQL.
     *
     * @return int Number of verified forward migrations.
     */
    public function verifyDeployment(): int
    {
        return $this->withMigrationLock(function (): int {
            if (!$this->ensureTrackingTable(true)) {
                throw new RuntimeException('Deployment verification requires an existing migration tracking table.');
            }
            $applied = $this->loadAppliedMigrations();
            foreach ($applied as $name => $row) {
                if (!in_array($name, $this->manifest, true)) {
                    throw new RuntimeException('Applied migration is absent from the deployment manifest: ' . $name);
                }
            }
            $this->verifyAppliedChecksums($applied);
            foreach ($this->manifest as $name) {
                if (!isset($applied[$name])) {
                    throw new RuntimeException('Deployment has a pending migration: ' . $name);
                }
            }
            return count($this->manifest);
        });
    }

    /** @return list<array{name:string,statements:int,execution_ms:int,skipped:bool}> */
    private function runUpLocked(?int $steps, bool $dryRun): array
    {
        $applied = $this->ensureTrackingTable($dryRun) ? $this->loadAppliedMigrations() : [];
        $this->verifyAppliedChecksums($applied);
        $pending = array_values(array_filter(
            $this->manifest,
            static fn(string $n) => !isset($applied[$n])
        ));
        if (
            in_array('migrate_v2.sql', $pending, true)
            && ($applied['migrate_actor_model_v1.sql']['environment'] ?? '') === 'ADOPTED'
        ) {
            throw new RuntimeException('Legacy v2 replay recreates is_npc; reconcile it before running Up.');
        }

        if ($steps !== null) {
            $pending = array_slice($pending, 0, $steps);
        }

        foreach ($pending as $name) {
            $this->readMigrationSql($name);
        }
        $results = [];
        foreach ($pending as $name) {
            $results[] = $this->applyMigration($name, $dryRun);
        }

        return $results;
    }

    /**
     * Roll back the last N applied migrations.
     *
     * A rollback requires a companion `<migration_name_without_.sql>_down.sql`
     * file in the same directory.  If no down-file exists the migration is
     * reported as non-reversible; the entire selected rollback is blocked.
     *
     * @param int  $steps   Number of migrations to roll back (default: 1).
     * @param bool $dryRun  When true, show what would happen without changing the DB.
     * @return list<array{name:string,status:string,statements:int,execution_ms:int}>
     */
    public function runRollback(int $steps = 1, bool $dryRun = false): array
    {
        if ($steps < 1) {
            throw new InvalidArgumentException('Rollback steps must be positive.');
        }
        return $this->withMigrationLock(fn(): array => $this->runRollbackLocked($steps, $dryRun));
    }

    /** @return list<array{name:string,status:string,statements:int,execution_ms:int}> */
    private function runRollbackLocked(int $steps, bool $dryRun): array
    {
        $applied = $this->ensureTrackingTable($dryRun) ? $this->loadAppliedMigrations() : [];
        $this->verifyAppliedChecksums($applied);

        // Build ordered list of applied migrations (manifest order, reversed).
        $appliedInOrder = array_values(array_filter(
            $this->manifest,
            static fn(string $n) => isset($applied[$n])
        ));
        $toRollback = array_slice(array_reverse($appliedInOrder), 0, $steps);

        foreach ($toRollback as $name) {
            if ($applied[$name]['environment'] === 'ADOPTED') {
                throw new RuntimeException('Rollback cannot undo adopted history: ' . $name);
            }
            $downName = $this->resolveDownFileName($name);
            if (!file_exists($this->sqlDir . '/' . $downName)) {
                return [[
                    'name' => $name,
                    'status' => 'no_down_file',
                    'statements' => 0,
                    'execution_ms' => 0,
                ]];
            }
            $this->readMigrationSql($downName);
        }
        $results = [];
        foreach ($toRollback as $name) {
            $results[] = $this->revertMigration($name, $dryRun);
        }

        return $results;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Apply a single migration file; DDL may implicitly end the transaction.
     *
     * @return array{name:string,statements:int,execution_ms:int,skipped:bool}
     */
    private function applyMigration(string $name, bool $dryRun): array
    {
        $sql = $this->readMigrationSql($name);
        $checksum   = md5($sql);
        $statements = $this->splitStatements($sql);

        if ($dryRun) {
            return [
                'name'         => $name,
                'statements'   => count($statements),
                'execution_ms' => 0,
                'skipped'      => true,
            ];
        }

        $start = microtime(true);

        $this->db->beginTransaction();
        try {
            foreach ($statements as $stmt) {
                $prepared = $this->db->prepare($stmt);
                $prepared->execute();
                if ($prepared->columnCount() > 0) {
                    $prepared->fetchAll();
                }
                $prepared->closeCursor();
            }

            $executionMs = (int)round((microtime(true) - $start) * 1000);

            $insert = $this->db->prepare(
                'INSERT INTO ' . self::TRACKING_TABLE . '
                    (migration_name, checksum, environment, execution_ms)
                 VALUES (?, ?, ?, ?)'
            );
            $insert->execute([$name, $checksum, $this->environment, $executionMs]);

            if ($this->db->inTransaction()) {
                $this->db->commit();
            }
        } catch (Throwable $e) {
            $transactionActive = $this->db->inTransaction();
            if ($transactionActive) {
                $this->db->rollBack();
            }
            throw new RuntimeException(
                'Migration "' . $name . '" failed: ' . $e->getMessage()
                . (!$transactionActive
                    ? ' Changes may already be committed; inspect the database before retrying.'
                    : ''),
                0,
                $e
            );
        }

        return [
            'name'         => $name,
            'statements'   => count($statements),
            'execution_ms' => $executionMs,
            'skipped'      => false,
        ];
    }

    /**
     * Revert a single migration using its companion _down.sql file.
     *
     * @return array{name:string,status:string,statements:int,execution_ms:int}
     */
    private function revertMigration(string $name, bool $dryRun): array
    {
        $downName = $this->resolveDownFileName($name);

        $sql = $this->readMigrationSql($downName);
        $statements = $this->splitStatements($sql);

        if ($dryRun) {
            return [
                'name'         => $name,
                'status'       => 'would_rollback',
                'statements'   => count($statements),
                'execution_ms' => 0,
            ];
        }

        $start = microtime(true);

        $this->db->beginTransaction();
        try {
            foreach ($statements as $stmt) {
                $prepared = $this->db->prepare($stmt);
                $prepared->execute();
                if ($prepared->columnCount() > 0) {
                    $prepared->fetchAll();
                }
                $prepared->closeCursor();
            }

            $executionMs = (int)round((microtime(true) - $start) * 1000);

            $delete = $this->db->prepare(
                'DELETE FROM ' . self::TRACKING_TABLE . ' WHERE migration_name = ?'
            );
            $delete->execute([$name]);

            if ($this->db->inTransaction()) {
                $this->db->commit();
            }
        } catch (Throwable $e) {
            $transactionActive = $this->db->inTransaction();
            if ($transactionActive) {
                $this->db->rollBack();
            }
            throw new RuntimeException(
                'Rollback of "' . $name . '" failed: ' . $e->getMessage()
                . (!$transactionActive
                    ? ' Changes may already be committed; inspect the database before retrying.'
                    : ''),
                0,
                $e
            );
        }

        return [
            'name'         => $name,
            'status'       => 'rolled_back',
            'statements'   => count($statements),
            'execution_ms' => $executionMs,
        ];
    }

    /**
     * Derive the _down.sql companion filename for a given migration name.
     *
     * migrate_foo_v1.sql        → migrate_foo_v1_down.sql
     * migrate_foo_v1_bar.sql    → migrate_foo_v1_bar_down.sql
     */
    private function resolveDownFileName(string $upName): string
    {
        // Strip the .sql suffix, append _down.sql
        $base = preg_replace('/\.sql$/i', '', $upName);
        return $base . '_down.sql';
    }

    /**
     * Load all applied migrations from the tracking table.
     *
     * @return array<string, array{applied_at:string,checksum:string,environment:string}>
     */
    private function loadAppliedMigrations(): array
    {
        $stmt = $this->db->query(
            'SELECT migration_name, applied_at, checksum, environment
               FROM ' . self::TRACKING_TABLE
        );
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $map = [];
        foreach ($rows as $row) {
            $map[(string)$row['migration_name']] = [
                'applied_at'  => (string)$row['applied_at'],
                'checksum'    => (string)$row['checksum'],
                'environment' => (string)$row['environment'],
            ];
        }

        return $map;
    }

    private function readMigrationSql(string $name): string
    {
        $filePath = $this->sqlDir . '/' . $name;
        if (!is_file($filePath) || !is_readable($filePath)) {
            throw new RuntimeException('Migration file not found or unreadable: ' . $filePath);
        }
        $sql = file_get_contents($filePath);
        if ($sql === false) {
            throw new RuntimeException('Cannot read migration file: ' . $filePath);
        }
        return $sql;
    }

    /** @param array<string, array{applied_at:string,checksum:string,environment:string}> $applied */
    private function verifyAppliedChecksums(array $applied): void
    {
        foreach ($this->manifest as $name) {
            if (!isset($applied[$name])) {
                continue;
            }
            $checksum = md5($this->readMigrationSql($name));
            if (!hash_equals($applied[$name]['checksum'], $checksum)) {
                throw new RuntimeException(
                    'Applied migration checksum mismatch: ' . $name
                    . '. Restore the originally applied SQL file; do not rewrite tracking checksums.'
                );
            }
            if ($applied[$name]['environment'] === 'ADOPTED') {
                require_once __DIR__ . '/ActorMigrationAdoption.php';
                require_once __DIR__ . '/BodyMigrationAdoption.php';
                require_once __DIR__ . '/LegacyV2MigrationAdoption.php';
                require_once __DIR__ . '/EconomyMigrationAdoption.php';
                require_once __DIR__ . '/AuthMigrationAdoption.php';
                require_once __DIR__ . '/VesselBlueprintMigrationAdoption.php';
                require_once __DIR__ . '/WarHistoryMigrationAdoption.php';
                $query = $this->db->prepare(
                    'SELECT contract_id,source_sha256,evidence_json
                     FROM schema_migration_adoptions WHERE migration_name=?'
                );
                $query->execute([$name]);
                $proof = $query->fetch(PDO::FETCH_ASSOC);
                $contract = match ($proof['contract_id'] ?? null) {
                    ActorMigrationAdoption::CONTRACT => ActorMigrationAdoption::class,
                    BodyMigrationAdoption::CONTRACT => BodyMigrationAdoption::class,
                    LegacyV2MigrationAdoption::CONTRACT => LegacyV2MigrationAdoption::class,
                    EconomyMigrationAdoption::CONTRACT => EconomyMigrationAdoption::class,
                    AuthMigrationAdoption::CONTRACT => AuthMigrationAdoption::class,
                    VesselBlueprintMigrationAdoption::CONTRACT => VesselBlueprintMigrationAdoption::class,
                    WarHistoryMigrationAdoption::CONTRACT => WarHistoryMigrationAdoption::class,
                    default => null,
                };
                $pin = $contract === null ? null : ($contract::SOURCES[$name] ?? null);
                if (
                    !$proof || $pin === null
                    || !hash_equals($pin, $proof['source_sha256'])
                    || !hash_equals($pin, hash('sha256', str_replace("\r\n", "\n", $this->readMigrationSql($name))))
                ) {
                    throw new RuntimeException('Missing or incompatible legacy adoption provenance: ' . $name);
                }
                $evidence = json_decode($proof['evidence_json'], true, 512, JSON_THROW_ON_ERROR);
                if (
                    ($evidence['contract'] ?? '') !== $contract::CONTRACT
                    || !is_string($evidence['identity_sha256'] ?? null)
                    || !preg_match('/^[a-f0-9]{64}$/D', $evidence['identity_sha256'])
                ) {
                    throw new RuntimeException('Invalid legacy adoption evidence: ' . $name);
                }
                if (
                    $contract === BodyMigrationAdoption::class
                    && (($evidence['policy'] ?? '') !== 'preserve-native-catalogue-no-uninhabited-legacy-import'
                        || !is_string($evidence['schema_sha256'] ?? null)
                        || !preg_match('/^[a-f0-9]{64}$/D', $evidence['schema_sha256']))
                ) {
                    throw new RuntimeException('Invalid native body adoption policy or schema evidence: ' . $name);
                }
                if ($contract === LegacyV2MigrationAdoption::class) {
                    LegacyV2MigrationAdoption::validateEvidence($evidence);
                }
                if ($contract === EconomyMigrationAdoption::class) {
                    EconomyMigrationAdoption::validateEvidence($evidence);
                }
                if ($contract === AuthMigrationAdoption::class) {
                    AuthMigrationAdoption::validateEvidence($evidence);
                }
                if ($contract === VesselBlueprintMigrationAdoption::class) {
                    VesselBlueprintMigrationAdoption::validateEvidence($evidence);
                }
                if ($contract === WarHistoryMigrationAdoption::class) {
                    WarHistoryMigrationAdoption::validateEvidence($evidence);
                }
            }
        }
    }

    /**
     * Probe tracking storage; only an actual missing table permits bootstrap.
     * A dry run treats absent storage as empty without issuing DDL.
     *
     * Uses a lightweight probe query rather than information_schema so the
     * method works on both MySQL/MariaDB and SQLite (tests).
     */
    private function ensureTrackingTable(bool $dryRun = false): bool
    {
        try {
            $probe = $this->db->query('SELECT 1 FROM ' . self::TRACKING_TABLE . ' LIMIT 1');
            $probe->closeCursor();
        } catch (PDOException $e) {
            $driver = $this->db->getAttribute(PDO::ATTR_DRIVER_NAME);
            $missing = ($driver === 'mysql' && $e->getCode() === '42S02'
                && ($e->errorInfo[1] ?? null) === 1146)
                || ($driver === 'sqlite' && ($e->errorInfo[1] ?? null) === 1
                    && ($e->errorInfo[2] ?? '') === 'no such table: ' . self::TRACKING_TABLE);
            if (!$missing) {
                throw $e;
            }
            if ($dryRun) {
                return false;
            }
            $this->bootstrap();
        }
        return true;
    }

    /**
     * Split a SQL file into individual statements, handling string literals,
     * backtick identifiers, line comments, and block comments.
     *
     * @return list<string>
     */
    public function splitStatements(string $sql): array
    {
        $len    = strlen($sql);
        $parts  = [];
        $buf    = '';

        $inSingle       = false;
        $inDouble       = false;
        $inBacktick     = false;
        $inLineComment  = false;
        $inBlockComment = false;

        for ($i = 0; $i < $len; $i++) {
            $ch   = $sql[$i];
            $next = ($i + 1 < $len) ? $sql[$i + 1] : '';

            if ($inLineComment) {
                if ($ch === "\n") {
                    $inLineComment = false;
                    $buf .= $ch;
                }
                continue;
            }

            if ($inBlockComment) {
                if ($ch === '*' && $next === '/') {
                    $inBlockComment = false;
                    $i++;
                }
                continue;
            }

            if (!$inSingle && !$inDouble && !$inBacktick) {
                if ($ch === '-' && $next === '-') {
                    $inLineComment = true;
                    $i++;
                    continue;
                }
                if ($ch === '/' && $next === '*') {
                    $inBlockComment = true;
                    $i++;
                    continue;
                }
                if ($ch === "'") {
                    $inSingle = true;
                    $buf .= $ch;
                    continue;
                }
                if ($ch === '"') {
                    $inDouble = true;
                    $buf .= $ch;
                    continue;
                }
                if ($ch === '`') {
                    $inBacktick = true;
                    $buf .= $ch;
                    continue;
                }
                if ($ch === ';') {
                    $trimmed = trim($buf);
                    if ($trimmed !== '') {
                        $parts[] = $trimmed;
                    }
                    $buf = '';
                    continue;
                }
            } else {
                if (($inSingle || $inDouble) && $ch === '\\' && $next !== '') {
                    $buf .= $ch . $next;
                    $i++;
                    continue;
                }
                if ($inSingle && $ch === "'" && $next === "'") {
                    $buf .= $ch . $next;
                    $i++;
                    continue;
                }
                if ($inSingle && $ch === "'") {
                    $inSingle = false;
                    $buf .= $ch;
                    continue;
                }
                if ($inDouble && $ch === '"' && $next === '"') {
                    $buf .= $ch . $next;
                    $i++;
                    continue;
                }
                if ($inDouble && $ch === '"') {
                    $inDouble = false;
                    $buf .= $ch;
                    continue;
                }
                if ($inBacktick && $ch === '`') {
                    $inBacktick = false;
                    $buf .= $ch;
                    continue;
                }
            }

            $buf .= $ch;
        }

        $trimmed = trim($buf);
        if ($trimmed !== '') {
            $parts[] = $trimmed;
        }

        return $parts;
    }

    /**
     * @template T
     * @param callable(): T $operation
     * @return T
     */
    private function withMigrationLock(callable $operation): mixed
    {
        if ($this->migrationLockHeld) {
            return $operation();
        }
        $driver = $this->db->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($driver === 'sqlite') {
            // SQLite is used by the isolated unit suite, not production migrations.
            return $operation();
        }
        if ($driver !== 'mysql') {
            throw new RuntimeException('Migration locking requires MySQL/MariaDB.');
        }
        if ($this->db->inTransaction()) {
            throw new RuntimeException('Migrations require a connection without an active transaction.');
        }
        $databaseQuery = $this->db->query('SELECT DATABASE()');
        $database = $databaseQuery->fetchColumn();
        $databaseQuery->closeCursor();
        if (!is_string($database) || $database === '') {
            throw new RuntimeException('Select a database before running migrations.');
        }
        $lockName = 'gq:migrations:' . substr(hash('sha256', $database), 0, 48);
        $acquire = $this->db->prepare('SELECT GET_LOCK(?, 0)');
        $acquire->execute([$lockName]);
        $acquired = $acquire->fetchColumn();
        $acquire->closeCursor();
        if ((string)$acquired !== '1') {
            throw new RuntimeException(
                $acquired === null || $acquired === false
                    ? 'Cannot acquire the database migration lock.'
                    : 'Another migration process holds the database migration lock; retry after it finishes.'
            );
        }
        $this->migrationLockHeld = true;
        $failure = null;
        try {
            return $operation();
        } catch (Throwable $error) {
            $failure = $error;
            throw $error;
        } finally {
            $this->migrationLockHeld = false;
            try {
                $release = $this->db->prepare('SELECT RELEASE_LOCK(?)');
                $release->execute([$lockName]);
                $released = $release->fetchColumn();
                $release->closeCursor();
                if ((string)$released !== '1') {
                    throw new RuntimeException('Database migration lock was not released by its owner.');
                }
            } catch (PDOException | RuntimeException $releaseError) {
                if ($failure === null) {
                    throw $releaseError;
                }
                error_log('migration_lock_release_failed: ' . $releaseError->getMessage());
            }
        }
    }
}
