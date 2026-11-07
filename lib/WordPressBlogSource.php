<?php

declare(strict_types=1);

require_once __DIR__ . '/DeveloperBlogRepository.php';

final class WordPressBlogSource
{
    private const POST_FIELDS =
        'id,date_gmt,modified_gmt,status,type,link,title,content.protected,excerpt.protected,'
        . 'categories,tags,meta,_embedded,_links';
    private Closure $transport;

    public function __construct(private string $restUrl, private string $siteUrl, ?Closure $transport = null)
    {
        foreach ([$restUrl, $siteUrl] as $url) {
            $parts = parse_url($url);
            if (
                !is_array($parts) || !in_array($parts['scheme'] ?? '', ['http', 'https'], true)
                || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])
                || isset($parts['query']) || isset($parts['fragment'])
            ) {
                throw new InvalidArgumentException('Ungültige WordPress-URL in der Serverkonfiguration.');
            }
        }
        $this->restUrl = rtrim($this->restUrl, '/');
        $this->transport = $transport ?? self::http(...);
    }

    public function latest(array $flightTargets): array
    {
        $tag = $this->startTag();
        if ($tag === null) {
            return [];
        }
        $posts = $this->request('/wp/v2/posts', [
            'tags' => $tag,
            'status' => 'publish',
            'per_page' => 100,
            'orderby' => 'date',
            'order' => 'desc',
            '_embed' => 'wp:term',
            '_fields' => self::POST_FIELDS,
        ]);
        if (
            !array_is_list($posts) || count($posts) > 100
            || array_filter($posts, static fn(mixed $post): bool => !is_array($post)) !== []
        ) {
            throw new RuntimeException('Ungültige WordPress-Beitragsliste.');
        }
        usort($posts, static fn(array $a, array $b): int =>
            [$b['date_gmt'] ?? '', $b['id'] ?? 0] <=> [$a['date_gmt'] ?? '', $a['id'] ?? 0]);
        $result = [];
        foreach ($posts as $post) {
            $mapped = $this->map($post, $tag, $flightTargets);
            if ($mapped !== null) {
                $result[] = $mapped;
            }
            if (count($result) === 5) {
                break;
            }
        }
        if (count($result) < 5 && count($posts) === 100) {
            throw new RuntimeException('WordPress-Auswahl überschreitet das Prüflimit von 100 Beiträgen.');
        }
        return $result;
    }

    public function published(int $id, array $flightTargets): ?array
    {
        $tag = $this->startTag();
        if ($tag === null) {
            return null;
        }
        $post = $this->request('/wp/v2/posts/' . $id, ['_embed' => 'wp:term', '_fields' => self::POST_FIELDS]);
        if (($post['code'] ?? null) === 'rest_post_invalid_id') {
            return null;
        }
        if (($post['id'] ?? null) !== $id) {
            throw new RuntimeException('WordPress lieferte eine falsche Beitrags-ID.');
        }
        return $this->map($post, $tag, $flightTargets);
    }

    private function startTag(): ?int
    {
        $tags = $this->request('/wp/v2/tags', ['slug' => 'game-start']);
        if (!array_is_list($tags)) {
            throw new RuntimeException('Ungültiger WordPress-Tagkatalog.');
        }
        foreach ($tags as $tag) {
            if (!is_array($tag) || !is_string($tag['slug'] ?? null) || !is_int($tag['id'] ?? null) || $tag['id'] < 1) {
                throw new RuntimeException('Ungültiger WordPress-Tagkatalog.');
            }
            if ($tag['slug'] === 'game-start') {
                return $tag['id'];
            }
        }
        return null;
    }

    private function map(mixed $post, int $tag, array $flightTargets): ?array
    {
        if (!is_array($post) || !is_string($post['status'] ?? null) || !is_string($post['type'] ?? null)) {
            throw new RuntimeException('Ungültiger WordPress-Beitrag.');
        }
        if ($post['status'] !== 'publish' || $post['type'] !== 'post') {
            return null;
        }
        if (
            !is_bool($post['content']['protected'] ?? null) || !is_bool($post['excerpt']['protected'] ?? null)
            || !is_array($post['tags'] ?? null) || !is_array($post['categories'] ?? null)
        ) {
            throw new RuntimeException('Unvollständige WordPress-Freigabedaten.');
        }
        foreach (['tags', 'categories'] as $taxonomy) {
            if (
                !array_is_list($post[$taxonomy]) || array_filter(
                    $post[$taxonomy],
                    static fn(mixed $id): bool => !is_int($id) || $id < 1
                ) !== []
            ) {
                throw new RuntimeException('Ungültige WordPress-Taxonomie-IDs.');
            }
        }
        if ($post['content']['protected'] || $post['excerpt']['protected'] || !in_array($tag, $post['tags'], true)) {
            return null;
        }
        $title = $post['title']['rendered'] ?? null;
        $summary = $post['meta']['gq_summary'] ?? null;
        $date = $post['date_gmt'] ?? null;
        $modified = $post['modified_gmt'] ?? null;
        $link = $post['link'] ?? null;
        if (
            !is_int($post['id'] ?? null) || $post['id'] < 1 || !is_string($title)
            || !is_string($summary) || trim($summary) === ''
            || mb_strlen($summary) > DeveloperBlogRepository::MAX_BODY_CHARS
            || strip_tags($summary) !== $summary
            || !self::validDate($date) || !self::validDate($modified)
            || !is_string($link) || !$this->sameSite($link)
        ) {
            throw new RuntimeException(
                'WordPress-Beitrag hat ungültige Spieldaten oder keine gültige Spiel-Kurzfassung.'
            );
        }
        $termsByTaxonomy = ['category' => [], 'post_tag' => []];
        $groups = $post['_embedded']['wp:term'] ?? null;
        if (!is_array($groups) || !array_is_list($groups)) {
            throw new RuntimeException('WordPress-Taxonomie fehlt. REST-Embedding ist erforderlich.');
        }
        foreach ($groups as $group) {
            if (!is_array($group) || !array_is_list($group)) {
                throw new RuntimeException('Ungültige WordPress-Taxonomie.');
            }
            foreach ($group as $term) {
                if (
                    !is_array($term) || !is_string($term['slug'] ?? null) || trim($term['slug']) === ''
                    || !is_int($term['id'] ?? null) || $term['id'] < 1 || !is_string($term['taxonomy'] ?? null)
                ) {
                    throw new RuntimeException('Ungültige WordPress-Taxonomie.');
                }
                if (isset($termsByTaxonomy[$term['taxonomy']])) {
                    $existing = $termsByTaxonomy[$term['taxonomy']][$term['id']] ?? null;
                    if ($existing !== null && $existing !== $term['slug']) {
                        throw new RuntimeException('Widersprüchliche WordPress-Taxonomie.');
                    }
                    $termsByTaxonomy[$term['taxonomy']][$term['id']] = $term['slug'];
                }
            }
        }
        foreach (['category' => 'categories', 'post_tag' => 'tags'] as $taxonomy => $field) {
            if (array_diff($post[$field], array_keys($termsByTaxonomy[$taxonomy])) !== []) {
                throw new RuntimeException('Unvollständige WordPress-Taxonomie.');
            }
        }
        if (($termsByTaxonomy['post_tag'][$tag] ?? null) !== 'game-start') {
            throw new RuntimeException('Widersprüchliche WordPress-Spielstartfreigabe.');
        }
        $categories = array_map(
            static fn(int $id): string => mb_substr($termsByTaxonomy['category'][$id], 0, 32),
            $post['categories']
        );
        $tags = array_map(
            static fn(int $id): string => mb_substr($termsByTaxonomy['post_tag'][$id], 0, 32),
            $post['tags']
        );
        $tags = array_values(array_unique(['game-start', ...array_intersect(['hero'], $tags), ...$tags]));
        $code = $post['meta']['gq_target_faction_code'] ?? '';
        if (!is_string($code)) {
            throw new RuntimeException('Ungültiges WordPress-Flugziel.');
        }
        $targetId = null;
        foreach ($flightTargets as $target) {
            if ($code !== '' && $target['code'] === $code) {
                $targetId = $target['faction_id'];
            }
        }
        if ($code !== '' && $targetId === null) {
            throw new RuntimeException('WordPress-Flugziel ist im öffentlichen Katalog nicht verfügbar.');
        }
        $plainTitle = trim(html_entity_decode(strip_tags($title), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($plainTitle === '') {
            throw new RuntimeException('WordPress-Beitrag hat keinen Titel.');
        }
        $mapped = [
            'id' => $post['id'],
            'title' => mb_substr($plainTitle, 0, DeveloperBlogRepository::MAX_TITLE_CHARS),
            'body' => trim($summary),
            'published_at' => str_replace('T', ' ', $date), 'updated_at' => $modified,
            'categories' => array_slice(array_values(array_unique($categories)), 0, 5),
            'tags' => array_slice($tags, 0, 10),
            'target_faction_id' => $targetId, 'original_url' => $link,
            'truncated' => mb_strlen($plainTitle) > DeveloperBlogRepository::MAX_TITLE_CHARS,
        ];
        $mapped['revision'] = 'wp:' . hash(
            'sha256',
            json_encode($mapped, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)
        );
        return $mapped;
    }

    private static function validDate(mixed $value): bool
    {
        if (!is_string($value) || !preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/D', $value)) {
            return false;
        }
        $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s', $value, new DateTimeZone('UTC'));
        return $date !== false && $date->format('Y-m-d\TH:i:s') === $value;
    }

    private function sameSite(string $url): bool
    {
        $parts = parse_url($url);
        $site = parse_url($this->siteUrl);
        return is_array($parts) && !isset($parts['user']) && !isset($parts['pass'])
            && ($parts['scheme'] ?? '') === $site['scheme'] && ($parts['host'] ?? '') === $site['host']
            && ($parts['port'] ?? null) === ($site['port'] ?? null);
    }

    private function request(string $route, array $query): array
    {
        $path = parse_url($this->restUrl, PHP_URL_PATH) ?? '';
        $url = str_ends_with($path, '/wp-json')
            ? $this->restUrl . $route . '?' . http_build_query($query)
            : $this->restUrl . '?' . http_build_query(['rest_route' => $route, ...$query]);
        $response = ($this->transport)($url);
        $missingPost = $response['status'] === 404 && str_starts_with($route, '/wp/v2/posts/');
        if ($response['status'] !== 200 && !$missingPost) {
            throw new RuntimeException('WordPress nicht erreichbar (HTTP ' . $response['status'] . ').');
        }
        try {
            $data = json_decode($response['body'], true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('WordPress lieferte ungültiges JSON.', 0, $error);
        }
        if (!is_array($data)) {
            throw new RuntimeException('Ungültige WordPress-Antwort.');
        }
        if ($missingPost) {
            if (($data['code'] ?? null) !== 'rest_post_invalid_id') {
                throw new RuntimeException('WordPress-Beitragsroute nicht erreichbar (HTTP 404).');
            }
            return ['code' => 'rest_post_invalid_id'];
        }
        if (isset($data['code'])) {
            throw new RuntimeException('WordPress lieferte eine Fehlerantwort ohne HTTP-Fehlerstatus.');
        }
        return $data;
    }

    private static function http(string $url): array
    {
        $handle = curl_init($url);
        if ($handle === false) {
            throw new RuntimeException('WordPress-HTTP-Client konnte nicht gestartet werden.');
        }
        $body = '';
        $oversized = false;
        curl_setopt_array($handle, [
            CURLOPT_CONNECTTIMEOUT => 2, CURLOPT_TIMEOUT => 6,
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body, &$oversized): int {
                if (strlen($body) + strlen($chunk) > 1048576) {
                    $oversized = true;
                    return 0;
                }
                $body .= $chunk;
                return strlen($chunk);
            },
        ]);
        try {
            $ok = curl_exec($handle);
            if ($oversized) {
                throw new RuntimeException('WordPress-Antwort überschreitet das Größenlimit.');
            }
            if ($ok === false) {
                throw new RuntimeException('WordPress-Anfrage fehlgeschlagen: ' . curl_error($handle));
            }
            return ['status' => (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE), 'body' => $body];
        } finally {
            curl_close($handle);
        }
    }
}
