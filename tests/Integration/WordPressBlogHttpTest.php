<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/WordPressBlogSource.php';
require_once __DIR__ . '/../../lib/WordPressSimulation.php';

final class WordPressBlogHttpTest extends TestCase
{
    private string $directory = '';
    private string $fixture = '';
    private string $baseUrl = '';
    private mixed $server = null;
    private array $data = [];
    private array $targets = [['faction_id' => 8, 'code' => 'aereth']];

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'gq-wordpress-http-' . bin2hex(random_bytes(8));
        self::assertTrue(mkdir($this->directory, 0700));
        $this->fixture = $this->directory . DIRECTORY_SEPARATOR . 'state.json';
        $this->data = json_decode(file_get_contents(__DIR__ . '/../../config/wordpress_simulation.json'), true, 512, JSON_THROW_ON_ERROR);
        $this->writeState();
        $socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        self::assertIsResource($socket, $error);
        $address = stream_socket_get_name($socket, false);
        fclose($socket);
        self::assertIsString($address);
        $this->baseUrl = 'http://' . $address;
        $this->server = proc_open([
            PHP_BINARY, '-d', 'display_errors=0', '-d', 'log_errors=1',
            '-S', $address, '-t', $this->directory, __DIR__ . '/wordpress_http_router.php',
        ], [
            0 => ['pipe', 'r'],
            1 => ['file', $this->directory . DIRECTORY_SEPARATOR . 'stdout.log', 'a'],
            2 => ['file', $this->directory . DIRECTORY_SEPARATOR . 'stderr.log', 'a'],
        ], $pipes, dirname(__DIR__, 2), array_merge(getenv(), [
            'GQ_WORDPRESS_HTTP_FIXTURE' => $this->fixture, 'XDEBUG_MODE' => 'off',
        ]));
        self::assertIsResource($this->server);
        fclose($pipes[0]);
        $deadline = microtime(true) + 10;
        do {
            $probe = @stream_socket_client('tcp://' . $address, $errno, $error, 0.1);
            if (is_resource($probe)) {
                fclose($probe);
                return;
            }
            self::assertTrue(proc_get_status($this->server)['running'], $this->serverLog());
            usleep(20000);
        } while (microtime(true) < $deadline);
        self::fail('WordPress HTTP test server was not ready: ' . $this->serverLog());
    }

    protected function tearDown(): void
    {
        if (is_resource($this->server)) {
            proc_terminate($this->server);
            proc_close($this->server);
        }
        foreach (['state.json', 'state.json.redirected', 'stdout.log', 'stderr.log'] as $name) {
            $file = $this->directory . DIRECTORY_SEPARATOR . $name;
            if ($this->directory !== '' && is_file($file)) unlink($file);
        }
        if ($this->directory !== '' && is_dir($this->directory)) rmdir($this->directory);
    }

    private function source(): WordPressBlogSource
    {
        return new WordPressBlogSource($this->baseUrl . '/index.php', $this->baseUrl);
    }

    private function writeState(array $overrides = []): void
    {
        self::assertNotFalse(file_put_contents($this->fixture,
            json_encode(['data' => $this->data, ...$overrides], JSON_THROW_ON_ERROR), LOCK_EX));
    }

    private function serverLog(): string
    {
        $file = $this->directory . DIRECTORY_SEPARATOR . 'stderr.log';
        return is_file($file) ? file_get_contents($file) : 'No server log.';
    }

    private function assertSourceFailure(Closure $operation, string $message): void
    {
        try {
            $operation();
        } catch (RuntimeException $error) {
            self::assertStringContainsString($message, $error->getMessage());
            return;
        }
        self::fail('WordPress failure was accepted.');
    }

    public function testRealHttpFeedMapsOnlyTheLatestEligiblePosts(): void
    {
        $source = $this->source();
        $posts = $source->latest($this->targets);
        self::assertSame([106, 105, 104, 103, 102], array_column($posts, 'id'));
        self::assertSame(['fraktionen'], $posts[0]['categories']);
        self::assertContains('hero', $posts[0]['tags']);
        self::assertSame(8, $posts[0]['target_faction_id']);
        self::assertSame($this->baseUrl . '/blog?p=106', $posts[0]['original_url']);
        self::assertSame($posts[0], $source->published(106, $this->targets));
        foreach ([107, 108, 109, 110, 999] as $id) {
            self::assertNull($source->published($id, $this->targets));
        }
    }

    public function testPrettyRestBasesMatchQueryRoutesAndRevalidateWithdrawal(): void
    {
        $expected = $this->source()->latest($this->targets);
        foreach (['/wp-json', '/wp-json/', '/blog/wp-json/'] as $path) {
            $source = new WordPressBlogSource($this->baseUrl . $path, $this->baseUrl);
            self::assertSame($expected, $source->latest($this->targets));
            self::assertSame($expected[0], $source->published(106, $this->targets));
            self::assertNull($source->published(999, $this->targets));
            $this->data['posts'][5]['tags'] = [2];
            $this->writeState();
            self::assertNull($source->published(106, $this->targets));
            self::assertSame([105, 104, 103, 102, 101], array_column($source->latest($this->targets), 'id'));
            $this->data['posts'][5]['tags'] = [1, 2];
            $this->writeState();
        }
    }

    public function testSameSourceSeesEditsWithdrawalAndRepublicationImmediately(): void
    {
        $source = $this->source();
        $before = $source->published(106, $this->targets);
        $this->data['posts'][5]['summary'] = 'Neue Kurzfassung in derselben Sekunde.';
        $this->writeState();
        $after = $source->published(106, $this->targets);
        self::assertSame($before['updated_at'], $after['updated_at']);
        self::assertNotSame($before['revision'], $after['revision']);
        self::assertSame('Neue Kurzfassung in derselben Sekunde.', $after['body']);
        $this->data['posts'][5]['tags'] = [2];
        $this->writeState();
        self::assertNull($source->published(106, $this->targets));
        self::assertSame([105, 104, 103, 102, 101], array_column($source->latest($this->targets), 'id'));
        $this->data['posts'][5]['tags'] = [1, 2];
        $this->writeState();
        self::assertSame($after['revision'], $source->published(106, $this->targets)['revision']);
    }

    public function testSourceFailuresAreExplicitAndRecoverWithoutRestartOrLocalFallback(): void
    {
        $source = $this->source();
        foreach (['unavailable' => 'HTTP 503', 'invalid-json' => 'JSON'] as $mode => $message) {
            $this->writeState(['mode' => $mode]);
            $this->assertSourceFailure(fn() => $source->latest($this->targets), $message);
            $this->assertSourceFailure(fn() => $source->published(106, $this->targets), $message);
            $this->writeState();
            self::assertCount(5, $source->latest($this->targets));
        }
    }

    public function testMissingRoutesAndHtml404DoNotMasqueradeAsWithdrawnPosts(): void
    {
        foreach (['/index.php', '/wp-json'] as $base) {
            $source = new WordPressBlogSource($this->baseUrl . $base, $this->baseUrl);
            foreach (['missing-route' => 'HTTP 404', 'html-404' => 'JSON', 'empty-post' => 'Beitrags-ID'] as $mode => $message) {
                $this->writeState(['mode' => $mode]);
                $this->assertSourceFailure(fn() => $source->published(106, $this->targets), $message);
                $this->writeState();
                self::assertNotNull($source->published(106, $this->targets));
            }
            self::assertNull($source->published(999, $this->targets));
        }
    }

    public function testRedirectsAreNotFollowed(): void
    {
        $this->writeState(['mode' => 'redirect']);
        $this->assertSourceFailure(fn() => $this->source()->latest($this->targets), 'HTTP 302');
        self::assertFileDoesNotExist($this->fixture . '.redirected');
    }

    public function testSlowUpstreamIsStoppedByTheRealRequestTimeout(): void
    {
        $this->writeState(['mode' => 'slow']);
        $start = microtime(true);
        $this->assertSourceFailure(fn() => $this->source()->latest($this->targets), 'Anfrage fehlgeschlagen');
        self::assertGreaterThanOrEqual(5.5, microtime(true) - $start);
        self::assertLessThan(8, microtime(true) - $start, 'The adapter waited for the upstream instead of timing out.');
    }

    public function testConnectionFailureIsNotAnEmptyFeed(): void
    {
        proc_terminate($this->server);
        proc_close($this->server);
        $this->server = null;
        $this->assertSourceFailure(fn() => $this->source()->latest($this->targets), 'Anfrage fehlgeschlagen');
    }

    public function testStreamedResponseAcceptsExactlyOneMiBAndRejectsOneExtraByte(): void
    {
        $this->writeState(['mode' => 'sized-response', 'bytes' => 1048576]);
        self::assertSame([], $this->source()->latest($this->targets));
        $this->writeState(['mode' => 'sized-response', 'bytes' => 1048577]);
        $this->assertSourceFailure(fn() => $this->source()->latest($this->targets), 'Größenlimit');
    }

    public function testFullBlogBodyIsExcludedFromTheRealHttpPayload(): void
    {
        $this->data['posts'][5]['body'] = str_repeat('Langer Blogvolltext. ', 100000);
        $this->writeState();
        $post = $this->source()->published(106, $this->targets);
        self::assertSame($this->data['posts'][5]['summary'], $post['body']);
        self::assertCount(5, $this->source()->latest($this->targets));
    }

    public function testCategoryNamedHeroDoesNotBecomeAHighlightTag(): void
    {
        $post = (new WordPressSimulation($this->data, $this->baseUrl . '/blog'))->request('/wp/v2/posts/106', ['_embed' => 'wp:term']);
        $post['tags'] = [1, 2];
        $post['categories'] = [2];
        $post['_embedded']['wp:term'] = [
            [['id' => 2, 'slug' => 'hero', 'taxonomy' => 'category']],
            [
                ['id' => 1, 'slug' => 'game-start', 'taxonomy' => 'post_tag'],
                ['id' => 2, 'slug' => 'audio', 'taxonomy' => 'post_tag'],
            ],
        ];
        $this->writeState(['mode' => 'raw-post', 'post' => $post]);
        $mapped = $this->source()->published(106, $this->targets);
        self::assertSame(['hero'], $mapped['categories']);
        self::assertSame(['game-start', 'audio'], $mapped['tags']);
    }

    public function testMalformedTermMetadataIsAnExplicitSourceError(): void
    {
        $post = (new WordPressSimulation($this->data, $this->baseUrl . '/blog'))->request('/wp/v2/posts/106', ['_embed' => 'wp:term']);
        $post['_embedded']['wp:term'][1][1]['slug'] = [];
        $this->writeState(['mode' => 'raw-post', 'post' => $post]);
        $this->assertSourceFailure(fn() => $this->source()->published(106, $this->targets), 'Taxonomie');
    }

    public function testIncompleteOrConflictingEmbeddedTermsCannotSilentlyLoseHeroMetadata(): void
    {
        $post = (new WordPressSimulation($this->data, $this->baseUrl . '/blog'))->request('/wp/v2/posts/106', ['_embed' => 'wp:term']);
        foreach (['missing-hero', 'missing-category', 'conflicting-hero', 'wrong-start-slug'] as $variant) {
            $changed = $post;
            if ($variant === 'missing-hero') array_pop($changed['_embedded']['wp:term'][1]);
            if ($variant === 'missing-category') $changed['_embedded']['wp:term'][0] = [];
            if ($variant === 'conflicting-hero') {
                $changed['_embedded']['wp:term'][1][] = ['id' => 2, 'slug' => 'audio', 'taxonomy' => 'post_tag'];
            }
            if ($variant === 'wrong-start-slug') $changed['_embedded']['wp:term'][1][0]['slug'] = 'other';
            $this->writeState(['mode' => 'raw-post', 'post' => $changed]);
            $this->assertSourceFailure(fn() => $this->source()->published(106, $this->targets),
                $variant === 'wrong-start-slug' ? 'Spielstartfreigabe' : 'Taxonomie');
        }
        $post['_embedded']['wp:term'][1][] = $post['_embedded']['wp:term'][1][1];
        $this->writeState(['mode' => 'raw-post', 'post' => $post]);
        $before = $this->source()->published(106, $this->targets);
        self::assertSame(['game-start', 'hero'], $before['tags']);
        $post['_embedded']['wp:term'] = array_reverse($post['_embedded']['wp:term']);
        $post['_embedded']['wp:term'][0] = array_reverse($post['_embedded']['wp:term'][0]);
        $this->writeState(['mode' => 'raw-post', 'post' => $post]);
        self::assertSame($before, $this->source()->published(106, $this->targets));
    }

    public function testInvalidCalendarDatesNeverBecomePublicationOrRevisionData(): void
    {
        $post = (new WordPressSimulation($this->data, $this->baseUrl . '/blog'))->request('/wp/v2/posts/106', ['_embed' => 'wp:term']);
        foreach (['date_gmt', 'modified_gmt'] as $field) {
            $changed = $post;
            $changed[$field] = '2026-02-31T10:00:00';
            $this->writeState(['mode' => 'raw-post', 'post' => $changed]);
            $this->assertSourceFailure(fn() => $this->source()->published(106, $this->targets), 'Spieldaten');
        }
    }

    public function testInvalidRestParametersReturnStructuredHttp400Errors(): void
    {
        foreach ([
            ['query' => ['per_page' => 101], 'code' => 'rest_invalid_param'],
            ['query' => ['tags' => '1,invalid'], 'code' => 'rest_invalid_param'],
            ['query' => ['page' => 3, 'tags' => 1, 'per_page' => 5], 'code' => 'rest_post_invalid_page_number'],
        ] as $case) {
            $handle = curl_init($this->baseUrl . '/index.php?' . http_build_query([
                'rest_route' => '/wp/v2/posts', ...$case['query'],
            ]));
            self::assertNotFalse($handle);
            try {
                curl_setopt_array($handle, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3]);
                $body = curl_exec($handle);
                self::assertIsString($body);
                self::assertSame(400, curl_getinfo($handle, CURLINFO_RESPONSE_CODE));
                $data = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
                self::assertSame($case['code'], $data['code']);
                self::assertSame(400, $data['data']['status']);
                self::assertNotSame('', $data['message']);
            } finally {
                curl_close($handle);
            }
        }

    }

    public function testRealHttpEmbeddingLinksResolveToTheArticleTaxonomies(): void
    {
        $get = static function (string $url): array {
            $handle = curl_init($url);
            self::assertNotFalse($handle);
            try {
                curl_setopt_array($handle, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3]);
                $body = curl_exec($handle);
                self::assertIsString($body);
                self::assertSame(200, curl_getinfo($handle, CURLINFO_RESPONSE_CODE));
                return json_decode($body, true, 512, JSON_THROW_ON_ERROR);
            } finally {
                curl_close($handle);
            }
        };
        $plain = $get($this->baseUrl . '/index.php?rest_route=/wp/v2/posts/106');
        self::assertArrayNotHasKey('_embedded', $plain);
        self::assertSame(106, $get($plain['_links']['self'][0]['href'])['id']);
        $embedded = $get($plain['_links']['self'][0]['href'] . '&_embed=wp:term');
        foreach ($plain['_links']['wp:term'] as $index => $link) {
            self::assertTrue($link['embeddable']);
            self::assertSame(array_column($embedded['_embedded']['wp:term'][$index], 'id'),
                array_column($get($link['href']), 'id'));
        }
        $partial = $get($plain['_links']['self'][0]['href'] . '&_embed=wp:term&_fields=id');
        self::assertSame(['id' => 106], $partial);
        $nested = $get($plain['_links']['self'][0]['href']
            . '&_fields=title.rendered,meta.gq_summary,content.protected');
        self::assertSame([
            'id' => 106, 'title' => $plain['title'], 'content' => ['protected' => false],
            'meta' => ['gq_summary' => $plain['meta']['gq_summary']],
        ], $nested);
        $terms = $get($plain['_links']['wp:term'][1]['href'] . '&_fields=slug');
        self::assertSame([['id' => 1, 'slug' => 'game-start'], ['id' => 2, 'slug' => 'hero']], $terms);
    }

    public function testHttpPaginationHeadersCountBeyondOneHundredAndApplyTermFilters(): void
    {
        for ($i = 0; $i < 120; $i++) {
            $this->data['posts'][] = [...$this->data['posts'][0], 'id' => 1000 + $i];
        }
        $this->writeState();
        foreach ([
            ['/wp/v2/posts', ['tags' => 1, 'per_page' => 100, 'page' => 2, '_fields' => 'id'], 126, 2, 26],
            ['/wp/v2/tags', ['post' => 106, 'per_page' => 1, 'page' => 2], 2, 2, 1],
            ['/wp/v2/categories', ['post' => 106], 1, 1, 1],
            ['/wp/v2/posts', ['tags' => 999], 0, 0, 0],
        ] as [$route, $query, $total, $pages, $count]) {
            $headers = [];
            $handle = curl_init($this->baseUrl . '/index.php?' . http_build_query(['rest_route' => $route, ...$query]));
            self::assertNotFalse($handle);
            try {
                curl_setopt_array($handle, [
                    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3,
                    CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$headers): int {
                        if (str_contains($line, ':')) {
                            [$name, $value] = explode(':', $line, 2);
                            $headers[strtolower($name)] = trim($value);
                        }
                        return strlen($line);
                    },
                ]);
                $body = curl_exec($handle);
                self::assertIsString($body);
                self::assertSame(200, curl_getinfo($handle, CURLINFO_RESPONSE_CODE));
                self::assertSame((string)$total, $headers['x-wp-total']);
                self::assertSame((string)$pages, $headers['x-wp-totalpages']);
                self::assertCount($count, json_decode($body, true, 512, JSON_THROW_ON_ERROR));
            } finally {
                curl_close($handle);
            }
        }
    }
}
