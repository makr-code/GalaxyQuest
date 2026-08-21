<?php
require_once __DIR__ . '/helpers.php';
$db = get_db();
$stmt = $db->prepare('SELECT * FROM generation_queue WHERE id = 4 LIMIT 1');
$stmt->execute();
$queue = $stmt->fetch(\PDO::FETCH_ASSOC);

echo "Keys: " . implode(', ', array_keys((array)$queue)) . PHP_EOL;
echo "Job ID 4:" . PHP_EOL;
foreach ((array)$queue as $k => $v) {
    echo "  $k => " . substr((string)$v, 0, 50) . PHP_EOL;
}
