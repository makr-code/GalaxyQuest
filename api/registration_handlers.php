<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/RegistrationDraftService.php';
require_once __DIR__ . '/../lib/RegistrationPortraitService.php';

function handle_registration(string $action): void {
    $read = in_array($action, ['register_catalog', 'register_preview', 'register_status', 'register_portrait_status', 'register_portrait_image'], true);
    only_method($read ? 'GET' : 'POST');
    if (!$read) verify_csrf();
    if (current_user_id() !== null) json_error('Sign out before creating another commander.', 409);
    if (in_array($action, ['register', 'register_complete'], true)) {
        json_error(RegistrationDraftService::ACTIVATION_UNAVAILABLE, 503);
    }
    $_SESSION['registration_owner'] ??= bin2hex(random_bytes(32));
    $owner = hash('sha256', $_SESSION['registration_owner']);
    $species = [];
    foreach (get_playable_faction_codes() as $code) {
        $species[$code] = json_decode(
            file_get_contents(__DIR__ . '/../fractions/' . $code . '/spec.json'), true, 512, JSON_THROW_ON_ERROR
        );
    }
    $db = get_db();
    $service = new RegistrationDraftService($db, $species, starter_homeworld_config('Commander'));
    $body = $read ? [] : get_json_body();
    try {
        switch ($action) {
            case 'register_catalog':
                json_ok($service->catalog());
            case 'register_preview':
                if (!is_string($_GET['faction_id'] ?? null)) json_error('Choose a faction.');
                json_ok(['preview' => $service->preview($_GET['faction_id'])]);
            case 'register_status':
                json_ok(['draft' => $service->status($owner)]);
            case 'register_cancel':
                $service->cancel($owner);
                json_ok();
            case 'register_profile':
                json_ok(['draft' => $service->saveProfile($owner, $body)]);
            case 'register_character':
                json_ok(['draft' => $service->saveCharacter($owner, $body)]);
            case 'register_portrait_status':
                json_ok(['portrait' => (new RegistrationPortraitService($db))->status($owner)]);
            case 'register_portrait_image':
                if (!is_string($_GET['revision'] ?? null) || !preg_match('/^[a-f0-9]{32}$/', $_GET['revision'])) {
                    json_error('Invalid portrait revision.');
                }
                $bytes = (new RegistrationPortraitService($db))->image($owner, $_GET['revision']);
                header('Content-Type: image/png');
                header('Cache-Control: private, no-store');
                header('X-Content-Type-Options: nosniff');
                header('Content-Length: ' . strlen($bytes));
                echo $bytes;
                exit;
            case 'register_portrait':
                if (!is_string($body['prolog_token'] ?? null) || !preg_match('/^[a-f0-9]{64}$/', $body['prolog_token'])) {
                    json_error('Invalid portrait draft identifier.');
                }
                // Generation may take minutes; do not lock Back, status checks or a changed draft behind the PHP session.
                session_write_close();
                require_once __DIR__ . '/registration_portrait_generator.php';
                json_ok(['portrait' => (new RegistrationPortraitService($db))->generate(
                    $owner, $body['prolog_token'],
                    hash('sha256', 'portrait|' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown')),
                    registration_render_portrait(...)
                )]);
            case 'register_prepare':
                if (!is_string($body['faction_id'] ?? null)) json_error('Choose a faction.');
                $draft = $service->prepare($owner, $body['faction_id'], hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown'));
                json_ok(['draft' => $draft] + $draft);
        }
    } catch (InvalidArgumentException $error) {
        json_error($error->getMessage(), 400);
    } catch (PDOException $error) {
        error_log('registration_database_failure code=' . $error->getCode() . ' message=' . $error->getMessage());
        if ($error->getCode() === '23000') json_error('Commander name, email or world is no longer available. Please retry.', 409);
        if ($error->getCode() === '42S02') json_error('Registration setup is incomplete. Apply the pending database migrations.', 503);
        throw $error;
    } catch (RuntimeException $error) {
        $status = $error->getCode();
        if (!in_array($status, [404, 409, 410, 429, 503], true)) throw $error;
        error_log('registration_unavailable status=' . $status . ' message=' . $error->getMessage());
        json_error($error->getMessage(), $status);
    }
}
