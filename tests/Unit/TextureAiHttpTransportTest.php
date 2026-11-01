<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\TextureAiHttpTransport;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;
use RuntimeException;

final class TextureAiHttpTransportTest extends TestCase
{
    public static function setUpBeforeClass(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/textures-ai.php');
        $offset = $source === false ? false : strpos($source, 'class GQTextureAiService');
        if ($offset === false) {
            throw new RuntimeException('Cannot locate texture service.');
        }
        // Unlike protocol mocks, this namespace uses PHP's real HTTP stream wrapper.
        eval('namespace ' . __NAMESPACE__ . '; use \RuntimeException; use \JsonException; use \Exception; '
            . substr($source, $offset));
    }

    /** @return iterable<array{int}> */
    public static function statuses(): iterable
    {
        yield [200];
        yield [302];
        yield [503];
    }

    #[DataProvider('statuses')]
    public function testRealHttpStatusAndRedirectPolicy(int $status): void
    {
        $script = <<<'PHP'
$server = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
if ($server === false) { fwrite(STDERR, $error); exit(1); }
echo stream_socket_get_name($server, false) . "\n";
flush();
$client = stream_socket_accept($server, 5);
if ($client === false) { fclose($server); exit(2); }
stream_set_timeout($client, 5);
while (($line = fgets($client)) !== false && trim($line) !== '') {}
fwrite($client, "HTTP/1.1 STATUS Result\r\nLocation: http://127.0.0.1:1/forbidden\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
fclose($client);
fclose($server);
PHP;
        $process = proc_open(
            [PHP_BINARY, '-r', str_replace('STATUS', (string)$status, $script)],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes
        );
        if ($process === false) {
            throw new RuntimeException('Cannot start isolated HTTP fixture.');
        }
        fclose($pipes[0]);
        stream_set_timeout($pipes[1], 5);
        try {
            $address = trim((string)fgets($pipes[1]));
            $this->assertMatchesRegularExpression('/^127\.0\.0\.1:\d+$/', $address);
            $service = new class extends GQTextureAiService {
                public function __construct() {}
            };
            $method = new ReflectionMethod(GQTextureAiService::class, 'readHttpResponse');
            if ($status !== 200) {
                $this->expectException(RuntimeException::class);
                $this->expectExceptionMessage('ComfyUI HTTP ' . $status);
            }
            $this->assertSame('{}', $method->invoke(
                $service, 'http://' . $address, stream_context_create(['http' => ['timeout' => 5]]), 1024
            ));
        } finally {
            fclose($pipes[1]);
            fclose($pipes[2]);
            $this->assertSame(0, proc_close($process));
        }
    }
}
