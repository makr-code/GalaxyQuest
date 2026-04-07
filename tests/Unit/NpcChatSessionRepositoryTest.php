<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/llm_soc/NpcChatSessionRepository.php';

final class NpcChatSessionRepositoryTest extends TestCase {
    private string $tmpRoot;
    private NpcChatSessionRepository $repo;

    protected function setUp(): void {
        $this->tmpRoot = sys_get_temp_dir() . '/npc_session_test_' . uniqid();
        mkdir($this->tmpRoot, 0755, true);
        $this->repo = new NpcChatSessionRepository($this->tmpRoot);
    }

    protected function tearDown(): void {
        $this->removeDir($this->tmpRoot);
    }

    private function removeDir(string $path): void {
        if (!is_dir($path)) {
            return;
        }
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $full = $path . '/' . $entry;
            is_dir($full) ? $this->removeDir($full) : unlink($full);
        }
        rmdir($path);
    }

    // ── slugify ───────────────────────────────────────────────────────────────

    public function testSlugifyLowercasesAndReplacesSeparators(): void {
        $this->assertSame("general_drak_mol", $this->repo->slugify("General Drak'Mol"));
    }

    public function testSlugifyFallsBackToNpcForBlankInput(): void {
        $this->assertSame('npc', $this->repo->slugify('---'));
        $this->assertSame('npc', $this->repo->slugify(''));
    }

    // ── buildRelativePath ─────────────────────────────────────────────────────

    public function testBuildRelativePathEmbedsDirPerNpcAndSessionId(): void {
        $path = $this->repo->buildRelativePath(7, 'vor_tak', "General Drak'Mol", 42);
        $this->assertSame(
            'generated/npc_chats/u_7/vor_tak/general_drak_mol/session_42.json',
            $path
        );
    }

    // ── loadMessages ──────────────────────────────────────────────────────────

    public function testLoadMessagesReturnsEmptyForMissingFile(): void {
        $this->assertSame([], $this->repo->loadMessages('generated/npc_chats/missing/session_1.json'));
    }

    public function testLoadMessagesReturnsEmptyForEmptyFile(): void {
        $dir = $this->tmpRoot . '/generated/npc_chats/u_1/vor_tak/general';
        mkdir($dir, 0755, true);
        file_put_contents($dir . '/session_1.json', '[]');

        $this->assertSame([], $this->repo->loadMessages('generated/npc_chats/u_1/vor_tak/general/session_1.json'));
    }

    public function testLoadMessagesDecodesJsonCorrectly(): void {
        $dir = $this->tmpRoot . '/generated/npc_chats/u_1/vor_tak/general';
        mkdir($dir, 0755, true);
        $data = [
            ['role' => 'user', 'content' => 'Was sind eure Absichten?', 'ts' => '2026-04-07T10:00:00'],
            ['role' => 'assistant', 'content' => 'Ehre ist alles.', 'ts' => '2026-04-07T10:00:01'],
        ];
        file_put_contents($dir . '/session_1.json', json_encode($data));

        $messages = $this->repo->loadMessages('generated/npc_chats/u_1/vor_tak/general/session_1.json');

        $this->assertCount(2, $messages);
        $this->assertSame('user', $messages[0]['role']);
        $this->assertSame('Was sind eure Absichten?', $messages[0]['content']);
    }

    public function testLoadMessagesReturnsEmptyForBrokenJson(): void {
        $dir = $this->tmpRoot . '/generated/npc_chats/u_1/vor_tak/general';
        mkdir($dir, 0755, true);
        file_put_contents($dir . '/session_2.json', '{broken}');

        $this->assertSame([], $this->repo->loadMessages('generated/npc_chats/u_1/vor_tak/general/session_2.json'));
    }

    // ── appendMessages ────────────────────────────────────────────────────────

    public function testAppendMessagesCreatesDirectoryAndFile(): void {
        $db = $this->createMock(PDO::class);
        $db->method('prepare')->willReturn($this->createConfiguredMock(\PDOStatement::class, ['execute' => true]));

        $relPath = 'generated/npc_chats/u_5/vor_tak/general/session_3.json';
        $this->repo->appendMessages($db, 3, $relPath, [
            ['role' => 'user', 'content' => 'First message'],
        ]);

        $this->assertFileExists($this->tmpRoot . '/' . $relPath);
        $messages = $this->repo->loadMessages($relPath);
        $this->assertCount(1, $messages);
        $this->assertSame('First message', $messages[0]['content']);
        $this->assertArrayHasKey('ts', $messages[0]);
    }

    public function testAppendMessagesAccumulatesAcrossCalls(): void {
        $db = $this->createMock(PDO::class);
        $db->method('prepare')->willReturn($this->createConfiguredMock(\PDOStatement::class, ['execute' => true]));

        $relPath = 'generated/npc_chats/u_5/vor_tak/general/session_4.json';

        $this->repo->appendMessages($db, 4, $relPath, [
            ['role' => 'user', 'content' => 'Turn 1'],
        ]);
        $this->repo->appendMessages($db, 4, $relPath, [
            ['role' => 'assistant', 'content' => 'Reply 1'],
            ['role' => 'user', 'content' => 'Turn 2'],
        ]);

        $messages = $this->repo->loadMessages($relPath);
        $this->assertCount(3, $messages);
        $this->assertSame('Turn 1', $messages[0]['content']);
        $this->assertSame('Reply 1', $messages[1]['content']);
        $this->assertSame('Turn 2', $messages[2]['content']);
    }

    // ── loadPreviousSummaries (DB query; tested via mock) ─────────────────────

    public function testLoadPreviousSummariesReturnsEmptyWhenNoneExist(): void {
        $stmt = $this->createConfiguredMock(\PDOStatement::class, [
            'execute' => true,
            'fetchAll' => [],
        ]);
        $db = $this->createMock(PDO::class);
        $db->method('prepare')->willReturn($stmt);

        $result = $this->repo->loadPreviousSummaries($db, 1, 'vor_tak', 'General Drak\'Mol');
        $this->assertSame([], $result);
    }

    public function testLoadPreviousSummariesReturnsMappedRows(): void {
        $rows = [
            ['id' => 1, 'summary' => 'The player asked about trade routes.', 'started_at' => '2026-04-01 10:00:00'],
            ['id' => 2, 'summary' => 'The player pledged loyalty.', 'started_at' => '2026-04-05 14:30:00'],
        ];
        $stmt = $this->createConfiguredMock(\PDOStatement::class, [
            'execute' => true,
            'fetchAll' => $rows,
        ]);
        $db = $this->createMock(PDO::class);
        $db->method('prepare')->willReturn($stmt);

        $result = $this->repo->loadPreviousSummaries($db, 1, 'vor_tak', 'General Drak\'Mol');

        $this->assertCount(2, $result);
        $this->assertSame('The player asked about trade routes.', $result[0]['summary']);
        $this->assertSame('2026-04-01 10:00:00', $result[0]['started_at']);
    }
}
