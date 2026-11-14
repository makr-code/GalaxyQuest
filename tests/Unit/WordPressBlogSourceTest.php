<?php
declare(strict_types=1);
use PHPUnit\Framework\TestCase;
require_once __DIR__ . '/../../lib/WordPressSimulation.php';
require_once __DIR__ . '/../../lib/WordPressBlogSource.php';

final class WordPressBlogSourceTest extends TestCase
{
    private array $data;
    private array $targets = [['faction_id' => 8, 'code' => 'aereth']];

    protected function setUp(): void
    {
        $this->data = json_decode(file_get_contents(__DIR__ . '/../../config/wordpress_simulation.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    private function source(?array $data = null): WordPressBlogSource
    {
        $sim = new WordPressSimulation($data ?? $this->data, 'http://blog.test/api.php');
        return new WordPressBlogSource('http://internal.test/api.php', 'http://blog.test',
            static function (string $url) use ($sim): array {
                parse_str(parse_url($url, PHP_URL_QUERY), $query);
                try {
                    return ['status' => 200, 'body' => json_encode($sim->request($query['rest_route'], $query), JSON_THROW_ON_ERROR)];
                } catch (OutOfBoundsException) {
                    return ['status' => 404, 'body' => '{"code":"rest_post_invalid_id"}'];
                }
            });
    }

    public function testLatestFiveAreExplicitlyTaggedPublicPostsWithMappedMetadata(): void
    {
        $posts = $this->source()->latest($this->targets);
        self::assertSame([106, 105, 104, 103, 102], array_column($posts, 'id'));
        self::assertContains('hero', $posts[0]['tags']);
        self::assertSame(['fraktionen'], $posts[0]['categories']);
        self::assertSame(8, $posts[0]['target_faction_id']);
        self::assertSame('http://blog.test/api.php?p=106', $posts[0]['original_url']);
        self::assertMatchesRegularExpression('/^wp:[a-f0-9]{64}$/D', $posts[0]['revision']);
        self::assertLessThanOrEqual(3000, mb_strlen($posts[0]['body']));
    }

    public function testCategoryFilterKeepsOnlyPostsInThatCategory(): void
    {
        $posts = $this->source()->latest($this->targets, 'fraktionen');
        self::assertNotSame([], $posts);
        foreach ($posts as $post) {
            self::assertContains('fraktionen', $post['categories']);
        }
        self::assertSame([], $this->source()->latest($this->targets, 'galaxy-news-radio'));
    }

    public function testChronologyPassesFiltersAndRejectsUnsafeOrInvalidData(): void
    {
        $entry = [
            'id' => 4, 'title' => 'Chronik', 'summary' => 'Kurzfassung',
            'event_date' => '2024-02-29', 'published_at' => '2026-11-14T08:20:00',
            'origin' => 'editorial', 'is_correction' => false,
            'categories' => ['diplomatie'], 'url' => 'http://blog.test/?p=4',
        ];
        $data = ['posts' => [$entry], 'has_more' => true];
        $requested = '';
        $source = new WordPressBlogSource('http://internal.test/index.php', 'http://blog.test',
            static function (string $url) use (&$data, &$requested): array {
                $requested = $url;
                return ['status' => 200, 'body' => json_encode($data, JSON_THROW_ON_ERROR)];
            });
        self::assertSame($data, $source->chronology(2, 'diplomatie', '2024-01-01', '2025-01-01'));
        parse_str(parse_url($requested, PHP_URL_QUERY), $query);
        self::assertSame('/gq/v1/chronology', $query['rest_route']);
        self::assertSame('2', $query['page']);
        self::assertSame('diplomatie', $query['topic']);
        foreach ([
            ['event_date' => '2026-02-29'],
            ['origin' => 'unknown'],
            ['is_correction' => 'false'],
            ['url' => 'https://other.test/post'],
            ['summary' => '<script>bad</script>'],
        ] as $invalid) {
            $data['posts'][0] = array_replace($entry, $invalid);
            try {
                $source->chronology(1, '', '', '');
                self::fail('Ungültiger Chronikbeitrag wurde akzeptiert.');
            } catch (RuntimeException $error) {
                self::assertStringContainsString('Chronik', $error->getMessage());
            }
        }
    }

    public function testNarrationCannotReadUntaggedPrivateDraftProtectedOrMissingPosts(): void
    {
        $source = $this->source();
        foreach ([107, 108, 109, 110, 999] as $id) self::assertNull($source->published($id, $this->targets));
        self::assertNotNull($source->published(101, $this->targets));
    }

    public function testTagWithdrawalAndChangesWithinSameSecondAreSeenWithoutCache(): void
    {
        $before = $this->source()->published(106, $this->targets);
        $data = $this->data;
        $data['posts'][5]['summary'] = 'Neue Kurzfassung';
        $after = $this->source($data)->published(106, $this->targets);
        self::assertSame($before['updated_at'], $after['updated_at']);
        self::assertNotSame($before['revision'], $after['revision']);
        $data['posts'][5]['tags'] = [2];
        self::assertNull($this->source($data)->published(106, $this->targets));
    }

    public function testLongBlogHtmlIsNotUsedAsGameSummaryOrNarration(): void
    {
        $data = $this->data;
        $data['posts'][5]['body'] = str_repeat('Langtext. ', 1000);
        $data['posts'][5]['title'] = 'Audio & Galaxie <Test>';
        $post = $this->source($data)->published(106, $this->targets);
        self::assertSame($data['posts'][5]['summary'], $post['body']);
        self::assertSame('Audio & Galaxie <Test>', $post['title']);
        self::assertStringNotContainsString('Langtext', $post['body']);
    }

    public function testInvalidOrOverlongSummaryFailsExplicitlyInsteadOfFallingBackToFullText(): void
    {
        $data = $this->data;
        $data['posts'][5]['summary'] = str_repeat('ä', 3001);
        $this->expectException(RuntimeException::class);
        $this->source($data)->latest($this->targets);
    }

    public function testMissingStartTagProducesAnEmptyFeed(): void
    {
        $data = $this->data;
        $data['tags'] = array_slice($data['tags'], 1);
        self::assertSame([], $this->source($data)->latest($this->targets));
    }

    public function testOnlyActualWordPressNotFoundErrorsMeanMissingPosts(): void
    {
        foreach ([
            ['status' => 404, 'body' => '{"code":"rest_no_route"}'],
            ['status' => 404, 'body' => '<html>Not found</html>'],
            ['status' => 200, 'body' => '{"code":"rest_post_invalid_id"}'],
            ['status' => 200, 'body' => '[]'],
        ] as $response) {
            $source = new WordPressBlogSource('http://blog.test/index.php', 'http://blog.test',
                static fn(string $url): array => str_contains($url, 'slug=game-start')
                    ? ['status' => 200, 'body' => '[{"id":1,"slug":"game-start"}]'] : $response);
            try {
                $source->published(106, $this->targets);
            } catch (RuntimeException $error) {
                self::assertNotSame('', $error->getMessage());
                continue;
            }
            self::fail('Source failure was treated as a withdrawn post.');
        }
    }

    public function testRestBaseSelectsPrettyOrQueryRoutesWithoutDroppingParameters(): void
    {
        foreach ([
            'https://blog.test/wp-json/' => '/wp-json/wp/v2/tags',
            'https://blog.test/site/wp-json' => '/site/wp-json/wp/v2/tags',
            'https://blog.test/index.php' => '/index.php',
        ] as $base => $expectedPath) {
            $requested = null;
            $source = new WordPressBlogSource($base, 'https://blog.test',
                static function (string $url) use (&$requested): array {
                    $requested = $url;
                    return ['status' => 200, 'body' => '[]'];
                });
            self::assertSame([], $source->latest([]));
            self::assertSame($expectedPath, parse_url($requested, PHP_URL_PATH));
            parse_str(parse_url($requested, PHP_URL_QUERY), $query);
            self::assertSame('game-start', $query['slug']);
            if (str_ends_with($expectedPath, '/tags')) self::assertArrayNotHasKey('rest_route', $query);
            else self::assertSame('/wp/v2/tags', $query['rest_route']);
        }
    }
    public function testSimulationProvidesPaginationAndPartialFieldsWithoutFullHtml(): void
    {
        $simulation = new WordPressSimulation($this->data, 'http://blog.test');
        $first = $simulation->request('/wp/v2/posts', ['tags' => 1, 'per_page' => 5]);
        $second = $simulation->request('/wp/v2/posts', ['tags' => 1, 'per_page' => 5, 'page' => 2]);
        self::assertSame([106, 105, 104, 103, 102], array_column($first, 'id'));
        self::assertSame([101], array_column($second, 'id'));
        $partial = $simulation->request('/wp/v2/posts/106', ['_embed' => 'wp:term', '_fields' => 'id,content.protected,meta,_embedded,_links']);
        self::assertSame(['protected' => false], $partial['content']);
        self::assertArrayNotHasKey('title', $partial);
        self::assertArrayHasKey('gq_summary', $partial['meta']);
        self::assertSame('category', $partial['_embedded']['wp:term'][0][0]['taxonomy']);
    }

    public function testSimulationRejectsInvalidParametersInsteadOfCoercingThem(): void
    {
        $simulation = new WordPressSimulation($this->data, 'http://blog.test');
        foreach ([
            ['per_page' => 0], ['per_page' => 101], ['per_page' => '1.5'], ['page' => -1],
            ['page' => '9999999999999999999999'], ['page' => []], ['order' => 'sideways'],
            ['status' => 'draft'], ['orderby' => 'unsupported'], ['tags' => '1,invalid'],
            ['tags' => ['id' => 1]], ['categories' => [0]], ['slug' => []], ['_fields' => []],
        ] as $query) {
            try {
                $simulation->request('/wp/v2/posts', $query);
            } catch (InvalidArgumentException $error) {
                self::assertNotSame('', $error->getMessage());
                continue;
            }
            self::fail('Invalid simulation query accepted: ' . json_encode($query));
        }
    }

    public function testSimulationSelectsNestedFieldsWithoutLeakingFullObjects(): void
    {
        $simulation = new WordPressSimulation($this->data, 'http://blog.test');
        $full = $simulation->request('/wp/v2/posts/106', []);
        $partial = $simulation->request('/wp/v2/posts/106', [
            '_fields' => ' title.rendered, meta.gq_summary,content.protected,missing,meta.gq_summary ',
        ]);
        self::assertSame([
            'id' => 106, 'title' => $full['title'], 'content' => ['protected' => false],
            'meta' => ['gq_summary' => $full['meta']['gq_summary']],
        ], $partial);
        self::assertSame(['id' => 106], $simulation->request('/wp/v2/posts/106', ['_fields' => 'missing']));
        self::assertSame($full, $simulation->request('/wp/v2/posts/106', ['_fields' => ' , ']));
        $parent = $simulation->request('/wp/v2/posts/106', ['_fields' => 'meta.gq_summary,meta']);
        self::assertSame(['id' => 106, 'meta' => $full['meta']], $parent);
        self::assertSame([['id' => 1, 'slug' => 'game-start']],
            $simulation->request('/wp/v2/tags', ['slug' => 'game-start', '_fields' => 'slug']));
        $embedded = $simulation->request('/wp/v2/posts/106', [
            '_embed' => 'wp:term', '_fields' => '_links.self.href,_embedded.wp:term.slug',
        ]);
        self::assertSame(['href'], array_keys($embedded['_links']['self'][0]));
        self::assertSame([['slug' => 'game-start'], ['slug' => 'hero']], $embedded['_embedded']['wp:term'][1]);
    }

    public function testSimulationEmbedsOnlyRequestedRelationsAndKeepsNavigableLinks(): void
    {
        $simulation = new WordPressSimulation($this->data, 'http://blog.test/article', 'http://blog.test/index.php');
        $plain = $simulation->request('/wp/v2/posts/106', []);
        self::assertArrayNotHasKey('_embedded', $plain);
        self::assertSame('http://blog.test/index.php?rest_route=%2Fwp%2Fv2%2Fposts%2F106', $plain['_links']['self'][0]['href']);
        foreach (['', '1', 'true', 'wp:term', 'author,wp:term'] as $embed) {
            $post = $simulation->request('/wp/v2/posts/106', ['_embed' => $embed]);
            self::assertSame('hero', $post['_embedded']['wp:term'][1][1]['slug']);
        }
        foreach (['false', 'author'] as $embed) {
            self::assertArrayNotHasKey('_embedded', $simulation->request('/wp/v2/posts/106', ['_embed' => $embed]));
        }
        $partial = $simulation->request('/wp/v2/posts/106', ['_embed' => 'wp:term', '_fields' => 'id,_embedded']);
        self::assertSame(['id' => 106], $partial);
        self::assertSame([11], array_column($simulation->request('/wp/v2/categories', ['post' => 106]), 'id'));
        self::assertSame([1, 2], array_column($simulation->request('/wp/v2/tags', ['post' => 106]), 'id'));
        self::assertSame([], $simulation->request('/wp/v2/tags', ['post' => 108]));
    }

    public function testSimulationSupportsCombinedTaxonomyFiltersAndAscendingDateOrder(): void
    {
        $simulation = new WordPressSimulation($this->data, 'http://blog.test');
        $posts = $simulation->request('/wp/v2/posts', ['tags' => '1,3', 'categories' => '10', 'order' => 'asc']);
        self::assertSame([101, 102, 103, 104, 105], array_column($posts, 'id'));
        $posts = $simulation->request('/wp/v2/posts', ['tags' => [2], 'categories' => [11]]);
        self::assertSame([106], array_column($posts, 'id'));
        self::assertSame([], $simulation->request('/wp/v2/posts', ['tags' => '999']));
        self::assertCount(1, $simulation->request('/wp/v2/tags', ['per_page' => 1, 'page' => 2]));
    }

    public function testSimulationRejectsPagesBeyondTheFilteredCollection(): void
    {
        $simulation = new WordPressSimulation($this->data, 'http://blog.test');
        self::assertCount(1, $simulation->request('/wp/v2/posts', ['tags' => 1, 'per_page' => 5, 'page' => 2]));
        $this->expectException(RangeException::class);
        $simulation->request('/wp/v2/posts', ['tags' => 1, 'per_page' => 5, 'page' => 3]);
    }

    public function testPaginationCountsTheEntireFilteredCollectionBeforeSlicing(): void
    {
        $data = $this->data;
        for ($i = 0; $i < 120; $i++) {
            $data['posts'][] = [...$data['posts'][0], 'id' => 1000 + $i];
        }
        $simulation = new WordPressSimulation($data, 'http://blog.test');
        $posts = $simulation->request('/wp/v2/posts', ['tags' => 1, 'per_page' => 100, 'page' => 2, '_fields' => 'id'], $pagination);
        self::assertCount(26, $posts);
        self::assertSame(['total' => 126, 'total_pages' => 2], $pagination);
        $simulation->request('/wp/v2/posts', ['tags' => 999], $pagination);
        self::assertSame(['total' => 0, 'total_pages' => 0], $pagination);
        $simulation->request('/wp/v2/tags', ['post' => 106, 'per_page' => 1, 'page' => 2], $pagination);
        self::assertSame(['total' => 2, 'total_pages' => 2], $pagination);
        $simulation->request('/wp/v2/categories', ['post' => 106], $pagination);
        self::assertSame(['total' => 1, 'total_pages' => 1], $pagination);
        $simulation->request('/wp/v2/posts/106', [], $pagination);
        self::assertNull($pagination);
    }

    public function testSummaryAndTitleUseExactSharedUnicodeLimits(): void
    {
        $data = $this->data;
        $data['posts'][5]['title'] = str_repeat('ä', 161);
        $data['posts'][5]['summary'] = str_repeat('ü', 3000);
        $post = $this->source($data)->published(106, $this->targets);
        self::assertSame(160, mb_strlen($post['title']));
        self::assertSame(3000, mb_strlen($post['body']));
        self::assertTrue($post['truncated']);
        foreach (DeveloperBlogRepository::speechChunks($post) as $chunk) self::assertLessThanOrEqual(1000, mb_strlen($chunk));
        $data['posts'][5]['summary'] = '<p>Keine HTML-Kurzfassung</p>';
        $this->expectException(RuntimeException::class);
        $this->source($data)->published(106, $this->targets);
    }

    public function testAdapterIndependentlyRejectsProtectedOrPrivateUpstreamDetails(): void
    {
        $sim = new WordPressSimulation($this->data, 'http://blog.test');
        $post = $sim->request('/wp/v2/posts/106', ['_embed' => 'wp:term']);
        foreach (['private', 'protected', 'untagged'] as $variant) {
            $changed = $post;
            if ($variant === 'private') $changed['status'] = 'private';
            if ($variant === 'protected') $changed['content']['protected'] = true;
            if ($variant === 'untagged') $changed['tags'] = [2];
            $source = new WordPressBlogSource('http://internal.test', 'http://blog.test',
                static fn(string $url): array => ['status' => 200, 'body' => json_encode(
                    str_contains($url, 'slug=game-start') ? [['id' => 1, 'slug' => 'game-start']] : $changed
                )]);
            self::assertNull($source->published(106, $this->targets));
        }
    }

    public function testProtectedRecentPostsDoNotDisplaceTheFiveEligibleArticles(): void
    {
        $sim = new WordPressSimulation($this->data, 'http://blog.test');
        $posts = $sim->request('/wp/v2/posts', ['tags' => 1, 'per_page' => 100, '_embed' => 'wp:term']);
        $protected = $posts[0];
        $protected['id'] = 999;
        $protected['date_gmt'] = '2026-11-06T15:00:00';
        $protected['content']['protected'] = true;
        array_unshift($posts, $protected);
        $source = new WordPressBlogSource('http://internal.test', 'http://blog.test',
            static fn(string $url): array => ['status' => 200, 'body' => json_encode(
                str_contains($url, 'slug=game-start') ? [['id' => 1, 'slug' => 'game-start']] : $posts
            )]);
        self::assertSame([106, 105, 104, 103, 102], array_column($source->latest($this->targets), 'id'));
    }

    public function testUnknownFactionTargetIsAnExplicitError(): void
    {
        $this->expectException(RuntimeException::class);
        $this->source()->latest([]);
    }

    public function testNetworkFailureAndInvalidJsonAreNotSuccessShaped(): void
    {
        foreach ([
            ['status' => 503, 'body' => '{}'], ['status' => 200, 'body' => '<html>'],
            ['status' => 200, 'body' => 'null'], ['status' => 200, 'body' => '{"not":"a list"}'],
            ['status' => 200, 'body' => '[null]'],
        ] as $response) {
            $source = new WordPressBlogSource('http://internal.test', 'http://blog.test', static fn() => $response);
            try {
                $source->latest([]);
                self::fail('Invalid response accepted');
            } catch (RuntimeException $error) {
                self::assertNotSame('', $error->getMessage());
            }
        }
    }

    public function testOriginalLinksCannotPointToAnUnconfiguredSite(): void
    {
        $simulation = new WordPressSimulation($this->data, 'https://other.test/blog');
        $source = new WordPressBlogSource('http://internal.test', 'http://blog.test',
            static function (string $url) use ($simulation): array {
                parse_str(parse_url($url, PHP_URL_QUERY), $query);
                return ['status' => 200, 'body' => json_encode($simulation->request($query['rest_route'], $query))];
            });
        $this->expectException(RuntimeException::class);
        $source->latest($this->targets);
    }
}
