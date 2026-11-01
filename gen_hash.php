<?php
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$password = getenv('RESET_TESTPLAYER_PASSWORD');
if ($password === false || strlen($password) < 16) {
    fwrite(STDERR, "Set RESET_TESTPLAYER_PASSWORD to a unique password of at least 16 characters.\n");
    exit(1);
}

$hash = password_hash($password, PASSWORD_BCRYPT);
echo "Hash: $hash\n";

// Also update the database
require_once 'config/db.php';
$db->prepare("UPDATE users SET password_hash=? WHERE username='testplayer'")->execute([$hash]);
echo "Database updated.\n";
