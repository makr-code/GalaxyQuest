SET @gq_blog_revision_missing = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_blog_posts'
      AND COLUMN_NAME = 'revision'
) = 0;
SET @sql = IF(
    @gq_blog_revision_missing,
    'ALTER TABLE developer_blog_posts ADD COLUMN revision INT UNSIGNED NOT NULL DEFAULT 1',
    'SELECT 1'
);
PREPARE gq_blog_revision_stmt FROM @sql;
EXECUTE gq_blog_revision_stmt;
DEALLOCATE PREPARE gq_blog_revision_stmt;
