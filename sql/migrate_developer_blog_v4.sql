SET @gq_blog_target_missing = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_blog_posts'
      AND COLUMN_NAME = 'target_faction_id'
) = 0;
SET @sql = IF(@gq_blog_target_missing,
    'ALTER TABLE developer_blog_posts ADD COLUMN target_faction_id INT NULL', 'SELECT 1');
PREPARE gq_blog_target_stmt FROM @sql;
EXECUTE gq_blog_target_stmt;
DEALLOCATE PREPARE gq_blog_target_stmt;
