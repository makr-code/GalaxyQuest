<?php
$password = 'test123';
$hash = password_hash($password, PASSWORD_BCRYPT);
echo "Password: $password\n";
echo "Hash: $hash\n";

// Also update the database
require_once 'config/db.php';
$db->prepare("UPDATE users SET password_hash=? WHERE username='testplayer'")->execute([$hash]);
echo "Database updated.\n";
