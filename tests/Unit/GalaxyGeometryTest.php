<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../api/galaxy_gen.php';

final class GalaxyGeometryTest extends TestCase {
    public function testAsteroidBeltsAreStableBoundedVisualDescriptorsForWidePlanetaryGaps(): void {
        $planets = [];
        for ($position = 1; $position <= 8; $position++) {
            $planets[] = [
                'position' => $position,
                'planet_class' => $position === 8 ? PC_COMET_BELT : 'rocky',
                'semi_major_axis_au' => 2 ** ($position - 1),
            ];
        }

        $generated = [];
        $systemIndex = 0;
        for ($candidateSystem = 1; $candidateSystem <= 256; $candidateSystem++) {
            $candidate = generate_asteroid_belts($planets, 1, $candidateSystem);
            if ($candidate !== []) {
                $generated = $candidate;
                $systemIndex = $candidateSystem;
                break;
            }
        }

        self::assertNotSame([], $generated);
        self::assertLessThanOrEqual(2, count($generated));
        self::assertSame($generated, generate_asteroid_belts($planets, 1, $systemIndex));
        foreach ($generated as $belt) {
            self::assertSame('asteroid_belt', $belt['body_type']);
            self::assertGreaterThan(0, $belt['seed']);
            self::assertGreaterThan($belt['inner_radius_au'], $belt['outer_radius_au']);
            self::assertGreaterThan($belt['inner_radius_au'], $belt['semi_major_axis_au']);
            self::assertLessThan($belt['outer_radius_au'], $belt['semi_major_axis_au']);
        }
    }

    public function testAsteroidBeltGeneratorDoesNotCreateBodiesFromACometBeltSlot(): void {
        self::assertSame([], generate_asteroid_belts([
            ['position' => 1, 'planet_class' => PC_COMET_BELT, 'semi_major_axis_au' => 40.0],
        ], 1, 1));
    }

    public function testSpurTracksOutnumberFactionRegionsAndRemainDeterministic(): void {
        $galaxyIndex = 1;
        $armCount = galaxy_arm_count($galaxyIndex);
        $galaxyConfig = galaxy_config()['galaxy'];
        $spursPerArm = (int)$galaxyConfig['spurs_per_arm'];
        self::assertGreaterThan(32, $armCount * $spursPerArm);

        $systemLimit = (int)$galaxyConfig['systems_per_galaxy'];
        $occupiedSpurs = [];
        for ($systemIndex = 1; $systemIndex <= $systemLimit; $systemIndex++) {
            $armIndex = (int)floor(gen_rand($galaxyIndex, $systemIndex, 7777) * $armCount) % $armCount;
            $radialT = ($systemIndex - 1) / max(1, $systemLimit - 1);
            $radialT = max(0.0, min(1.0, $radialT + gen_rand($galaxyIndex, $systemIndex, 3131) * 0.18 - 0.09));
            $spur = galaxy_spur_deviation($galaxyIndex, $systemIndex, $armIndex, $radialT);
            if ($spur['spur_index'] !== null) {
                $occupiedSpurs[$armIndex . ':' . $spur['spur_index']] = true;
            }
        }

        self::assertGreaterThan(32, count($occupiedSpurs));
        $systemIndex = 1234;
        $armIndex = (int)floor(gen_rand($galaxyIndex, $systemIndex, 7777) * $armCount) % $armCount;
        $radialT = ($systemIndex - 1) / max(1, $systemLimit - 1);
        $radialT = max(0.0, min(1.0, $radialT + gen_rand($galaxyIndex, $systemIndex, 3131) * 0.18 - 0.09));
        self::assertSame(
            galaxy_spur_deviation($galaxyIndex, $systemIndex, $armIndex, $radialT),
            galaxy_spur_deviation($galaxyIndex, $systemIndex, $armIndex, $radialT)
        );
    }
}