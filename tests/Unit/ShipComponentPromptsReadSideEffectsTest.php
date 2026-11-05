<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class ShipComponentPromptsReadSideEffectsTest extends TestCase
{
    public function testPromptEndpointIsGetOnlyAndUsesOnlyInMemoryCatalogMethods(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/ship_component_prompts.php');
        self::assertIsString($source);

        $dispatchStart = strpos($source, "if (basename(__FILE__) === basename(\$_SERVER['SCRIPT_FILENAME'] ?? '')) {");
        self::assertNotFalse($dispatchStart);
        $dispatch = substr($source, $dispatchStart);
        self::assertMatchesRegularExpression(
            '/if \(basename\(__FILE__\).*?\{\s*require_once __DIR__ \. \'\/helpers\.php\';'
                . '\s*only_method\(\'GET\'\);/s',
            $dispatch
        );

        foreach ([
            'get_hull_prompt' => 'getHullPrompt',
            'get_component_prompt' => 'getComponentPrompt',
            'get_assembly_prompt' => 'getAssemblyPrompt',
            'get_geometry_reference' => 'getGeometryReference',
            'get_texture_reference' => 'getTextureReference',
        ] as $action => $method) {
            self::assertStringContainsString("case '" . $action . "':", $dispatch);
            self::assertStringContainsString('ShipComponentPromptLibrary::' . $method . '(', $dispatch);
        }

        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:file_put_contents|fopen|unlink|rename|mkdir|shell_exec|exec|INSERT|UPDATE|DELETE|REPLACE)\\b/',
            $source
        );
    }
}
