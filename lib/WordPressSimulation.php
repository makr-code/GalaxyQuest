<?php

declare(strict_types=1);

final class WordPressSimulation
{
    public function __construct(private array $data, private string $publicUrl, private ?string $restUrl = null)
    {
    }

    public function request(string $route, array $query, ?array &$pagination = null): array
    {
        $pagination = null;
        $limit = self::positiveInteger($query['per_page'] ?? 10, 'per_page', 100);
        $page = self::positiveInteger($query['page'] ?? 1, 'page', intdiv(PHP_INT_MAX, 100));
        foreach (['slug', '_fields', '_embed', 'status', 'order', 'orderby'] as $parameter) {
            if (array_key_exists($parameter, $query) && !is_string($query[$parameter])) {
                throw new InvalidArgumentException($parameter . ': String required.');
            }
        }
        $order = strtolower($query['order'] ?? 'desc');
        if (!in_array($order, ['asc', 'desc'], true)) {
            throw new InvalidArgumentException('order: asc or desc required.');
        }
        if (isset($query['orderby']) && $query['orderby'] !== 'date') {
            throw new InvalidArgumentException('Simulation supports only orderby=date.');
        }
        if (isset($query['status']) && $query['status'] !== 'publish') {
            throw new InvalidArgumentException('Simulation exposes only status=publish.');
        }
        $tags = self::termIds($query['tags'] ?? null, 'tags');
        $categories = self::termIds($query['categories'] ?? null, 'categories');
        if (in_array($route, ['/wp/v2/tags', '/wp/v2/categories'], true)) {
            $taxonomy = str_ends_with($route, 'tags') ? 'tags' : 'categories';
            $terms = $this->data[$taxonomy];
            if (isset($query['post'])) {
                $postId = self::positiveInteger($query['post'], 'post', PHP_INT_MAX);
                $postTerms = [];
                foreach ($this->data['posts'] as $post) {
                    if ($post['id'] === $postId && $post['status'] === 'publish' && !($post['protected'] ?? false)) {
                        $postTerms = $post[$taxonomy];
                    }
                }
                $terms = array_filter($terms, static fn(array $term): bool => in_array($term['id'], $postTerms, true));
            }
            $terms = array_values(array_filter($terms, static fn(array $term): bool =>
                !isset($query['slug']) || $term['slug'] === $query['slug']));
            $pagination = self::pagination(count($terms), $limit);
            return array_map(
                static fn(array $term): array => self::selectFields($term, $query),
                self::paginate($terms, $page, $limit)
            );
        }
        if ($route !== '/wp/v2/posts' && !preg_match('~^/wp/v2/posts/([1-9][0-9]*)$~D', $route, $match)) {
            throw new OutOfBoundsException('REST route not found.');
        }
        $id = isset($match[1]) ? (int)$match[1] : null;
        $posts = array_filter($this->data['posts'], static fn(array $post): bool =>
            $post['status'] === 'publish' && !($post['protected'] ?? false)
            && ($id === null || $post['id'] === $id)
            && ($tags === [] || array_intersect($tags, $post['tags']) !== [])
            && ($categories === [] || array_intersect($categories, $post['categories']) !== []));
        usort($posts, static fn(array $a, array $b): int =>
            [$b['date_gmt'], $b['id']] <=> [$a['date_gmt'], $a['id']]);
        if ($order === 'asc') {
            $posts = array_reverse($posts);
        }
        if ($id === null) {
            $pagination = self::pagination(count($posts), $limit);
        }
        $embed = array_key_exists('_embed', $query)
            && ($query['_embed'] === '' || in_array($query['_embed'], ['1', 'true'], true)
                || in_array('wp:term', explode(',', $query['_embed']), true));
        $posts = array_map(
            fn(array $post): array => $this->wirePost($post, $embed),
            $id === null ? self::paginate($posts, $page, $limit) : $posts
        );
        $posts = array_map(static fn(array $post): array => self::selectFields($post, $query), $posts);
        if ($id === null) {
            return $posts;
        }
        if ($posts === []) {
            throw new OutOfBoundsException('Post not found.');
        }
        return $posts[0];
    }

    private static function selectFields(array $item, array $query): array
    {
        $fields = array_values(array_filter(
            array_map('trim', explode(',', $query['_fields'] ?? '')),
            static fn(string $field): bool => $field !== ''
        ));
        if ($fields === []) {
            return $item;
        }
        $selected = self::filterFields($item, ['id', ...$fields]);
        if (!isset($selected['_links'])) {
            unset($selected['_embedded']);
        }
        return $selected;
    }

    private static function filterFields(array $item, array $fields): array
    {
        if (array_is_list($item)) {
            return array_map(static fn(mixed $value): mixed =>
                is_array($value) ? self::filterFields($value, $fields) : $value, $item);
        }
        $result = [];
        foreach ($item as $key => $value) {
            if (in_array((string)$key, $fields, true)) {
                $result[$key] = $value;
                continue;
            }
            $nested = [];
            foreach ($fields as $field) {
                if (str_starts_with($field, $key . '.')) {
                    $nested[] = substr($field, strlen($key) + 1);
                }
            }
            if ($nested !== [] && is_array($value)) {
                $result[$key] = self::filterFields($value, $nested);
            }
        }
        return $result;
    }

    private static function positiveInteger(mixed $value, string $parameter, int $maximum): int
    {
        if (
            (!is_int($value) && !is_string($value)) || !preg_match('/^[1-9][0-9]*$/D', (string)$value)
            || strlen((string)$value) > strlen((string)$maximum)
            || (strlen((string)$value) === strlen((string)$maximum) && strcmp((string)$value, (string)$maximum) > 0)
        ) {
            throw new InvalidArgumentException($parameter . ': Integer between 1 and ' . $maximum . ' required.');
        }
        return (int)$value;
    }

    private static function termIds(mixed $value, string $parameter): array
    {
        if ($value === null || $value === '') {
            return [];
        }
        if (is_int($value)) {
            $value = [$value];
        } elseif (is_string($value)) {
            $value = explode(',', $value);
        }
        if (!is_array($value) || !array_is_list($value) || count($value) > 100) {
            throw new InvalidArgumentException($parameter . ': At most 100 term IDs required.');
        }
        return array_values(array_unique(array_map(
            static fn(mixed $id): int => self::positiveInteger($id, $parameter, PHP_INT_MAX),
            $value
        )));
    }

    private static function paginate(array $items, int $page, int $limit): array
    {
        if ($page > 1 && ($page - 1) * $limit >= count($items)) {
            throw new RangeException('The page number requested is larger than the number of pages available.');
        }
        return array_slice($items, ($page - 1) * $limit, $limit);
    }

    private static function pagination(int $total, int $limit): array
    {
        return ['total' => $total, 'total_pages' => (int)ceil($total / $limit)];
    }

    private function restLink(string $route): string
    {
        return ($this->restUrl ?? $this->publicUrl) . '?' . http_build_query(['rest_route' => $route]);
    }

    private function wirePost(array $post, bool $embed): array
    {
        $terms = [];
        if ($embed) {
            foreach (['categories', 'tags'] as $taxonomy) {
                $terms[] = array_map(
                    static fn(array $term): array =>
                    [...$term, 'taxonomy' => $taxonomy === 'tags' ? 'post_tag' : 'category'],
                    array_values(array_filter(
                        $this->data[$taxonomy],
                        static fn(array $term): bool => in_array($term['id'], $post[$taxonomy], true)
                    ))
                );
            }
        }
        $result = [
            'id' => $post['id'], 'date_gmt' => $post['date_gmt'],
            'modified_gmt' => $post['modified_gmt'] ?? $post['date_gmt'],
            'status' => 'publish', 'type' => 'post',
            'link' => $this->publicUrl . '?p=' . $post['id'],
            'title' => ['rendered' => htmlspecialchars($post['title'], ENT_QUOTES, 'UTF-8')],
            'content' => [
                'rendered' => '<p>' . nl2br(htmlspecialchars($post['body'], ENT_QUOTES, 'UTF-8')) . '</p>',
                'protected' => false,
            ],
            'excerpt' => ['rendered' => htmlspecialchars($post['summary'], ENT_QUOTES, 'UTF-8'), 'protected' => false],
            'categories' => $post['categories'], 'tags' => $post['tags'],
            'meta' => [
                'gq_summary' => $post['summary'],
                'gq_target_faction_code' => $post['target_faction_code'] ?? '',
            ],
            '_links' => [
                'self' => [['href' => $this->restLink('/wp/v2/posts/' . $post['id'])]],
                'collection' => [['href' => $this->restLink('/wp/v2/posts')]],
                'wp:term' => [
                    ['taxonomy' => 'category', 'embeddable' => true,
                        'href' => $this->restLink('/wp/v2/categories') . '&post=' . $post['id']],
                    ['taxonomy' => 'post_tag', 'embeddable' => true,
                        'href' => $this->restLink('/wp/v2/tags') . '&post=' . $post['id']],
                ],
            ],
        ];
        if ($embed) {
            $result['_embedded'] = ['wp:term' => $terms];
        }
        return $result;
    }
}
