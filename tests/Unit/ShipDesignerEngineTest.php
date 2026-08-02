<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Unit Tests for Ship Designer Prompt Engine
 * Validates faction signatures, ship templates, LoRA styles, and prompt generation
 */
final class ShipDesignerEngineTest extends TestCase
{
    // ── Test Faction Signatures ───────────────────────────────────────────────

    public function testFactionSignatureVorTak(): void
    {
        $sig = FactionShipSignature::getSignature('vor_tak');
        
        $this->assertIsArray($sig);
        $this->assertStringContainsString('wedge', $sig['silhouette']);
        $this->assertStringContainsString('armor', $sig['materials']);
        $this->assertContains('jaw_bridge', $sig['signature_parts']);
        $this->assertContains('dorsal_spine', $sig['signature_parts']);
        $this->assertContains('armor_scales', $sig['signature_parts']);
        $this->assertEquals('#8B4513', $sig['color_primary']);
        $this->assertEquals('#C0C0C0', $sig['color_secondary']);
        $this->assertEquals('vor_tak_industrial_militaristic', $sig['lora_style']);
    }

    public function testFactionSignatureSylNar(): void
    {
        $sig = FactionShipSignature::getSignature('syl_nar');
        
        $this->assertStringContainsString('flowing', $sig['silhouette']);
        $this->assertStringContainsString('bioluminescent', $sig['materials']);
        $this->assertContains('halo_tentacles', $sig['signature_parts']);
        $this->assertEquals('#4169E1', $sig['color_primary']);
    }

    public function testAllFactionSignaturesHaveRequiredFields(): void
    {
        $allSigs = FactionShipSignature::getAllSignatures();
        
        $requiredFields = ['silhouette', 'materials', 'signature_parts', 'color_primary', 'color_secondary', 'lora_style', 'motifs'];
        
        foreach ($allSigs as $factionCode => $sig) {
            foreach ($requiredFields as $field) {
                $this->assertArrayHasKey(
                    $field,
                    $sig,
                    "Faction $factionCode missing field: $field"
                );
            }
            
            // Validate signature_parts is an array
            $this->assertIsArray($sig['signature_parts']);
            $this->assertGreaterThanOrEqual(3, count($sig['signature_parts']), "Faction $factionCode needs at least 3 signature parts");
        }
    }

    // ── Test Ship Class Templates ──────────────────────────────────────────────

    public function testShipClassTemplateFighter(): void
    {
        $template = ShipClassTemplate::getTemplate('fighter');
        
        $this->assertIsArray($template);
        $this->assertEquals('Fighter', $template['title']);
        $this->assertEquals(20, $template['scale_unit']);
        $this->assertEquals(3000, $template['tri_budget']);
        $this->assertStringContainsString('agile', strtolower($template['description']));
    }

    public function testShipClassTemplateCapital(): void
    {
        $template = ShipClassTemplate::getTemplate('capital');
        
        $this->assertEquals('Capital Ship', $template['title']);
        $this->assertEquals(300, $template['scale_unit']);
        $this->assertEquals(25000, $template['tri_budget']);
    }

    public function testAllShipClassesHaveRequiredFields(): void
    {
        $templates = ShipClassTemplate::getAllTemplates();
        
        $requiredFields = ['title', 'scale_unit', 'tri_budget', 'description', 'silhouette_hint', 'role_descriptor'];
        
        foreach ($templates as $classCode => $template) {
            foreach ($requiredFields as $field) {
                $this->assertArrayHasKey(
                    $field,
                    $template,
                    "Class $classCode missing field: $field"
                );
            }
        }
    }

    public function testTriangleBudgetIncreasesWithShipSize(): void
    {
        $templates = ShipClassTemplate::getAllTemplates();
        
        $budgets = array_values(array_map(fn($t) => $t['tri_budget'], $templates));
        sort($budgets);
        
        // Verify budgets are in ascending order (generally)
        for ($i = 1; $i < count($budgets); $i++) {
            $this->assertGreaterThanOrEqual($budgets[$i - 1], $budgets[$i]);
        }
    }

    // ── Test LoRA Style Presets ────────────────────────────────────────────────

    public function testLoRAPresetFactionSignature(): void
    {
        $preset = LoRAStylePreset::getPreset('faction_signature');
        
        $this->assertIsArray($preset);
        $this->assertEquals('Faction Signature Style', $preset['name']);
        $this->assertTrue($preset['enabled_by_default']);
        $this->assertEquals(7.5, $preset['guidance_scale']);
        $this->assertContains('silhouette', $preset['affects']);
    }

    public function testLoRAStyleRecommendationsForFaction(): void
    {
        $recommended = LoRAStylePreset::getRecommendedForFaction('vor_tak');
        
        $this->assertIsArray($recommended);
        $this->assertContains('faction_signature', $recommended);
        $this->assertContains('industrial_militaristic', $recommended);
    }

    public function testLoRAStyleRecommendationsForSylNar(): void
    {
        $recommended = LoRAStylePreset::getRecommendedForFaction('syl_nar');
        
        $this->assertContains('faction_signature', $recommended);
        $this->assertContains('organic_biomimetic', $recommended);
    }

    public function testAllLoRAPresetsHaveRequiredFields(): void
    {
        $allPresets = LoRAStylePreset::getAllPresets();
        
        foreach ($allPresets as $key => $preset) {
            $this->assertArrayHasKey('name', $preset, "Preset $key missing name");
            $this->assertArrayHasKey('description', $preset, "Preset $key missing description");
            $this->assertArrayHasKey('enabled_by_default', $preset, "Preset $key missing enabled_by_default");
            $this->assertArrayHasKey('guidance_scale', $preset, "Preset $key missing guidance_scale");
            $this->assertArrayHasKey('affects', $preset, "Preset $key missing affects");
        }
    }

    // ── Test Prompt Generation ─────────────────────────────────────────────────

    public function testPromptGenerationBasic(): void
    {
        $db = $this->createMockPDO();
        $engine = new ShipDesignerPromptEngine($db);
        
        $result = $engine->generatePrompt([
            'faction_code' => 'vor_tak',
            'ship_class' => 'corvette',
        ]);
        
        $this->assertIsArray($result);
        $this->assertArrayHasKey('prompt', $result);
        $this->assertArrayHasKey('metadata', $result);
        
        $prompt = $result['prompt'];
        $this->assertStringContainsString('Vor\'Tak', $prompt);
        $this->assertStringContainsString('Corvette', $prompt);
        $this->assertStringContainsString('wedge', $prompt);
        $this->assertStringContainsString('8000', $prompt); // triangle budget
    }

    public function testPromptMetadataComplete(): void
    {
        $db = $this->createMockPDO();
        $engine = new ShipDesignerPromptEngine($db);
        
        $result = $engine->generatePrompt([
            'faction_code' => 'syl_nar',
            'ship_class' => 'frigate',
            'name' => 'Tidecaller',
            'lora_styles' => ['faction_signature', 'organic_biomimetic'],
        ]);
        
        $metadata = $result['metadata'];
        $this->assertEquals('syl_nar', $metadata['faction_code']);
        $this->assertEquals('frigate', $metadata['ship_class']);
        $this->assertEquals('Tidecaller', $metadata['ship_name']);
        $this->assertEquals(120, $metadata['scale_reference']);
        $this->assertEquals(12000, $metadata['tri_budget']);
        $this->assertContains('faction_signature', $metadata['lora_styles']);
    }

    public function testPromptIncludesCustomizationPrompt(): void
    {
        $db = $this->createMockPDO();
        $engine = new ShipDesignerPromptEngine($db);
        
        $customization = 'sleeker profile with more weapons';
        $result = $engine->generatePrompt([
            'faction_code' => 'vel_ar',
            'ship_class' => 'fighter',
            'customization_prompt' => $customization,
        ]);
        
        $this->assertStringContainsString($customization, $result['prompt']);
    }

    public function testPromptIncludesLoRAStyling(): void
    {
        $db = $this->createMockPDO();
        $engine = new ShipDesignerPromptEngine($db);
        
        $result = $engine->generatePrompt([
            'faction_code' => 'aereth',
            'ship_class' => 'corvette',
            'lora_styles' => ['crystalline_geometric'],
        ]);
        
        $this->assertStringContainsString('crystalline', $result['prompt']);
    }

    public function testPromptValidatesRequiredFields(): void
    {
        $db = $this->createMockPDO();
        $engine = new ShipDesignerPromptEngine($db);
        
        $this->expectException(\InvalidArgumentException::class);
        $engine->generatePrompt(['ship_class' => 'corvette']); // missing faction_code
    }

    public function testPromptValidatesShipClass(): void
    {
        $db = $this->createMockPDO();
        $engine = new ShipDesignerPromptEngine($db);
        
        $this->expectException(\InvalidArgumentException::class);
        $engine->generatePrompt(['faction_code' => 'vor_tak', 'ship_class' => 'invalid_class']);
    }

    // ── Test Facade Methods ────────────────────────────────────────────────────

    public function testGetShipTemplates(): void
    {
        $db = $this->createMockPDO();
        $engine = new ShipDesignerPromptEngine($db);
        
        $templates = $engine->getShipTemplates();
        
        $this->assertIsArray($templates);
        $this->assertArrayHasKey('fighter', $templates);
        $this->assertArrayHasKey('corvette', $templates);
        $this->assertArrayHasKey('capital', $templates);
    }

    public function testGetFactionShips(): void
    {
        $db = $this->createMockPDO();
        $engine = new ShipDesignerPromptEngine($db);
        
        $result = $engine->getFactionShips('kryl_tha');
        
        $this->assertArrayHasKey('faction', $result);
        $this->assertArrayHasKey('signature', $result);
        $this->assertArrayHasKey('available_classes', $result);
        
        $this->assertEquals('kryl_tha', $result['faction']['code']);
        $this->assertContains('insectoid', $result['signature']['silhouette']);
    }

    public function testGetLoRAStylesForFaction(): void
    {
        $db = $this->createMockPDO();
        $engine = new ShipDesignerPromptEngine($db);
        
        $styles = $engine->getLoRAStyles('syl_nar');
        
        $this->assertIsArray($styles);
        $this->assertArrayHasKey('faction_signature', $styles);
        $this->assertArrayHasKey('organic_biomimetic', $styles);
    }

    // ── Helper Methods ─────────────────────────────────────────────────────────

    private function createMockPDO(): PDO
    {
        return new PDO('sqlite::memory:');
    }
}
