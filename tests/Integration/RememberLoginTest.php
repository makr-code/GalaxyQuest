<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class RememberLoginTest extends TestCase
{
    private ?PDO $db = null;
    private string $database = '';
    private string $sessionDirectory = '';
    private mixed $server = null;
    private array $pipes = [];
    private int $port = 0;
    private array $cookies = [];
    private array $sessionIds = [];

    protected function setUp(): void
    {
        if (getenv('GQ_REMEMBER_MYSQL_TESTS') !== '1') {
            self::markTestSkipped('Set GQ_REMEMBER_MYSQL_TESTS=1 for disposable-database HTTP cookie tests.');
        }
        $user = getenv('GQ_REMEMBER_TEST_USER') ?: DB_USER;
        $password = getenv('GQ_REMEMBER_TEST_PASSWORD') ?: DB_PASS;
        $this->db = new PDO('mysql:host=' . DB_HOST . ';port=' . DB_PORT, $user, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
        $database = 'gq_remember_test_' . bin2hex(random_bytes(6));
        $this->db->exec('CREATE DATABASE `' . $database . '`');
        $this->database = $database;
        $this->db->exec('USE `' . $this->database . '`');
        $this->db->exec("CREATE TABLE users (
            id INT PRIMARY KEY, username VARCHAR(80), email VARCHAR(120), password_hash VARCHAR(255),
            is_admin INT DEFAULT 0, totp_enabled INT DEFAULT 0, deleted_at DATETIME NULL,
            control_type VARCHAR(20) DEFAULT 'human', auth_enabled INT DEFAULT 1,
            dark_matter INT DEFAULT 0, rank_points INT DEFAULT 0, protection_until DATETIME NULL,
            vacation_mode INT DEFAULT 0, pvp_mode INT DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME NULL
        ) ENGINE=InnoDB;
        CREATE TABLE remember_tokens (
            id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id INT, selector CHAR(18) UNIQUE,
            token_hash CHAR(64), expires_at DATETIME, last_used_at DATETIME NULL
        ) ENGINE=InnoDB;
        CREATE TABLE login_attempts (
            ip_hash CHAR(64) PRIMARY KEY, attempt_count INT, first_attempt_at DATETIME, locked_until DATETIME NULL
        ) ENGINE=InnoDB;
        CREATE TABLE user_achievements (user_id INT, completed INT, reward_claimed INT);
        CREATE TABLE user_faction_quests (user_id INT, status VARCHAR(30))");
        $this->db->prepare('INSERT INTO users (id, username, email, password_hash) VALUES (7, ?, ?, ?)')
            ->execute(['RememberTest', 'remember@example.test', password_hash('test-only-long-password', PASSWORD_DEFAULT)]);

        $this->sessionDirectory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . $this->database;
        self::assertTrue(mkdir($this->sessionDirectory, 0700));
        $socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        self::assertIsResource($socket, $error);
        $address = stream_socket_get_name($socket, false);
        $this->port = (int)substr(strrchr($address, ':'), 1);
        fclose($socket);
        $root = dirname(__DIR__, 2);
        $this->server = proc_open([
            PHP_BINARY, '-d', 'session.save_path=' . $this->sessionDirectory,
            '-S', '127.0.0.1:' . $this->port, '-t', $root,
        ], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $this->pipes, $root,
            array_merge((array)getenv(), ['DB_NAME' => $this->database, 'DB_USER' => $user, 'DB_PASS' => $password]));
        self::assertIsResource($this->server);
        foreach ([1, 2] as $index) stream_set_blocking($this->pipes[$index], false);
        $deadline = microtime(true) + 10;
        do {
            $probe = @stream_socket_client('tcp://127.0.0.1:' . $this->port, $errno, $error, 0.1);
            if (is_resource($probe)) {
                fclose($probe);
                return;
            }
            self::assertTrue(proc_get_status($this->server)['running'], 'Test API server exited.');
            usleep(20000);
        } while (microtime(true) < $deadline);
        self::fail('Test API server was not ready.');
    }

    protected function tearDown(): void
    {
        if (is_resource($this->server)) {
            proc_terminate($this->server);
            foreach ($this->pipes as $pipe) if (is_resource($pipe)) fclose($pipe);
            proc_close($this->server);
        }
        if ($this->db && $this->database !== '') {
            $this->db->exec('DROP DATABASE IF EXISTS `' . $this->database . '`');
        }
        foreach (array_unique($this->sessionIds) as $id) {
            $file = $this->sessionDirectory . DIRECTORY_SEPARATOR . 'sess_' . $id;
            if (is_file($file)) unlink($file);
        }
        if ($this->sessionDirectory !== '' && is_dir($this->sessionDirectory)) rmdir($this->sessionDirectory);
    }

    private function request(string $action, ?array $body = null, ?string $csrf = null): array
    {
        $headers = ['Accept: application/json', 'Connection: close'];
        if ($this->cookies) {
            $headers[] = 'Cookie: ' . implode('; ', array_map(
                static fn(string $name, string $value): string => $name . '=' . $value,
                array_keys($this->cookies), array_values($this->cookies)
            ));
        }
        if ($csrf !== null) $headers[] = 'X-CSRF-Token: ' . $csrf;
        if ($body !== null) $headers[] = 'Content-Type: application/json';
        $context = stream_context_create(['http' => [
            'method' => $body === null ? 'GET' : 'POST',
            'header' => implode("\r\n", $headers),
            'content' => $body === null ? '' : json_encode($body, JSON_THROW_ON_ERROR),
            'ignore_errors' => true, 'timeout' => 10,
        ]]);
        $response = file_get_contents('http://127.0.0.1:' . $this->port . '/api/auth.php?action=' . $action,
            false, $context);
        self::assertIsString($response);
        $responseHeaders = $http_response_header;
        foreach ($responseHeaders as $header) {
            if (preg_match('/^Set-Cookie: ([^=]+)=([^;]*)/i', $header, $match)) {
                if ($match[2] === '' || $match[2] === 'deleted') unset($this->cookies[$match[1]]);
                else $this->cookies[$match[1]] = $match[2];
                if ($match[1] === 'PHPSESSID' && preg_match('/^[a-zA-Z0-9,-]+$/', $match[2])) {
                    $this->sessionIds[] = $match[2];
                }
            }
        }
        return ['data' => json_decode($response, true, 512, JSON_THROW_ON_ERROR), 'headers' => $responseHeaders];
    }

    private function login(bool $remember): array
    {
        $csrf = $this->request('csrf')['data']['token'];
        $result = $this->request('login', [
            'username' => 'RememberTest', 'password' => 'test-only-long-password', 'remember' => $remember,
        ], $csrf);
        self::assertTrue($result['data']['success']);
        return $result;
    }

    public function testPersistentCookieRestoresRotatesAndLogoutRevokesIt(): void
    {
        $result = $this->login(true);
        $header = implode("\n", $result['headers']);
        self::assertMatchesRegularExpression('/Set-Cookie: gq_remember=.*HttpOnly.*SameSite=Lax/i', $header);
        self::assertMatchesRegularExpression('/Set-Cookie: gq_remember=.*path=\//i', $header);
        $first = $this->cookies['gq_remember'];
        [$selector, $validator] = explode(':', urldecode($first));
        self::assertSame(hash('sha256', $validator),
            $this->db->query('SELECT token_hash FROM remember_tokens')->fetchColumn());
        $remaining = (int)$this->db->query('SELECT TIMESTAMPDIFF(SECOND, NOW(), expires_at) FROM remember_tokens')->fetchColumn();
        self::assertEqualsWithDelta(REMEMBER_ME_DAYS * 86400, $remaining, 5);

        unset($this->cookies['PHPSESSID']);
        $restored = $this->request('me&quiet=1');
        self::assertSame('RememberTest', $restored['data']['user']['username']);
        self::assertNotSame($first, $this->cookies['gq_remember']);
        self::assertStringStartsWith($selector . '%3A', $this->cookies['gq_remember']);
        self::assertArrayHasKey('PHPSESSID', $this->cookies);
        $stolen = $this->cookies['gq_remember'];
        self::assertTrue($this->request('logout', [])['data']['success']);
        self::assertArrayNotHasKey('gq_remember', $this->cookies);
        self::assertArrayNotHasKey('PHPSESSID', $this->cookies);
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM remember_tokens')->fetchColumn());
        $this->cookies = ['gq_remember' => $stolen];
        self::assertFalse($this->request('me&quiet=1')['data']['authenticated']);
    }

    public function testOptOutAndExpiredCookieNeverRestoreAnAccount(): void
    {
        $this->login(false);
        self::assertArrayNotHasKey('gq_remember', $this->cookies);
        unset($this->cookies['PHPSESSID']);
        self::assertFalse($this->request('me&quiet=1')['data']['authenticated']);
        $this->login(true);
        $this->db->exec('UPDATE remember_tokens SET expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND)');
        unset($this->cookies['PHPSESSID']);
        self::assertFalse($this->request('me&quiet=1')['data']['authenticated']);
        self::assertArrayNotHasKey('gq_remember', $this->cookies);
    }

    public function testPersistenceFailureIsNotReportedAsSuccessfulLogin(): void
    {
        $csrf = $this->request('csrf')['data']['token'];
        $this->db->exec('DROP TABLE remember_tokens');
        $result = $this->request('login', [
            'username' => 'RememberTest', 'password' => 'test-only-long-password', 'remember' => true,
        ], $csrf);
        self::assertFalse($result['data']['success']);
        self::assertArrayNotHasKey('gq_remember', $this->cookies);
    }
}
