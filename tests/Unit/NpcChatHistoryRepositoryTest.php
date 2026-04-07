<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/llm_soc/NpcChatHistoryRepository.php';

final class NpcChatHistoryRepositoryTest extends TestCase {
    private string $tmpRoot;
    private NpcChatHistoryRepository $repo;

    protected function setUp(): void {
        $this->tmpRoot = sys_get_temp_dir() . '/npc_chat_test_' . uniqid();
        mkdir($this->tmpRoot, 0755, true);
        $this->repo = new NpcChatHistoryRepository($this->tmpRoot);
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

    // ── buildRelativePath ────────────────────────────────────────────────────

    public function testBuildRelativePathFollowsConvention(): void {
        $path = $this->repo->buildRelativePath(7, 'vor_tak', "General Drak'Mol");
        $this->assertSame("generated/npc_chats/u_7/vor_tak/general_drak_mol.json", $path);
    }

    public function testBuildRelativePathSlugifiesSpecialChars(): void {
        $path = $this->repo->buildRelativePath(42, 'iron_fleet', 'Stratega T\'Asha');
        $this->assertStringEndsWith('.json', $path);
        $this->assertStringNotContainsString("'", $path);
        $this->assertStringNotContainsString(' ', $path);
    }

    public function testBuildRelativePathFallbacksToNpcForEmptyName(): void {
        $path = $this->repo->buildRelativePath(1, 'vor_tak', '---');
        $this->assertStringContainsString('npc.json', $path);
    }

    // ── loadMessages ─────────────────────────────────────────────────────────

    public function testLoadMessagesReturnsEmptyArrayWhenFileDoesNotExist(): void {
        $result = $this->repo->loadMessages('generated/npc_chats/u_99/missing/npc.json');
        $this->assertSame([], $result);
    }

    public function testLoadMessagesReturnsDecodedArray(): void {
        $dir = $this->tmpRoot . '/generated/npc_chats/u_1/vor_tak';
        mkdir($dir, 0755, true);
        file_put_contents(
            $dir . '/test_npc.json',
            json_encode([
                ['role' => 'user', 'content' => 'Hello', 'ts' => '2026-04-07T10:00:00'],
                ['role' => 'assistant', 'content' => 'Greetings', 'ts' => '2026-04-07T10:00:01'],
            ])
        );

        $messages = $this->repo->loadMessages('generated/npc_chats/u_1/vor_tak/test_npc.json');

        $this->assertCount(2, $messages);
        $this->assertSame('user', $messages[0]['role']);
        $this->assertSame('Hello', $messages[0]['content']);
    }

    public function testLoadMessagesReturnsEmptyArrayOnBrokenJson(): void {
        $dir = $this->tmpRoot . '/generated/npc_chats/u_1/vor_tak';
        mkdir($dir, 0755, true);
        file_put_contents($dir . '/broken.json', '{broken}');

        $result = $this->repo->loadMessages('generated/npc_chats/u_1/vor_tak/broken.json');
        $this->assertSame([], $result);
    }

    // ── appendMessages ───────────────────────────────────────────────────────

    public function testAppendMessagesCreatesFileAndDirectory(): void {
        $db = $this->createMock(PDO::class);
        $db->method('prepare')->willReturn($this->createConfiguredMock(\PDOStatement::class, ['execute' => true]));

        $relPath = 'generated/npc_chats/u_5/vor_tak/general.json';
        $this->repo->appendMessages($db, $relPath, [
            ['role' => 'user', 'content' => 'What is your plan?'],
        ]);

        $absPath = $this->tmpRoot . '/' . $relPath;
        $this->assertFileExists($absPath);

        $messages = $this->repo->loadMessages($relPath);
        $this->assertCount(1, $messages);
        $this->assertSame('What is your plan?', $messages[0]['content']);
        $this->assertArrayHasKey('ts', $messages[0]);
    }

    public function testAppendMessagesAddsToExistingFile(): void {
        $db = $this->createMock(PDO::class);
        $db->method('prepare')->willReturn($this->createConfiguredMock(\PDOStatement::class, ['execute' => true]));

        $relPath = 'generated/npc_chats/u_5/vor_tak/general.json';

        $this->repo->appendMessages($db, $relPath, [
            ['role' => 'user', 'content' => 'First message'],
        ]);
        $this->repo->appendMessages($db, $relPath, [
            ['role' => 'assistant', 'content' => 'First reply'],
            ['role' => 'user', 'content' => 'Second message'],
        ]);

        $messages = $this->repo->loadMessages($relPath);
        $this->assertCount(3, $messages);
        $this->assertSame('First message', $messages[0]['content']);
        $this->assertSame('First reply', $messages[1]['content']);
        $this->assertSame('Second message', $messages[2]['content']);
    }

    public function testAppendMessagesSetsCorrectRoles(): void {
        $db = $this->createMock(PDO::class);
        $db->method('prepare')->willReturn($this->createConfiguredMock(\PDOStatement::class, ['execute' => true]));

        $relPath = 'generated/npc_chats/u_5/vor_tak/role_test.json';
        $this->repo->appendMessages($db, $relPath, [
            ['role' => 'user', 'content' => 'A'],
            ['role' => 'assistant', 'content' => 'B'],
        ]);

        $messages = $this->repo->loadMessages($relPath);
        $this->assertSame('user', $messages[0]['role']);
        $this->assertSame('assistant', $messages[1]['role']);
    }
}
