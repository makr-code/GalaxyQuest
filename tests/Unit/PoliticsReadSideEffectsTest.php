<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class PoliticsReadSideEffectsTest extends TestCase
{
    public function testPoliticsGetActionsDoNotCreateProfileOrCivicRows(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/politics.php');
        self::assertIsString($source);

        $catalogStart = strpos($source, "case 'catalog':");
        $presetsStart = strpos($source, "case 'presets':", $catalogStart);
        $statusStart = strpos($source, "case 'status':", $presetsStart);
        $configureStart = strpos($source, "case 'configure':", $statusStart);

        self::assertNotFalse($catalogStart);
        self::assertNotFalse($presetsStart);
        self::assertNotFalse($statusStart);
        self::assertNotFalse($configureStart);

        foreach ([
            substr($source, $catalogStart, $presetsStart - $catalogStart),
            substr($source, $presetsStart, $statusStart - $presetsStart),
            substr($source, $statusStart, $configureStart - $statusStart),
        ] as $getHandler) {
            self::assertStringContainsString("only_method('GET')", $getHandler);
            self::assertStringNotContainsString('ensure_empire_profile_row(', $getHandler);
        }

        self::assertStringContainsString(
            "'primary_species_key' => 'adaptive_humans'",
            $source
        );
        self::assertStringContainsString(
            "'government_key' => 'stellar_republic'",
            $source
        );
    }
}
