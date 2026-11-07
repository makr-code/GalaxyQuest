<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\SimulationRuntimePublicResponse;

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/simulation_runtime.php';

final class SimulationRuntimePublicResponseTest extends TestCase
{
    public function testSuccessfulTickRemainsSuccessful(): void
    {
        $result = ['executed' => true, 'scope' => 'global', 'error_count' => 0, 'ticks' => []];

        self::assertSame(
            ['success' => true, 'simulation' => $result],
            \simulation_runtime_public_response($result)
        );
    }

    public function testLockSkipRemainsSuccessfulAndUnexecuted(): void
    {
        $result = ['executed' => false, 'scope' => 'global', 'reason' => 'lock_busy'];

        self::assertSame(
            ['success' => true, 'simulation' => $result],
            \simulation_runtime_public_response($result)
        );
    }

    public function testSubsystemFailureIsReportedWithoutExposingExceptionMessage(): void
    {
        $result = [
            'executed' => true,
            'scope' => 'global',
            'error_count' => 1,
            'ticks' => [
                'war_runtime' => [
                    'ok' => false,
                    'error_count' => 1,
                    'error_class' => 'PDOException',
                    'error' => 'internal SQL details',
                ],
            ],
        ];

        self::assertSame([
            'success' => false,
            'simulation' => [
                'executed' => true,
                'scope' => 'global',
                'error_count' => 1,
                'ticks' => [
                    'war_runtime' => [
                        'ok' => false,
                        'error_count' => 1,
                        'error_class' => 'PDOException',
                    ],
                ],
            ],
            'error' => 'One or more simulation subsystems failed.',
        ], \simulation_runtime_public_response($result));
        self::assertSame('internal SQL details', $result['ticks']['war_runtime']['error']);
    }

    public function testHttpAndCliEntrypointsUseTheSharedFailureContract(): void
    {
        $endpoint = file_get_contents(__DIR__ . '/../../api/simulation_tick.php');
        $cli = file_get_contents(__DIR__ . '/../../scripts/run_simulation_tick.php');
        self::assertIsString($endpoint);
        self::assertIsString($cli);
        self::assertSame(2, substr_count($endpoint, 'simulation_runtime_public_response($result)'));
        self::assertSame(2, substr_count($endpoint, "json_response(\$response, \$response['success'] ? 200 : 500)"));
        self::assertStringContainsString('simulation_runtime_public_response($result)', $cli);
        self::assertStringContainsString("exit(\$response['success'] ? 0 : 2)", $cli);
    }
}
