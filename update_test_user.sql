-- Update testplayer with correct bcrypt hash for password 'test123'
UPDATE users SET password_hash='$2y$10$z2QjtzLRuM2MbREPAOaIeedsyqYG6DuVsz7jY8vNK4DcQVqxoayJ2' WHERE username='testplayer';

-- Verify
SELECT id, username, is_admin FROM users WHERE username='testplayer';
