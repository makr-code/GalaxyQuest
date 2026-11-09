<?php

declare(strict_types=1);

function registration_send_verification(string $email, string $token): void
{
    if (!app_is_development() || app_registration_mailpit_url() === '') {
        throw new RuntimeException('Email delivery is not configured. Your playable draft remains saved.', 503);
    }
    $base = app_registration_public_url();
    $url = parse_url($base);
    if (
        !$url || !isset($url['host']) || !in_array($url['scheme'] ?? '', ['https', 'http'], true)
        || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment'])
        || !preg_match('/^[a-f0-9]{64}$/', $token)
    ) {
        throw new RuntimeException('Registration public URL or confirmation token is invalid.', 503);
    }
    $link = $base . '/#registration-confirm=' . $token;
    $payload = json_encode([
        'From' => ['Email' => 'registration@galaxyquest.local', 'Name' => 'GalaxyQuest'],
        'To' => [['Email' => $email]],
        'Subject' => 'GalaxyQuest registration confirmation',
        'Text' => $link,
    ], JSON_THROW_ON_ERROR);
    $client = curl_init(app_registration_mailpit_url() . '/api/v1/send');
    if ($client === false) {
        throw new RuntimeException('Email client could not be initialized.', 503);
    }
    try {
        curl_setopt_array($client, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 8,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        $result = curl_exec($client);
        $status = curl_getinfo($client, CURLINFO_HTTP_CODE);
        if ($result === false || $status !== 200) {
            error_log('registration_mail_delivery_failed status=' . $status . ' error=' . curl_error($client));
            throw new RuntimeException(
                'Confirmation email could not be delivered. Your draft remains saved; please retry.',
                503
            );
        }
    } finally {
        curl_close($client);
    }
}
