<?php

/*
 * Exercises the real registered REST route over verified HTTPS, then passes
 * its publisher snapshot through the existing SQLite-backed outbox code.
 * SMTP delivery is intentionally outside this fixture.
 */

declare(strict_types=1);

require_once '/run/gq-source/WordPressNewsPublisher.php';
require_once '/run/gq-source/WordPressTemplateMail.php';

const GQ_FIXTURE_REST_ROOT = 'https://wp.fixture.invalid';
const GQ_FIXTURE_ADMIN_USER = 'gqfixtureadmin';
const GQ_FIXTURE_READER_USER = 'gqmailreader';

function gq_http_check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

/** @return array{status:int,body:string,headers:array<string,string>} */
function gq_http_get(string $url, ?string $user = null, ?string $password = null): array
{
    $handle = curl_init($url);
    gq_http_check($handle !== false, 'Could not initialize the HTTPS fixture client.');
    $responseHeaders = [];
    try {
        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_CAINFO => '/fixture/cert.pem',
            CURLOPT_PROXY => '',
            CURLOPT_NOPROXY => '*',
            CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$responseHeaders): int {
                $length = strlen($line);
                if (str_contains($line, ':')) {
                    [$name, $value] = explode(':', $line, 2);
                    $responseHeaders[strtolower(trim($name))] = trim($value);
                }
                return $length;
            },
        ];
        if ($user !== null && $password !== null) {
            $options[CURLOPT_HTTPAUTH] = CURLAUTH_BASIC;
            $options[CURLOPT_USERPWD] = $user . ':' . $password;
        }
        curl_setopt_array($handle, $options);
        $body = curl_exec($handle);
        gq_http_check(is_string($body), 'The isolated WordPress HTTPS request failed: ' . curl_error($handle));
        return [
            'status' => (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE),
            'body' => $body,
            'headers' => $responseHeaders,
        ];
    } finally {
        curl_close($handle);
    }
}

function gq_assert_publisher_error(WordPressNewsPublisher $publisher, int $postId, int $status): void
{
    try {
        $publisher->mailTemplate($postId);
    } catch (RuntimeException $error) {
        gq_http_check(str_contains($error->getMessage(), "HTTP {$status}"), 'Unexpected WordPress REST denial.');
        return;
    }
    throw new RuntimeException("WordPress REST request unexpectedly succeeded; expected HTTP {$status}.");
}

function gq_sqlite_outbox(): PDO
{
    $db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec("CREATE TABLE users (
        id INTEGER PRIMARY KEY, username TEXT NOT NULL, email TEXT, control_type TEXT,
        auth_enabled INTEGER, deleted_at TEXT, email_notifications INTEGER
    );
    CREATE TABLE game_events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL);
    CREATE TABLE mail_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE, subject TEXT NOT NULL, body_text TEXT NOT NULL, body_html TEXT,
        template_id INTEGER, template_revision TEXT, status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, last_error TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, sent_at TEXT
    );
    INSERT INTO users VALUES (1, 'Ada & <Nova>', 'pilot@example.invalid', 'human', 1, NULL, 1)");
    return $db;
}

function gq_run_draft(int $postId, string $adminPassword): void
{
    $publisher = new WordPressNewsPublisher(GQ_FIXTURE_REST_ROOT, GQ_FIXTURE_ADMIN_USER, $adminPassword);
    gq_assert_publisher_error($publisher, $postId, 404);

    $customRoute = gq_http_get(
        GQ_FIXTURE_REST_ROOT . '/?rest_route=' . rawurlencode('/gq/v1/mail-templates/' . $postId)
    );
    gq_http_check($customRoute['status'] === 401, 'Anonymous access to the private REST route was not denied.');

    $draftRoute = gq_http_get(
        GQ_FIXTURE_REST_ROOT . '/?rest_route=' . rawurlencode('/gq/v1/mail-templates/' . $postId),
        GQ_FIXTURE_ADMIN_USER,
        $adminPassword
    );
    gq_http_check($draftRoute['status'] === 404, 'An authenticated user could retrieve a draft template.');

    $genericRoute = gq_http_get(
        GQ_FIXTURE_REST_ROOT . '/?rest_route=' . rawurlencode('/wp/v2/gq_mail_template/' . $postId),
        GQ_FIXTURE_ADMIN_USER,
        $adminPassword
    );
    gq_http_check($genericRoute['status'] === 404, 'The mail template was exposed through the generic CPT REST API.');

    $publicQuery = gq_http_get(
        GQ_FIXTURE_REST_ROOT . '/?post_type=gq_mail_template&p=' . $postId
    );
    gq_http_check($publicQuery['status'] === 404, 'The draft template was publicly queryable.');
}

function gq_run_approved(int $postId, string $adminPassword, string $readerPassword): void
{
    $wrongPassword = new WordPressNewsPublisher(GQ_FIXTURE_REST_ROOT, GQ_FIXTURE_ADMIN_USER, 'wrong-password');
    gq_assert_publisher_error($wrongPassword, $postId, 401);

    $publisher = new WordPressNewsPublisher(GQ_FIXTURE_REST_ROOT, GQ_FIXTURE_ADMIN_USER, $adminPassword);
    $template = $publisher->mailTemplate($postId);
    gq_http_check($template['id'] === $postId, 'WordPressNewsPublisher returned an unexpected template ID.');
    gq_http_check($template['subject'] === 'Grüße an {{username}} & Crew', 'WordPress returned the wrong subject.');
    gq_http_check(hash('sha256', json_encode([
        'subject' => $template['subject'],
        'html' => $template['html'],
    ], JSON_THROW_ON_ERROR)) === $template['revision'], 'The revision does not match the real REST payload.');
    foreach (['<script', 'onclick', 'style=', 'javascript:', '<!-- wp:'] as $unsafe) {
        gq_http_check(!str_contains($template['html'], $unsafe), "WordPress KSES did not remove {$unsafe}.");
    }
    gq_http_check(
        str_contains($template['html'], '<a href="https://game.example.invalid/#fleet">Zur Flotte</a>'),
        'Safe mail markup was not preserved by real WordPress KSES.'
    );

    $approvedRoute = gq_http_get(
        GQ_FIXTURE_REST_ROOT . '/?rest_route=' . rawurlencode('/gq/v1/mail-templates/' . $postId),
        GQ_FIXTURE_ADMIN_USER,
        $adminPassword
    );
    gq_http_check($approvedRoute['status'] === 200, 'The approved template was not returned over authenticated HTTP.');
    $cacheControl = strtolower($approvedRoute['headers']['cache-control'] ?? '');
    gq_http_check(
        str_contains($cacheControl, 'private') && str_contains($cacheControl, 'no-store'),
        'The real REST response did not disable shared caching.'
    );

    $reader = new WordPressNewsPublisher(GQ_FIXTURE_REST_ROOT, GQ_FIXTURE_READER_USER, $readerPassword);
    gq_assert_publisher_error($reader, $postId, 403);

    $genericRoute = gq_http_get(
        GQ_FIXTURE_REST_ROOT . '/?rest_route=' . rawurlencode('/wp/v2/gq_mail_template/' . $postId)
    );
    gq_http_check($genericRoute['status'] === 404, 'The approved template was exposed through the generic CPT REST API.');
    $publicQuery = gq_http_get(
        GQ_FIXTURE_REST_ROOT . '/?post_type=gq_mail_template&p=' . $postId
    );
    gq_http_check($publicQuery['status'] === 404, 'The approved template was publicly queryable.');

    $db = gq_sqlite_outbox();
    $db->beginTransaction();
    $db->exec("INSERT INTO game_events (kind) VALUES ('fleet_ready')");
    gq_http_check(mail_template_enqueue($db, 1, $template, 'approved-template-http', 1000),
        'The approved template was not enqueued.');
    $db->rollBack();
    gq_http_check((int)$db->query('SELECT COUNT(*) FROM mail_outbox')->fetchColumn() === 0,
        'A rolled-back game event left an outbox message.');

    $db->beginTransaction();
    $db->exec("INSERT INTO game_events (kind) VALUES ('fleet_ready')");
    gq_http_check(mail_template_enqueue($db, 1, $template, 'approved-template-http', 1000),
        'The approved template was not enqueued after commit.');
    $db->commit();
    $row = $db->query('SELECT * FROM mail_outbox')->fetch(PDO::FETCH_ASSOC);
    gq_http_check(is_array($row), 'The SQLite outbox row is missing.');
    gq_http_check($row['status'] === 'pending' && (int)$row['template_id'] === $postId,
        'The outbox did not persist the approved WordPress template identity.');
    gq_http_check($row['subject'] === 'Grüße an Ada & <Nova> & Crew',
        'The outbox did not personalize the real WordPress subject.');
    gq_http_check(str_contains($row['body_html'], 'Hallo Ada &amp; &lt;Nova&gt;,'),
        'The outbox HTML did not safely personalize the real WordPress content.');
    gq_http_check(str_contains($row['body_text'], 'Zur Flotte (https://game.example.invalid/#fleet)'),
        'The outbox plaintext did not preserve the approved link.');
    gq_http_check($row['template_revision'] === $template['revision'],
        'The outbox did not snapshot the authenticated REST revision.');
}

try {
    $action = $argv[1] ?? '';
    $postId = isset($argv[2]) ? filter_var($argv[2], FILTER_VALIDATE_INT) : false;
    $adminPassword = getenv('GQ_FIXTURE_ADMIN_APP_PASSWORD');
    $readerPassword = getenv('GQ_FIXTURE_READER_APP_PASSWORD');
    gq_http_check(is_int($postId) && $postId > 0, 'A valid disposable WordPress template ID is required.');
    gq_http_check(is_string($adminPassword) && $adminPassword !== '', 'The synthetic admin app password is missing.');

    if ($action === 'draft' && count($argv) === 3) {
        gq_run_draft($postId, $adminPassword);
        echo "PASS draft blocked; anonymous and generic public REST access denied.\n";
    } elseif ($action === 'approved' && count($argv) === 3 && is_string($readerPassword) && $readerPassword !== '') {
        gq_run_approved($postId, $adminPassword, $readerPassword);
        echo "PASS approved template fetched; no-edit REST auth denied; SQLite outbox snapshot verified.\n";
    } else {
        throw new RuntimeException('Expected draft or approved <fixture-post-id>.');
    }
} catch (Throwable $error) {
    fwrite(STDERR, 'WordPress mail HTTP fixture failed: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
