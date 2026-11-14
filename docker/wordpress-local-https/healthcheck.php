<?php

declare(strict_types=1);

$context = stream_context_create([
    'http' => ['timeout' => 3, 'follow_location' => 0],
    'ssl' => [
        'cafile' => '/var/lib/gq-local-tls/localhost.crt',
        'verify_peer' => true,
        'verify_peer_name' => true,
    ],
]);
$body = @file_get_contents('https://localhost:8443/wordpress/wp-login.php', false, $context);
exit(is_string($body) && str_contains($body, 'id="loginform"') ? 0 : 1);
