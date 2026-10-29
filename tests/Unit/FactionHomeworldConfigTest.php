<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../lib/FactionHomeworldSeeder.php';

final class FactionHomeworldConfigTest extends TestCase {
    public function testAllLoreFactionsHaveExplicitDistinctColonizableWorlds(): void {
        $worlds = FactionHomeworldSeeder::configuredWorlds(
            __DIR__ . '/../../config/faction_homeworlds.json', __DIR__ . '/../../fractions'
        );
        self::assertCount(19, $worlds);
        $positions = [];
        foreach ($worlds as $code => $world) {
            self::assertSame($code, $world['code']);
            self::assertTrue($world['provisional']);
            self::assertSame('draft-v1', $world['placement_version']);
            $positions[] = $world['galaxy'] . ':' . $world['system'];
        }
        self::assertCount(count($worlds), array_unique($positions));
        foreach (['aereth', 'vor_tak', 'syl_nar', 'kryl_tha', 'zhareen', 'vel_ar'] as $code) {
            self::assertSame('capital', $worlds[$code]['kind']);
        }
        self::assertSame('outpost', $worlds['nomaden_des_rifts']['kind']);
        self::assertSame('outpost', $worlds['brut_der_ewigkeit']['kind']);
    }

    public function testPlayableCapitalsAreSpatiallySeparated(): void {
        $worlds = FactionHomeworldSeeder::configuredWorlds(
            __DIR__ . '/../../config/faction_homeworlds.json', __DIR__ . '/../../fractions'
        );
        $centers = [];
        foreach (['aereth', 'vor_tak', 'syl_nar', 'kryl_tha', 'zhareen', 'vel_ar'] as $code) {
            $centers[] = galactic_position($worlds[$code]['galaxy'], $worlds[$code]['system']);
        }
        foreach ($centers as $i => $a) {
            foreach (array_slice($centers, $i + 1) as $b) {
                self::assertGreaterThan(3000, sqrt(($a[0] - $b[0]) ** 2 + ($a[1] - $b[1]) ** 2 + ($a[2] - $b[2]) ** 2));
            }
        }
    }

    public function testMissingDuplicateAndInvalidDefinitionsAreRejected(): void {
        $base = json_decode(file_get_contents(__DIR__ . '/../../config/faction_homeworlds.json'), true, 512, JSON_THROW_ON_ERROR);
        $missing = $base;
        unset($missing['worlds']['aereth']);
        $duplicate = $base;
        $duplicate['worlds']['vor_tak'] = $duplicate['worlds']['aereth'];
        $invalid = $base;
        $invalid['worlds']['aereth']['system'] = 0;
        $unknown = $base;
        $unknown['worlds']['unknown'] = $unknown['worlds']['aereth'];
        $uncolonizable = $base;
        $uncolonizable['worlds']['aereth']['system'] = 305;
        $uncolonizable['worlds']['aereth']['position'] = 1;
        $path = tempnam(sys_get_temp_dir(), 'gq-worlds-');
        try {
            foreach ([$missing, $duplicate, $invalid, $unknown, $uncolonizable] as $config) {
                file_put_contents($path, json_encode($config, JSON_THROW_ON_ERROR));
                try {
                    FactionHomeworldSeeder::configuredWorlds($path, __DIR__ . '/../../fractions');
                    self::fail('Invalid homeworld configuration accepted.');
                } catch (InvalidArgumentException $error) {
                    self::assertNotSame('', $error->getMessage());
                }
            }
        } finally {
            unlink($path);
        }
    }
}
