<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/registration_handlers.php';
require_once __DIR__ . '/../lib/RegistrationPlayService.php';
require_once __DIR__ . '/../lib/RegistrationMail.php';

$action = $_GET['action'] ?? '';
if (!in_array($action, ['status', 'enter', 'play', 'send_confirmation', 'confirm'], true)) json_error('Unknown draft action.', 400);
only_method($action === 'status' ? 'GET' : 'POST');
session_start_secure();
if ($action !== 'status') verify_csrf();
$body = $action === 'status' ? [] : get_json_body();
$uid = current_user_id();
if ($uid !== null) {
    if ($action === 'status' || ($action === 'confirm' && is_string($body['token'] ?? null)
        && isset($_SESSION['registration_confirmation_hash'])
        && hash_equals($_SESSION['registration_confirmation_hash'], hash('sha256', $body['token'])))) {
        if ($action === 'confirm') issue_remember_me_token($uid);
        json_ok(['draft' => null, 'draft_mode' => false, 'user' => ['id' => $uid, 'username' => $_SESSION['username'] ?? '']]);
    }
    json_error('A confirmed account is already signed in.', 409);
}
$owner = registration_session_owner($action, true);
$db = get_db();
$service = new RegistrationPlayService($db);
try {
    if ($action === 'status') json_ok(['draft' => $owner === '' ? null : $service->status($owner)]);
    if ($owner === '' && $action !== 'confirm') json_error('Registration session is unavailable.', 410);
    if ($action === 'enter') {
        if (!is_string($body['prolog_token'] ?? null) || !preg_match('/^[a-f0-9]{64}$/', $body['prolog_token'])) json_error('Invalid draft identifier.');
        $draft = $service->enter($owner, $body['prolog_token']);
        $ownerToken = $_SESSION['registration_owner'] ?? $_COOKIE['gq_draft_owner'] ?? '';
        setcookie('gq_draft_owner', $ownerToken, [
            'expires' => time() + 10 * 365 * 86400, 'path' => '/', 'secure' => is_https_request(),
            'httponly' => true, 'samesite' => 'Strict',
        ]);
        json_ok(['draft' => $draft]);
    }
    if ($action === 'play') json_ok(['draft' => $service->play($owner, $body)]);
        if ($action === 'send_confirmation') json_ok($service->sendConfirmation($owner, $body, registration_send_verification(...)));
    if ($action === 'confirm') {
            if (!is_string($body['token'] ?? null)) json_error('Open the confirmation link from your email.');
            $result = $service->confirm($body['token']);
        session_regenerate_id(true);
        $_SESSION['user_id'] = $result['user']['id'];
        $_SESSION['username'] = $result['user']['username'];
        $_SESSION['registration_confirmation_hash'] = hash('sha256', $body['token']);
        issue_remember_me_token((int)$result['user']['id']);
        if ($owner === '' || $service->status($owner) === null) {
            unset($_SESSION['registration_owner']);
            setcookie('gq_draft_owner', '', [
                'expires' => time() - 3600, 'path' => '/', 'secure' => is_https_request(), 'httponly' => true, 'samesite' => 'Strict',
            ]);
        }
        json_ok($result);
    }
} catch (InvalidArgumentException $error) {
    json_error($error->getMessage(), 400);
} catch (PDOException $error) {
    error_log('registration_play_database_failure code=' . $error->getCode());
    if ($error->getCode() === '23000') json_error('Commander name, email or startworld is already claimed. Your draft is still saved.', 409);
    if ($error->getCode() === '42S02') json_error('Draft gameplay setup is incomplete. Apply pending migrations.', 503);
    throw $error;
} catch (RuntimeException $error) {
    if (!in_array($error->getCode(), [400, 409, 410, 429, 503], true)) throw $error;
    error_log('registration_play_unavailable status=' . $error->getCode() . ' message=' . $error->getMessage());
    json_error($error->getMessage(), $error->getCode());
}
