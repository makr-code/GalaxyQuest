<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../lib/RegistrationDraftService.php';
require_once __DIR__ . '/../../lib/RegistrationPortraitService.php';
require_once __DIR__ . '/../../api/registration_portrait_generator.php';

final class RegistrationDraftTest extends TestCase {
    public function testPrivatePoliticalDraftLifecycleWithoutWorldActivation(): void {
        $dsn = getenv('GQ_REGISTRATION_MYSQL_DSN');
        if (!$dsn) self::markTestSkipped('Requires an empty disposable MySQL database (GQ_REGISTRATION_MYSQL_DSN).');
        $db = new PDO($dsn, getenv('DB_USER') ?: 'root', getenv('DB_PASS') ?: '', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        self::assertSame('galaxyquest', $db->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()')->fetchColumn(),
            'Never run this test against an existing installation.');
        foreach (['schema.sql', 'migrate_security_v1.sql', 'migrate_security_v2_totp.sql', 'migrate_admin_user_crud_v1.sql', 'migrate_fog_of_war.sql',
                  'migrate_faction_homeworlds_v1.sql', 'migrate_registration_drafts_v1.sql', 'migrate_registration_portraits_v1.sql'] as $file) {
            $db->exec(file_get_contents(__DIR__ . '/../../sql/' . $file));
        }
        ensure_star_system_columns($db);
        ensure_binary_systems_table($db);
        $worlds = FactionHomeworldSeeder::configuredWorlds(__DIR__ . '/../../config/faction_homeworlds.json', __DIR__ . '/../../fractions');
        (new FactionHomeworldSeeder($db))->seed($worlds);
        $species = [];
        foreach (['aereth', 'vor_tak', 'syl_nar', 'kryl_tha', 'zhareen', 'vel_ar'] as $code) {
            $species[$code] = json_decode(file_get_contents(__DIR__ . '/../../fractions/' . $code . '/spec.json'), true, 512, JSON_THROW_ON_ERROR);
        }
        $config = json_decode(file_get_contents(__DIR__ . '/../../config/galaxy_config.json'), true, 512, JSON_THROW_ON_ERROR);
        $service = new RegistrationDraftService($db, $species, $config['starter_homeworld']);
        self::assertSame(['schildzirkel', 'lichtbund', 'kernrat', 'schattenzirkel'], array_column($service->catalog()['factions'], 'code'));
        self::assertCount(6, $service->catalog()['species']);
        $before = $this->counts($db);
        $owner = hash('sha256', 'browser-one');
        $other = hash('sha256', 'browser-two');
        $draft = $service->prepare($owner, 'kernrat', hash('sha256', 'test-ip'));
        self::assertSame($before, $this->counts($db));
        self::assertSame('kernrat', $draft['faction_code']);
        self::assertSame('aereth', $draft['anchor_species']);
        self::assertNotEmpty($draft['planets']);
        self::assertGreaterThan(0, $draft['star']['temperature_k']);
        self::assertGreaterThan(0, $draft['star']['radius_solar']);
        foreach ($draft['planets'] as $planet) {
            self::assertGreaterThan(0, $planet['diameter_km']);
            self::assertGreaterThan(0, $planet['semi_major_axis_au']);
        }
        self::assertNotEmpty($draft['stars']);
        self::assertSame(64, strlen($draft['prolog_token']));
        self::assertEqualsWithDelta(7200, strtotime($draft['expires_at']) - time(), 10);
        self::assertSame($draft['prolog_token'], $service->prepare($owner, 'kernrat', hash('sha256', 'test-ip'))['prolog_token']);
        self::assertNull($service->status($other));
        $draft2 = $service->prepare($other, 'kernrat', hash('sha256', 'test-ip'));
        self::assertNotSame($draft['position'], $draft2['position']);
        $input = ['prolog_token' => $draft['prolog_token'], 'species_code' => 'vor_tak'];
        $character = ['prolog_token' => $draft['prolog_token'], 'name' => 'DraftCommander', 'background' => 'Frontier researcher'];
        foreach (['profile', 'character'] as $write) {
            try {
                if ($write === 'profile') $service->saveProfile($other, $input);
                else $service->saveCharacter($other, $character);
                self::fail('Another browser modified a private draft.');
            } catch (RuntimeException $error) {
                self::assertSame(410, $error->getCode());
            }
        }
        $profile = $service->saveProfile($owner, $input);
        self::assertSame('vor_tak', $profile['species_code'], 'Species must be independent of the political faction and geographic anchor.');
        $saved = $service->saveCharacter($owner, $character);
        self::assertSame(['name' => $character['name'], 'background' => $character['background']], $saved['character']);
        $portraits = new RegistrationPortraitService($db);
        $png = $this->portraitPng();
        $portraitIp = hash('sha256', 'portrait-test');
        self::assertSame('not_generated', $portraits->status($owner)['status']);
        try {
            $portraits->generate($other, $draft['prolog_token'], $portraitIp, static fn(): string => $png);
            self::fail('Another browser generated a portrait.');
        } catch (RuntimeException $error) {
            self::assertSame(410, $error->getCode());
        }
        $result = $portraits->generate($owner, $draft['prolog_token'], $portraitIp,
            function (array $snapshot) use ($portraits, $owner, $draft, $portraitIp, $png): string {
                self::assertSame('vor_tak', $snapshot['species_code']);
                self::assertSame('DraftCommander', $snapshot['character']['name']);
                self::assertSame('pending', $portraits->status($owner)['status']);
                try {
                    $portraits->generate($owner, $draft['prolog_token'], $portraitIp, static fn(): string => $png);
                    self::fail('Concurrent duplicate generation was accepted.');
                } catch (RuntimeException $error) {
                    self::assertSame(409, $error->getCode());
                }
                return $png;
            });
        self::assertSame('generated', $result['status']);
        parse_str(parse_url($result['image_url'], PHP_URL_QUERY), $query);
        self::assertSame($png, $portraits->image($owner, $query['revision']));
        self::assertSame($result, $portraits->generate($owner, $draft['prolog_token'], $portraitIp,
            static function (): never { throw new LogicException('A completed portrait must be reused.'); }));
        try {
            $portraits->image($other, $query['revision']);
            self::fail('Another browser read a private portrait.');
        } catch (RuntimeException $error) {
            self::assertSame(409, $error->getCode());
        }
        $service->saveCharacter($owner, array_replace($character, ['background' => 'Changed background']));
        self::assertSame('not_generated', $portraits->status($owner)['status']);
        try {
            $portraits->image($owner, $query['revision']);
            self::fail('Changed identity still exposed its old portrait.');
        } catch (RuntimeException $error) {
            self::assertSame(404, $error->getCode());
        }
        $db->exec('UPDATE registration_portraits SET started_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 31 SECOND)');
        try {
            $portraits->generate($owner, $draft['prolog_token'], $portraitIp,
                static function (): never { throw new RuntimeException('Test image service unavailable', 503); });
            self::fail('Failed generation returned success.');
        } catch (RuntimeException $error) {
            self::assertSame(503, $error->getCode());
        }
        self::assertSame('failed', $portraits->status($owner)['status']);
        self::assertStringContainsString('unavailable', $portraits->status($owner)['error']);
        try {
            $portraits->generate($owner, $draft['prolog_token'], $portraitIp, static fn(): string => $png);
            self::fail('Retry cooldown was ignored.');
        } catch (RuntimeException $error) {
            self::assertSame(429, $error->getCode());
        }
        $db->exec('UPDATE registration_portraits SET started_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 31 SECOND)');
        try {
            $portraits->generate($owner, $draft['prolog_token'], $portraitIp,
                function () use ($service, $owner, $character, $png): string {
                    $service->saveCharacter($owner, array_replace($character, ['name' => 'NewCommander']));
                    return $png;
                });
            self::fail('Stale generation was published after a character edit.');
        } catch (RuntimeException $error) {
            self::assertSame(409, $error->getCode());
        }
        self::assertSame('not_generated', $portraits->status($owner)['status']);
        self::assertSame(0, $portraits->status($owner)['attempts_remaining']);
        $service->saveCharacter($owner, $character);
        $service->saveProfile($other, ['prolog_token' => $draft2['prolog_token'], 'species_code' => 'vor_tak']);
        $service->saveCharacter($other, array_replace($character, ['prolog_token' => $draft2['prolog_token']]));
        foreach (['not a PNG', str_repeat('x', RegistrationPortraitService::MAX_BYTES + 1)] as $invalidImage) {
            $db->exec('UPDATE registration_portraits SET started_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 31 SECOND)');
            try {
                $portraits->generate($other, $draft2['prolog_token'], $portraitIp, static fn(): string => $invalidImage);
                self::fail('Invalid or oversized portrait was published.');
            } catch (RuntimeException $error) {
                self::assertSame(503, $error->getCode());
            }
            self::assertNull($portraits->status($other)['image_url']);
        }
        $db->exec("UPDATE registration_portraits SET status = 'pending', started_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 301 SECOND)");
        self::assertSame('failed', $portraits->status($other)['status']);
        self::assertSame(0, $portraits->status($other)['retry_after']);
        $quota = hash('sha256', 'portrait-quota');
        $db->prepare('INSERT INTO registration_limits (ip_hash, attempts) VALUES (?, 10)')->execute([$quota]);
        try {
            $portraits->generate($other, $draft2['prolog_token'], $quota, static fn(): string => $png);
            self::fail('Portrait IP quota was ignored.');
        } catch (RuntimeException $error) {
            self::assertSame(429, $error->getCode());
        }
        self::assertSame($saved['character'], $service->saveProfile($owner, $input)['character'], 'Unchanged species must preserve the character.');
        $changed = $service->saveProfile($owner, array_replace($input, ['species_code' => 'syl_nar']));
        self::assertArrayNotHasKey('character', $changed, 'Changing species invalidates the dependent character draft.');
        foreach ([['name' => '<script>'], ['background' => str_repeat('x', 801)]] as $invalid) {
            try {
                $service->saveCharacter($owner, array_replace($character, $invalid));
                self::fail('Invalid character was accepted.');
            } catch (InvalidArgumentException $error) {
                self::assertSame(400, $error->getCode());
            }
        }
        $planetId = (int)$db->query("SELECT planet_id FROM registration_drafts WHERE session_hash = '$owner'")->fetchColumn();
        $npc = (int)$db->query('SELECT user_id FROM faction_homeworlds LIMIT 1')->fetchColumn();
        try {
            (new FactionHomeworldSeeder($db))->createColony($npc, 'Must not steal draft', $draft['position']);
            self::fail('NPC seeder stole a reserved player world.');
        } catch (RuntimeException $error) {
            self::assertSame(409, $error->getCode());
        }
        self::assertTrue(PlanetReservation::isReserved($db, $planetId));
        foreach ([$owner, $other] as $caller) {
            try {
                $service->complete($caller, $input + ['email' => 'draft@example.invalid', 'password' => 'valid-password']);
                self::fail('Unverified draft activated a world.');
            } catch (RuntimeException $error) {
                self::assertSame(503, $error->getCode());
                self::assertStringContainsString('email verification', $error->getMessage());
            }
        }
        self::assertSame($before, $this->counts($db), 'Neither saving the character nor blocked activation may create real gameplay objects.');
        $replacement = $service->prepare($owner, 'lichtbund', hash('sha256', 'test-ip'));
        $remaining = $db->prepare('SELECT COUNT(*) FROM registration_portraits WHERE draft_token = ?');
        $remaining->execute([$draft['prolog_token']]);
        self::assertSame(0, (int)$remaining->fetchColumn(), 'Replacing a draft must cascade-delete its private image.');
        self::assertNotSame($draft['prolog_token'], $replacement['prolog_token']);
        self::assertSame('lichtbund', $replacement['faction_code']);
        self::assertArrayNotHasKey('species_code', $replacement);
        self::assertArrayNotHasKey('character', $replacement);
        $db->exec("UPDATE registration_drafts SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND)");
        self::assertNull($service->status($owner));
        try {
            $service->saveCharacter($owner, array_replace($character, ['prolog_token' => $replacement['prolog_token']]));
            self::fail('Expired reservation was modified.');
        } catch (RuntimeException $error) {
            self::assertSame(410, $error->getCode());
        }
        $renewed = $service->prepare($owner, 'lichtbund', hash('sha256', 'expiry-ip'));
        self::assertNotSame($replacement['prolog_token'], $renewed['prolog_token']);
        $limitedIp = hash('sha256', 'limited-ip');
        $db->prepare('INSERT INTO registration_limits (ip_hash, attempts) VALUES (?, 10)')->execute([$limitedIp]);
        try {
            $service->prepare(hash('sha256', 'rate-limited'), 'kernrat', $limitedIp);
            self::fail('Rate limit was ignored.');
        } catch (RuntimeException $error) {
            self::assertSame(429, $error->getCode());
        }
        $service->cancel($owner);
        $service->cancel($other);
        self::assertNull($service->status($owner));
    }

    private function counts(PDO $db): array {
        $counts = [];
        foreach (['users', 'colonies', 'ships', 'buildings', 'research', 'messages'] as $table) {
            $counts[$table] = (int)$db->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();
        }
        return $counts;
    }

    private function portraitPng(): string {
        $chunk = static fn(string $type, string $data): string =>
            pack('N', strlen($data)) . $type . $data . pack('N', crc32($type . $data));
        return "\x89PNG\r\n\x1a\n"
            . $chunk('IHDR', pack('NNCCCCC', 768, 1024, 8, 2, 0, 0, 0))
            . $chunk('IDAT', gzcompress(str_repeat("\0" . str_repeat("\x40\x80\xc0", 768), 1024)))
            . $chunk('IEND', '');
    }
}
