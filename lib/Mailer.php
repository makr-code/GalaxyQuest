<?php

declare(strict_types=1);

/**
 * Shared outbound mail transport (SMTP via curl, Mailpit API in development).
 * Senders return null on success or a short, secret-free error description.
 */

/** @return array{host: string, port: int, tls: string, user: string, password: string, from: string}|null */
function mailer_smtp_settings_or_null(): ?array
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
        return null;
    }
    return ['host' => $host, 'port' => $port, 'tls' => $tls, 'user' => $user, 'password' => $password, 'from' => $from];
}

function mailer_valid_address(string $address): bool
{
    return filter_var($address, FILTER_VALIDATE_EMAIL) !== false && !preg_match('/[\r\n]/', $address);
}

function mailer_encode_subject(string $subject): string
{
    if (preg_match('/[\r\n]/', $subject)) {
        throw new InvalidArgumentException('Invalid email subject.');
    }
    return preg_match('/^[\x20-\x7E]*$/D', $subject)
        ? $subject
        : mb_encode_mimeheader($subject, 'UTF-8', 'B', "\r\n", strlen('Subject: '));
}

function mailer_smtp_message(string $from, string $to, string $subject, string $body, ?string $html = null): string
{
    foreach ([$from, $to] as $address) {
        if (!mailer_valid_address($address)) {
            throw new InvalidArgumentException('Invalid email envelope.');
        }
    }
    $headers = 'From: GalaxyQuest <' . $from . ">\r\n"
        . 'To: <' . $to . ">\r\n"
        . 'Subject: ' . mailer_encode_subject($subject) . "\r\n"
        . 'Date: ' . gmdate('D, d M Y H:i:s') . " +0000\r\n"
        . 'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . substr(strrchr($from, '@'), 1) . ">\r\n"
        . "MIME-Version: 1.0\r\n";
    if ($html === null) {
        return $headers . "Content-Type: text/plain; charset=UTF-8\r\n"
            . "Content-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($body), 76, "\r\n");
    }
    $boundary = 'gq-' . bin2hex(random_bytes(24));
    return $headers . "Content-Type: multipart/alternative; boundary=\"$boundary\"\r\n\r\n"
        . "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode($body), 76, "\r\n")
        . "--$boundary\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode($html), 76, "\r\n") . "--$boundary--\r\n";
}

/**
 * @param array{host: string, port: int, tls: string, user: string, password: string, from: string} $settings
 */
function mailer_send_smtp(array $settings, string $to, string $message): ?string
{
    $scheme = $settings['tls'] === 'implicit' ? 'smtps' : 'smtp';
    $client = curl_init($scheme . '://' . $settings['host'] . ':' . $settings['port']);
    if ($client === false) {
        return 'smtp_client_init_failed';
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
            CURLOPT_MAIL_RCPT => [$to],
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
        return curl_exec($client) === false ? 'errno=' . curl_errno($client) : null;
    } finally {
        curl_close($client);
    }
}

function mailer_send_mailpit(string $baseUrl, string $from, string $to, string $subject, string $text, ?string $html = null): ?string
{
    $data = [
        'From' => ['Email' => $from, 'Name' => 'GalaxyQuest'],
        'To' => [['Email' => $to]],
        'Subject' => $subject,
        'Text' => $text,
    ];
    if ($html !== null) {
        $data['HTML'] = $html;
    }
    $payload = json_encode($data, JSON_THROW_ON_ERROR);
    $client = curl_init($baseUrl . '/api/v1/send');
    if ($client === false) {
        return 'mailpit_client_init_failed';
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
        return $result === false || $status !== 200 ? 'status=' . $status . ' error=' . curl_error($client) : null;
    } finally {
        curl_close($client);
    }
}

/**
 * Configured transport for notification mail, or null when none is set up.
 * Development prefers Mailpit; otherwise validated SMTP settings are required.
 *
 * @return (callable(string, string, string, ?string): ?string)|null fn(to, subject, text, html) => error|null
 */
function mailer_default_transport(): ?callable
{
    if (app_is_development() && app_registration_mailpit_url() !== '') {
        $mailpit = app_registration_mailpit_url();
        return static fn(string $to, string $subject, string $body, ?string $html = null): ?string
            => mailer_send_mailpit($mailpit, 'notifications@galaxyquest.local', $to, $subject, $body, $html);
    }
    $settings = mailer_smtp_settings_or_null();
    if ($settings === null) {
        return null;
    }
    return static fn(string $to, string $subject, string $body, ?string $html = null): ?string
        => mailer_send_smtp($settings, $to, mailer_smtp_message($settings['from'], $to, $subject, $body, $html));
}
