<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/DeveloperBlogRepository.php';

final class DeveloperBlogRepositoryTest extends TestCase
{
    private PDO $db;
    private DeveloperBlogRepository $repository;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->db->exec('CREATE TABLE developer_blog_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, author_id INTEGER,
            published_at TEXT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            revision INTEGER NOT NULL DEFAULT 1, categories TEXT NULL, tags TEXT NULL, target_faction_id INTEGER NULL
        )');
        $this->repository = new DeveloperBlogRepository($this->db);
    }

    public function testLatestFiveArePublishedAndDeterministicallyOrdered(): void
    {
        for ($i = 1; $i <= 8; $i++) {
            $this->repository->save(['title' => "Beitrag $i", 'body' => 'Text', 'published' => true], 1);
        }
        $draft = $this->repository->save(['title' => 'Entwurf', 'body' => 'Privat', 'published' => false], 1);
        $posts = $this->repository->latest();
        self::assertCount(5, $posts);
        self::assertSame([8, 7, 6, 5, 4], array_column($posts, 'id'));
        self::assertNull($this->repository->published($draft));
        self::assertCount(9, $this->repository->administration(1));
        self::assertSame([], $this->repository->administration(2));
    }

    public function testEditAndWithdrawalPreserveIdAndOriginalPublicationTime(): void
    {
        $id = $this->repository->save(['title' => 'Title', 'body' => 'Text', 'published' => true], 1);
        $before = $this->repository->published($id);
        $this->repository->save(['id' => $id, 'revision' => 1, 'title' => 'Update', 'body' => 'New text', 'published' => true], 2);
        self::assertSame('Update', $this->repository->latest()[0]['title']);
        self::assertSame($before['published_at'], $this->repository->published($id)['published_at']);
        $this->repository->save(['id' => $id, 'revision' => 2, 'title' => 'Update', 'body' => 'Text', 'published' => false], 2);
        self::assertSame([], $this->repository->latest());
        self::assertNull($this->repository->published($id));
    }

    public function testValidationRejectsInvalidInputsWithoutWrites(): void
    {
        foreach ([[], ['title' => [], 'body' => 'a', 'published' => true],
            ['title' => 'a', 'body' => ' ', 'published' => true],
            ['title' => str_repeat('ä', 161), 'body' => 'a', 'published' => true],
            ['title' => 'a', 'body' => str_repeat('a', 3001), 'published' => false],
            ['title' => 'a', 'body' => 'b', 'published' => 'true']] as $input) {
            try {
                $this->repository->save($input, 1);
                self::fail('Invalid input accepted');
            } catch (InvalidArgumentException $error) {
                self::assertNotSame('', $error->getMessage());
            }
        }
        self::assertSame([], $this->repository->administration(1));
    }

    public function testMissingUpdateDoesNotInsert(): void
    {
        $this->expectException(OutOfBoundsException::class);
        $this->repository->save(['id' => 999, 'title' => 'a', 'body' => 'b', 'published' => true], 1);
    }

    public function testStaleEditsCannotOverwriteNewerContentOrWithdrawPublication(): void
    {
        $input = ['title' => 'Original', 'body' => 'Text', 'published' => true];
        $id = $this->repository->save($input, 1);
        $this->repository->save([...$input, 'id' => $id, 'revision' => 1, 'title' => 'Newer'], 2);
        self::assertSame(2, $this->repository->published($id)['revision']);
        foreach ([true, false] as $published) {
            try {
                $this->repository->save([...$input, 'id' => $id, 'revision' => 1, 'published' => $published], 1);
                self::fail('Stale edit accepted');
            } catch (UnexpectedValueException $error) {
                self::assertStringContainsString('zwischenzeitlich', $error->getMessage());
            }
        }
        self::assertSame('Newer', $this->repository->published($id)['title']);
        self::assertSame(2, $this->repository->published($id)['revision']);
    }

    public function testUpdatesRequireRevisionAndNoOpSavesStillAdvanceIt(): void
    {
        $input = ['title' => 'Original', 'body' => 'Text', 'published' => true];
        $id = $this->repository->save($input, 1);
        $this->repository->save([...$input, 'id' => $id, 'revision' => 1], 1);
        self::assertSame(2, $this->repository->published($id)['revision']);
        $this->expectException(InvalidArgumentException::class);
        $this->repository->save([...$input, 'id' => $id], 1);
    }

    public function testNarrationChunksCoverLongUnicodePostsWithoutTruncation(): void
    {
        $post = ['title' => 'Neuigkeiten', 'body' => mb_substr(str_repeat('Übertragung. ', 300), 0, 3000)];
        $chunks = DeveloperBlogRepository::speechChunks($post);
        self::assertGreaterThan(1, count($chunks));
        foreach ($chunks as $chunk) self::assertLessThanOrEqual(1000, mb_strlen($chunk));
        self::assertSame(
            preg_replace('/\s+/u', '', $post['title'] . '.' . $post['body']),
            preg_replace('/\s+/u', '', implode('', $chunks))
        );
    }

    public function testOnlyPublicHomeworldCatalogTargetsCanBeSavedAndRevised(): void
    {
        $this->db->exec('CREATE TABLE npc_factions (id INTEGER, code TEXT);
            CREATE TABLE faction_homeworlds (faction_id INTEGER, colony_id INTEGER);
            CREATE TABLE colonies (id INTEGER, body_id INTEGER, name TEXT);
            CREATE TABLE celestial_bodies (id INTEGER, galaxy_index INTEGER, system_index INTEGER, position INTEGER);
            CREATE TABLE star_systems (galaxy_index INTEGER, system_index INTEGER, name TEXT, x_ly REAL, y_ly REAL, z_ly REAL);
            INSERT INTO npc_factions VALUES (4, \'test\');
            INSERT INTO faction_homeworlds VALUES (4, 20);
            INSERT INTO colonies VALUES (20, 30, \'Home\');
            INSERT INTO celestial_bodies VALUES (30, 1, 42, 3);
            INSERT INTO star_systems VALUES (1, 42, \'Star\', 1, 2, 3)');
        $targets = $this->repository->flightTargets();
        self::assertSame(4, $targets[0]['faction_id']);
        self::assertSame(3, $targets[0]['position']);
        self::assertArrayNotHasKey('colony_id', $targets[0]);
        $input = ['title' => 'Visit', 'body' => 'Home', 'published' => true, 'target_faction_id' => 4];
        $id = $this->repository->save($input, 1);
        self::assertSame(4, $this->repository->latest()[0]['target_faction_id']);
        $this->repository->save([...$input, 'id' => $id, 'revision' => 1, 'target_faction_id' => null], 1);
        self::assertNull($this->repository->published($id)['target_faction_id']);
        $this->expectException(InvalidArgumentException::class);
        $this->repository->save([...$input, 'target_faction_id' => 99], 1);
    }

    public function testCategoriesAndHeroTagsPersistNormalizeAndDoNotChangeLatestOrder(): void
    {
        $input = ['title' => 'Important', 'body' => 'Text', 'published' => true,
            'categories' => [' Entwicklung ', 'audio', 'audio'], 'tags' => [' HERO ', 'tts']];
        $id = $this->repository->save($input, 1);
        $this->repository->save(['title' => 'Newer', 'body' => 'Text', 'published' => true], 1);
        self::assertSame(['Newer', 'Important'], array_column($this->repository->latest(), 'title'));
        self::assertSame(['entwicklung', 'audio'], $this->repository->published($id)['categories']);
        self::assertSame(['hero', 'tts'], $this->repository->administration(1)[1]['tags']);
        $this->repository->save([...$input, 'id' => $id, 'revision' => 1, 'tags' => ['tts']], 1);
        self::assertSame(['tts'], $this->repository->published($id)['tags']);
        self::assertSame(2, $this->repository->published($id)['revision']);
        self::assertSame(['Important', 'Text'], explode(".\n\n", implode('', DeveloperBlogRepository::speechChunks($input))));
    }

    public function testInvalidTaxonomyIsRejectedWithoutWrites(): void
    {
        $input = ['title' => 'Title', 'body' => 'Text', 'published' => true];
        foreach ([
            ['categories' => []], ['categories' => null], ['categories' => 'audio'],
            ['categories' => ['a', 'b', 'c', 'd', 'e', 'f']], ['tags' => array_fill(0, 11, 'tts')],
            ['tags' => ['<script>']], ['tags' => ['a b']], ['tags' => ['-hero']],
            ['tags' => [str_repeat('a', 33)]], ['tags' => [123]], ['tags' => ['key' => 'hero']],
        ] as $taxonomy) {
            try {
                $this->repository->save([...$input, ...$taxonomy], 1);
                self::fail('Invalid taxonomy accepted');
            } catch (InvalidArgumentException $error) {
                self::assertNotSame('', $error->getMessage());
            }
        }
        self::assertSame([], $this->repository->latest());
    }

    public function testLegacyPostsReceiveDefaultCategoryWithoutChangingStorage(): void
    {
        $this->db->exec("INSERT INTO developer_blog_posts (title, body, published_at) VALUES ('Old', 'Text', '2026-11-06')");
        self::assertSame(['entwicklung'], $this->repository->latest()[0]['categories']);
        self::assertSame([], $this->repository->latest()[0]['tags']);
        self::assertNull($this->db->query('SELECT categories FROM developer_blog_posts')->fetchColumn());
    }

    public function testExactUnicodeLimitsAreAcceptedAndLimitPlusOneIsRejected(): void
    {
        $input = ['title' => str_repeat('🌟', 160), 'body' => str_repeat('🌟', 3000), 'published' => true];
        $id = $this->repository->save($input, 1);
        self::assertSame($input['body'], $this->repository->published($id)['body']);
        self::assertFalse($this->repository->published($id)['truncated']);
        $input['body'] .= '🌟';
        $this->expectException(InvalidArgumentException::class);
        $this->repository->save($input, 1);
    }

    public function testOldOversizedPostsHaveSameBoundedDisplayAndSpeechWithoutDataLoss(): void
    {
        $title = str_repeat('T', 170);
        $body = str_repeat('🌟', 5000);
        $statement = $this->db->prepare('INSERT INTO developer_blog_posts (title, body, author_id, published_at) VALUES (?, ?, 1, ?)');
        $statement->execute([$title, $body, '2026-11-06 12:00:00']);
        $post = $this->repository->latest()[0];
        self::assertTrue($post['truncated']);
        self::assertSame(160, mb_strlen($post['title']));
        self::assertSame(3000, mb_strlen($post['body']));
        self::assertSame($post['body'], $this->repository->published($post['id'])['body']);
        self::assertSame($body, $this->repository->administration(1)[0]['body']);
        $chunks = DeveloperBlogRepository::speechChunks(['title' => $title, 'body' => $body]);
        self::assertLessThanOrEqual(7, count($chunks));
        self::assertSame($post['title'] . ".\n\n" . $post['body'], implode('', $chunks));
        self::assertLessThanOrEqual(3163, mb_strlen(implode('', $chunks)));
    }
}
