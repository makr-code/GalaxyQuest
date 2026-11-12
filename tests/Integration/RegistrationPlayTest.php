<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/RegistrationPlayService.php';

final class RegistrationPlayTest extends TestCase {
    public function testIsolatedPlayAndVerifiedAtomicPromotionPreserveProgress(): void {
        $dsn = getenv('GQ_DRAFT_PLAY_MYSQL_DSN');
        if (!$dsn) self::markTestSkipped('Requires an empty disposable gq_draft_play_* MySQL database.');
        $db = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        self::assertStringStartsWith('gq_draft_play_', $db->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()')->fetchColumn(),
            'Never run this test against an existing installation.');
        $schema = preg_replace('/^(?:CREATE DATABASE IF NOT EXISTS galaxyquest[^;]*;|USE galaxyquest;)\s*$/m', '', file_get_contents(__DIR__ . '/../../sql/schema.sql'));
        $db->exec($schema);
        $database = $db->query('SELECT DATABASE()')->fetchColumn();
        foreach (['migrate_security_v1.sql', 'migrate_security_v2_totp.sql', 'migrate_fog_of_war.sql',
                  'migrate_faction_homeworlds_v1.sql', 'migrate_registration_drafts_v1.sql', 'migrate_registration_mentor_drafts_v2.sql',
                  'migrate_registration_portraits_v1.sql', 'migrate_colony_buildings_v1.sql', 'migrate_economy_v1.sql',
                  'migrate_ship_build_queue_v1.sql', 'migrate_economy_on_demand_v1.sql', 'migrate_registration_play_v1.sql',
                  'migrate_star_spectral_wd_v1.sql'] as $file) {
            $sql = preg_replace('/^USE galaxyquest;\s*$/m', '', file_get_contents(__DIR__ . '/../../sql/' . $file));
            $db->exec($sql);
            self::assertSame($database, $db->query('SELECT DATABASE()')->fetchColumn(), 'Fixtures must never switch into the live database.');
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
        $drafts = new RegistrationDraftService($db, $species, $config['starter_homeworld']);
        $owner = hash('sha256', 'play-test-browser');
        $other = hash('sha256', 'other-browser');
        $draft = $drafts->prepare($owner, 'kernrat', hash('sha256', 'test-ip'));
        $drafts->saveProfile($owner, ['prolog_token' => $draft['prolog_token'], 'species_code' => 'aereth']);
        $drafts->saveCharacter($owner, ['prolog_token' => $draft['prolog_token'], 'name' => 'PlayableCommander', 'background' => 'Private frontier explorer']);
        $beforeUsers = (int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn();
        $beforeColonies = (int)$db->query('SELECT COUNT(*) FROM colonies')->fetchColumn();
        $play = new RegistrationPlayService($db);
        self::assertNull($play->status($owner));
        $entered = $play->enter($owner, $draft['prolog_token']);
        self::assertTrue($entered['draft_mode']);
        self::assertNull($entered['expires_at']);
        self::assertNull($play->status($other));
        self::assertSame($beforeUsers, (int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn());
        self::assertSame($beforeColonies, (int)$db->query('SELECT COUNT(*) FROM colonies')->fetchColumn());
        self::assertSame('9999-12-31 23:59:59', $db->query('SELECT expires_at FROM registration_drafts')->fetchColumn());
        self::assertSame($entered, $play->enter($owner, $draft['prolog_token']), 'Entering twice must not reset progress.');
        try {
            $play->play($other, ['kind' => 'settle']);
            self::fail('Another browser played a private world.');
        } catch (RuntimeException $error) { self::assertSame(410, $error->getCode()); }

        $state = $entered['state'];
        $state['economy']['stock']['metal'] = 20000;
        $state['economy']['stock']['crystal'] = 20000;
        $state['economy']['stock']['deuterium'] = 20000;
        $save = $db->prepare('UPDATE registration_play SET state_json = ? WHERE draft_token = ?');
        $save->execute([json_encode($state, JSON_THROW_ON_ERROR), $draft['prolog_token']]);
        $ordered = $play->play($owner, ['kind' => 'building', 'type' => 'metal_mine']);
        self::assertSame(3, $ordered['state']['queues']['building']['level']);
        self::assertSame($ordered['state'], (new RegistrationPlayService($db))->status($owner)['state']);
        $play->play($owner, ['kind' => 'research', 'type' => 'energy_tech']);
        $play->play($owner, ['kind' => 'ship', 'type' => 'small_cargo', 'count' => 2]);
        $target = array_values(array_filter($draft['planets'], static fn(array $planet): bool => $planet['position'] !== $draft['position']['position']))[0];
        $play->play($owner, ['kind' => 'fleet', 'position' => $target['position']]);
        $credentials = ['username' => 'PlayableLogin', 'email' => 'playable@example.test', 'password' => 'test-only-long-password'];
        try {
            $play->sendConfirmation($owner, $credentials, static function (): void { throw new RuntimeException('Test delivery unavailable.', 503); });
            self::fail('Mail failure returned success.');
        } catch (RuntimeException $error) { self::assertSame(503, $error->getCode()); }
        self::assertNull($db->query('SELECT verification_hash FROM registration_play')->fetchColumn());
        $token = '';
        $play->sendConfirmation($owner, $credentials, static function (string $email, string $value) use (&$token): void {
            self::assertSame('playable@example.test', $email);
            $token = $value;
        });
        self::assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $token);
        self::assertSame(86400, (int)$db->query(
            'SELECT TIMESTAMPDIFF(SECOND, verification_sent_at, verification_expires_at) FROM registration_play'
        )->fetchColumn(), 'Confirmation links must be valid for exactly 24 hours.');
        self::assertSame(hash('sha256', $token), $db->query('SELECT verification_hash FROM registration_play')->fetchColumn());
        self::assertArrayNotHasKey('verification_hash', $play->status($owner));
        try {
            $play->confirm($token === str_repeat('a', 64) ? str_repeat('b', 64) : str_repeat('a', 64));
            self::fail('An incorrect link activated the world.');
        } catch (RuntimeException $error) { self::assertSame(410, $error->getCode()); }
        try {
            $play->confirm('12345678');
            self::fail('A numeric code activated the world.');
        } catch (InvalidArgumentException $error) { self::assertStringContainsString('link', $error->getMessage()); }
        self::assertSame($beforeUsers, (int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn());
        try {
            $play->sendConfirmation($owner, $credentials, static function (): void { self::fail('A throttled email was delivered.'); });
            self::fail('Email resend was not throttled.');
        } catch (RuntimeException $error) { self::assertSame(429, $error->getCode()); }
        $db->exec('UPDATE registration_play SET verification_expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND)');
        try {
            $play->confirm($token);
            self::fail('An expired email link activated the world.');
        } catch (RuntimeException $error) { self::assertSame(410, $error->getCode()); }
        $db->exec('UPDATE registration_play SET verification_sent_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 61 SECOND)');
        $oldToken = $token;
        $play->sendConfirmation($owner, $credentials, static function (string $email, string $value) use (&$token): void { $token = $value; });
        self::assertNotSame($oldToken, $token);
        try {
            $play->confirm($oldToken);
            self::fail('A superseded link activated the world.');
        } catch (RuntimeException $error) { self::assertSame(410, $error->getCode()); }
        $snapshot = $db->query('SELECT snapshot_json FROM registration_drafts')->fetchColumn();
        $brokenDraft = json_decode($snapshot, true, 512, JSON_THROW_ON_ERROR);
        $occupied = $db->query('SELECT cb.galaxy_index AS galaxy, cb.system_index AS `system`, cb.position
            FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id LIMIT 1')->fetch();
        $brokenDraft['position'] = array_map('intval', $occupied);
        $setSnapshot = $db->prepare('UPDATE registration_drafts SET snapshot_json = ? WHERE token = ?');
        $setSnapshot->execute([json_encode($brokenDraft, JSON_THROW_ON_ERROR), $draft['prolog_token']]);
        try {
            $play->confirm($token);
            self::fail('A failed colony write partially activated the player.');
        } catch (RuntimeException $error) { self::assertSame(409, $error->getCode()); }
        finally { $setSnapshot->execute([$snapshot, $draft['prolog_token']]); }
        self::assertSame($beforeUsers, (int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn(), 'User creation must roll back with the colony write.');
        self::assertNotNull($play->status($owner), 'Failed promotion must restore the playable draft and its reservation.');
        $result = $play->confirm($token);
        $uid = $result['user']['id'];
        $cid = $result['colony_id'];
        self::assertFalse($result['draft_mode']);
        self::assertSame('PlayableLogin', $result['user']['username']);
        self::assertSame($beforeUsers + 1, (int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn());
        self::assertSame($beforeColonies + 1, (int)$db->query('SELECT COUNT(*) FROM colonies')->fetchColumn());
        self::assertNull($play->status($owner));
        try {
            $play->confirm($token);
            self::fail('A consumed link was accepted twice.');
        } catch (RuntimeException $error) { self::assertSame(410, $error->getCode()); }
        $password = $db->query("SELECT password_hash FROM users WHERE id = $uid")->fetchColumn();
        self::assertTrue(password_verify($credentials['password'], $password));
        self::assertSame(1, (int)$db->query("SELECT COUNT(*) FROM building_upgrade_queue WHERE colony_id = $cid AND status = 'running'")->fetchColumn());
        self::assertSame(1, (int)$db->query("SELECT COUNT(*) FROM ship_build_queue WHERE colony_id = $cid AND quantity = 2")->fetchColumn());
        self::assertSame(1, (int)$db->query("SELECT COUNT(*) FROM research WHERE user_id = $uid AND research_end IS NOT NULL")->fetchColumn());
        self::assertSame(1, (int)$db->query("SELECT COUNT(*) FROM fleets WHERE user_id = $uid AND `returning` = 1")->fetchColumn());
        self::assertSame(1, (int)$db->query("SELECT count FROM ships WHERE colony_id = $cid AND type = 'espionage_probe'")->fetchColumn(), 'The travelling probe must not be duplicated.');
        $archive = json_decode($db->query("SELECT state_json FROM user_draft_progress WHERE user_id = $uid")->fetchColumn(), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame('Private frontier explorer', $archive['world']['character']['background']);
        self::assertEqualsWithDelta($archive['progress']['economy']['stock']['metal'], (float)$db->query("SELECT metal FROM colonies WHERE id = $cid")->fetchColumn(), 0.001);
        self::assertSame($draft['position']['system'], (int)$db->query("SELECT cb.system_index FROM colonies c JOIN celestial_bodies cb ON cb.id=c.body_id WHERE c.id=$cid")->fetchColumn());
    }
}
