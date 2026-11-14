<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/GalaxyNewsWriter.php';
require_once __DIR__ . '/../../lib/WordPressNewsPublisher.php';

final class GalaxyNewsTest extends TestCase
{
    public function testItemsAreLimitedToTheRequestedDayVisibleAndNotWithdrawn(): void
    {
        $db = new PDO('sqlite::memory:');
        $db->exec('CREATE TABLE server_announcements (id INTEGER PRIMARY KEY, title TEXT, message TEXT, published_at TEXT, withdrawn_at TEXT)');
        $db->exec('CREATE TABLE galactic_events (id INTEGER PRIMARY KEY, event_type TEXT, description TEXT, affected_scope TEXT, starts_at TEXT, is_visible INT)');
        $db->exec("INSERT INTO server_announcements (title, message, published_at, withdrawn_at) VALUES
            ('Wartung', 'Heute Nacht.', '2026-11-14 08:00:00', NULL),
            ('Zurückgezogen', 'x', '2026-11-14 09:00:00', '2026-11-14 10:00:00'),
            ('Gestern', 'y', '2026-11-13 23:59:59', NULL)");
        $db->exec("INSERT INTO galactic_events (event_type, description, affected_scope, starts_at, is_visible) VALUES
            ('nebula', 'Ein Nebel zieht auf.', 'sector', '2026-11-14 12:00:00', 1),
            ('secret', 'verborgen', 'galaxy', '2026-11-14 12:00:00', 0)");
        $items = GalaxyNewsWriter::itemsForDay($db, '2026-11-14');
        self::assertSame(['Wartung', 'nebula'], array_column($items, 'title'));
        $prompt = GalaxyNewsWriter::messages($items, '2026-11-14')[1]['content'];
        self::assertStringContainsString('Ein Nebel zieht auf.', $prompt);
        self::assertStringContainsString('Datum: Samstag, 14.11.2026', $prompt);
        self::assertStringNotContainsString('verborgen', $prompt);
    }

    public function testParseLinesAcceptsFencedJsonAndBuildsScript(): void
    {
        $lines = GalaxyNewsWriter::parseLines("```json\n{\"lines\":[\"Ein Nebel zieht über den Sektor.\"]}\n```");
        self::assertSame(['Ein Nebel zieht über den Sektor.'], $lines);
        self::assertStringStartsWith(GalaxyNewsWriter::INTRO, GalaxyNewsWriter::script($lines));
    }

    /** @dataProvider invalidAnswers */
    public function testParseLinesRejectsUnsafeOrMalformedAnswers(string $answer): void
    {
        $this->expectException(UnexpectedValueException::class);
        GalaxyNewsWriter::parseLines($answer);
    }

    public static function invalidAnswers(): array
    {
        return [
            'not json' => ['Hier sind die News'],
            'empty list' => ['{"lines":[]}'],
            'markup' => ['{"lines":["<b>Wichtige Meldung</b> aus dem Sektor."]}'],
            'markdown' => ['{"lines":["**Wichtige** Meldung aus dem Sektor."]}'],
            'too short' => ['{"lines":["Kurz."]}'],
            'not text' => ['{"lines":[42]}'],
            'too many' => ['{"lines":' . json_encode(array_fill(0, 7, 'Eine ausreichend lange Zeile.')) . '}'],
            'line too long' => ['{"lines":["' . str_repeat('a', 301) . '"]}'],
        ];
    }

    public function testScriptLimitIsEnforced(): void
    {
        $this->expectException(UnexpectedValueException::class);
        GalaxyNewsWriter::parseLines('{"lines":["Eine ausreichend lange Zeile."]}', 60);
    }

    public function testPublisherSendsAuthenticatedRequestsAndEscapesContent(): void
    {
        $calls = [];
        $publisher = new WordPressNewsPublisher(
            'http://wp.test/index.php',
            'bot',
            'secret pass',
            static function (string $method, string $url, array $headers, string $body) use (&$calls): array {
                $calls[] = compact('method', 'url', 'headers', 'body');
                return ['status' => 201, 'body' => str_contains($url, 'media')
                    ? '{"id":5,"source_url":"http://wp.test/a.mp3"}'
                    : '{"id":9,"link":"http://wp.test/?p=9","status":"draft"}'];
            }
        );
        $audio = $publisher->uploadAudio('MP3', 'galaxy-news-2026-11-14.mp3');
        $post = $publisher->createPost('galaxy-news-2026-11-14', 'T', ['Zeile <eins> & mehr.'], 'Skript', $audio, 'draft', 6, 3);
        self::assertSame(9, $post['id']);
        self::assertContains('Authorization: Basic ' . base64_encode('bot:secret pass'), $calls[0]['headers']);
        self::assertContains('Content-Type: audio/mpeg', $calls[0]['headers']);
        $payload = json_decode($calls[1]['body'], true);
        self::assertSame('Skript', $payload['meta']['gq_summary']);
        self::assertSame([6], $payload['categories']);
        self::assertStringContainsString('Zeile &lt;eins&gt; &amp; mehr.', $payload['content']);
        self::assertStringContainsString('src="http://wp.test/a.mp3"', $payload['content']);
    }

    public function testPublisherReportsWordPressErrorsWithoutLeakingBodies(): void
    {
        $publisher = new WordPressNewsPublisher('http://wp.test/index.php', 'bot', 'pw',
            static fn(): array => ['status' => 401, 'body' => '{"code":"rest_cannot_create","secret":"x"}']);
        $this->expectExceptionMessageMatches('/HTTP 401, rest_cannot_create/');
        $publisher->existingPostId('galaxy-news-2026-11-14');
    }

    public function testPublisherRequiresCredentialsAndValidStatus(): void
    {
        $this->expectException(InvalidArgumentException::class);
        new WordPressNewsPublisher('http://wp.test/index.php', '', '');
    }
}
