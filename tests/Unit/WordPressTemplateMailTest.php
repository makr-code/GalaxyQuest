<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/WordPressTemplateMail.php';
require_once __DIR__ . '/../../lib/WordPressNewsPublisher.php';

final class WordPressTemplateMailTest extends TestCase
{
    private function database(): PDO
    {
        $db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $db->exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT, control_type TEXT,
            auth_enabled INT, deleted_at TEXT, email_notifications INT);
            CREATE TABLE mail_outbox (id INTEGER PRIMARY KEY, user_id INT, kind TEXT, dedupe_key TEXT UNIQUE,
            subject TEXT, body_text TEXT, body_html TEXT, template_id INT, template_revision TEXT, status TEXT,
            attempts INT, next_attempt_at INT, last_error TEXT, sent_at TEXT);
            INSERT INTO users VALUES (1, 'A <Pilot>', 'pilot@example.org', 'human', 1, NULL, 1)");
        return $db;
    }

    private function template(): array
    {
        return ['id' => 3, 'revision' => str_repeat('a', 64), 'subject' => 'Hallo {{username}}',
            'html' => '<p>Willkommen {{username}}</p><a href="https://example.org/">Spiel öffnen</a>'];
    }

    public function testSnapshotDedupeAndDelivery(): void
    {
        $db = $this->database();
        $template = $this->template();
        self::assertTrue(mail_template_enqueue($db, 1, $template, 'welcome', 100));
        $template['html'] = '<p>Geändert</p>';
        self::assertFalse(mail_template_enqueue($db, 1, $template, 'welcome', 100));
        $row = $db->query('SELECT * FROM mail_outbox')->fetch(PDO::FETCH_ASSOC);
        self::assertSame('Hallo A <Pilot>', $row['subject']);
        self::assertStringContainsString('Willkommen A &lt;Pilot&gt;', $row['body_html']);
        self::assertStringContainsString('Willkommen A <Pilot>', $row['body_text']);
        self::assertStringContainsString('Spiel öffnen (https://example.org/)', $row['body_text']);
        self::assertSame(str_repeat('a', 64), $row['template_revision']);
        $delivered = [];
        $transport = static function (string $to, string $subject, string $text, ?string $html) use (&$delivered): ?string {
            $delivered = compact('to', 'subject', 'text', 'html');
            return null;
        };
        self::assertSame(1, mail_outbox_flush($db, 100, 10, 3, $transport)['sent']);
        self::assertSame($row['body_html'], $delivered['html']);
        $mime = mailer_smtp_message('sender@example.org', $delivered['to'], $delivered['subject'], $delivered['text'], $delivered['html']);
        self::assertStringContainsString('multipart/alternative', $mime);
        self::assertStringContainsString(base64_encode($delivered['html']), str_replace("\r\n", '', $mime));
    }

    public function testOptOutIsRecheckedBeforeDelivery(): void
    {
        $db = $this->database();
        mail_template_enqueue($db, 1, $this->template(), 'notice', 100);
        $db->exec('UPDATE users SET email_notifications = 0 WHERE id = 1');
        self::assertSame(1, mail_outbox_flush($db, 100, 10, 3, static fn(): ?string => null)['skipped']);
    }

    public function testPlaceholdersInAttributesAreRejected(): void
    {
        $template = $this->template();
        $template['html'] = '<a href="{{username}}">Link</a>';
        $this->expectException(InvalidArgumentException::class);
        mail_template_enqueue($this->database(), 1, $template, 'notice', 100);
    }

    public function testPlaceholderAfterGreaterThanInsideAttributeIsRejected(): void
    {
        $template = $this->template();
        $template['html'] = '<a title="> {{username}}" href="https://example.org/">Link</a>';
        $this->expectException(InvalidArgumentException::class);
        mail_template_enqueue($this->database(), 1, $template, 'notice', 100);
    }

    public function testOversizedPlaintextCannotBeSilentlyTruncated(): void
    {
        $db = $this->database();
        $template = $this->template();
        $template['html'] = '<p>' . str_repeat('x', 65535) . '</p>';
        try {
            mail_template_enqueue($db, 1, $template, 'notice', 100);
            self::fail('Oversized mail accepted');
        } catch (InvalidArgumentException $error) {
            self::assertStringContainsString('Nachrichtengröße', $error->getMessage());
        }
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM mail_outbox')->fetchColumn());
    }

    public function testUnrelatedDatabaseConstraintIsNotTreatedAsDuplicate(): void
    {
        $db = $this->database();
        $db->exec("CREATE TRIGGER reject_template BEFORE INSERT ON mail_outbox
            BEGIN SELECT RAISE(ABORT, 'rejected'); END");
        $this->expectException(PDOException::class);
        mail_template_enqueue($db, 1, $this->template(), 'notice', 100);
    }

    public function testPlainTextPreservesValidUnquotedLinks(): void
    {
        $db = $this->database();
        $template = $this->template();
        $template['html'] = '<a title=">" href=https://example.org/path>Zum Spiel</a>';
        mail_template_enqueue($db, 1, $template, 'notice', 100);
        $text = $db->query('SELECT body_text FROM mail_outbox')->fetchColumn();
        self::assertStringContainsString('Zum Spiel (https://example.org/path)', $text);
    }

    public function testLongUnicodeSubjectUsesFoldedMimeWords(): void
    {
        $subject = str_repeat('Ä', 80);
        $encoded = mailer_encode_subject($subject);
        self::assertSame($subject, mb_decode_mimeheader($encoded));
        self::assertGreaterThan(1, preg_match_all('/=\?UTF-8\?B\?[^?]+\?=/i', $encoded, $words));
        foreach ($words[0] as $word) {
            self::assertLessThanOrEqual(75, strlen($word));
        }
        self::assertStringContainsString("\r\n ", $encoded);
    }

    public function testAuthenticatedTemplateFetchRejectsMalformedResponse(): void
    {
        $publisher = new WordPressNewsPublisher('https://wp.example/wp-json', 'bot', 'secret',
            static fn(): array => ['status' => 200, 'body' => '{"id":3,"revision":"bad","subject":"x","html":"x"}']);
        $this->expectException(RuntimeException::class);
        $publisher->mailTemplate(3);
    }

    public function testFetchUsesAuthenticationAndReturnsApprovedSnapshot(): void
    {
        $template = $this->template();
        $calls = [];
        $publisher = new WordPressNewsPublisher('https://wp.example/wp-json', 'bot', 'secret',
            static function (string $method, string $url, array $headers) use (&$calls, $template): array {
                $calls = [$method, $url, $headers];
                return ['status' => 200, 'body' => json_encode($template, JSON_THROW_ON_ERROR)];
            });
        self::assertSame($template, $publisher->mailTemplate(3));
        self::assertStringContainsString('/gq/v1/mail-templates/3', $calls[1]);
        self::assertContains('Authorization: Basic ' . base64_encode('bot:secret'), $calls[2]);
    }
}
