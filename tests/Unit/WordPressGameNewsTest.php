<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

final class WordPressGameNewsTest extends TestCase
{
    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testNewTaggedPostCanPublishWithoutAnOptionalFlightTarget(): void
    {
        require_once __DIR__ . '/../fixtures/wordpress_game_news_stubs.php';
        require_once __DIR__ . '/../../wordpress-integration/gq-game-news.php';
        $post = (object)['post_status' => 'publish'];
        $request = new WP_REST_Request([
            'status' => 'publish',
            'tags' => [7],
            'meta' => ['gq_summary' => 'Eine freigegebene Kurzfassung.'],
        ]);
        self::assertSame($post, gq_game_news_validate_rest_publish($post, $request));
        $request = new WP_REST_Request([
            'status' => 'publish',
            'tags' => [7],
            'meta' => ['gq_summary' => ''],
        ]);
        self::assertSame('gq_game_news_invalid', gq_game_news_validate_rest_publish($post, $request)->code);
        $request = new WP_REST_Request([
            'status' => 'publish',
            'tags' => [7],
            'meta' => ['gq_summary' => 'Kurzfassung', 'gq_target_faction_code' => 'INVALID CODE'],
        ]);
        self::assertSame('gq_game_news_invalid', gq_game_news_validate_rest_publish($post, $request)->code);
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testChronologyMetadataRejectsInvalidDatesAndOriginsEvenForDrafts(): void
    {
        require_once __DIR__ . '/../fixtures/wordpress_game_news_stubs.php';
        require_once __DIR__ . '/../../wordpress-integration/gq-game-news.php';
        $post = (object)['post_status' => 'draft'];
        foreach (['2026-02-29', '2026-2-01', '0000-01-01'] as $date) {
            $result = gq_game_news_validate_rest_publish($post, new WP_REST_Request([
                'meta' => ['gq_event_date' => $date],
            ]));
            self::assertSame('gq_invalid_event_date', $result->code);
        }
        self::assertSame($post, gq_game_news_validate_rest_publish($post, new WP_REST_Request([
            'meta' => ['gq_event_date' => '2024-02-29', 'gq_event_origin' => 'game-event'],
        ])));
        $result = gq_game_news_validate_rest_publish($post, new WP_REST_Request([
            'meta' => ['gq_event_origin' => 'unknown'],
        ]));
        self::assertSame('gq_invalid_event_origin', $result->code);
    }

    #[RunInSeparateProcess]
    #[PreserveGlobalState(false)]
    public function testClassicEditorRejectsInvalidChronologyBeforePostInsertion(): void
    {
        require_once __DIR__ . '/../fixtures/wordpress_game_news_stubs.php';
        require_once __DIR__ . '/../../wordpress-integration/gq-game-news.php';
        $_POST = ['gq_game_news_nonce' => 'valid', 'gq_event_date' => '2026-02-29',
            'gq_event_origin' => 'editorial'];
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Ungültiges Ereignisdatum');
        gq_game_news_validate_admin_publish(['post_type' => 'post', 'post_status' => 'draft'], []);
    }
}
