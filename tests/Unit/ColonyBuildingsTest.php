<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Smoke tests for the Colony Buildings feature (A-3).
 *
 * These tests validate the static artefacts — SQL schema, PHP API, JS client
 * methods, and IsometricModuleRenderer wiring — without requiring a running
 * database or browser.  All assertions use assertStringContainsString on the
 * raw file contents.
 *
 * Referenz: docs/gamedesign/COLONY_BUILDING_SYSTEM_DESIGN.md
 *           api/colony_buildings.php
 *           sql/migrate_colony_buildings_v1.sql
 *           js/network/api.js
 *           js/ui/IsometricModuleRenderer.js
 */
final class ColonyBuildingsTest extends TestCase
{
    private static string $root;

    public static function setUpBeforeClass(): void
    {
        self::$root = dirname(__DIR__, 2);
    }

    // ── SQL schema ────────────────────────────────────────────────────────────

    private function sqlContent(): string
    {
        return file_get_contents(self::$root . '/sql/migrate_colony_buildings_v1.sql');
    }

    public function testSqlFileExists(): void
    {
        $this->assertFileExists(self::$root . '/sql/migrate_colony_buildings_v1.sql');
    }

    public function testSqlCreatesSlotsTable(): void
    {
        $this->assertStringContainsString('CREATE TABLE IF NOT EXISTS colony_building_slots', $this->sqlContent());
    }

    public function testSqlSlotsHasColonyId(): void
    {
        $this->assertStringContainsString('colony_id', $this->sqlContent());
    }

    public function testSqlSlotsHasSlotCoordinates(): void
    {
        $this->assertStringContainsString('slot_x', $this->sqlContent());
        $this->assertStringContainsString('slot_y', $this->sqlContent());
    }

    public function testSqlSlotsHasBuildingType(): void
    {
        $this->assertStringContainsString('building_type', $this->sqlContent());
    }

    public function testSqlCreatesUpgradesTable(): void
    {
        $this->assertStringContainsString('CREATE TABLE IF NOT EXISTS colony_building_upgrades', $this->sqlContent());
    }

    public function testSqlUpgradesHasStatus(): void
    {
        $this->assertStringContainsString("ENUM('pending','done','cancelled')", $this->sqlContent());
    }

    public function testSqlUpgradesHasCompletesAt(): void
    {
        $this->assertStringContainsString('completes_at', $this->sqlContent());
    }

    // ── PHP API ───────────────────────────────────────────────────────────────

    private function apiContent(): string
    {
        return file_get_contents(self::$root . '/api/colony_buildings.php');
    }

    public function testApiFileExists(): void
    {
        $this->assertFileExists(self::$root . '/api/colony_buildings.php');
    }

    public function testApiHasGetLayoutAction(): void
    {
        $this->assertStringContainsString("case 'get_layout'", $this->apiContent());
    }

    public function testApiHasPlaceBuildingAction(): void
    {
        $this->assertStringContainsString("case 'place_building'", $this->apiContent());
    }

    public function testApiHasRemoveBuildingAction(): void
    {
        $this->assertStringContainsString("case 'remove_building'", $this->apiContent());
    }

    public function testApiHasUpgradeSlotAction(): void
    {
        $this->assertStringContainsString("case 'upgrade_slot'", $this->apiContent());
    }

    public function testApiHasGetSlotInfoAction(): void
    {
        $this->assertStringContainsString("case 'get_slot_info'", $this->apiContent());
    }

    public function testApiValidatesOwnership(): void
    {
        $this->assertStringContainsString('_assert_colony_owner', $this->apiContent());
    }

    public function testApiChecksSlotEmpty(): void
    {
        $this->assertStringContainsString('Slot already occupied', $this->apiContent());
    }

    public function testApiChecksPendingUpgrade(): void
    {
        $this->assertStringContainsString('Upgrade already pending for this slot', $this->apiContent());
    }

    // ── JS API client ─────────────────────────────────────────────────────────

    private function apiJsContent(): string
    {
        return file_get_contents(self::$root . '/js/network/api.js');
    }

    public function testApiJsHasColonyBuildingsLayout(): void
    {
        $this->assertStringContainsString('colonyBuildingsLayout', $this->apiJsContent());
    }

    public function testApiJsHasColonyBuildingsPlace(): void
    {
        $this->assertStringContainsString('colonyBuildingsPlace', $this->apiJsContent());
    }

    public function testApiJsHasColonyBuildingsRemove(): void
    {
        $this->assertStringContainsString('colonyBuildingsRemove', $this->apiJsContent());
    }

    public function testApiJsHasColonyBuildingsUpgrade(): void
    {
        $this->assertStringContainsString('colonyBuildingsUpgrade', $this->apiJsContent());
    }

    public function testApiJsHasColonyBuildingsSlotInfo(): void
    {
        $this->assertStringContainsString('colonyBuildingsSlotInfo', $this->apiJsContent());
    }

    // ── IsometricModuleRenderer wiring ────────────────────────────────────────

    private function rendererContent(): string
    {
        return file_get_contents(self::$root . '/js/ui/IsometricModuleRenderer.js');
    }

    public function testRendererHasColonyBuildingManager(): void
    {
        $this->assertStringContainsString('IsometricColonyBuildingManager', $this->rendererContent());
    }

    public function testRendererGetLayoutCallsApi(): void
    {
        $this->assertStringContainsString('colonyBuildingsLayout', $this->rendererContent());
    }

    public function testRendererPlaceBuildingCallsApi(): void
    {
        $this->assertStringContainsString('colonyBuildingsPlace', $this->rendererContent());
    }

    public function testRendererRemoveBuildingCallsApi(): void
    {
        $this->assertStringContainsString('colonyBuildingsRemove', $this->rendererContent());
    }

    public function testRendererUpgradeSlotCallsApi(): void
    {
        $this->assertStringContainsString('colonyBuildingsUpgrade', $this->rendererContent());
    }
}
