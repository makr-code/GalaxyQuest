<?php

declare(strict_types=1);

require_once __DIR__ . '/Mailer.php';

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
    $error = mailer_send_mailpit(
        app_registration_mailpit_url(),
        'registration@galaxyquest.local',
        $email,
        'GalaxyQuest registration confirmation',
        $link
    );
    if ($error === 'mailpit_client_init_failed') {
        throw new RuntimeException('Email client could not be initialized.', 503);
    }
    if ($error !== null) {
        error_log('registration_mail_delivery_failed ' . $error);
        throw new RuntimeException(
            'Confirmation email could not be delivered. Your draft remains saved; please retry.',
            503
        );
    }
}

/** @return array{host: string, port: int, tls: string, user: string, password: string, from: string} */
function registration_smtp_settings(): array
{
    $settings = mailer_smtp_settings_or_null();
    if ($settings === null) {
        error_log('registration_smtp_configuration_invalid');
        throw new RuntimeException('Email delivery is not configured. Your playable draft remains saved.', 503);
    }
    return $settings;
}

function registration_smtp_message(string $from, string $to, string $link): string
{
    return mailer_smtp_message($from, $to, 'GalaxyQuest registration confirmation', $link . "\r\n");
}

function registration_send_smtp(string $email, string $link): void
{
    $settings = registration_smtp_settings();
    $message = registration_smtp_message($settings['from'], $email, $link);
    $error = mailer_send_smtp($settings, $email, $message);
    if ($error === 'smtp_client_init_failed') {
        throw new RuntimeException('SMTP client could not be initialized.', 503);
    }
    if ($error !== null) {
        error_log('registration_smtp_delivery_failed ' . $error);
        throw new RuntimeException(
            'Confirmation email could not be delivered. Your draft remains saved; please retry.',
            503
        );
    }
}
