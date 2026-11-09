<?php

declare(strict_types=1);

namespace GalaxyQuest\Fleet;

use DomainException;
use InvalidArgumentException;
use LengthException;

final class FleetTrajectory
{
    public const MODEL_VERSION = 'newtonian-v1';
    private const AU_PER_LIGHT_YEAR = 63241.07708426628;
    private const METERS_PER_LIGHT_YEAR = 9.4607304725808e15;
    private const SECONDS_PER_JULIAN_YEAR = 31557600.0;
    private const GRAVITATIONAL_CONSTANT = 4.0 * M_PI * M_PI
        / (self::AU_PER_LIGHT_YEAR * self::AU_PER_LIGHT_YEAR * self::AU_PER_LIGHT_YEAR);
    private const MAX_INTEGRATION_STEPS = 100000;

    /**
     * Sum authoritative per-ship mass and thrust for a fleet.
     *
     * @param array<array-key, mixed> $ships Ship type to count.
     * @param array<string, mixed> $specifications
     * @return array{mass_kg: float, thrust_newtons: float}
     */
    public static function aggregateFleetPropulsion(array $ships, array $specifications): array
    {
        $massKg = 0.0;
        $thrustNewtons = 0.0;
        $shipCount = 0;

        foreach ($ships as $type => $count) {
            if (!is_string($type) || !is_int($count) || $count < 0) {
                throw new InvalidArgumentException('Fleet composition must contain nonnegative integer ship counts.');
            }
            if ($count === 0) {
                continue;
            }

            $specification = $specifications[$type] ?? null;
            if (!is_array($specification)
                || !isset($specification['mass_kg'], $specification['thrust_newtons'])
                || !is_numeric($specification['mass_kg']) || !is_numeric($specification['thrust_newtons'])) {
                throw new InvalidArgumentException("Missing physical specification for ship type {$type}.");
            }

            $shipMassKg = (float)$specification['mass_kg'];
            $shipThrustNewtons = (float)$specification['thrust_newtons'];
            if (!is_finite($shipMassKg) || $shipMassKg <= 0.0
                || !is_finite($shipThrustNewtons) || $shipThrustNewtons < 0.0) {
                throw new InvalidArgumentException("Invalid physical specification for ship type {$type}.");
            }

            $massKg += $shipMassKg * $count;
            $thrustNewtons += $shipThrustNewtons * $count;
            $shipCount += $count;
            if (!is_finite($massKg) || !is_finite($thrustNewtons)) {
                throw new InvalidArgumentException('Fleet physical properties exceed the supported numeric range.');
            }
        }

        if ($shipCount === 0) {
            throw new InvalidArgumentException('A fleet physics profile requires at least one ship.');
        }

        return ['mass_kg' => $massKg, 'thrust_newtons' => $thrustNewtons];
    }

    /**
     * @param array{x: float, y: float, z: float} $position Light-years.
     * @param list<mixed> $bodies
     * @return array{x: float, y: float, z: float} Acceleration in light-years/year^2.
     */
    public static function gravitationalAcceleration(array $position, array $bodies): array
    {
        self::assertVector($position, 'position');
        $acceleration = ['x' => 0.0, 'y' => 0.0, 'z' => 0.0];

        foreach ($bodies as $body) {
            if (!is_array($body) || !isset($body['mass_solar']) || !is_numeric($body['mass_solar'])
                || !is_finite((float)$body['mass_solar']) || (float)$body['mass_solar'] <= 0.0) {
                throw new InvalidArgumentException('Every gravity body must have a positive finite solar mass.');
            }
            self::assertVector($body['position'] ?? [], 'body position');

            $offset = [
                'x' => $body['position']['x'] - $position['x'],
                'y' => $body['position']['y'] - $position['y'],
                'z' => $body['position']['z'] - $position['z'],
            ];
            $distanceSquared = $offset['x'] ** 2 + $offset['y'] ** 2 + $offset['z'] ** 2;
            if ($distanceSquared === 0.0) {
                throw new InvalidArgumentException('Trajectory position overlaps a point-mass gravity source.');
            }

            $scale = self::GRAVITATIONAL_CONSTANT * (float)$body['mass_solar']
                / ($distanceSquared * sqrt($distanceSquared));
            foreach (['x', 'y', 'z'] as $axis) {
                $acceleration[$axis] += $scale * $offset[$axis];
            }
        }

        return $acceleration;
    }

    /**
     * Calculate conserved quantities and center of mass for a closed system.
     *
     * Energy uses solar-mass·light-year²/year²; momentum uses solar-mass·light-year/year.
     *
    /**
     * Calculate conserved quantities and center of mass for a closed system.
     *
     * Energy uses solar-mass·light-year²/year²; momentum uses solar-mass·light-year/year.
     *
     * @param list<array{
     *     mass_solar: float,
     *     position: array{x: float, y: float, z: float},
     *     velocity: array{x: float, y: float, z: float},
     *     radius_ly?: float
     * }> $bodies
     * @return array{
     *     mass_solar: float,
     *     center_of_mass: array{x: float, y: float, z: float},
     *     momentum: array{x: float, y: float, z: float},
     *     angular_momentum: array{x: float, y: float, z: float},
     *     kinetic_energy: float,
     *     potential_energy: float,
     *     total_energy: float
     * }
     */
    public static function systemInvariants(array $bodies): array
    {
        $bodies = self::normalizeBodies($bodies);
        $totalMass = 0.0;
        $weightedPosition = ['x' => 0.0, 'y' => 0.0, 'z' => 0.0];
        $momentum = ['x' => 0.0, 'y' => 0.0, 'z' => 0.0];
        $angularMomentum = ['x' => 0.0, 'y' => 0.0, 'z' => 0.0];
        $kineticEnergy = 0.0;

        foreach ($bodies as $body) {
            $mass = $body['mass_solar'];
            $totalMass += $mass;
            $speedSquared = 0.0;
            foreach (['x', 'y', 'z'] as $axis) {
                $weightedPosition[$axis] += $mass * $body['position'][$axis];
                $momentum[$axis] += $mass * $body['velocity'][$axis];
                $speedSquared += $body['velocity'][$axis] ** 2;
            }
            $kineticEnergy += 0.5 * $mass * $speedSquared;
            $angularMomentum['x'] += $mass
                * ($body['position']['y'] * $body['velocity']['z']
                    - $body['position']['z'] * $body['velocity']['y']);
            $angularMomentum['y'] += $mass
                * ($body['position']['z'] * $body['velocity']['x']
                    - $body['position']['x'] * $body['velocity']['z']);
            $angularMomentum['z'] += $mass
                * ($body['position']['x'] * $body['velocity']['y']
                    - $body['position']['y'] * $body['velocity']['x']);
        }

        $potentialEnergy = 0.0;
        for ($first = 0, $count = count($bodies); $first < $count; $first++) {
            for ($second = $first + 1; $second < $count; $second++) {
                $distanceSquared = 0.0;
                foreach (['x', 'y', 'z'] as $axis) {
                    $delta = $bodies[$second]['position'][$axis] - $bodies[$first]['position'][$axis];
                    $distanceSquared += $delta * $delta;
                }
                if (!is_finite($distanceSquared) || $distanceSquared <= 0.0) {
                    throw new InvalidArgumentException('System invariant calculation requires separated bodies.');
                }
                $potentialEnergy -= self::GRAVITATIONAL_CONSTANT * $bodies[$first]['mass_solar']
                    * $bodies[$second]['mass_solar'] / sqrt($distanceSquared);
            }
        }

        $centerOfMass = [
            'x' => $weightedPosition['x'] / $totalMass,
            'y' => $weightedPosition['y'] / $totalMass,
            'z' => $weightedPosition['z'] / $totalMass,
        ];
        $totalEnergy = $kineticEnergy + $potentialEnergy;
        $values = [
            $totalMass,
            ...array_values($centerOfMass),
            ...array_values($momentum),
            ...array_values($angularMomentum),
            $kineticEnergy,
            $potentialEnergy,
            $totalEnergy,
        ];
        foreach ($values as $value) {
            if (!is_finite($value)) {
                throw new InvalidArgumentException('System invariants exceed the supported numeric range.');
            }
        }

        return [
            'mass_solar' => $totalMass,
            'center_of_mass' => $centerOfMass,
            'momentum' => $momentum,
            'angular_momentum' => $angularMomentum,
            'kinetic_energy' => $kineticEnergy,
            'potential_energy' => $potentialEnergy,
            'total_energy' => $totalEnergy,
        ];
    }

    /**
     * Advance a mutually gravitating system using velocity-Verlet integration.
     *
     * @param list<array{
     *     mass_solar: float,
     *     position: array{x: float, y: float, z: float},
     *     velocity: array{x: float, y: float, z: float},
     *     radius_ly?: float
     * }> $bodies
     * @return list<array{
     *     mass_solar: float,
     *     position: array{x: float, y: float, z: float},
     *     velocity: array{x: float, y: float, z: float},
     *     radius_ly?: float
     * }>
     */
    public static function advanceBodies(array $bodies, float $elapsedYears, float $maximumStepYears): array
    {
        $bodies = self::normalizeBodies($bodies);
        [$steps, $step] = self::integrationWindow($elapsedYears, $maximumStepYears);
        $accelerations = self::bodyAccelerations($bodies);
        if ($steps === 0) {
            return $bodies;
        }

        $propulsion = array_fill(0, count($bodies), ['x' => 0.0, 'y' => 0.0, 'z' => 0.0]);
        return self::integrateBodies($bodies, $accelerations, $propulsion, $steps, $step);
    }

    /**
     * Advance a mutually gravitating system while applying constant inertial thrust.
     *
     * Each propulsion entry corresponds to the body at the same list index.
     *
     * @param list<array{
     *     mass_solar: float,
     *     position: array{x: float, y: float, z: float},
     *     velocity: array{x: float, y: float, z: float},
     *     radius_ly?: float
     * }> $bodies
     * @param array<array-key, mixed> $propulsionByBody
     * @return list<array{
     *     mass_solar: float,
     *     position: array{x: float, y: float, z: float},
     *     velocity: array{x: float, y: float, z: float},
     *     radius_ly?: float
     * }>
     */
    public static function advanceBodiesPowered(
        array $bodies,
        array $propulsionByBody,
        float $elapsedYears,
        float $maximumStepYears
    ): array {
        $bodies = self::normalizeBodies($bodies);
        if (!array_is_list($propulsionByBody) || count($propulsionByBody) !== count($bodies)) {
            throw new InvalidArgumentException('Each system body requires one propulsion specification.');
        }
        /** @var list<mixed> $propulsionByBody */

        [$steps, $step] = self::integrationWindow($elapsedYears, $maximumStepYears);
        $accelerations = self::bodyAccelerations($bodies);
        $propulsionAccelerations = [];
        foreach ($propulsionByBody as $index => $propulsion) {
            if (!is_array($propulsion)
                || !isset($propulsion['thrust_newtons'], $propulsion['mass_kg'], $propulsion['direction'])
                || !is_numeric($propulsion['thrust_newtons']) || !is_numeric($propulsion['mass_kg'])
                || !is_finite((float)$propulsion['thrust_newtons']) || !is_finite((float)$propulsion['mass_kg'])
                || !is_array($propulsion['direction'])) {
                throw new InvalidArgumentException("Invalid propulsion specification for system body {$index}.");
            }
            $propulsionAccelerations[$index] = self::thrustAcceleration(
                (float)$propulsion['thrust_newtons'],
                (float)$propulsion['mass_kg'],
                $propulsion['direction']
            );
            $accelerations[$index] = self::withPropulsion(
                $accelerations[$index],
                $propulsionAccelerations[$index]
            );
        }

        foreach ($accelerations as $acceleration) {
            self::assertVector($acceleration, 'body acceleration');
        }
        if ($steps === 0) {
            return $bodies;
        }

        return self::integrateBodies($bodies, $accelerations, $propulsionAccelerations, $steps, $step);
    }

    /**
     * @param list<array{
     *     mass_solar: float,
     *     position: array{x: float, y: float, z: float},
     *     velocity: array{x: float, y: float, z: float},
     *     radius_ly?: float
     * }> $bodies
     * @param list<array{x: float, y: float, z: float}> $accelerations
     * @param list<array{x: float, y: float, z: float}> $propulsion
     * @return list<array{
     *     mass_solar: float,
     *     position: array{x: float, y: float, z: float},
     *     velocity: array{x: float, y: float, z: float},
     *     radius_ly?: float
     * }>
     */
    private static function integrateBodies(
        array $bodies,
        array $accelerations,
        array $propulsion,
        int $steps,
        float $step
    ): array {
        for ($index = 0; $index < $steps; $index++) {
            $nextBodies = $bodies;
            foreach ($bodies as $bodyIndex => $body) {
                foreach (['x', 'y', 'z'] as $axis) {
                    $nextBodies[$bodyIndex]['position'][$axis] = $body['position'][$axis]
                        + $body['velocity'][$axis] * $step
                        + 0.5 * $accelerations[$bodyIndex][$axis] * $step * $step;
                }
                self::assertVector($nextBodies[$bodyIndex]['position'], 'body position');
            }

            self::assertNoCollisionAlongStep($bodies, $nextBodies);
            $nextAccelerations = self::bodyAccelerations($nextBodies);
            foreach ($nextAccelerations as $bodyIndex => $nextAcceleration) {
                $nextAccelerations[$bodyIndex] = self::withPropulsion(
                    $nextAcceleration,
                    $propulsion[$bodyIndex]
                );
            }
            foreach ($nextBodies as $bodyIndex => &$body) {
                foreach (['x', 'y', 'z'] as $axis) {
                    $body['velocity'][$axis] += 0.5
                        * ($accelerations[$bodyIndex][$axis] + $nextAccelerations[$bodyIndex][$axis]) * $step;
                }
                self::assertVector($body['velocity'], 'body velocity');
            }
            unset($body);
            $bodies = $nextBodies;
            $accelerations = $nextAccelerations;
        }

        return $bodies;
    }

    /**
     * Advance a mutually gravitating system with deterministic encounter-aware steps.
     *
     * The safety factor scales both the gravitational dynamical-time limit and
     * the distance-travel limit; a value below 1.0 requests finer integration.
     *
     * @param list<array{
     *     mass_solar: float,
     *     position: array{x: float, y: float, z: float},
     *     velocity: array{x: float, y: float, z: float},
     *     radius_ly?: float
     * }> $bodies
     * @return list<array{
     *     mass_solar: float,
     *     position: array{x: float, y: float, z: float},
     *     velocity: array{x: float, y: float, z: float},
     *     radius_ly?: float
     * }>
     */
    public static function advanceBodiesAdaptive(
        array $bodies,
        float $elapsedYears,
        float $maximumStepYears,
        float $safetyFactor = 0.01
    ): array {
        $bodies = self::normalizeBodies($bodies);
        if (!is_finite($elapsedYears) || $elapsedYears < 0.0
            || !is_finite($maximumStepYears) || $maximumStepYears <= 0.0
            || !is_finite($safetyFactor) || $safetyFactor <= 0.0 || $safetyFactor > 1.0) {
            throw new InvalidArgumentException('Adaptive integration requires valid duration, step and safety factor.');
        }
        if ($elapsedYears === 0.0) {
            self::bodyAccelerations($bodies);
            return $bodies;
        }

        $accelerations = self::bodyAccelerations($bodies);
        $remainingYears = $elapsedYears;
        $steps = 0;
        while ($remainingYears > 0.0) {
            if (++$steps > self::MAX_INTEGRATION_STEPS) {
                throw new LengthException('Trajectory exceeds the deterministic integration step limit.');
            }

            $step = min($maximumStepYears, self::adaptiveStepLimit($bodies, $safetyFactor), $remainingYears);
            $nextRemainingYears = $remainingYears - $step;
            if (!is_finite($step) || $step <= 0.0
                || ($nextRemainingYears === $remainingYears && $remainingYears > 0.0)) {
                throw new LengthException('Adaptive trajectory step is below the supported numeric resolution.');
            }

            $nextBodies = $bodies;
            foreach ($bodies as $bodyIndex => $body) {
                foreach (['x', 'y', 'z'] as $axis) {
                    $nextBodies[$bodyIndex]['position'][$axis] = $body['position'][$axis]
                        + $body['velocity'][$axis] * $step
                        + 0.5 * $accelerations[$bodyIndex][$axis] * $step * $step;
                }
                self::assertVector($nextBodies[$bodyIndex]['position'], 'body position');
            }

            self::assertNoCollisionAlongStep($bodies, $nextBodies);
            $nextAccelerations = self::bodyAccelerations($nextBodies);
            foreach ($nextBodies as $bodyIndex => &$body) {
                foreach (['x', 'y', 'z'] as $axis) {
                    $body['velocity'][$axis] += 0.5
                        * ($accelerations[$bodyIndex][$axis] + $nextAccelerations[$bodyIndex][$axis]) * $step;
                }
                self::assertVector($body['velocity'], 'body velocity');
            }
            unset($body);

            $remainingYears = $nextRemainingYears;
            if ($remainingYears < $elapsedYears * PHP_FLOAT_EPSILON) {
                $remainingYears = 0.0;
            }
            $bodies = $nextBodies;
            $accelerations = $nextAccelerations;
        }

        return $bodies;
    }

    /**
     * @param array{x: float, y: float, z: float} $position Light-years.
     * @param array{x: float, y: float, z: float} $velocity Light-years/year.
     * @param list<array{mass_solar: float, position: array{x: float, y: float, z: float}}> $bodies
     * @return array{position: array{x: float, y: float, z: float}, velocity: array{x: float, y: float, z: float}}
     */
    public static function advance(
        array $position,
        array $velocity,
        array $bodies,
        float $elapsedYears,
        float $maximumStepYears
    ): array {
        return self::integrate($position, $velocity, $bodies, ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
            $elapsedYears, $maximumStepYears);
    }

    /**
     * Convert a propulsion force into acceleration in light-years/year^2.
     *
     * @param array<string, mixed> $direction Inertial thrust direction.
     * @return array{x: float, y: float, z: float}
     */
    public static function thrustAcceleration(float $thrustNewtons, float $massKg, array $direction): array
    {
        self::assertVector($direction, 'thrust direction');
        if (!is_finite($thrustNewtons) || $thrustNewtons < 0.0 || !is_finite($massKg) || $massKg <= 0.0) {
            throw new InvalidArgumentException('Thrust must be nonnegative and craft mass must be positive.');
        }
        if ($thrustNewtons === 0.0) {
            return ['x' => 0.0, 'y' => 0.0, 'z' => 0.0];
        }

        $length = sqrt($direction['x'] ** 2 + $direction['y'] ** 2 + $direction['z'] ** 2);
        if ($length === 0.0 || !is_finite($length)) {
            throw new InvalidArgumentException('A positive thrust requires a finite nonzero direction.');
        }

        $scale = ($thrustNewtons / $massKg)
            * (self::SECONDS_PER_JULIAN_YEAR ** 2 / self::METERS_PER_LIGHT_YEAR) / $length;
        return [
            'x' => $direction['x'] * $scale,
            'y' => $direction['y'] * $scale,
            'z' => $direction['z'] * $scale,
        ];
    }

    /**
     * Advance a powered flight segment using fixed inertial thrust and gravity.
     *
     * @param array{x: float, y: float, z: float} $position Light-years.
     * @param array{x: float, y: float, z: float} $velocity Light-years/year.
     * @param list<array{mass_solar: float, position: array{x: float, y: float, z: float}}> $bodies
     * @param array{x: float, y: float, z: float} $thrustDirection
     * @return array{position: array{x: float, y: float, z: float}, velocity: array{x: float, y: float, z: float}}
     */
    public static function advancePowered(
        array $position,
        array $velocity,
        array $bodies,
        float $thrustNewtons,
        float $massKg,
        array $thrustDirection,
        float $elapsedYears,
        float $maximumStepYears
    ): array {
        $propulsion = self::thrustAcceleration($thrustNewtons, $massKg, $thrustDirection);
        return self::integrate($position, $velocity, $bodies, $propulsion, $elapsedYears, $maximumStepYears);
    }

    /**
     * @param array{x: float, y: float, z: float} $position Light-years.
     * @param array{x: float, y: float, z: float} $velocity Light-years/year.
     * @param list<array{mass_solar: float, position: array{x: float, y: float, z: float}}> $bodies
     * @param array{x: float, y: float, z: float} $propulsion Light-years/year^2.
     * @return array{position: array{x: float, y: float, z: float}, velocity: array{x: float, y: float, z: float}}
     */
    private static function integrate(
        array $position,
        array $velocity,
        array $bodies,
        array $propulsion,
        float $elapsedYears,
        float $maximumStepYears
    ): array {
        self::assertVector($position, 'position');
        self::assertVector($velocity, 'velocity');
        self::assertVector($propulsion, 'propulsion acceleration');
        [$steps, $step] = self::integrationWindow($elapsedYears, $maximumStepYears);
        if ($steps === 0) {
            return ['position' => $position, 'velocity' => $velocity];
        }

        $acceleration = self::withPropulsion(self::gravitationalAcceleration($position, $bodies), $propulsion);

        for ($index = 0; $index < $steps; $index++) {
            $nextPosition = [];
            foreach (['x', 'y', 'z'] as $axis) {
                $nextPosition[$axis] = $position[$axis] + $velocity[$axis] * $step
                    + 0.5 * $acceleration[$axis] * $step * $step;
            }
            $nextAcceleration = self::withPropulsion(
                self::gravitationalAcceleration($nextPosition, $bodies),
                $propulsion
            );
            foreach (['x', 'y', 'z'] as $axis) {
                $velocity[$axis] += 0.5 * ($acceleration[$axis] + $nextAcceleration[$axis]) * $step;
            }
            $position = $nextPosition;
            $acceleration = $nextAcceleration;
        }

        return ['position' => $position, 'velocity' => $velocity];
    }

    /**
     * @param list<mixed> $bodies
     * @return list<array{
     *     mass_solar: float,
     *     position: array{x: float, y: float, z: float},
     *     velocity: array{x: float, y: float, z: float},
     *     radius_ly?: float
     * }>
     */
    private static function normalizeBodies(array $bodies): array
    {
        if ($bodies === []) {
            throw new InvalidArgumentException('A gravitational system requires at least one body.');
        }

        $normalized = [];
        foreach ($bodies as $body) {
            if (!is_array($body) || !isset($body['mass_solar']) || !is_numeric($body['mass_solar'])
                || !is_finite((float)$body['mass_solar']) || (float)$body['mass_solar'] <= 0.0) {
                throw new InvalidArgumentException('Every system body must have a positive finite solar mass.');
            }
            self::assertVector($body['position'] ?? [], 'body position');
            self::assertVector($body['velocity'] ?? [], 'body velocity');

            $normalizedBody = [
                'mass_solar' => (float)$body['mass_solar'],
                'position' => [
                    'x' => (float)$body['position']['x'],
                    'y' => (float)$body['position']['y'],
                    'z' => (float)$body['position']['z'],
                ],
                'velocity' => [
                    'x' => (float)$body['velocity']['x'],
                    'y' => (float)$body['velocity']['y'],
                    'z' => (float)$body['velocity']['z'],
                ],
            ];
            if (array_key_exists('radius_ly', $body)) {
                if (!is_numeric($body['radius_ly']) || !is_finite((float)$body['radius_ly'])
                    || (float)$body['radius_ly'] < 0.0) {
                    throw new InvalidArgumentException('A body radius must be finite and nonnegative.');
                }
                $normalizedBody['radius_ly'] = (float)$body['radius_ly'];
            }
            $normalized[] = $normalizedBody;
        }

        self::assertNoCollisionAlongStep($normalized, $normalized);
        return $normalized;
    }

    /**
     * Rejects collisions on the linear segment between two integration states.
     *
     * @param list<array{
     *     position: array{x: float, y: float, z: float},
     *     radius_ly?: float
     * }> $start
     * @param list<array{
     *     position: array{x: float, y: float, z: float},
     *     radius_ly?: float
     * }> $end
     */
    private static function assertNoCollisionAlongStep(array $start, array $end): void
    {
        for ($first = 0, $count = count($start); $first < $count; $first++) {
            for ($second = $first + 1; $second < $count; $second++) {
                $relativeStart = [];
                $relativeTravel = [];
                foreach (['x', 'y', 'z'] as $axis) {
                    $relativeStart[$axis] = $start[$second]['position'][$axis] - $start[$first]['position'][$axis];
                    $relativeTravel[$axis] = ($end[$second]['position'][$axis] - $start[$second]['position'][$axis])
                        - ($end[$first]['position'][$axis] - $start[$first]['position'][$axis]);
                }

                $travelSquared = $relativeTravel['x'] ** 2 + $relativeTravel['y'] ** 2 + $relativeTravel['z'] ** 2;
                $closestFraction = 0.0;
                if ($travelSquared > 0.0 && is_finite($travelSquared)) {
                    $dot = $relativeStart['x'] * $relativeTravel['x']
                        + $relativeStart['y'] * $relativeTravel['y']
                        + $relativeStart['z'] * $relativeTravel['z'];
                    $closestFraction = max(0.0, min(1.0, -$dot / $travelSquared));
                }

                $closestDistanceSquared = 0.0;
                foreach (['x', 'y', 'z'] as $axis) {
                    $closestDelta = $relativeStart[$axis] + $closestFraction * $relativeTravel[$axis];
                    $closestDistanceSquared += $closestDelta * $closestDelta;
                }
                $collisionRadius = ($start[$first]['radius_ly'] ?? 0.0) + ($start[$second]['radius_ly'] ?? 0.0);
                if (!is_finite($closestDistanceSquared)
                    || $closestDistanceSquared <= $collisionRadius * $collisionRadius) {
                    throw new DomainException('Two system bodies collide during the requested trajectory step.');
                }
            }
        }
    }

    /**
     * @param list<array{
     *     mass_solar: float,
     *     position: array{x: float, y: float, z: float},
     *     velocity: array{x: float, y: float, z: float}
     * }> $bodies
     * @return list<array{x: float, y: float, z: float}>
     */
    private static function bodyAccelerations(array $bodies): array
    {
        $accelerations = array_fill(0, count($bodies), ['x' => 0.0, 'y' => 0.0, 'z' => 0.0]);
        for ($first = 0, $count = count($bodies); $first < $count; $first++) {
            for ($second = $first + 1; $second < $count; $second++) {
                $offset = [
                    'x' => $bodies[$second]['position']['x'] - $bodies[$first]['position']['x'],
                    'y' => $bodies[$second]['position']['y'] - $bodies[$first]['position']['y'],
                    'z' => $bodies[$second]['position']['z'] - $bodies[$first]['position']['z'],
                ];
                $distanceSquared = $offset['x'] ** 2 + $offset['y'] ** 2 + $offset['z'] ** 2;
                if (!is_finite($distanceSquared) || $distanceSquared === 0.0) {
                    throw new InvalidArgumentException('System bodies must have a finite, nonzero separation.');
                }

                $inverseDistanceCubed = 1.0 / ($distanceSquared * sqrt($distanceSquared));
                $firstScale = self::GRAVITATIONAL_CONSTANT * $bodies[$second]['mass_solar']
                    * $inverseDistanceCubed;
                $secondScale = self::GRAVITATIONAL_CONSTANT * $bodies[$first]['mass_solar']
                    * $inverseDistanceCubed;
                if (!is_finite($firstScale) || !is_finite($secondScale)) {
                    throw new InvalidArgumentException('System body acceleration exceeds the supported numeric range.');
                }
                foreach (['x', 'y', 'z'] as $axis) {
                    $accelerations[$first][$axis] += $firstScale * $offset[$axis];
                    $accelerations[$second][$axis] -= $secondScale * $offset[$axis];
                    if (!is_finite($accelerations[$first][$axis]) || !is_finite($accelerations[$second][$axis])) {
                        throw new InvalidArgumentException('System body acceleration exceeds the supported numeric range.');
                    }
                }
            }
        }

        return $accelerations;
    }

    /**
     * @param list<array{
     *     mass_solar: float,
     *     position: array{x: float, y: float, z: float},
     *     velocity: array{x: float, y: float, z: float}
     * }> $bodies
     */
    private static function adaptiveStepLimit(array $bodies, float $safetyFactor): float
    {
        $stepLimit = INF;
        for ($first = 0, $count = count($bodies); $first < $count; $first++) {
            for ($second = $first + 1; $second < $count; $second++) {
                $distanceSquared = 0.0;
                $relativeSpeedSquared = 0.0;
                foreach (['x', 'y', 'z'] as $axis) {
                    $positionDelta = $bodies[$second]['position'][$axis] - $bodies[$first]['position'][$axis];
                    $velocityDelta = $bodies[$second]['velocity'][$axis] - $bodies[$first]['velocity'][$axis];
                    $distanceSquared += $positionDelta * $positionDelta;
                    $relativeSpeedSquared += $velocityDelta * $velocityDelta;
                }
                if (!is_finite($distanceSquared) || !is_finite($relativeSpeedSquared) || $distanceSquared <= 0.0) {
                    throw new InvalidArgumentException('Adaptive integration requires finite, separated bodies.');
                }

                $distance = sqrt($distanceSquared);
                $totalMass = $bodies[$first]['mass_solar'] + $bodies[$second]['mass_solar'];
                $dynamicalTime = sqrt($distanceSquared * $distance / (self::GRAVITATIONAL_CONSTANT * $totalMass));
                $stepLimit = min($stepLimit, $safetyFactor * $dynamicalTime);
                if ($relativeSpeedSquared > 0.0) {
                    $stepLimit = min($stepLimit, $safetyFactor * $distance / sqrt($relativeSpeedSquared));
                }
            }
        }

        return $stepLimit;
    }

    /**
     * @return array{int, float}
     */
    private static function integrationWindow(float $elapsedYears, float $maximumStepYears): array
    {
        if (!is_finite($elapsedYears) || $elapsedYears < 0.0
            || !is_finite($maximumStepYears) || $maximumStepYears <= 0.0) {
            throw new InvalidArgumentException('Elapsed time must be nonnegative and integration step must be positive.');
        }
        if ($elapsedYears === 0.0) {
            return [0, 0.0];
        }

        $requiredSteps = ceil($elapsedYears / $maximumStepYears);
        if (!is_finite($requiredSteps) || $requiredSteps > self::MAX_INTEGRATION_STEPS) {
            throw new LengthException('Trajectory exceeds the deterministic integration step limit.');
        }
        $steps = (int)$requiredSteps;

        return [$steps, $elapsedYears / $steps];
    }

    /**
     * @param array{x: float, y: float, z: float} $gravity
     * @param array{x: float, y: float, z: float} $propulsion
     * @return array{x: float, y: float, z: float}
     */
    private static function withPropulsion(array $gravity, array $propulsion): array
    {
        return [
            'x' => $gravity['x'] + $propulsion['x'],
            'y' => $gravity['y'] + $propulsion['y'],
            'z' => $gravity['z'] + $propulsion['z'],
        ];
    }

    /**
     * @param array<string, mixed> $vector
     */
    private static function assertVector(array $vector, string $name): void
    {
        foreach (['x', 'y', 'z'] as $axis) {
            if (!isset($vector[$axis]) || !is_numeric($vector[$axis]) || !is_finite((float)$vector[$axis])) {
                throw new InvalidArgumentException("The {$name} vector must contain finite x, y and z coordinates.");
            }
        }
    }
}
