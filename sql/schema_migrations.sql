-- Migration tracking table for GalaxyQuest automated migration runner.
-- Applied once (CREATE TABLE IF NOT EXISTS is idempotent).
-- See: scripts/migrate.php, lib/MigrationRunner.php, docs/technical/DATABASE_MIGRATIONS.md

CREATE TABLE IF NOT EXISTS schema_migrations (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    migration_name  VARCHAR(255)  NOT NULL,
    applied_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checksum        VARCHAR(64)   NOT NULL COMMENT 'MD5 of SQL file at time of application',
    environment     VARCHAR(20)   NOT NULL DEFAULT 'unknown',
    execution_ms    INT           NOT NULL DEFAULT 0,
    UNIQUE KEY uq_migration_name (migration_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
