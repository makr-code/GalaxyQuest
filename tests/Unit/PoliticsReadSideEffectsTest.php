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

    public function testPoliticsReadHelpersDoNotHideDatabaseFailuresAsEmptyData(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/politics.php');
        self::assertIsString($source);

        $functionRanges = [
            ['function load_catalog(', 'function load_user_empire_profile('],
            ['function load_user_empire_profile(', 'function load_user_faction_state_rows('],
            ['function load_user_faction_state_rows(', 'function normalize_civic_keys('],
        ];

        foreach ($functionRanges as [$functionStart, $nextFunction]) {
            $start = strpos($source, $functionStart);
            $end = strpos($source, $nextFunction, $start);
            self::assertNotFalse($start, $functionStart . ' must exist.');
            self::assertNotFalse($end, $nextFunction . ' must exist.');
            self::assertStringNotContainsString('catch (Throwable', substr($source, $start, $end - $start));
        }

        self::assertStringContainsString('if (!$profile)', $source);
        self::assertStringContainsString("'user_id' => \$uid", $source);
    }
}
