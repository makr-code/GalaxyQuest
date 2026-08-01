-- Create test user for GameGuide testing
INSERT INTO users (username, email, password_hash, created_at) 
VALUES ('player1', 'player1@test.com', MD5('player1'), NOW()) 
ON DUPLICATE KEY UPDATE created_at=created_at;
