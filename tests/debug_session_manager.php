<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/../api/llm_soc/NpcMultiTenantSessionManager.php';

echo "=== Debug NPC Multi-Tenant Session Manager ===\n\n";

$config = [
    'storage' => 'file',
    'ttl_seconds' => 3600,
    'context_depth' => 5,
    'context_compression' => true,
];

$mgr = new NpcMultiTenantSessionManager($config);

echo "1. Loading session...\n";
$session = $mgr->loadSession(1, 'npc_commander_01', 'Federation');
echo "   Session ID: " . $session['session_id'] . "\n";
echo "   Initial messages: " . count($session['messages'] ?? []) . "\n";
var_dump($session);

echo "\n2. Adding first message...\n";
$session = $mgr->addMessage($session, 'user', 'Hello!');
echo "   Messages after addMessage: " . count($session['messages'] ?? []) . "\n";
var_dump($session);

echo "\n3. Checking saved session file...\n";
$sessionFile = __DIR__ . '/../cache/npc_sessions/' . $session['session_id'] . '.json';
if (file_exists($sessionFile)) {
    echo "   File exists: $sessionFile\n";
    $fileContent = file_get_contents($sessionFile);
    echo "   File content:\n";
    var_dump(json_decode($fileContent, true));
} else {
    echo "   File not found: $sessionFile\n";
}

echo "\n4. Adding second message...\n";
$session = $mgr->addMessage($session, 'assistant', 'Greetings!');
echo "   Messages after second addMessage: " . count($session['messages'] ?? []) . "\n";
var_dump($session);

echo "\nDone!\n";
?>
