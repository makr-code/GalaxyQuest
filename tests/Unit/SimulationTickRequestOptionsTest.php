<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\SimulationTickRequestOptions;

use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/simulation_runtime.php';

final class SimulationTickRequestOptionsTest extends TestCase
{
    public function testDefaultsToAuthenticatedUserWithoutForce(): void
    {
        self::assertSame(
            ['scope' => 'user', 'user_id' => 42, 'force' => false],
            \simulation_tick_request_options([], 42)
        );
    }

    public function testAcceptsNormalizedScopesAndExplicitBooleanForce(): void
    {
        self::assertSame(
            ['scope' => 'user', 'user_id' => 77, 'force' => true],
            \simulation_tick_request_options(['scope' => ' USER ', 'user_id' => 77, 'force' => true], 42)
        );
        self::assertSame(
            ['scope' => 'global', 'user_id' => 42, 'force' => false],
            \simulation_tick_request_options(['scope' => 'Global'], 42)
        );
    }

    /** @return iterable<string, array{array<string, mixed>, int}> */
    public static function invalidRequestOptions(): iterable
    {
        yield 'unknown scope' => [['scope' => 'typo'], 42];
        yield 'non-string scope' => [['scope' => 1], 42];
        yield 'null scope' => [['scope' => null], 42];
        yield 'global with user id' => [['scope' => 'global', 'user_id' => 42], 42];
        yield 'zero user id' => [['user_id' => 0], 42];
        yield 'negative user id' => [['user_id' => -1], 42];
        yield 'string user id' => [['user_id' => '42'], 42];
        yield 'fractional user id' => [['user_id' => 1.5], 42];
        yield 'boolean user id' => [['user_id' => true], 42];
        yield 'string false is not boolean' => [['force' => 'false'], 42];
        yield 'integer force is not boolean' => [['force' => 1], 42];
        yield 'null force is not boolean' => [['force' => null], 42];
        yield 'invalid authenticated user' => [[], 0];
    }

    /** @param array<string, mixed> $body */
    #[DataProvider('invalidRequestOptions')]
    public function testMalformedOptionsAreRejected(array $body, int $authenticatedUserId): void
    {
        $this->expectException(InvalidArgumentException::class);
        \simulation_tick_request_options($body, $authenticatedUserId);
    }

    public function testHttpEndpointValidatesOptionsBeforeDispatchingTick(): void
    {
        $endpoint = file_get_contents(__DIR__ . '/../../api/simulation_tick.php');
        self::assertIsString($endpoint);

        $validation = strpos($endpoint, 'simulation_tick_request_options($body, $uid)');
        $globalTick = strpos($endpoint, 'simulation_tick_global($db, $force)');
        $userTick = strpos($endpoint, 'simulation_tick_user($db, $targetUserId, $force)');
        self::assertNotFalse($validation);
        self::assertNotFalse($globalTick);
        self::assertNotFalse($userTick);
        self::assertLessThan($globalTick, $validation);
        self::assertLessThan($userTick, $validation);
        self::assertStringContainsString("json_error(\$error->getMessage(), 400)", $endpoint);
    }
}
