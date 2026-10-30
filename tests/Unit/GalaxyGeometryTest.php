<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../api/galaxy_gen.php';

final class GalaxyGeometryTest extends TestCase {
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