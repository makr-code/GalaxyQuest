<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use PHPUnit\Framework\TestCase;

/**
 * End-to-end: WordPress plugin export (stubbed WP, real KSES when local core exists)
 * -> WordPressNewsPublisher via an in-process REST transport -> SQLite outbox
 * -> real multipart SMTP (STARTTLS) into a short-lived, isolated Mailpit fixture.
 *
 * Runs only inside tests/scripts/check_wordpress_template_mail_pipeline.mjs, which creates
 * a uniquely named internal Docker network, Mailpit and CA volume and removes them again.
 * Without that fixture environment every test is skipped; no game or WordPress DB is used.
 */
#[RunTestsInSeparateProcesses]
#[PreserveGlobalState(false)]
final class WordPressTemplateMailPipelineTest extends TestCase
{
    private const FIXTURE_HOST = 'gq-wpmail-smtp-fixture';
    private const REST_URL = 'https://wp.fixture.invalid/wp-json';
    private const WP_USER = 'mail-bot';
    private const WP_APP_PASSWORD = 'fixture only pass';
    private const TEMPLATE_ID = 42;

    private string $mailpitApi;
    private bool $realKses = false;
    private int $restCalls = 0;

    protected function setUp(): void
    {
        $api = getenv('GQ_MAIL_PIPELINE_MAILPIT_API');
        if (!is_string($api) || $api === '') {
            self::markTestSkipped('Only runs via tests/scripts/check_wordpress_template_mail_pipeline.mjs.');
        }
        // Guard: never talk to anything except the dedicated fixture host.
        self::assertSame('http://' . self::FIXTURE_HOST . ':8025', $api);
        self::assertSame(self::FIXTURE_HOST, getenv('SMTP_HOST'));
        self::assertSame('production', getenv('APP_ENV'));
        self::assertFalse(getenv('REGISTRATION_MAILPIT_URL'));
        $this->mailpitApi = $api;
        $this->loadWordPressPlugin();
        $this->waitForMailpit();
        $this->mailpit('DELETE', '/api/v1/messages');
        self::assertSame(0, $this->mailpitList()['total']);
    }

    public function testApprovedExportIsDeliveredOnceAsPersonalizedMultipartSmtpMail(): void
    {
        $db = $this->database();
        $publisher = $this->publisher(self::WP_APP_PASSWORD);
        $template = $publisher->mailTemplate(self::TEMPLATE_ID);

        self::assertSame(1, $this->restCalls);
        self::assertSame(hash('sha256', json_encode(['subject' => $template['subject'], 'html' => $template['html']])),
            $template['revision']);
        self::assertSame('Grüße an {{username}} & Crew', $template['subject']);
        if ($this->realKses) {
            foreach (['<script', 'onclick', 'style=', 'javascript:', '<!-- wp:'] as $unsafe) {
                self::assertStringNotContainsString($unsafe, $template['html']);
            }
        }
        self::assertStringContainsString('<a href="https://game.example.invalid/#fleet">Zur Flotte</a>', $template['html']);

        // Transactional outbox: a rolled-back game event leaves no mail behind.
        $db->beginTransaction();
        $db->exec("INSERT INTO game_events (kind) VALUES ('fleet_ready')");
        self::assertTrue(mail_template_enqueue($db, 1, $template, 'fleet-ready-1', 1000));
        $db->rollBack();
        self::assertSame(0, $this->rowCount($db, 'SELECT COUNT(*) FROM mail_outbox'));
        $db->beginTransaction();
        $db->exec("INSERT INTO game_events (kind) VALUES ('fleet_ready')");
        self::assertTrue(mail_template_enqueue($db, 1, $template, 'fleet-ready-1', 1000));
        $db->commit();

        // Idempotency on enqueue (also with a changed export) and on repeated flushes.
        $changed = ['html' => '<p>Anders</p>', 'revision' => str_repeat('b', 64)] + $template;
        self::assertFalse(mail_template_enqueue($db, 1, $changed, 'fleet-ready-1', 1001));
        self::assertSame(1, $this->rowCount($db, 'SELECT COUNT(*) FROM mail_outbox'));
        $row = $db->query('SELECT * FROM mail_outbox')->fetch(PDO::FETCH_ASSOC);
        self::assertSame($template['revision'], $row['template_revision']);
        self::assertSame(self::TEMPLATE_ID, (int)$row['template_id']);
        self::assertSame('Grüße an Ada & <Nova> & Crew', $row['subject']);
        self::assertStringContainsString('Hallo Ada &amp; &lt;Nova&gt;,', $row['body_html']);
        self::assertStringContainsString('Hallo Ada & <Nova>,', $row['body_text']);
        self::assertStringContainsString('Zur Flotte (https://game.example.invalid/#fleet)', $row['body_text']);
        self::assertStringContainsString(MAIL_OUTBOX_SETTINGS_HINT, $row['body_text']);
        self::assertStringNotContainsString('<', str_replace('<Nova>', '', $row['body_text']));

        self::assertSame(1, $this->flush($db, 1000)['sent']);
        self::assertSame(['sent' => 0, 'skipped' => 0], array_intersect_key($this->flush($db, 5000), ['sent' => 0, 'skipped' => 0]));
        self::assertSame('sent', $db->query('SELECT status FROM mail_outbox')->fetchColumn());

        $list = $this->mailpitList();
        self::assertSame(1, $list['total'], 'SMTP did not deliver exactly once');
        $message = $this->mailpit('GET', '/api/v1/message/' . $list['messages'][0]['ID']);
        self::assertSame('pilot@example.invalid', $message['To'][0]['Address']);
        self::assertSame('notifications@example.invalid', $message['From']['Address']);
        self::assertSame($row['subject'], $message['Subject']);
        self::assertSame($this->normalize($row['body_text']), $this->normalize($message['Text']));
        self::assertSame($this->normalize($row['body_html']), $this->normalize($message['HTML']));

        $this->assertMultipartSource($this->mailpitRaw($list['messages'][0]['ID']), $row['body_text'], $row['body_html']);
    }

    public function testRevisionChangeIsSnapshottedPerRequestAndDeliveredSeparately(): void
    {
        $db = $this->database();
        $publisher = $this->publisher(self::WP_APP_PASSWORD);
        $first = $publisher->mailTemplate(self::TEMPLATE_ID);
        self::assertTrue(mail_template_enqueue($db, 1, $first, 'briefing-1', 1000));

        $GLOBALS['gq_mail_test_posts'][self::TEMPLATE_ID]->post_content = '<p>Neue Lage für {{username}}.</p>';
        $longSubject = 'Lagebericht ' . str_repeat('Ä', 80);
        $GLOBALS['gq_mail_test_posts'][self::TEMPLATE_ID]->post_title = $longSubject;
        $second = $publisher->mailTemplate(self::TEMPLATE_ID);
        self::assertNotSame($first['revision'], $second['revision']);
        self::assertTrue(mail_template_enqueue($db, 1, $second, 'briefing-2', 1000));
        self::assertFalse(mail_template_enqueue($db, 1, $second, 'briefing-1', 1000));

        self::assertSame(2, $this->flush($db, 1000)['sent']);
        $rows = $db->query('SELECT dedupe_key, template_revision FROM mail_outbox ORDER BY id')->fetchAll(PDO::FETCH_KEY_PAIR);
        self::assertSame(['wp:1:briefing-1' => $first['revision'], 'wp:1:briefing-2' => $second['revision']], $rows);

        $bySubject = [];
        foreach ($this->mailpitList()['messages'] as $summary) {
            $bySubject[$summary['Subject']] = $this->mailpit('GET', '/api/v1/message/' . $summary['ID']);
        }
        self::assertSame(['Grüße an Ada & <Nova> & Crew', $longSubject], $this->sorted(array_keys($bySubject)));
        self::assertStringContainsString('Zur Flotte', $bySubject['Grüße an Ada & <Nova> & Crew']['Text']);
        self::assertStringNotContainsString('Neue Lage', $bySubject['Grüße an Ada & <Nova> & Crew']['HTML']);
        self::assertStringContainsString('<p>Neue Lage für Ada &amp; &lt;Nova&gt;.</p>', $bySubject[$longSubject]['HTML']);
        self::assertStringContainsString('Neue Lage für Ada & <Nova>.', $bySubject[$longSubject]['Text']);
    }

    public function testOptOutAndIneligibleRecipientsNeverReachSmtp(): void
    {
        $db = $this->database();
        $template = $this->publisher(self::WP_APP_PASSWORD)->mailTemplate(self::TEMPLATE_ID);

        self::assertTrue(mail_template_enqueue($db, 2, $template, 'notice', 1000));
        self::assertSame('skipped', $db->query("SELECT status FROM mail_outbox WHERE user_id = 2")->fetchColumn());
        self::assertTrue(mail_template_enqueue($db, 3, $template, 'notice', 1000));
        self::assertSame('pending', $db->query("SELECT status FROM mail_outbox WHERE user_id = 3")->fetchColumn());
        $db->exec('UPDATE users SET email_notifications = 0 WHERE id = 3');
        try {
            mail_template_enqueue($db, 4, $template, 'notice', 1000);
            self::fail('NPC recipient was accepted');
        } catch (InvalidArgumentException) {
        }
        self::assertTrue(mail_template_enqueue($db, 1, $template, 'notice', 1000));

        $stats = $this->flush($db, 1000);
        self::assertSame(1, $stats['sent']);
        self::assertSame(1, $stats['skipped']);
        self::assertSame(['1' => 'sent', '2' => 'skipped', '3' => 'skipped'],
            $db->query('SELECT user_id, status FROM mail_outbox ORDER BY user_id')->fetchAll(PDO::FETCH_KEY_PAIR));
        $list = $this->mailpitList();
        self::assertSame(1, $list['total']);
        self::assertSame('pilot@example.invalid', $list['messages'][0]['To'][0]['Address']);
    }

    public function testUnauthenticatedOrUnapprovedExportsAreNotQueued(): void
    {
        try {
            $this->publisher('wrong password')->mailTemplate(self::TEMPLATE_ID);
            self::fail('Wrong application password was accepted');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTP 401', $error->getMessage());
        }
        $GLOBALS['gq_mail_test_posts'][self::TEMPLATE_ID]->post_status = 'draft';
        try {
            $this->publisher(self::WP_APP_PASSWORD)->mailTemplate(self::TEMPLATE_ID);
            self::fail('Draft template was exported');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('HTTP 404', $error->getMessage());
        }
        self::assertSame(0, $this->mailpitList()['total']);
    }

    public function testDevelopmentTransportDeliversHtmlAndTextThroughMailpitApi(): void
    {
        $db = $this->database();
        $template = $this->publisher(self::WP_APP_PASSWORD)->mailTemplate(self::TEMPLATE_ID);
        self::assertTrue(mail_template_enqueue($db, 1, $template, 'local-notice', 1000));
        $row = $db->query('SELECT body_text, body_html FROM mail_outbox')->fetch(PDO::FETCH_ASSOC);
        putenv('APP_ENV=dev');
        putenv('REGISTRATION_MAILPIT_URL=' . $this->mailpitApi);
        try {
            self::assertSame(1, $this->flush($db, 1000)['sent']);
        } finally {
            putenv('APP_ENV=production');
            putenv('REGISTRATION_MAILPIT_URL');
        }
        $list = $this->mailpitList();
        self::assertSame(1, $list['total']);
        $message = $this->mailpit('GET', '/api/v1/message/' . $list['messages'][0]['ID']);
        self::assertSame('pilot@example.invalid', $message['To'][0]['Address']);
        self::assertSame('notifications@galaxyquest.local', $message['From']['Address']);
        self::assertSame($this->normalize($row['body_text']), $this->normalize($message['Text']));
        self::assertSame($this->normalize($row['body_html']), $this->normalize($message['HTML']));
    }

    private function loadWordPressPlugin(): void
    {
        $core = __DIR__ . '/../../wordpress/wp-includes/kses.php';
        if (is_file($core)) {
            global $html5_named_character_references;
            require_once dirname($core) . '/compat.php';
            foreach (['class-wp-token-map.php', 'html-api/html5-named-character-references.php',
                'html-api/class-wp-html-attribute-token.php', 'html-api/class-wp-html-span.php',
                'html-api/class-wp-html-doctype-info.php', 'html-api/class-wp-html-text-replacement.php',
                'html-api/class-wp-html-decoder.php', 'html-api/class-wp-html-tag-processor.php'] as $dependency) {
                if (is_file(dirname($core) . '/' . $dependency)) {
                    require_once dirname($core) . '/' . $dependency;
                }
            }
            require_once $core;
            $this->realKses = true;
        }
        require_once __DIR__ . '/../fixtures/wordpress_mail_templates_stubs.php';
        require_once __DIR__ . '/../../wordpress-integration/gq-game-news.php';
        require_once __DIR__ . '/../../lib/WordPressNewsPublisher.php';
        require_once __DIR__ . '/../../lib/WordPressTemplateMail.php';
        self::assertSame(getenv('GQ_MAIL_PIPELINE_EXPECT_REAL_KSES') === '1', $this->realKses, 'Unexpected KSES mode');
        $GLOBALS['gq_mail_test_posts'] = [self::TEMPLATE_ID => new WP_Post(
            self::TEMPLATE_ID,
            'gq_mail_template',
            'publish',
            'Grüße an {{username}} &amp; Crew',
            '<!-- wp:paragraph --><p>Hallo {{username}},</p><!-- /wp:paragraph -->'
                . '<p onclick="evil()" style="color:red">Deine <strong>Flotte</strong> wartet.</p>'
                . '<script>steal()</script><a href="javascript:steal()">Böse</a>'
                . '<p><a href="https://game.example.invalid/#fleet">Zur Flotte</a></p>'
                . '<table cellpadding="4"><tr><td>Status</td><td>bereit</td></tr></table>',
        )];
        $GLOBALS['gq_mail_test_editable'] = [self::TEMPLATE_ID => true];
        gq_mail_templates_register_rest_route();
    }

    /** Publisher whose transport dispatches to the plugin's registered REST route like WP core would. */
    private function publisher(string $appPassword): WordPressNewsPublisher
    {
        $expectedAuth = 'Authorization: Basic ' . base64_encode(self::WP_USER . ':' . self::WP_APP_PASSWORD);
        $transport = function (string $method, string $url, array $headers, string $body) use ($expectedAuth): array {
            $this->restCalls++;
            self::assertSame('GET', $method);
            self::assertSame('', $body);
            self::assertStringStartsWith(self::REST_URL . '/', $url);
            $GLOBALS['gq_mail_test_authenticated'] = in_array($expectedAuth, $headers, true);
            $path = substr((string)parse_url($url, PHP_URL_PATH), strlen('/wp-json'));
            foreach ($GLOBALS['gq_mail_test_routes'] as $pattern => $route) {
                if ($route['methods'] === $method && preg_match('#^/' . $pattern . '$#D', $path, $match)) {
                    $request = new WP_REST_Request(['id' => (int)$match['id']]);
                    $result = $route['permission_callback']($request);
                    if ($result === true) {
                        $result = $route['callback']($request);
                    }
                    return $result instanceof WP_Error
                        ? ['status' => $result->data['status'], 'body' => json_encode(['code' => $result->code])]
                        : ['status' => 200, 'body' => json_encode($result->data, JSON_THROW_ON_ERROR)];
                }
            }
            return ['status' => 404, 'body' => '{"code":"rest_no_route"}'];
        };
        return new WordPressNewsPublisher(self::REST_URL, self::WP_USER, $appPassword, $transport);
    }

    private function database(): PDO
    {
        $db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $db->exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, email TEXT, control_type TEXT,
                auth_enabled INTEGER, deleted_at TEXT, email_notifications INTEGER);
            CREATE TABLE game_events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL);
            CREATE TABLE mail_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL,
                dedupe_key TEXT NOT NULL UNIQUE, subject TEXT NOT NULL, body_text TEXT NOT NULL, body_html TEXT,
                template_id INTEGER, template_revision TEXT, status TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, last_error TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP, sent_at TEXT);
            INSERT INTO users VALUES (1, 'Ada & <Nova>', 'pilot@example.invalid', 'human', 1, NULL, 1),
                (2, 'Optout', 'optout@example.invalid', 'human', 1, NULL, 0),
                (3, 'Late', 'late@example.invalid', 'human', 1, NULL, 1),
                (4, 'Bot', 'npc@example.invalid', 'npc', 1, NULL, 1)");
        return $db;
    }

    /** @return array<string, mixed> */
    private function flush(PDO $db, int $now): array
    {
        $transport = mailer_default_transport();
        self::assertNotNull($transport, 'SMTP fixture settings are incomplete');
        $stats = mail_outbox_flush($db, $now, 10, 3, $transport);
        self::assertSame(0, $stats['retried'] + $stats['failed'],
            'SMTP error: ' . (string)$db->query('SELECT last_error FROM mail_outbox WHERE last_error IS NOT NULL')->fetchColumn());
        return $stats;
    }

    private function assertMultipartSource(string $raw, string $text, string $html): void
    {
        [$head, $body] = explode("\r\n\r\n", $raw, 2);
        self::assertMatchesRegularExpression('/^Subject: =\?UTF-8\?B\?[A-Za-z0-9+\/=]+\?=\r?$/m', $head);
        self::assertMatchesRegularExpression('/^MIME-Version: 1\.0\r?$/m', $head);
        self::assertSame(1, preg_match('/^Content-Type: multipart\/alternative; boundary="(gq-[a-f0-9]{48})"\r?$/m', $head, $m));
        $parts = explode('--' . $m[1], $body);
        self::assertSame("--\r\n", end($parts));
        $parts = array_slice($parts, 1, -1);
        self::assertCount(2, $parts);
        $decoded = [];
        foreach ($parts as $part) {
            [$partHead, $partBody] = explode("\r\n\r\n", ltrim($part, "\r\n"), 2);
            self::assertStringContainsString('Content-Transfer-Encoding: base64', $partHead);
            self::assertSame(1, preg_match('/Content-Type: (text\/(?:plain|html)); charset=UTF-8/', $partHead, $type));
            $decoded[$type[1]] = base64_decode(str_replace("\r\n", '', $partBody), true);
        }
        self::assertSame(['text/plain', 'text/html'], array_keys($decoded));
        self::assertSame($text, $decoded['text/plain']);
        self::assertSame($html, $decoded['text/html']);
    }

    private function waitForMailpit(): void
    {
        for ($attempt = 0; $attempt < 40; $attempt++) {
            [$status] = $this->http('GET', '/livez');
            if ($status === 200) {
                return;
            }
            usleep(250000);
        }
        self::fail('Mailpit fixture did not become ready');
    }

    /** @return array{total:int, messages:list<array<string,mixed>>} */
    private function mailpitList(): array
    {
        return $this->mailpit('GET', '/api/v1/messages');
    }

    private function mailpitRaw(string $id): string
    {
        [$status, $body] = $this->http('GET', '/api/v1/message/' . rawurlencode($id) . '/raw');
        self::assertSame(200, $status);
        return $body;
    }

    /** @return array<string, mixed> */
    private function mailpit(string $method, string $path): array
    {
        [$status, $body] = $this->http($method, $path);
        self::assertSame(200, $status, "Mailpit $method $path");
        return $method === 'DELETE' ? [] : json_decode($body, true, 512, JSON_THROW_ON_ERROR);
    }

    /** @return array{0:int, 1:string} */
    private function http(string $method, string $path): array
    {
        $handle = curl_init($this->mailpitApi . $path);
        self::assertNotFalse($handle);
        try {
            curl_setopt_array($handle, [
                CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_CONNECTTIMEOUT => 2, CURLOPT_TIMEOUT => 5, CURLOPT_PROTOCOLS => CURLPROTO_HTTP,
            ]);
            $body = curl_exec($handle);
            return [is_string($body) ? (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE) : 0, is_string($body) ? $body : ''];
        } finally {
            curl_close($handle);
        }
    }

    private function rowCount(PDO $db, string $sql): int
    {
        return (int)$db->query($sql)->fetchColumn();
    }

    private function normalize(string $value): string
    {
        return trim(str_replace("\r\n", "\n", $value));
    }

    /** @param list<string> $values @return list<string> */
    private function sorted(array $values): array
    {
        sort($values);
        return $values;
    }
}
