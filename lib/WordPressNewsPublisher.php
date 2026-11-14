<?php

declare(strict_types=1);

/** Creates Galaxy News Radio posts (with MP3 attachment) through the authenticated WordPress REST API. */
final class WordPressNewsPublisher
{
    private Closure $transport;

    /** @param ?Closure(string,string,array<int,string>,string):array{status:int,body:string} $transport */
    public function __construct(
        private string $restUrl,
        private string $user,
        private string $appPassword,
        ?Closure $transport = null
    ) {
        $parts = parse_url($restUrl);
        if (!is_array($parts) || !in_array($parts['scheme'] ?? '', ['http', 'https'], true)
            || empty($parts['host']) || isset($parts['user']) || isset($parts['query'])) {
            throw new InvalidArgumentException('Ungültige WordPress-REST-URL.');
        }
        if ($user === '' || $appPassword === '') {
            throw new InvalidArgumentException('WordPress-Benutzer und Anwendungspasswort sind erforderlich.');
        }
        $this->restUrl = rtrim($restUrl, '/');
        $this->transport = $transport ?? self::http(...);
    }

    public function existingPostId(string $slug): ?int
    {
        $posts = $this->json('GET', '/wp/v2/posts', ['slug' => $slug, 'status' => 'any', '_fields' => 'id']);
        if (!array_is_list($posts)) {
            throw new RuntimeException('Ungültige WordPress-Beitragsliste.');
        }
        return isset($posts[0]['id']) && is_int($posts[0]['id']) ? $posts[0]['id'] : null;
    }

    public function termId(string $taxonomy, string $slug): int
    {
        $route = $taxonomy === 'tag' ? '/wp/v2/tags' : '/wp/v2/categories';
        $terms = $this->json('GET', $route, ['slug' => $slug, '_fields' => 'id,slug']);
        foreach ($terms as $term) {
            if (is_array($term) && ($term['slug'] ?? null) === $slug && is_int($term['id'] ?? null)) {
                return $term['id'];
            }
        }
        throw new RuntimeException("WordPress-Begriff '$slug' existiert nicht.");
    }

    /** @return array{id:int,revision:string,subject:string,html:string} */
    public function mailTemplate(int $id): array
    {
        $parts = parse_url($this->restUrl);
        $local = function_exists('app_is_development') && app_is_development()
            && in_array(strtolower((string)($parts['host'] ?? '')), ['localhost', '127.0.0.1', '::1'], true);
        if (($parts['scheme'] ?? '') !== 'https' && !$local) {
            throw new RuntimeException('Mailvorlagen benötigen HTTPS außerhalb der lokalen Entwicklung.');
        }
        if ($id < 1) {
            throw new InvalidArgumentException('Ungültige Mailvorlage.');
        }
        $data = $this->json('GET', '/gq/v1/mail-templates/' . $id, []);
        if (($data['id'] ?? null) !== $id || !is_string($data['revision'] ?? null)
            || !preg_match('/^[a-f0-9]{64}$/D', $data['revision'])
            || !is_string($data['subject'] ?? null) || trim($data['subject']) === ''
            || mb_strlen($data['subject']) > 200 || preg_match('/[\r\n]/', $data['subject'])
            || !is_string($data['html'] ?? null) || trim($data['html']) === ''
            || strlen($data['html']) > 262144) {
            throw new RuntimeException('Ungültige WordPress-Mailvorlage.');
        }
        return ['id' => $id, 'revision' => $data['revision'], 'subject' => $data['subject'], 'html' => $data['html']];
    }

    /** @return array{id:int,url:string} */
    public function uploadAudio(string $bytes, string $filename): array
    {
        $media = $this->json('POST', '/wp/v2/media', ['_fields' => 'id,source_url'], $bytes, [
            'Content-Type: audio/mpeg',
            'Content-Disposition: attachment; filename="' . $filename . '"',
        ]);
        if (!is_int($media['id'] ?? null) || !is_string($media['source_url'] ?? null)) {
            throw new RuntimeException('Ungültige WordPress-Medienantwort.');
        }
        return ['id' => $media['id'], 'url' => $media['source_url']];
    }

    /**
     * @param list<string> $lines
     * @param array{id:int,url:string} $audio
     * @return array{id:int,link:string,status:string}
     */
    public function createPost(
        string $slug,
        string $title,
        array $lines,
        string $script,
        array $audio,
        string $status,
        int $categoryId,
        int $tagId,
        array $extraTagIds = []
    ): array {
        if (!in_array($status, ['draft', 'publish'], true)) {
            throw new InvalidArgumentException('Ungültiger Beitragsstatus.');
        }
        $url = htmlspecialchars($audio['url'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $content = sprintf(
            "<!-- wp:audio {\"id\":%d} -->\n<figure class=\"wp-block-audio\"><audio controls src=\"%s\"></audio></figure>\n<!-- /wp:audio -->\n",
            $audio['id'],
            $url
        );
        foreach ($lines as $line) {
            $content .= "<!-- wp:paragraph -->\n<p>" . htmlspecialchars($line, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')
                . "</p>\n<!-- /wp:paragraph -->\n";
        }
        $post = $this->json('POST', '/wp/v2/posts', ['_fields' => 'id,link,status'], json_encode([
            'slug' => $slug, 'title' => $title, 'status' => $status, 'content' => $content,
            'categories' => [$categoryId], 'tags' => array_values(array_unique([$tagId, ...$extraTagIds])), 'meta' => ['gq_summary' => $script],
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), ['Content-Type: application/json']);
        if (!is_int($post['id'] ?? null) || !is_string($post['link'] ?? null) || !is_string($post['status'] ?? null)) {
            throw new RuntimeException('Ungültige WordPress-Beitragsantwort.');
        }
        return ['id' => $post['id'], 'link' => $post['link'], 'status' => $post['status']];
    }

    /**
     * Chronicle entry (no audio) for the history book; summary and event date feed the chronology.
     * @return array{id:int,link:string,status:string}
     */
    public function createChronicleEntry(
        string $slug,
        string $title,
        string $summary,
        string $eventDate,
        string $status,
        int $categoryId,
        int $tagId
    ): array {
        if (!in_array($status, ['draft', 'publish'], true)) {
            throw new InvalidArgumentException('Ungültiger Beitragsstatus.');
        }
        $post = $this->json('POST', '/wp/v2/posts', ['_fields' => 'id,link,status'], json_encode([
            'slug' => $slug, 'title' => $title, 'status' => $status,
            'content' => "<!-- wp:paragraph -->\n<p>" . htmlspecialchars($summary, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')
                . "</p>\n<!-- /wp:paragraph -->\n",
            'categories' => [$categoryId], 'tags' => [$tagId],
            'meta' => ['gq_summary' => $summary, 'gq_event_date' => $eventDate, 'gq_event_origin' => 'game-event'],
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), ['Content-Type: application/json']);
        if (!is_int($post['id'] ?? null) || !is_string($post['link'] ?? null) || !is_string($post['status'] ?? null)) {
            throw new RuntimeException('Ungültige WordPress-Beitragsantwort.');
        }
        return ['id' => $post['id'], 'link' => $post['link'], 'status' => $post['status']];
    }

    /** @param array<string,string> $query @param list<string> $headers */
    private function json(string $method, string $route, array $query, string $body = '', array $headers = []): array
    {
        $path = parse_url($this->restUrl, PHP_URL_PATH) ?? '';
        $url = str_ends_with($path, '/wp-json')
            ? $this->restUrl . $route . '?' . http_build_query($query)
            : $this->restUrl . '?' . http_build_query(['rest_route' => $route, ...$query]);
        $headers[] = 'Accept: application/json';
        $headers[] = 'Authorization: Basic ' . base64_encode($this->user . ':' . $this->appPassword);
        $response = ($this->transport)($method, $url, $headers, $body);
        $data = json_decode($response['body'], true);
        if ($response['status'] < 200 || $response['status'] >= 300 || !is_array($data)) {
            $code = is_array($data) && is_string($data['code'] ?? null) ? $data['code'] : 'unbekannt';
            throw new RuntimeException("WordPress-Anfrage $method $route fehlgeschlagen (HTTP {$response['status']}, $code).");
        }
        return $data;
    }

    private static function http(string $method, string $url, array $headers, string $body): array
    {
        $handle = curl_init($url);
        if ($handle === false) {
            throw new RuntimeException('WordPress-HTTP-Client konnte nicht gestartet werden.');
        }
        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 60,
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers,
        ]);
        if ($body !== '') {
            curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
        }
        try {
            $raw = curl_exec($handle);
            if (!is_string($raw)) {
                throw new RuntimeException('WordPress-Anfrage fehlgeschlagen: ' . curl_error($handle));
            }
            return ['status' => (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE), 'body' => $raw];
        } finally {
            curl_close($handle);
        }
    }
}
