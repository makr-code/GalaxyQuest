<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class ShipDesignerReadSideEffectsTest extends TestCase
{
    public function testShipDesignerCatalogActionsAreGetOnlyAndDoNotPersistGameState(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/ship_designer_engine.php');
        self::assertIsString($source);

        foreach ([
            ['ship_templates', 'faction_ships'],
            ['faction_ships', 'lora_styles'],
            ['lora_styles', 'default:'],
        ] as [$action, $nextAction]) {
            $handler = $this->routeBody($source, $action, $nextAction);
            self::assertStringContainsString("only_method('GET');", $handler);
            $this->assertNoDatabaseWrites($handler);
        }

        self::assertMatchesRegularExpression(
            "/case 'generate_prompt':\\s*only_method\\('POST'\\);/",
            $source
        );

        $getFactionShips = $this->functionBody($source, 'getFactionShips');
        self::assertStringContainsString('$this->specLoader->loadFactionSpec($factionCode)', $getFactionShips);
        self::assertStringNotContainsString('catch (\\Exception', $getFactionShips);
    }

    public function testEnhancedShipDesignerReadsOnlySelectDataAndOptionalReadThroughCache(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/ship_designer_enhanced.php');
        self::assertIsString($source);

        foreach ([
            ['get_base_assets', 'get_avatar'],
            ['get_avatar', 'customize_ship'],
        ] as [$action, $nextAction]) {
            $handler = $this->routeBody($source, $action, $nextAction);
            self::assertStringContainsString("only_method('GET');", $handler);
            $this->assertNoDatabaseWrites($handler);
        }

        $baseAssets = $this->functionBody($source, 'getBaseAssets');
        self::assertStringContainsString('gq_cache_set(', $baseAssets);
        self::assertDoesNotMatchRegularExpression('/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i', $baseAssets);
        $avatar = $this->functionBody($source, 'getSpeciesAvatar');
        self::assertStringContainsString('SELECT glb_path, metadata, thumbnail_path', $avatar);
        $this->assertNoDatabaseWrites($avatar);
    }

    public function testVesselAndWireframeDesignReadsAreOwnerScopedAndDoNotMutate(): void
    {
        $vessel = file_get_contents(__DIR__ . '/../../api/vessel_designs.php');
        $wireframe = file_get_contents(__DIR__ . '/../../api/wireframe_designs.php');
        self::assertIsString($vessel);
        self::assertIsString($wireframe);

        $vesselRead = $this->between($vessel, '// Handle GET design:', 'json_error(\'Invalid request\'');
        self::assertStringContainsString("only_method('GET');", $vesselRead);
        self::assertStringContainsString('WHERE design_id = ? AND user_id = ?', $vesselRead);
        $this->assertNoDatabaseWrites($vesselRead);

        $wireframeRead = $this->functionBody($wireframe, 'handleLoadWireframeDesign');
        self::assertStringContainsString('WHERE design_id = ? AND user_id = ?', $wireframeRead);
        $this->assertNoDatabaseWrites($wireframeRead);
    }

    public function testVesselDesignErrorsAreLoggedWithoutExposingExceptionDetails(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/vessel_designs.php');
        self::assertIsString($source);

        self::assertStringContainsString('error_log("VesselDesigns error: " . $e->getMessage());', $source);
        self::assertStringContainsString("json_error('Vessel design service unavailable', 503);", $source);
        self::assertStringNotContainsString('json_error($e->getMessage(), 500);', $source);
    }

    public function testWireframeErrorsAreLoggedWithoutExposingExceptionDetails(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/wireframe_designs.php');
        self::assertIsString($source);

        self::assertStringContainsString("echo json_encode(['error' => 'Internal server error']);", $source);
        foreach ([
            'Save' => 'Unable to save wireframe design',
            'Load' => 'Unable to load wireframe design',
            'Delete' => 'Unable to delete wireframe design',
        ] as $operation => $message) {
            self::assertStringContainsString(
                "error_log('[WIREFRAME_API] {$operation} failed: ' . \$e->getMessage());",
                $source
            );
            self::assertStringContainsString("['error' => '{$message}']", $source);
        }
        self::assertStringNotContainsString("echo json_encode(['error' => \$e->getMessage()]);", $source);
    }

    private function routeBody(string $source, string $action, string $nextAction): string
    {
        $start = strpos($source, "case '" . $action . "':");
        self::assertNotFalse($start, $action . ' route must exist.');
        $nextMarker = $nextAction === 'default:'
            ? 'default:'
            : "case '" . $nextAction . "':";
        $end = strpos($source, $nextMarker, $start + 1);
        self::assertNotFalse($end, $action . ' route must be bounded.');
        return substr($source, $start, $end - $start);
    }

    private function functionBody(string $source, string $function): string
    {
        $start = strpos($source, 'function ' . $function . '(');
        self::assertNotFalse($start, $function . ' function must exist.');
        $nextFunction = strpos($source, "\n    public function ", $start + 1);
        if ($nextFunction === false) {
            $nextFunction = strpos($source, "\nfunction ", $start + 1);
        }
        $end = $nextFunction === false ? strlen($source) : $nextFunction;
        return substr($source, $start, $end - $start);
    }

    private function between(string $source, string $startMarker, string $endMarker): string
    {
        $start = strpos($source, $startMarker);
        self::assertNotFalse($start, 'Start marker must exist.');
        $end = strpos($source, $endMarker, $start + 1);
        self::assertNotFalse($end, 'End marker must exist.');
        return substr($source, $start, $end - $start);
    }

    private function assertNoDatabaseWrites(string $source): void
    {
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO\\s+[a-z_]+|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM\\s+[a-z_]+|REPLACE\\s+INTO\\s+[a-z_]+)\\b/i',
            $source
        );
    }
}
