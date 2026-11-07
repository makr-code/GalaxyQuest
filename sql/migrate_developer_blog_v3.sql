SET @gq_blog_categories_missing = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_blog_posts'
      AND COLUMN_NAME = 'categories'
) = 0;
SET @sql = IF(@gq_blog_categories_missing,
    'ALTER TABLE developer_blog_posts ADD COLUMN categories JSON NULL', 'SELECT 1');
PREPARE gq_blog_taxonomy_stmt FROM @sql;
EXECUTE gq_blog_taxonomy_stmt;
DEALLOCATE PREPARE gq_blog_taxonomy_stmt;

SET @gq_blog_tags_missing = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_blog_posts'
      AND COLUMN_NAME = 'tags'
) = 0;
SET @sql = IF(@gq_blog_tags_missing,
    'ALTER TABLE developer_blog_posts ADD COLUMN tags JSON NULL', 'SELECT 1');
PREPARE gq_blog_taxonomy_stmt FROM @sql;
EXECUTE gq_blog_taxonomy_stmt;
DEALLOCATE PREPARE gq_blog_taxonomy_stmt;
