<?php

declare(strict_types=1);

/**
 * War endpoint integration smoke test.
 *
 * Run inside web container:
 *   php scripts/test_war_endpoint_smoke.php
 */

require_once __DIR__ . '/../api/helpers.php';

function out(string $line = ''): void {
    echo $line . PHP_EOL;
}

function pass(string $label): void {
    out('[PASS] ' . $label);
}

function fail(string $label): void {
    out('[FAIL] ' . $label);
}

function parse_status(array $headers): int {
    if (!$headers) return 0;
    if (preg_match('/HTTP\/\d(?:\.\d)?\s+(\d{3})/', (string)$headers[0], $m)) {
        return (int)$m[1];
    }
    return 0;
}

function parse_cookies(array $headers): array {
    $cookies = [];
    foreach ($headers as $line) {
        if (stripos($line, 'Set-Cookie:') !== 0) continue;
        $pair = explode(';', trim(substr($line, 11)), 2)[0] ?? '';
        if ($pair === '' || strpos($pair, '=') === false) continue;
        [$k, $v] = explode('=', $pair, 2);
        $cookies[trim($k)] = trim($v);
    }
    return $cookies;
}

function cookie_header(array $jar): string {
    $parts = [];
    foreach ($jar as $k => $v) {
        $parts[] = $k . '=' . $v;
    }
    return implode('; ', $parts);
}

/** @return array{status:int,json:array,body:string} */
function http_json(string $method, string $url, ?array $payload, array &$cookies, ?string $csrf = null): array {
    $headers = [
        'Accept: application/json',
        'Content-Type: application/json',
    ];

    $cookie = cookie_header($cookies);
    if ($cookie !== '') {
        $headers[] = 'Cookie: ' . $cookie;
    }
    if ($csrf !== null && $csrf !== '') {
        $headers[] = 'X-CSRF-Token: ' . $csrf;
    }

    $opts = [
        'http' => [
            'method' => strtoupper($method),
            'ignore_errors' => true,
            'timeout' => 20,
            'header' => implode("\r\n", $headers) . "\r\n",
        ],
    ];
    if ($payload !== null) {
        $opts['http']['content'] = json_encode($payload);
    }

    $ctx = stream_context_create($opts);
    $body = @file_get_contents($url, false, $ctx);
    $respHeaders = $http_response_header ?? [];
    $cookies = array_merge($cookies, parse_cookies($respHeaders));

    $json = [];
    if (is_string($body) && $body !== '') {
        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            $json = $decoded;
        }
    }

    return [
        'status' => parse_status($respHeaders),
        'json' => $json,
        'body' => is_string($body) ? $body : '',
    ];
}

/** @return array{uid:int,cookies:array,csrf:string} */
function create_and_login_user(PDO $db, string $prefix): array {
    $username = $prefix . '_' . bin2hex(random_bytes(4));
    $email = $username . '@example.com';
    $password = 'WarSmoke!123';
    $hash = password_hash($password, PASSWORD_BCRYPT);

    $db->prepare(
        'INSERT INTO users (username, email, password_hash, control_type, auth_enabled, protection_until)
         VALUES (?, ?, ?, "human", 1, DATE_ADD(NOW(), INTERVAL 1 DAY))'
    )->execute([$username, $email, $hash]);
    $uid = (int)$db->lastInsertId();

    $cookies = [];
    $authBase = 'http://127.0.0.1/api/v1/auth.php';

    $csrfResp = http_json('GET', $authBase . '?action=csrf', null, $cookies);
    $csrf = (string)($csrfResp['json']['token'] ?? '');
    if ($csrfResp['status'] !== 200 || $csrf === '') {
        throw new RuntimeException('Failed to fetch CSRF token for ' . $username);
    }

    $loginResp = http_json('POST', $authBase . '?action=login', [
        'username' => $username,
        'password' => $password,
        'remember' => false,
    ], $cookies, $csrf);
    if ($loginResp['status'] !== 200 || ($loginResp['json']['success'] ?? false) !== true) {
        throw new RuntimeException('Login failed for ' . $username . ' (status=' . $loginResp['status'] . ')');
    }

    return [
        'uid' => $uid,
        'cookies' => $cookies,
        'csrf' => $csrf,
    ];
}

$db = get_db();
$hasFailure = false;

out('=== War Endpoint Smoke Test ===');
out('Timestamp: ' . date('c'));

$attackerUid = 0;
$defenderUid = 0;
$warId = 0;
$offerId = 0;

try {
    $attacker = create_and_login_user($db, 'war_att');
    $defender = create_and_login_user($db, 'war_def');
    $attackerUid = (int)$attacker['uid'];
    $defenderUid = (int)$defender['uid'];

    $warBase = 'http://127.0.0.1/api/war.php';

    $declareResp = http_json('POST', $warBase . '?action=declare', [
        'target_user_id' => $defenderUid,
        'war_goals' => [
            ['type' => 'annex_system', 'target_id' => 1, 'score_value' => 20],
            ['type' => 'reparations', 'target_value' => 'credits', 'score_value' => 10],
        ],
        'casus_belli' => 'border_incident',
    ], $attacker['cookies'], $attacker['csrf']);

    if ($declareResp['status'] !== 200 || ($declareResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('declare failed (status=' . $declareResp['status'] . ')');
        throw new RuntimeException('Declare failed: ' . $declareResp['body']);
    }
    $warId = (int)($declareResp['json']['war_id'] ?? 0);
    if ($warId <= 0) {
        $hasFailure = true;
        fail('declare did not return war_id');
    } else {
        pass('declare works');
    }

    $listResp = http_json('GET', $warBase . '?action=list', null, $attacker['cookies']);
    if ($listResp['status'] !== 200 || ($listResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('list failed (status=' . $listResp['status'] . ')');
    } else {
        $wars = $listResp['json']['wars'] ?? null;
        if (!is_array($wars)) {
            $hasFailure = true;
            fail('list payload missing wars[]');
        } else {
            $found = false;
            $summaryOk = false;
            foreach ($wars as $w) {
                if ((int)($w['war_id'] ?? 0) === $warId) {
                    $found = true;
                    $summary = $w['summary'] ?? null;
                    $pressure = is_array($summary) ? ($summary['pressure'] ?? null) : null;
                    $goalCounts = is_array($summary) ? ($summary['goal_counts'] ?? null) : null;
                    if (is_array($summary) && is_array($pressure) && is_array($goalCounts)) {
                        $summaryOk = array_key_exists('score_balance', $pressure)
                            && array_key_exists('exhaustion_gap', $pressure)
                            && array_key_exists('total', $goalCounts);
                    }
                    break;
                }
            }
            if (!$found) {
                $hasFailure = true;
                fail('declared war not found in list');
            } elseif (!$summaryOk) {
                $hasFailure = true;
                fail('list entry missing summary.pressure/goal_counts payload');
            } else {
                pass('list includes declared war with summary payload');
            }
        }
    }

    $statusResp = http_json('GET', $warBase . '?action=get_status&war_id=' . $warId, null, $attacker['cookies']);
    if ($statusResp['status'] !== 200 || ($statusResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('get_status failed (status=' . $statusResp['status'] . ')');
    } else {
        $goals = $statusResp['json']['goals'] ?? null;
        if (!is_array($goals) || count($goals) < 1) {
            $hasFailure = true;
            fail('get_status missing goals');
        } else {
            pass('get_status returns goals and war state');
        }
    }

    $offerResp = http_json('POST', $warBase . '?action=offer_peace', [
        'war_id' => $warId,
        'terms' => [
            ['type' => 'white_peace'],
        ],
    ], $attacker['cookies'], $attacker['csrf']);

    if ($offerResp['status'] !== 200 || ($offerResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('offer_peace failed (status=' . $offerResp['status'] . ')');
    } else {
        $offerId = (int)($offerResp['json']['offer_id'] ?? 0);
        if ($offerId <= 0) {
            $hasFailure = true;
            fail('offer_peace did not return offer_id');
        } else {
            pass('offer_peace works');
        }
    }

    if ($offerId > 0) {
        $respondResp = http_json('POST', $warBase . '?action=respond_peace', [
            'offer_id' => $offerId,
            'accept' => true,
        ], $defender['cookies'], $defender['csrf']);

        if ($respondResp['status'] !== 200 || ($respondResp['json']['success'] ?? false) !== true) {
            $hasFailure = true;
            fail('respond_peace failed (status=' . $respondResp['status'] . ')');
        } elseif (($respondResp['json']['war_status'] ?? '') !== 'ended') {
            $hasFailure = true;
            fail('respond_peace did not end the war');
        } else {
            pass('respond_peace accepts and ends war');
        }
    }

    $postStatus = http_json('GET', $warBase . '?action=get_status&war_id=' . $warId, null, $attacker['cookies']);
    if ($postStatus['status'] !== 200 || ($postStatus['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('post-respond get_status failed (status=' . $postStatus['status'] . ')');
    } elseif (($postStatus['json']['status'] ?? '') !== 'ended') {
        $hasFailure = true;
        fail('war status expected ended after accepted peace');
    } else {
        pass('war status reflects accepted peace');
    }

    $invalidResp = http_json('GET', $warBase . '?action=not_real', null, $attacker['cookies']);
    if ($invalidResp['status'] !== 400) {
        $hasFailure = true;
        fail('invalid action should return 400 but got ' . $invalidResp['status']);
    } else {
        pass('invalid action returns 400');
    }
} catch (Throwable $e) {
    $hasFailure = true;
    fail('Unhandled exception: ' . $e->getMessage());
} finally {
    try {
        if ($offerId > 0) {
            $db->prepare('DELETE FROM peace_offers WHERE id = ?')->execute([$offerId]);
        }
    } catch (Throwable) {
        // Ignore cleanup failures.
    }

    try {
        if ($warId > 0) {
            $db->prepare('DELETE FROM war_goals WHERE war_id = ?')->execute([$warId]);
            $db->prepare('DELETE FROM wars WHERE id = ?')->execute([$warId]);
        }
    } catch (Throwable) {
        // Ignore cleanup failures.
    }

    try {
        if ($attackerUid > 0) {
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$attackerUid]);
        }
    } catch (Throwable) {
        // Ignore cleanup failures.
    }

    try {
        if ($defenderUid > 0) {
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$defenderUid]);
        }
    } catch (Throwable) {
        // Ignore cleanup failures.
    }
}

if ($hasFailure) {
    out('RESULT: FAIL');
    exit(1);
}

out('RESULT: PASS');
exit(0);
