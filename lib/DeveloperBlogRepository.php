<?php
declare(strict_types=1);

final class DeveloperBlogRepository
{
    public const MAX_TITLE_CHARS = 160;
    public const MAX_BODY_CHARS = 3000;

    public function __construct(private PDO $db) {}

    public function latest(): array
    {
        return array_map(self::publicPost(...), $this->rows(
            'SELECT id, title, body, published_at, updated_at, revision, categories, tags, target_faction_id FROM developer_blog_posts
            WHERE published_at IS NOT NULL ORDER BY published_at DESC, id DESC LIMIT 5'
        ));
    }

    public function administration(int $page): array
    {
        $offset = (max(1, $page) - 1) * 20;
        return $this->rows('SELECT id, title, body, published_at, updated_at, revision, categories, tags, target_faction_id FROM developer_blog_posts
            ORDER BY id DESC LIMIT 21 OFFSET ' . $offset);
    }

    public function published(int $id): ?array
    {
        $statement = $this->db->prepare('SELECT id, title, body, published_at, updated_at, revision, categories, tags, target_faction_id FROM developer_blog_posts
            WHERE id = ? AND published_at IS NOT NULL');
        $statement->execute([$id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : self::publicPost(self::hydrate($row));
    }

    public function save(array $input, int $authorId): int
    {
        $title = $input['title'] ?? null;
        $body = $input['body'] ?? null;
        $published = $input['published'] ?? null;
        $id = $input['id'] ?? 0;
        if (!is_string($title) || trim($title) === '' || mb_strlen($title) > self::MAX_TITLE_CHARS
            || !is_string($body) || trim($body) === '' || mb_strlen($body) > self::MAX_BODY_CHARS
            || !is_bool($published) || !is_int($id) || $id < 0 || $authorId < 1) {
            throw new InvalidArgumentException('Titel (1–' . self::MAX_TITLE_CHARS . ' Zeichen), Text (1–'
                . self::MAX_BODY_CHARS . ' Zeichen) und Veröffentlichungsstatus sind erforderlich.');
        }
        $categories = self::terms(array_key_exists('categories', $input) ? $input['categories'] : ['entwicklung'], 5, 'Kategorien', true);
        $tags = self::terms(array_key_exists('tags', $input) ? $input['tags'] : [], 10, 'Tags');
        $target = $input['target_faction_id'] ?? null;
        if ($target !== null && (!is_int($target) || $target < 1
            || !in_array($target, array_column($this->flightTargets(), 'faction_id'), true))) {
            throw new InvalidArgumentException('Ungültige Fraktionshauptwelt als Flugziel.');
        }
        if ($id === 0) {
            $statement = $this->db->prepare('INSERT INTO developer_blog_posts
                (title, body, author_id, published_at, categories, tags, target_faction_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $statement->execute([trim($title), trim($body), $authorId, $published ? gmdate('Y-m-d H:i:s') : null,
                json_encode($categories, JSON_THROW_ON_ERROR), json_encode($tags, JSON_THROW_ON_ERROR), $target]);
            return (int)$this->db->lastInsertId();
        }
        $exists = $this->db->prepare('SELECT id FROM developer_blog_posts WHERE id = ?');
        $exists->execute([$id]);
        if ($exists->fetchColumn() === false) {
            throw new OutOfBoundsException('Beitrag nicht gefunden.');
        }
        $revision = $input['revision'] ?? null;
        if (!is_int($revision) || $revision < 1) {
            throw new InvalidArgumentException('Beitragsversion fehlt. Bitte Beitragsliste neu laden.');
        }
        $statement = $this->db->prepare('UPDATE developer_blog_posts SET title = ?, body = ?,
            published_at = CASE WHEN ? THEN COALESCE(published_at, ?) ELSE NULL END,
            updated_at = ?, categories = ?, tags = ?, target_faction_id = ?, revision = revision + 1 WHERE id = ? AND revision = ?');
        $now = gmdate('Y-m-d H:i:s');
        $statement->execute([trim($title), trim($body), (int)$published, $now, $now,
            json_encode($categories, JSON_THROW_ON_ERROR), json_encode($tags, JSON_THROW_ON_ERROR), $target, $id, $revision]);
        if ($statement->rowCount() !== 1) {
            throw new UnexpectedValueException('Beitrag wurde zwischenzeitlich geändert. Bitte eigenen Text sichern, die Beitragsliste neu laden und Änderungen vergleichen.');
        }
        return $id;
    }

    public function flightTargets(): array
    {
        $rows = $this->db->query(
            'SELECT f.id AS faction_id, f.code, c.name AS homeworld, cb.galaxy_index, cb.system_index,
                    cb.position, s.name, s.x_ly, s.y_ly, s.z_ly
             FROM faction_homeworlds h JOIN npc_factions f ON f.id = h.faction_id
             JOIN colonies c ON c.id = h.colony_id JOIN celestial_bodies cb ON cb.id = c.body_id
             JOIN star_systems s ON s.galaxy_index = cb.galaxy_index AND s.system_index = cb.system_index
             ORDER BY f.code'
        )->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$row) {
            foreach (['faction_id', 'galaxy_index', 'system_index', 'position'] as $key) $row[$key] = (int)$row[$key];
            foreach (['x_ly', 'y_ly', 'z_ly'] as $key) $row[$key] = (float)$row[$key];
        }
        return $rows;
    }

    public static function speechChunks(array $post): array
    {
        $post = self::publicPost($post);
        $text = trim($post['title'] . ".\n\n" . $post['body']);
        $chunks = [];
        while (mb_strlen($text) > 1000) {
            $prefix = mb_substr($text, 0, 1000);
            $break = mb_strrpos($prefix, ' ');
            $length = $break !== false && $break > 500 ? $break : 1000;
            $chunks[] = mb_substr($text, 0, $length);
            $text = ltrim(mb_substr($text, $length));
        }
        if ($text !== '') $chunks[] = $text;
        return $chunks;
    }

    private static function publicPost(array $post): array
    {
        if (isset($post['revision'])) $post['revision'] = (int)$post['revision'];
        $post['truncated'] = ($post['truncated'] ?? false)
            || mb_strlen($post['title']) > self::MAX_TITLE_CHARS || mb_strlen($post['body']) > self::MAX_BODY_CHARS;
        $post['title'] = mb_substr($post['title'], 0, self::MAX_TITLE_CHARS);
        $post['body'] = mb_substr($post['body'], 0, self::MAX_BODY_CHARS);
        return $post;
    }

    private function rows(string $sql): array
    {
        $rows = $this->db->query($sql)->fetchAll(PDO::FETCH_ASSOC);
        return array_map(self::hydrate(...), $rows);
    }

    private static function hydrate(array $row): array
    {
        $row['id'] = (int)$row['id'];
        $row['revision'] = (int)$row['revision'];
        $row['target_faction_id'] = isset($row['target_faction_id']) ? (int)$row['target_faction_id'] : null;
        foreach (['categories' => ['entwicklung'], 'tags' => []] as $key => $default) {
            $row[$key] = $row[$key] === null ? $default : json_decode($row[$key], true, 512, JSON_THROW_ON_ERROR);
            $row[$key] = self::terms($row[$key], $key === 'categories' ? 5 : 10, $key, $key === 'categories');
        }
        return $row;
    }

    private static function terms(mixed $value, int $limit, string $label, bool $required = false): array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) > $limit || ($required && $value === [])) {
            throw new InvalidArgumentException($label . ': ' . ($required ? '1' : '0') . ' bis ' . $limit . ' Einträge erforderlich.');
        }
        $terms = [];
        foreach ($value as $term) {
            if (!is_string($term)) throw new InvalidArgumentException($label . ': Ungültiger Eintrag.');
            $term = strtolower(trim($term));
            if (strlen($term) > 32 || !preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $term)) {
                throw new InvalidArgumentException($label . ': Maximal 32 Zeichen pro Eintrag (a-z, 0-9 und Bindestrich).');
            }
            $terms[] = $term;
        }
        return array_values(array_unique($terms));
    }
}
