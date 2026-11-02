-- Fence queue completion/failure transitions across subsequent claims.
SET @gq_claim_token_missing = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projection_dirty_queue'
      AND COLUMN_NAME = 'claim_token'
) = 0;
SET @sql = IF(
    @gq_claim_token_missing,
    'ALTER TABLE projection_dirty_queue ADD COLUMN claim_token VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL',
    'SELECT 1'
);
PREPARE gq_claim_token_stmt FROM @sql;
EXECUTE gq_claim_token_stmt;
DEALLOCATE PREPARE gq_claim_token_stmt;
