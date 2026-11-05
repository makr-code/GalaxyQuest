<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use DomainException;
use GalaxyQuest\Fleet\FleetTrajectory;
use InvalidArgumentException;
use LengthException;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../src/Fleet/FleetTrajectory.php';

final class FleetTrajectoryTest extends TestCase
{
    public function testGravityPointsTowardTheSourceAndScalesWithItsMass(): void
    {
        $position = ['x' => 1.0, 'y' => 0.0, 'z' => 0.0];
        $body = ['position' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0], 'mass_solar' => 1.0];

        $oneSolarMass = FleetTrajectory::gravitationalAcceleration($position, [$body]);
        $twoSolarMasses = FleetTrajectory::gravitationalAcceleration($position, [
            [...$body, 'mass_solar' => 2.0],
        ]);

        self::assertLessThan(0.0, $oneSolarMass['x']);
        self::assertSame(0.0, $oneSolarMass['y']);
        self::assertSame(0.0, $oneSolarMass['z']);
        self::assertEqualsWithDelta(2.0 * $oneSolarMass['x'], $twoSolarMasses['x'], 1.0e-15);
    }

    public function testVelocityVerletChangesCourseAndPreservesTheNoForceSolution(): void
    {
        $position = ['x' => 0.000016, 'y' => 0.0, 'z' => 0.0];
        $velocity = ['x' => 0.0, 'y' => 0.0001, 'z' => 0.0];
        $body = ['position' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0], 'mass_solar' => 1.0];

        $curved = FleetTrajectory::advance($position, $velocity, [$body], 0.1, 0.001);
        $coasting = FleetTrajectory::advance($position, $velocity, [], 0.1, 0.001);

        self::assertLessThan($position['x'], $curved['position']['x']);
        self::assertGreaterThan(0.0, $curved['position']['y']);
        self::assertEqualsWithDelta(0.000016, $coasting['position']['x'], 1.0e-15);
        self::assertEqualsWithDelta(0.00001, $coasting['position']['y'], 1.0e-15);
        self::assertSame($velocity, $coasting['velocity']);
    }

    public function testMutualGravityMaintainsBarycenterAndCurvesBothBodies(): void
    {
        $sunMass = 1.0;
        $companionMass = 0.001;
        $totalMass = $sunMass + $companionMass;
        $separation = 1.0 / 63241.07708426628;
        $gravitationalConstant = 4.0 * M_PI * M_PI / (63241.07708426628 ** 3);
        $relativeSpeed = sqrt($gravitationalConstant * $totalMass / $separation);
        $bodies = [
            [
                'mass_solar' => $sunMass,
                'position' => ['x' => -$companionMass / $totalMass * $separation, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => 0.0, 'y' => -$companionMass / $totalMass * $relativeSpeed, 'z' => 0.0],
            ],
            [
                'mass_solar' => $companionMass,
                'position' => ['x' => $sunMass / $totalMass * $separation, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => 0.0, 'y' => $sunMass / $totalMass * $relativeSpeed, 'z' => 0.0],
            ],
        ];

        $advanced = FleetTrajectory::advanceBodies($bodies, 0.25, 0.001);
        $relativeX = $advanced[1]['position']['x'] - $advanced[0]['position']['x'];
        $relativeY = $advanced[1]['position']['y'] - $advanced[0]['position']['y'];
        $advancedSeparation = sqrt($relativeX ** 2 + $relativeY ** 2);
        $centerOfMassX = ($sunMass * $advanced[0]['position']['x']
            + $companionMass * $advanced[1]['position']['x']) / $totalMass;
        $centerOfMassY = ($sunMass * $advanced[0]['position']['y']
            + $companionMass * $advanced[1]['position']['y']) / $totalMass;

        self::assertEqualsWithDelta(0.0, $centerOfMassX, 1.0e-15);
        self::assertEqualsWithDelta(0.0, $centerOfMassY, 1.0e-15);
        self::assertEqualsWithDelta($separation, $advancedSeparation, $separation * 1.0e-4);
        self::assertLessThan(0.0, $relativeX);
        self::assertGreaterThan(0.0, $relativeY);
    }

    public function testCircularOrbitPreservesClosedSystemInvariantsWithinNumericalTolerance(): void
    {
        $sunMass = 1.0;
        $companionMass = 0.001;
        $totalMass = $sunMass + $companionMass;
        $separation = 1.0 / 63241.07708426628;
        $gravitationalConstant = 4.0 * M_PI * M_PI / (63241.07708426628 ** 3);
        $relativeSpeed = sqrt($gravitationalConstant * $totalMass / $separation);
        $bodies = [
            [
                'mass_solar' => $sunMass,
                'position' => ['x' => -$companionMass / $totalMass * $separation, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => 0.0, 'y' => -$companionMass / $totalMass * $relativeSpeed, 'z' => 0.0],
            ],
            [
                'mass_solar' => $companionMass,
                'position' => ['x' => $sunMass / $totalMass * $separation, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => 0.0, 'y' => $sunMass / $totalMass * $relativeSpeed, 'z' => 0.0],
            ],
        ];

        $initial = FleetTrajectory::systemInvariants($bodies);
        $advanced = FleetTrajectory::advanceBodies($bodies, 1.0, 0.001);
        $final = FleetTrajectory::systemInvariants($advanced);

        self::assertEqualsWithDelta($totalMass, $final['mass_solar'], 1.0e-14);
        self::assertEqualsWithDelta(0.0, $final['center_of_mass']['x'], 1.0e-15);
        self::assertEqualsWithDelta(0.0, $final['center_of_mass']['y'], 1.0e-15);
        self::assertEqualsWithDelta($initial['momentum']['x'], $final['momentum']['x'], 1.0e-14);
        self::assertEqualsWithDelta($initial['momentum']['y'], $final['momentum']['y'], 1.0e-14);
        self::assertEqualsWithDelta(
            $initial['angular_momentum']['z'],
            $final['angular_momentum']['z'],
            abs($initial['angular_momentum']['z']) * 1.0e-8
        );
        self::assertEqualsWithDelta(
            $initial['total_energy'],
            $final['total_energy'],
            abs($initial['total_energy']) * 1.0e-7
        );
        self::assertLessThan(0.0, $initial['potential_energy']);
        self::assertGreaterThan(0.0, $initial['kinetic_energy']);
    }

    public function testPoweredSystemBodyKeepsThrustWhileGravityIsRecomputed(): void
    {
        $bodies = [
            [
                'mass_solar' => 1.0e-20,
                'position' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
            ],
            [
                'mass_solar' => 1.0e-20,
                'position' => ['x' => 1.0, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
            ],
        ];
        $propulsion = [
            [
                'thrust_newtons' => 1.0,
                'mass_kg' => 1.0,
                'direction' => ['x' => 0.0, 'y' => 1.0, 'z' => 0.0],
            ],
            [
                'thrust_newtons' => 0.0,
                'mass_kg' => 1.0,
                'direction' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
            ],
        ];
        $expectedAcceleration = FleetTrajectory::thrustAcceleration(
            1.0,
            1.0,
            ['x' => 0.0, 'y' => 1.0, 'z' => 0.0]
        );

        $advanced = FleetTrajectory::advanceBodiesPowered($bodies, $propulsion, 1.0, 1.0);
        $coasting = FleetTrajectory::advanceBodies($bodies, 1.0, 1.0);

        self::assertEqualsWithDelta(
            0.5 * $expectedAcceleration['y'],
            $advanced[0]['position']['y'],
            abs($expectedAcceleration['y']) * 1.0e-12
        );
        self::assertGreaterThan($coasting[0]['position']['y'], $advanced[0]['position']['y']);
        self::assertEqualsWithDelta(0.0, $advanced[1]['position']['y'], 1.0e-40);
    }

    public function testPoweredSystemRequiresOneSpecificationPerBody(): void
    {
        $this->expectException(InvalidArgumentException::class);
        FleetTrajectory::advanceBodiesPowered(
            [[
                'mass_solar' => 1.0,
                'position' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
            ]],
            [],
            0.0,
            1.0
        );
    }

    public function testSystemInvariantsRejectCoincidentPositions(): void
    {
        $body = [
            'mass_solar' => 1.0,
            'position' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
            'velocity' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
        ];

        $this->expectException(DomainException::class);
        FleetTrajectory::systemInvariants([$body, $body]);
    }

    public function testAdaptiveIntegrationResolvesAnOrbitAndIsDeterministic(): void
    {
        $sunMass = 1.0;
        $companionMass = 0.001;
        $totalMass = $sunMass + $companionMass;
        $separation = 1.0 / 63241.07708426628;
        $gravitationalConstant = 4.0 * M_PI * M_PI / (63241.07708426628 ** 3);
        $relativeSpeed = sqrt($gravitationalConstant * $totalMass / $separation);
        $bodies = [
            [
                'mass_solar' => $sunMass,
                'position' => ['x' => -$companionMass / $totalMass * $separation, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => 0.0, 'y' => -$companionMass / $totalMass * $relativeSpeed, 'z' => 0.0],
            ],
            [
                'mass_solar' => $companionMass,
                'position' => ['x' => $sunMass / $totalMass * $separation, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => 0.0, 'y' => $sunMass / $totalMass * $relativeSpeed, 'z' => 0.0],
            ],
        ];

        $adaptive = FleetTrajectory::advanceBodiesAdaptive($bodies, 0.25, 0.1);
        $repeated = FleetTrajectory::advanceBodiesAdaptive($bodies, 0.25, 0.1);
        $reference = FleetTrajectory::advanceBodies($bodies, 0.25, 0.0001);
        $adaptiveRelativeX = $adaptive[1]['position']['x'] - $adaptive[0]['position']['x'];
        $adaptiveRelativeY = $adaptive[1]['position']['y'] - $adaptive[0]['position']['y'];
        $referenceRelativeX = $reference[1]['position']['x'] - $reference[0]['position']['x'];
        $referenceRelativeY = $reference[1]['position']['y'] - $reference[0]['position']['y'];

        self::assertSame($adaptive, $repeated);
        self::assertEqualsWithDelta($referenceRelativeX, $adaptiveRelativeX, $separation * 1.0e-4);
        self::assertEqualsWithDelta($referenceRelativeY, $adaptiveRelativeY, $separation * 1.0e-4);
    }

    public function testAdaptiveIntegrationRejectsInvalidSafetyFactors(): void
    {
        $this->expectException(InvalidArgumentException::class);
        FleetTrajectory::advanceBodiesAdaptive(
            [[
                'mass_solar' => 1.0,
                'position' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
            ]],
            1.0,
            0.1,
            1.1
        );
    }

    public function testSingleBodyCoastsAndZeroDurationPreservesState(): void
    {
        $body = [
            'mass_solar' => 2.0,
            'position' => ['x' => 1.0, 'y' => -2.0, 'z' => 3.0],
            'velocity' => ['x' => 0.5, 'y' => 0.25, 'z' => -1.0],
        ];

        self::assertSame(
            [$body],
            FleetTrajectory::advanceBodies([$body], 0.0, 0.001)
        );
        $advanced = FleetTrajectory::advanceBodies([$body], 1.0, 0.1);
        self::assertSame(2.0, $advanced[0]['mass_solar']);
        self::assertEqualsWithDelta(1.5, $advanced[0]['position']['x'], 1.0e-14);
        self::assertEqualsWithDelta(-1.75, $advanced[0]['position']['y'], 1.0e-14);
        self::assertEqualsWithDelta(2.0, $advanced[0]['position']['z'], 1.0e-14);
        self::assertSame($body['velocity'], $advanced[0]['velocity']);
    }

    public function testMutualGravityRejectsOverlappingBodies(): void
    {
        $body = [
            'mass_solar' => 1.0,
            'position' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
            'velocity' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
        ];

        $this->expectException(DomainException::class);
        FleetTrajectory::advanceBodies([$body, $body], 1.0, 0.1);
    }

    public function testFiniteRadiiRejectBodiesThatPassThroughBetweenSteps(): void
    {
        $bodies = [
            [
                'mass_solar' => 1.0e-15,
                'radius_ly' => 0.05,
                'position' => ['x' => -1.0, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => 10.0, 'y' => 0.0, 'z' => 0.0],
            ],
            [
                'mass_solar' => 1.0e-15,
                'radius_ly' => 0.05,
                'position' => ['x' => 1.0, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => -10.0, 'y' => 0.0, 'z' => 0.0],
            ],
        ];

        $this->expectException(DomainException::class);
        FleetTrajectory::advanceBodies($bodies, 0.2, 0.2);
    }

    public function testFiniteRadiiAllowAPathThatMissesByMoreThanCombinedRadius(): void
    {
        $bodies = [
            [
                'mass_solar' => 1.0e-15,
                'radius_ly' => 0.05,
                'position' => ['x' => -1.0, 'y' => 0.11, 'z' => 0.0],
                'velocity' => ['x' => 10.0, 'y' => 0.0, 'z' => 0.0],
            ],
            [
                'mass_solar' => 1.0e-15,
                'radius_ly' => 0.05,
                'position' => ['x' => 1.0, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => -10.0, 'y' => 0.0, 'z' => 0.0],
            ],
        ];

        $advanced = FleetTrajectory::advanceBodies($bodies, 0.2, 0.2);

        self::assertEqualsWithDelta(1.0, $advanced[0]['position']['x'], 1.0e-12);
        self::assertEqualsWithDelta(-1.0, $advanced[1]['position']['x'], 1.0e-12);
    }

    public function testMutualGravityRejectsNegativeCollisionRadius(): void
    {
        $this->expectException(InvalidArgumentException::class);
        FleetTrajectory::advanceBodies(
            [[
                'mass_solar' => 1.0,
                'radius_ly' => -0.1,
                'position' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
                'velocity' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
            ]],
            0.0,
            0.1
        );
    }

    public function testOneSolarMassAtOneAstronomicalUnitMatchesKeplerianGravity(): void
    {
        $astronomicalUnitInLightYears = 1.0 / 63241.07708426628;
        $acceleration = FleetTrajectory::gravitationalAcceleration(
            ['x' => $astronomicalUnitInLightYears, 'y' => 0.0, 'z' => 0.0],
            [['position' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0], 'mass_solar' => 1.0]]
        );

        self::assertEqualsWithDelta(
            -4.0 * M_PI * M_PI / 63241.07708426628,
            $acceleration['x'],
            1.0e-15
        );
    }

    public function testSameThrustAcceleratesLowerMassCraftMore(): void
    {
        $direction = ['x' => 1.0, 'y' => 0.0, 'z' => 0.0];
        $light = FleetTrajectory::thrustAcceleration(100.0, 1000.0, $direction);
        $heavy = FleetTrajectory::thrustAcceleration(100.0, 2000.0, $direction);

        self::assertGreaterThan(0.0, $light['x']);
        self::assertSame(0.0, $light['y']);
        self::assertSame(0.0, $light['z']);
        self::assertEqualsWithDelta($light['x'] / 2.0, $heavy['x'], 1.0e-15);
    }

    public function testFleetPropulsionIsTheSumOfItsShipSpecifications(): void
    {
        $profile = FleetTrajectory::aggregateFleetPropulsion(
            ['scout' => 2, 'hauler' => 1, 'unused' => 0],
            [
                'scout' => ['mass_kg' => 1200.0, 'thrust_newtons' => 400.0],
                'hauler' => ['mass_kg' => 5000.0, 'thrust_newtons' => 900.0],
            ]
        );

        self::assertSame(['mass_kg' => 7400.0, 'thrust_newtons' => 1700.0], $profile);
    }

    public function testFleetPropulsionRejectsMissingShipPhysicsInsteadOfGuessing(): void
    {
        $this->expectException(InvalidArgumentException::class);
        FleetTrajectory::aggregateFleetPropulsion(
            ['unconfigured_ship' => 1],
            []
        );
    }

    public function testFleetPropulsionRejectsAnEmptyFleet(): void
    {
        $this->expectException(InvalidArgumentException::class);
        FleetTrajectory::aggregateFleetPropulsion([], []);
    }

    public function testPoweredTrajectoryCombinesThrustWithGravity(): void
    {
        $result = FleetTrajectory::advancePowered(
            ['x' => 0.000016, 'y' => 0.0, 'z' => 0.0],
            ['x' => 0.0, 'y' => 0.0001, 'z' => 0.0],
            [['position' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0], 'mass_solar' => 1.0]],
            100.0,
            1000.0,
            ['x' => 0.0, 'y' => 1.0, 'z' => 0.0],
            0.1,
            0.001
        );

        self::assertLessThan(0.000016, $result['position']['x']);
        self::assertGreaterThan(0.00001, $result['position']['y']);
        self::assertGreaterThan(0.0001, $result['velocity']['y']);
    }

    public function testIntegrationIsDeterministicAcrossRepeatedReads(): void
    {
        $position = ['x' => 1.0, 'y' => 0.0, 'z' => 0.0];
        $velocity = ['x' => 0.0, 'y' => 0.1, 'z' => 0.0];
        $bodies = [['position' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0], 'mass_solar' => 1.0]];

        self::assertSame(
            FleetTrajectory::advance($position, $velocity, $bodies, 0.5, 0.001),
            FleetTrajectory::advance($position, $velocity, $bodies, 0.5, 0.001)
        );
    }

    public function testInvalidSourcesAndUnboundedIntegrationAreRejected(): void
    {
        $this->expectException(InvalidArgumentException::class);
        FleetTrajectory::gravitationalAcceleration(
            ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
            [['position' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0], 'mass_solar' => 1.0]]
        );
    }

    public function testIntegrationRejectsRequestsAboveTheStepBudget(): void
    {
        $this->expectException(LengthException::class);
        FleetTrajectory::advance(
            ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
            ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
            [],
            101.0,
            0.001
        );
    }

    public function testGravityRejectsMalformedMassData(): void
    {
        $this->expectException(InvalidArgumentException::class);
        FleetTrajectory::gravitationalAcceleration(
            ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
            ['not-a-body']
        );
    }
}
