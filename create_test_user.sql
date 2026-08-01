-- Create test player account (password: 'test')
INSERT INTO users (username, email, password_hash, is_admin, auth_enabled, protection_until, created_at)
VALUES ('testplayer', 'test@local.dev', '$2y$10$W8qg8z1K6x.Z4nE3P9oHBOF7.9mKq5R3vQ2sL8tH6xJ5yK4pM3bNi', 0, 1, DATE_ADD(NOW(), INTERVAL 7 DAY), NOW())
ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash);

-- Verify creation
SELECT id, username, is_admin FROM users WHERE username='testplayer';
