<?php

declare(strict_types=1);

function registration_send_verification(string $email, string $token): void
{
    if (app_is_development() && app_registration_mailpit_url() === '') {
        throw new RuntimeException('Email delivery is not configured. Your playable draft remains saved.', 503);
    }
    $base = app_registration_public_url();
    $url = parse_url($base);
    if (
        !$url || !isset($url['host']) || !in_array($url['scheme'] ?? '', ['https', 'http'], true)
        || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment'])
        || !preg_match('/^[a-f0-9]{64}$/', $token)
        || (!app_is_development() && $url['scheme'] !== 'https')
        || filter_var($email, FILTER_VALIDATE_EMAIL) === false
        || preg_match('/[\r\n]/', $email)
    ) {
        throw new RuntimeException('Registration public URL or confirmation token is invalid.', 503);
    }
    $link = $base . '/#registration-confirm=' . $token;
    if (!app_is_development()) {
        registration_send_smtp($email, $link);
        return;
    }
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

/** @return array{host: string, port: int, tls: string, user: string, password: string, from: string} */
function registration_smtp_settings(): array
{
    $host = (string)env_value('SMTP_HOST', '');
    $port = filter_var(env_value('SMTP_PORT', '587'), FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 1, 'max_range' => 65535],
    ]);
    $tls = (string)env_value('SMTP_TLS', 'starttls');
    $from = (string)env_value('SMTP_FROM', '');
    $user = (string)env_value('SMTP_USER', '');
    $password = (string)env_value('SMTP_PASSWORD', '');
    if (
        !preg_match('/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/D', $host)
        || $port === false || !in_array($tls, ['starttls', 'implicit'], true)
        || filter_var($from, FILTER_VALIDATE_EMAIL) === false || preg_match('/[\r\n]/', $from . $user)
        || $user === '' || $password === ''
    ) {
        error_log('registration_smtp_configuration_invalid');
        throw new RuntimeException('Email delivery is not configured. Your playable draft remains saved.', 503);
    }
    return ['host' => $host, 'port' => $port, 'tls' => $tls, 'user' => $user, 'password' => $password, 'from' => $from];
}

function registration_smtp_message(string $from, string $to, string $link): string
{
    foreach ([$from, $to] as $address) {
        if (filter_var($address, FILTER_VALIDATE_EMAIL) === false || preg_match('/[\r\n]/', $address)) {
            throw new InvalidArgumentException('Invalid email envelope.');
        }
    }
    return 'From: GalaxyQuest <' . $from . ">\r\n"
        . 'To: <' . $to . ">\r\n"
        . "Subject: GalaxyQuest registration confirmation\r\n"
        . 'Date: ' . gmdate('D, d M Y H:i:s') . " +0000\r\n"
        . 'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . substr(strrchr($from, '@'), 1) . ">\r\n"
        . "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode($link . "\r\n"), 76, "\r\n");
}

function registration_send_smtp(string $email, string $link): void
{
    $settings = registration_smtp_settings();
    $message = registration_smtp_message($settings['from'], $email, $link);
    $scheme = $settings['tls'] === 'implicit' ? 'smtps' : 'smtp';
    $client = curl_init($scheme . '://' . $settings['host'] . ':' . $settings['port']);
    if ($client === false) {
        throw new RuntimeException('SMTP client could not be initialized.', 503);
    }
    $offset = 0;
    try {
        curl_setopt_array($client, [
            CURLOPT_USERNAME => $settings['user'],
            CURLOPT_PASSWORD => $settings['password'],
            CURLOPT_USE_SSL => CURLUSESSL_ALL,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_MAIL_FROM => $settings['from'],
            CURLOPT_MAIL_RCPT => [$email],
            CURLOPT_UPLOAD => true,
            CURLOPT_INFILESIZE => strlen($message),
            CURLOPT_READFUNCTION => static function ($handle, $stream, int $length) use ($message, &$offset): string {
                $chunk = substr($message, $offset, $length);
                $offset += strlen($chunk);
                return $chunk;
            },
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 15,
        ]);
        if (curl_exec($client) === false) {
            error_log('registration_smtp_delivery_failed errno=' . curl_errno($client));
            throw new RuntimeException(
                'Confirmation email could not be delivered. Your draft remains saved; please retry.',
                503
            );
        }
    } finally {
        curl_close($client);
    }
}
