<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/registration_handlers.php';
require_once __DIR__ . '/../../lib/RegistrationDraftService.php';

final class RegistrationReadSideEffectsTest extends TestCase
{
    private array $previousSession;

    protected function setUp(): void
    {
        $this->previousSession = $_SESSION ?? [];
        $_SESSION = [];
    }

    protected function tearDown(): void
    {
        $_SESSION = $this->previousSession;
    }

    public function testRegistrationReadsDoNotInitializeSessionOwner(): void
    {
        foreach (['register_catalog', 'register_preview', 'register_status', 'register_portrait_status', 'register_portrait_image'] as $action) {
            self::assertSame('', \registration_session_owner($action, true));
            self::assertArrayNotHasKey('registration_owner', $_SESSION);
        }
    }

    public function testDraftMutationInitializesOwnerWhileCancelDoesNot(): void
    {
        self::assertSame('', \registration_session_owner('register_cancel', false));
        self::assertArrayNotHasKey('registration_owner', $_SESSION);

        $owner = \registration_session_owner('register_prepare', false);
        self::assertSame(64, strlen((string)($_SESSION['registration_owner'] ?? '')));
        self::assertSame(hash('sha256', $_SESSION['registration_owner']), $owner);
    }

    public function testRegistrationCatalogPreviewAndStatusServicesOnlyReadPersistentState(): void
    {
        $draftService = file_get_contents(__DIR__ . '/../../lib/RegistrationDraftService.php');
        $portraitService = file_get_contents(__DIR__ . '/../../lib/RegistrationPortraitService.php');
        $handler = file_get_contents(__DIR__ . '/../../api/registration_handlers.php');
        self::assertIsString($draftService);
        self::assertIsString($portraitService);
        self::assertIsString($handler);

        $normalizedHandler = preg_replace('/\s+/', '', $handler);
        self::assertIsString($normalizedHandler);
        self::assertStringContainsString(
            "\$read=in_array(\$action,['register_catalog','register_preview','register_status','register_portrait_status','register_portrait_image',],true);",
            $normalizedHandler
        );
        self::assertStringContainsString("only_method(\$read?'GET':'POST');", $normalizedHandler);

        foreach (['catalog', 'preview', 'status'] as $method) {
            $body = $this->methodBody($draftService, $method);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO)\\b/i',
                $body,
                $method . ' must not persist registration changes.'
            );
        }

        foreach (['draft', 'portrait', 'status', 'image'] as $method) {
            $body = $this->methodBody($portraitService, $method);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO)\\b/i',
                $body,
                $method . ' must not persist portrait changes.'
            );
        }
    }

    public function testPortraitStatusDoesNotExpireAQueuedJobByAgeOrUpdateStoredState(): void
    {
        $source = file_get_contents(__DIR__ . '/../../lib/RegistrationPortraitService.php');
        self::assertIsString($source);
        $status = $this->methodBody($source, 'status');

        self::assertStringNotContainsString('Portrait generation timed out.', $status);
        self::assertDoesNotMatchRegularExpression('/\\bUPDATE\\s+registration_portraits\\b/i', $status);
    }

    public function testCatalogProjectsOnlyEstablishedPublicHomeworldScenes(): void
    {
        [$service, $rows] = $this->catalogFixture();
        $catalog = $service->catalog();
        self::assertCount(6, $catalog['species']);
        foreach ($catalog['species'] as $entry) {
            $row = $rows[$entry['code']];
            $scene = $entry['homeworld_scene'];
            $generated = \generate_star_system($row['galaxy_index'], $row['system_index']);
            self::assertSame("homeworld:{$row['galaxy_index']}:{$row['system_index']}", $scene['scene_key']);
            self::assertSame($row['system_name'], $scene['system_name']);
            self::assertSame($entry['target'], $scene['target']);
            self::assertSame([
                'galaxy' => $row['galaxy_index'], 'system' => $row['system_index'], 'position' => $row['position'],
            ], $scene['position']);
            self::assertSame([
                'temperature_k' => (int)$generated['temperature_k'], 'radius_solar' => (float)$generated['radius_solar'],
            ], $scene['star']);
            self::assertCount(count($generated['planets']), $scene['planets']);
            $inhabited = 0;
            foreach ($scene['planets'] as $index => $planet) {
                $source = $generated['planets'][$index];
                $homeworld = (int)$source['position'] === $row['position'];
                $expected = [
                    'name' => $homeworld ? $row['homeworld'] : $source['name'],
                    'position' => (int)$source['position'], 'class' => $source['planet_class'],
                    'can_colonize' => (bool)$source['can_colonize'], 'diameter_km' => (int)$source['diameter_km'],
                    'semi_major_axis_au' => (float)$source['semi_major_axis_au'],
                ];
                if ($homeworld) {
                    $expected['inhabited'] = true;
                    $inhabited++;
                }
                self::assertSame($expected, $planet);
            }
            self::assertSame(1, $inhabited);
            self::assertSame(['scene_key', 'system_name', 'target', 'position', 'star', 'planets'], array_keys($scene));
        }
        foreach ($catalog['factions'] as $faction) self::assertArrayNotHasKey('homeworld_scene', $faction);
        self::assertSame(['iron_fleet', 'helion_confederation', 'ketzer_von_verath'],
            array_column($catalog['npc_homeworlds'], 'code'));
        foreach ($catalog['npc_homeworlds'] as $entry) {
            $row = $rows[$entry['code']];
            self::assertSame($row['homeworld'], $entry['homeworld']);
            self::assertSame($entry['target'], $entry['homeworld_scene']['target']);
            self::assertSame($row['position'], $entry['homeworld_scene']['position']['position']);
            self::assertArrayNotHasKey('prolog_token', $entry['homeworld_scene']);
        }
    }

    public function testCatalogReportsMissingNpcWorldWithoutInventingItsScene(): void
    {
        [$service] = $this->catalogFixture(false, false, true);
        $catalog = $service->catalog();
        self::assertSame('Erde', $catalog['npc_homeworlds'][0]['homeworld']);
        self::assertNull($catalog['npc_homeworlds'][0]['homeworld_scene']);
        self::assertNull($catalog['npc_homeworlds'][0]['target']);
    }

    public function testCatalogRejectsHomeworldMissingFromGeneratedSystem(): void
    {
        [$service] = $this->catalogFixture(true);
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionCode(503);
        $this->expectExceptionMessage('Faction homeworld is missing from its generated system.');
        $service->catalog();
    }

    public function testCatalogRejectsHomeworldThatIsNotAPlanet(): void
    {
        [$service] = $this->catalogFixture(false, true);
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionCode(503);
        $this->expectExceptionMessage('Faction homeworld is not a star-orbiting planet.');
        $service->catalog();
    }

    private function catalogFixture(bool $missingHomeworld = false, bool $nonPlanet = false, bool $missingNpc = false): array
    {
        $worlds = json_decode(file_get_contents(__DIR__ . '/../../config/faction_homeworlds.json'), true, 512, JSON_THROW_ON_ERROR)['worlds'];
        $species = [];
        $rows = [];
        foreach (['aereth', 'vor_tak', 'syl_nar', 'kryl_tha', 'zhareen', 'vel_ar',
            'iron_fleet', 'helion_confederation', 'ketzer_von_verath'] as $index => $code) {
            if ($missingNpc && $code === 'iron_fleet') continue;
            if ($index < 6) {
                $species[$code] = json_decode(file_get_contents(__DIR__ . '/../../fractions/' . $code . '/spec.json'), true, 512, JSON_THROW_ON_ERROR);
            }
            $world = $worlds[$code];
            $rows[$code] = [
                'id' => $index + 1, 'code' => $code, 'homeworld' => 'Established ' . $code,
                'galaxy_index' => $world['galaxy'], 'system_index' => $world['system'],
                'position' => $missingHomeworld && $index === 0 ? 999 : $world['position'],
                'body_type' => $nonPlanet && $index === 0 ? 'moon' : 'planet',
                'parent_body_type' => 'star', 'system_name' => 'Stored ' . $code,
                'x_ly' => 1.5, 'y_ly' => 2.5, 'z_ly' => 3.5,
            ];
        }
        $homeworlds = $this->createMock(\PDOStatement::class);
        $homeworlds->method('fetchAll')->willReturn(array_values($rows));
        $stars = $this->createMock(\PDOStatement::class);
        $stars->method('execute')->willReturn(true);
        $stars->method('fetchAll')->willReturn([]);
        $db = $this->createMock(\PDO::class);
        $db->expects(self::once())->method('query')->willReturnCallback(static function (string $sql) use ($homeworlds): \PDOStatement {
            self::assertStringContainsString('FROM faction_homeworlds', $sql);
            self::assertStringContainsString('s.name AS system_name', $sql);
            return $homeworlds;
        });
        $db->method('prepare')->willReturnCallback(static function (string $sql) use ($stars): \PDOStatement {
            self::assertStringContainsString('FROM star_systems', $sql);
            return $stars;
        });
        $db->expects(self::never())->method('exec');
        $db->expects(self::never())->method('beginTransaction');
        return [new \RegistrationDraftService($db, $species, []), $rows];
    }

    private function methodBody(string $source, string $method): string
    {
        $start = strpos($source, 'function ' . $method . '(');
        self::assertNotFalse($start, $method . ' method must exist.');
        $tail = substr($source, $start + 1);
        $nextMethod = preg_match('/\n    (?:public|private|protected) function /', $tail, $matches, PREG_OFFSET_CAPTURE)
            ? $start + 1 + $matches[0][1]
            : false;
        $end = $nextMethod === false ? strlen($source) : $nextMethod;
        return substr($source, $start, $end - $start);
    }
}
