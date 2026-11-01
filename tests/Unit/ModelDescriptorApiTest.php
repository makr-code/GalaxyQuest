<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class ModelDescriptorApiTest extends TestCase
{
    /** @return array{int, array<string, mixed>, string} */
    private function request(string $type, string $mode = 'normal'): array
    {
        $apiDir = dirname(__DIR__, 2) . '/api';
        $source = file_get_contents($apiDir . '/model_gen.php');
        $helpers = file_get_contents($apiDir . '/helpers.php');
        if ($source === false || $helpers === false) {
            throw new RuntimeException('Cannot load model API sources.');
        }
        $start = strpos($helpers, 'function json_response(');
        $end = strpos($helpers, 'function csrf_token(');
        if ($start === false || $end === false) {
            throw new RuntimeException('Cannot locate JSON response helpers.');
        }
        $source = str_replace("require_once __DIR__ . '/helpers.php';", '', $source);
        $source = str_replace('__DIR__', var_export($apiDir, true), $source);
        $script = 'namespace ModelDescriptorRequest; '
            . '$mode = ' . var_export($mode, true) . '; '
            . '$_GET = ["type" => ' . var_export($type, true) . ']; '
            . 'http_response_code(200); '
            . 'register_shutdown_function(function () { fwrite(STDERR, "STATUS:" . http_response_code()); }); '
            . substr($helpers, $start, $end - $start)
            . <<<'PHP'
function send_security_headers(): void {}
function only_method(string ...$methods): void {
    if ($GLOBALS['mode'] === 'wrong_method') json_error('Method not allowed', 405);
}
function require_auth(): int {
    if ($GLOBALS['mode'] === 'unauthenticated') json_error('Not authenticated', 401);
    return 42;
}
function realpath(string $path): string|false {
    if ($GLOBALS['mode'] === 'missing') return false;
    return \realpath($path);
}
function is_readable(string $path): bool {
    return $GLOBALS['mode'] !== 'unreadable' && \is_readable($path);
}
function file_get_contents(string $path): string|false {
    return match ($GLOBALS['mode']) {
        'read_failure' => false,
        'malformed' => '{broken',
        'scalar' => '"not a descriptor"',
        default => \file_get_contents($path),
    };
}
PHP
            . 'eval(' . var_export('namespace ModelDescriptorRequest; ' . substr($source, 5), true) . ');';

        // Exercise the endpoint's real exit paths without terminating PHPUnit.
        $process = proc_open(
            [PHP_BINARY, '-d', 'display_errors=stderr', '-r', $script],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes
        );
        if ($process === false) {
            throw new RuntimeException('Cannot start model API test process.');
        }
        fclose($pipes[0]);
        $output = stream_get_contents($pipes[1]);
        $errors = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($process);
        $this->assertSame(0, $exitCode, $errors);
        // Xdebug's existing image configuration warnings are unrelated to the endpoint.
        $this->assertDoesNotMatchRegularExpression('/(?:Fatal error|Warning:|Notice:)/', $errors);
        $this->assertMatchesRegularExpression('/STATUS:\d{3}$/', $errors);
        preg_match('/STATUS:(\d{3})$/', $errors, $match);
        return [(int)$match[1], json_decode($output, true, flags: JSON_THROW_ON_ERROR), $output];
    }

    /** @return iterable<string, array{string, string, int, string}> */
    public static function errors(): iterable
    {
        yield 'required' => ['', 'normal', 400, 'type parameter is required.'];
        yield 'unknown' => ['unknown_model', 'normal', 404, 'Unknown model type: unknown_model'];
        yield 'missing' => ['stargate', 'missing', 404, 'Model file not found.'];
        yield 'unreadable' => ['stargate', 'unreadable', 404, 'Model descriptor not found for type: stargate'];
        yield 'read-failure' => ['stargate', 'read_failure', 500, 'Unable to read model descriptor.'];
        yield 'malformed' => ['stargate', 'malformed', 500, 'Malformed model descriptor.'];
        yield 'scalar' => ['stargate', 'scalar', 500, 'Malformed model descriptor.'];
        yield 'auth-first' => ['', 'unauthenticated', 401, 'Not authenticated'];
        yield 'method-first' => ['', 'wrong_method', 405, 'Method not allowed'];
    }

    #[DataProvider('errors')]
    public function testErrorsReturnRepositoryJsonShape(string $type, string $mode, int $status, string $error): void
    {
        [$actualStatus, $payload] = $this->request($type, $mode);
        $this->assertSame($status, $actualStatus);
        $this->assertSame(['success' => false, 'error' => $error], $payload);
    }

    /** @return iterable<string, array{string}> */
    public static function descriptors(): iterable
    {
        foreach ([
            'stargate', 'relay_station', 'jump_inhibitor', 'deep_space_radar',
            'space_station', 'transport_shuttle', 'ship_corvette', 'ship_frigate',
            'ship_destroyer', 'ship_cruiser',
        ] as $type) {
            yield $type => [$type];
        }
    }

    #[DataProvider('descriptors')]
    public function testExistingDescriptorPayloadIsUnchanged(string $type): void
    {
        [$status, , $output] = $this->request($type);
        $expected = file_get_contents(dirname(__DIR__, 2) . '/models/' . $type . '.json');
        $this->assertSame(200, $status);
        $this->assertSame(
            json_encode(json_decode($expected, true, flags: JSON_THROW_ON_ERROR), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $output
        );
    }
}
