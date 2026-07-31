<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use GalaxyQuest\Galaxy\Domain\RangeValidator;

/**
 * Unit tests for RangeValidator.
 *
 * Verifies business rules for galaxy coordinate ranges.
 */
final class RangeValidatorTest extends TestCase
{
    private RangeValidator $validator;

    protected function setUp(): void
    {
        $this->validator = new RangeValidator();
    }

    public function testValidRangeWithinBounds(): void
    {
        $this->assertTrue($this->validator->isValidRange(0, 100, 0, 100));
        $this->assertTrue($this->validator->isValidRange(500, 700, 800, 900));
        $this->assertTrue($this->validator->isValidRange(5000, 5100, 5000, 5100));
    }

    public function testValidRangeAtMaxSize(): void
    {
        $maxSize = RangeValidator::getMaxRangeSize();
        $this->assertTrue(
            $this->validator->isValidRange(0, $maxSize, 0, $maxSize),
            "Range at maximum size should be valid"
        );
    }

    public function testInvalidRangeExceedsMaxSize(): void
    {
        $maxSize = RangeValidator::getMaxRangeSize();
        $this->assertFalse($this->validator->isValidRange(0, $maxSize + 1, 0, 100));
        $this->assertFalse($this->validator->isValidRange(0, 100, 0, $maxSize + 1));
    }

    public function testInvalidRangeMinGreaterThanMax(): void
    {
        $this->assertFalse($this->validator->isValidRange(200, 100, 0, 100));
        $this->assertFalse($this->validator->isValidRange(0, 100, 200, 100));
    }

    public function testInvalidRangeExceedsCoordinateBounds(): void
    {
        $min = RangeValidator::getMinCoordinate();
        $max = RangeValidator::getMaxCoordinate();

        $this->assertFalse($this->validator->isValidRange($min - 1, 100, 0, 100));
        $this->assertFalse($this->validator->isValidRange(0, $max + 1, 0, 100));
        $this->assertFalse($this->validator->isValidRange(0, 100, $min - 1, 100));
        $this->assertFalse($this->validator->isValidRange(0, 100, 0, $max + 1));
    }

    public function testGetValidationErrorForValidRange(): void
    {
        $error = $this->validator->getValidationError(0, 100, 0, 100);
        $this->assertNull($error);
    }

    public function testGetValidationErrorForInvalidRange(): void
    {
        $error = $this->validator->getValidationError(200, 100, 0, 100);
        $this->assertNotNull($error);
        $this->assertStringContainsString('Min coordinate', $error);
    }

    public function testGetValidationErrorForOutOfBoundsX(): void
    {
        $error = $this->validator->getValidationError(-1, 100, 0, 100);
        $this->assertNotNull($error);
        $this->assertStringContainsString('X coordinates', $error);
    }

    public function testGetValidationErrorForExcessiveRange(): void
    {
        $maxSize = RangeValidator::getMaxRangeSize();
        $error = $this->validator->getValidationError(0, $maxSize + 1, 0, 100);
        $this->assertNotNull($error);
        $this->assertStringContainsString('Range size', $error);
    }

    public function testGetMaxRangeSize(): void
    {
        $max = RangeValidator::getMaxRangeSize();
        $this->assertIsInt($max);
        $this->assertGreaterThan(0, $max);
    }

    public function testGetCoordinateBounds(): void
    {
        $min = RangeValidator::getMinCoordinate();
        $max = RangeValidator::getMaxCoordinate();

        $this->assertIsInt($min);
        $this->assertIsInt($max);
        $this->assertLessThan($max, $min);
    }
}
