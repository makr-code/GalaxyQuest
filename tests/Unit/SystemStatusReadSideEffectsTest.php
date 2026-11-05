<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class SystemStatusReadSideEffectsTest extends TestCase
{
    public function testServerAnnouncementListUsesGetAndReadOnlyRepositoryMethod(): void
    {
        $endpoint = file_get_contents(__DIR__ . '/../../api/server_announcements.php');
        $repository = file_get_contents(__DIR__ . '/../../lib/ServerAnnouncementRepository.php');
        self::assertIsString($endpoint);
        self::assertIsString($repository);

        self::assertMatchesRegularExpression(
            "/if \\(\\\$action === 'list'\\) \\{\\s*only_method\\('GET'\\);/",
            $endpoint
        );
        $activeStart = strpos($repository, 'public function active(');
        $publishStart = strpos($repository, 'public function publish(', $activeStart);
        self::assertNotFalse($activeStart);
        self::assertNotFalse($publishStart);
        $active = substr($repository, $activeStart, $publishStart - $activeStart);
        self::assertStringContainsString('SELECT id, title, message, severity, published_at', $active);
        self::assertDoesNotMatchRegularExpression('/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i', $active);
    }

    public function testQuotaAndAdminStatsEndpointsAreReadOnlyGetRequests(): void
    {
        $quota = file_get_contents(__DIR__ . '/../../api/user_quota.php');
        $adminStats = file_get_contents(__DIR__ . '/../../api/admin_stats.php');
        self::assertIsString($quota);
        self::assertIsString($adminStats);

        self::assertStringContainsString("only_method('GET');", $quota);
        self::assertStringContainsString("only_method('GET');", $adminStats);
        foreach ([$quota, $adminStats] as $source) {
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i',
                $source
            );
            self::assertStringNotContainsString('file_put_contents(', $source);
            self::assertStringNotContainsString('unlink(', $source);
        }
        self::assertStringContainsString('FROM user_asset_quotas', $quota);
        self::assertStringContainsString('json_error(\'Quota data unavailable\', 503);', $quota);
        self::assertStringNotContainsString('// Fall back to defaults if DB fails', $quota);
    }
}
