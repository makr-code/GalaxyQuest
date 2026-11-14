DROP TABLE IF EXISTS mail_outbox;
DROP TABLE IF EXISTS world_events;

SET @world_events_has_mail_opt = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email_notifications'
);
SET @world_events_mail_opt_sql = IF(
    @world_events_has_mail_opt = 1,
    'ALTER TABLE users DROP COLUMN email_notifications',
    'SELECT 1'
);
PREPARE world_events_mail_opt_stmt FROM @world_events_mail_opt_sql;
EXECUTE world_events_mail_opt_stmt;
DEALLOCATE PREPARE world_events_mail_opt_stmt;
