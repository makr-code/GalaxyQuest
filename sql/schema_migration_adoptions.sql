-- Explicit operator adoption infrastructure, never a gameplay-time bootstrap.
CREATE TABLE IF NOT EXISTS schema_migration_adoptions (
    migration_name VARCHAR(255) NOT NULL PRIMARY KEY,
    contract_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    evidence_json JSON NOT NULL,
    adopted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deployment_environment VARCHAR(20) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
