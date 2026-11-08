<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class ColonizationRuntimeGateTest extends TestCase
{
    /** @return iterable<string,array{string,string,bool,bool,int}> */
    public static function requests(): iterable
    {
        foreach (
            [
                'create_sector', 'update_sector', 'delete_sector', 'assign_system', 'remove_system',
                'appoint_governor', 'dismiss_governor', 'activate_edict', 'deactivate_edict',
            ] as $action
        ) {
            yield $action => [$action, 'POST', true, true, 503];
            yield $action . ' auth' => [$action, 'POST', false, true, 401];
            yield $action . ' method' => [$action, 'GET', true, true, 405];
            yield $action . ' csrf' => [$action, 'POST', true, false, 403];
        }
    }

    #[DataProvider('requests')]
    public function testMutationGateRejectsWithoutDatabaseAccess(
        string $action,
        string $method,
        bool $auth,
        bool $csrf,
        int $status
    ): void {
        $root = sys_get_temp_dir() . '/gq-colonization-gate-' . bin2hex(random_bytes(8));
        mkdir($root);
        mkdir($root . '/api');
        mkdir($root . '/lib');
        try {
            copy(__DIR__ . '/../../api/colonization.php', $root . '/api/colonization.php');
            file_put_contents($root . '/lib/ColonizationEngine.php', '<?php');
            file_put_contents($root . '/api/helpers.php', <<<'PHP'
<?php
function json_error(string $message, int $status): never {
    echo json_encode(['success'=>false,'error'=>$message,'status'=>$status], JSON_THROW_ON_ERROR);
    exit;
}
function require_auth(): int {
    if (getenv('GQ_AUTH') !== '1') json_error('Not authenticated', 401);
    return 7;
}
function only_method(string $method): void {
    if (getenv('GQ_METHOD') !== $method) json_error('Method not allowed', 405);
}
function verify_csrf(): void {
    if (getenv('GQ_CSRF') !== '1') json_error('Invalid CSRF', 403);
}
function get_db(): PDO { throw new RuntimeException('Forbidden database access'); }
PHP);
            file_put_contents(
                $root . '/request.php',
                '<?php $_GET["action"]=getenv("GQ_ACTION"); require __DIR__."/api/colonization.php";'
            );
            $process = proc_open(
                [PHP_BINARY, $root . '/request.php'],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
                $root,
                ['GQ_ACTION' => $action, 'GQ_METHOD' => $method,
                    'GQ_AUTH' => $auth ? '1' : '0', 'GQ_CSRF' => $csrf ? '1' : '0']
            );
            if ($process === false) {
                throw new RuntimeException('Cannot start colonization gate fixture.');
            }
            fclose($pipes[0]);
            $output = stream_get_contents($pipes[1]);
            $errors = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $this->assertSame(0, proc_close($process), $errors);
            $result = json_decode($output, true, 512, JSON_THROW_ON_ERROR);
            $this->assertSame($status, $result['status']);
            $this->assertFalse($result['success']);
            if ($status === 503) {
                $this->assertStringContainsString('read-only', $result['error']);
            }
        } finally {
            foreach (['api', 'lib'] as $folder) {
                foreach (glob($root . '/' . $folder . '/*.php') as $file) {
                    unlink($file);
                }
                rmdir($root . '/' . $folder);
            }
            if (is_file($root . '/request.php')) {
                unlink($root . '/request.php');
            }
            rmdir($root);
        }
    }
}
