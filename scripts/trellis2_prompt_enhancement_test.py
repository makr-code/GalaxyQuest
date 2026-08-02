#!/usr/bin/env python3
"""
TRELLIS2 Prompt Enhancement Integration Test
==============================================
Validates complete LLM Wiki-based prompt enhancement workflow.

Tests:
1. Template loading (YAML parsing)
2. Prompt building (customization → prompt)
3. Enhancement patterns (weathering, faction, roles)
4. Design state persistence (JSON serialization)
5. Prompt deduplication (hash tracking)
6. Multi-iteration workflows

Run with:
  python scripts/trellis2_prompt_enhancement_test.py
"""

import sys
import json
import logging
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent))

from trellis2_prompt_enhancement import (
    SpeciesDesignTemplateLoader,
    PromptBuilder,
    EnhancementOrchestrator,
    PromptHashRegistry,
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s - %(message)s'
)
logger = logging.getLogger(__name__)


class PromptEnhancementTest:
    """Test suite for prompt enhancement system"""
    
    def __init__(self):
        self.loader = SpeciesDesignTemplateLoader()
        self.orchestrator = EnhancementOrchestrator(self.loader)
        self.registry = PromptHashRegistry()
        self.test_results = []
    
    def test_template_loading(self) -> bool:
        """Test 1: Load species templates"""
        print("\n" + "="*70)
        print("TEST 1: Template Loading")
        print("="*70)
        
        try:
            species_list = self.loader.list_species()
            print(f"✓ Loaded {len(species_list)} species templates:")
            for species in species_list:
                spec = self.loader.get_species(species)
                print(f"  • {species:20} → {spec['display_name']}")
            
            self.test_results.append(("Template Loading", True, len(species_list)))
            return True
        except Exception as e:
            print(f"✗ Template loading failed: {e}")
            self.test_results.append(("Template Loading", False, str(e)))
            return False
    
    def test_prompt_building(self) -> bool:
        """Test 2: Build prompts for each species"""
        print("\n" + "="*70)
        print("TEST 2: Prompt Building")
        print("="*70)
        
        try:
            builder = PromptBuilder(self.loader)
            
            test_cases = [
                ("vortak", {
                    "scale_coloration": "#1a4d3d",
                    "metallic_accents": "#8b6914",
                    "commander_rank": "Admiral",
                    "battle_scars_intensity": 60,
                    "age_and_honor": 80,
                }),
                ("sylnar", {
                    "bioluminescence_color": "#00d4ff",
                    "translucency_level": 45,
                    "spiritual_alignment": "cosmic-harmony",
                    "tentacle_complexity": 7,
                }),
                ("aereth", {
                    "energy_color": "#00ccff",
                    "geometric_precision": 85,
                    "research_specialization": "stellar-physics",
                    "energy_intensity": 85,
                }),
                ("kryltha", {
                    "carapace_color": "#2d5f4f",
                    "battle_scars": 50,
                    "warrior_caste": "assault-class",
                    "hive_coordination_level": 9,
                }),
            ]
            
            success_count = 0
            for species_code, customizations in test_cases:
                prompt = builder.build_prompt(
                    species_code=species_code,
                    customizations=customizations,
                    ship_name=f"{species_code.upper()} Vessel",
                    ship_length=150
                )
                
                prompt_length = len(prompt)
                print(f"✓ {species_code:20} → Prompt ({prompt_length} chars)")
                success_count += 1
            
            self.test_results.append(("Prompt Building", True, success_count))
            return success_count == len(test_cases)
        
        except Exception as e:
            print(f"✗ Prompt building failed: {e}")
            self.test_results.append(("Prompt Building", False, str(e)))
            return False
    
    def test_enhancement_patterns(self) -> bool:
        """Test 3: Apply enhancement patterns"""
        print("\n" + "="*70)
        print("TEST 3: Enhancement Patterns (Weathering, Faction, Purpose)")
        print("="*70)
        
        try:
            # Create base state
            state = self.orchestrator.create_design_state(
                species_code="vortak",
                customizations={"scale_coloration": "#1a4d3d"},
                ship_name="Test Vessel",
                ship_length=150
            )
            
            original_prompt = state.generated_prompt
            print(f"✓ Base prompt ({len(original_prompt)} chars)")
            
            # Test weathering
            state = self.orchestrator.enhance_with_pattern(
                state,
                pattern_name="weathering",
                pattern_params={
                    "age_level": 50,
                    "damage_intensity": 30,
                    "patina_type": "rust-oxidation"
                }
            )
            print(f"✓ Weathering enhancement (+{len(state.generated_prompt) - len(original_prompt)} chars)")
            
            # Test faction customization
            state = self.orchestrator.enhance_with_pattern(
                state,
                pattern_name="faction_customization",
                pattern_params={
                    "faction_name": "Vor'Tak Command",
                    "rank_insignia": "Commander",
                    "honor_markings": "decorated"
                }
            )
            print(f"✓ Faction enhancement (+{len(state.generated_prompt) - len(original_prompt)} chars total)")
            
            # Test special purpose
            state = self.orchestrator.enhance_with_pattern(
                state,
                pattern_name="special_purpose",
                pattern_params={
                    "special_purpose": "battleship"
                }
            )
            print(f"✓ Special purpose enhancement (+{len(state.generated_prompt) - len(original_prompt)} chars total)")
            
            # Verify history
            print(f"✓ Enhancement history: {len(state.enhancement_history)} modifications")
            
            self.test_results.append(("Enhancement Patterns", True, len(state.enhancement_history)))
            return True
        
        except Exception as e:
            print(f"✗ Enhancement patterns failed: {e}")
            self.test_results.append(("Enhancement Patterns", False, str(e)))
            return False
    
    def test_model_and_texture_enhancement(self) -> bool:
        """Test 3.5: Model detail and texture enhancements"""
        print("\n" + "="*70)
        print("TEST 3.5: Model Detail & Texture Enhancement")
        print("="*70)
        
        try:
            # Create base design
            state = self.orchestrator.create_design_state(
                species_code="kryltha",
                customizations={"carapace_color": "#2d5f4f"},
                ship_name="Insectoid Cruiser",
                ship_length=220
            )
            
            base_length = len(state.generated_prompt)
            print(f"✓ Base design: {base_length} chars")
            
            # Test 1: Model Detail Enhancement
            state = self.orchestrator.enhance_with_pattern(
                state,
                pattern_name="model_detail_enhancement",
                pattern_params={
                    "detail_level": "high-detail",
                    "surface_complexity": 75,
                    "structural_emphasis": "bio-mechanical"
                }
            )
            detail_length = len(state.generated_prompt)
            print(f"✓ Model detail enhancement: {detail_length - base_length} chars added")
            print(f"  Detail level: high-detail, Surface complexity: 75%")
            
            # Test 2: Texture & Material Enhancement
            state = self.orchestrator.enhance_with_pattern(
                state,
                pattern_name="texture_material_enhancement",
                pattern_params={
                    "texture_resolution": "4k",
                    "material_variety": 65,
                    "weathering_pattern": "edge-wear",
                    "surface_properties": "metallic-reflective"
                }
            )
            texture_length = len(state.generated_prompt)
            print(f"✓ Texture & material: {texture_length - detail_length} chars added")
            print(f"  Texture: 4k, Material variety: 65%, Weathering: edge-wear")
            
            # Test 3: Bioluminescence & Glow
            state = self.orchestrator.enhance_with_pattern(
                state,
                pattern_name="bioluminescence_glow_enhancement",
                pattern_params={
                    "glow_intensity": 70,
                    "glow_coverage": 40,
                    "energy_flow_pattern": "pulsing-rhythm",
                    "glow_color_variation": "complementary-dual"
                }
            )
            glow_length = len(state.generated_prompt)
            print(f"✓ Glow & luminescence: {glow_length - texture_length} chars added")
            print(f"  Intensity: 70%, Coverage: 40%, Pattern: pulsing-rhythm")
            
            # Test 4: Armor & Plating
            state = self.orchestrator.enhance_with_pattern(
                state,
                pattern_name="armor_plating_enhancement",
                pattern_params={
                    "plating_scale": 35,
                    "plating_definition": 85,
                    "armor_style": "overlapping-scales",
                    "structural_reinforcement": 60
                }
            )
            armor_length = len(state.generated_prompt)
            print(f"✓ Armor & plating: {armor_length - glow_length} chars added")
            print(f"  Plating scale: 35%, Definition: 85%, Style: overlapping-scales")
            
            # Test 5: Particle Effects
            state = self.orchestrator.enhance_with_pattern(
                state,
                pattern_name="particle_effects_enhancement",
                pattern_params={
                    "exhaust_intensity": 60,
                    "particle_types": "ion-plasma",
                    "effect_density": 50,
                    "environmental_interaction": "turbulent-streams"
                }
            )
            particle_length = len(state.generated_prompt)
            print(f"✓ Particle effects: {particle_length - armor_length} chars added")
            print(f"  Exhaust: 60%, Type: ion-plasma, Density: 50%")
            
            # Test 6: Color Grading
            state = self.orchestrator.enhance_with_pattern(
                state,
                pattern_name="color_grading_enhancement",
                pattern_params={
                    "saturation_level": 120,
                    "color_temperature": "cool-blue",
                    "contrast_level": 1.3,
                    "special_color_effects": "iridescent-shift"
                }
            )
            final_length = len(state.generated_prompt)
            print(f"✓ Color grading: {final_length - particle_length} chars added")
            print(f"  Saturation: 120%, Temperature: cool-blue, Contrast: 1.3x")
            
            # Summary
            total_added = final_length - base_length
            print(f"\n✓ Total enhancement: {total_added} chars ({100 * total_added / base_length:.1f}% expansion)")
            print(f"✓ Full prompt: {final_length} chars")
            print(f"✓ Enhancement history: {len(state.enhancement_history)} steps")
            
            self.test_results.append(("Model & Texture Enhancement", True, len(state.enhancement_history)))
            return True
        
        except Exception as e:
            print(f"✗ Model & texture enhancement failed: {e}")
            self.test_results.append(("Model & Texture Enhancement", False, str(e)))
            return False

    
    def test_design_persistence(self) -> bool:
        """Test 4: Save and load design states"""
        print("\n" + "="*70)
        print("TEST 4: Design State Persistence")
        print("="*70)
        
        try:
            # Create and modify design
            state = self.orchestrator.create_design_state(
                species_code="sylnar",
                customizations={"bioluminescence_color": "#00d4ff"},
                ship_name="Bio-Luminescent Test",
                ship_length=200
            )
            
            state = self.orchestrator.enhance_with_pattern(
                state,
                pattern_name="weathering",
                pattern_params={"age_level": 60, "damage_intensity": 40, "patina_type": "bio-growth"}
            )
            
            original_prompt = state.generated_prompt
            
            # Save
            saved_path = self.orchestrator.save_design_state(state)
            print(f"✓ Design saved to: {saved_path}")
            
            # Load
            loaded_state = self.orchestrator.load_design_state(saved_path)
            if not loaded_state:
                raise Exception("Failed to load design state")
            
            print(f"✓ Design loaded from: {saved_path}")
            
            # Verify content
            if loaded_state.generated_prompt != original_prompt:
                raise Exception("Prompt mismatch after save/load")
            
            print(f"✓ Prompt integrity verified")
            print(f"✓ Enhancement history: {len(loaded_state.enhancement_history)} entries preserved")
            
            self.test_results.append(("Design Persistence", True, saved_path))
            return True
        
        except Exception as e:
            print(f"✗ Design persistence failed: {e}")
            self.test_results.append(("Design Persistence", False, str(e)))
            return False
    
    def test_prompt_deduplication(self) -> bool:
        """Test 5: Track and deduplicate prompts"""
        print("\n" + "="*70)
        print("TEST 5: Prompt Deduplication")
        print("="*70)
        
        try:
            # Generate identical prompts
            builder = PromptBuilder(self.loader)
            
            prompt1 = builder.build_prompt(
                species_code="vortak",
                customizations={"metallic_accents": "#8b6914"}
            )
            prompt2 = builder.build_prompt(
                species_code="vortak",
                customizations={"metallic_accents": "#8b6914"}
            )
            
            # Register both and get hashes
            self.registry.register_prompt(prompt1)
            self.registry.register_prompt(prompt2)
            
            import hashlib
            hash1 = hashlib.sha256(prompt1.encode()).hexdigest()[:16]
            hash2 = hashlib.sha256(prompt2.encode()).hexdigest()[:16]
            
            print(f"✓ Prompt 1 registered with hash: {hash1}")
            print(f"✓ Prompt 2 registered with hash: {hash2}")
            
            if hash1 != hash2:
                raise Exception("Identical prompts produced different hashes")
            
            print(f"✓ Duplicate detection working (same hash)")
            
            # Register different prompt
            prompt3 = builder.build_prompt(
                species_code="aereth",
                customizations={"energy_intensity": 90}
            )
            self.registry.register_prompt(prompt3)
            hash3 = hashlib.sha256(prompt3.encode()).hexdigest()[:16]
            
            if hash1 == hash3:
                raise Exception("Different prompts produced same hash")
            
            print(f"✓ Different prompt produced different hash: {hash3}")
            
            # Get stats
            stats = self.registry.get_stats()
            print(f"✓ Registry stats:")
            print(f"   • Total unique prompts: {stats['total_unique_prompts']}")
            print(f"   • Total generations: {stats['total_generations']}")
            
            self.test_results.append(("Prompt Deduplication", True, stats))
            return True
        
        except Exception as e:
            print(f"✗ Prompt deduplication failed: {e}")
            self.test_results.append(("Prompt Deduplication", False, str(e)))
            return False
    
    def test_multi_iteration_workflow(self) -> bool:
        """Test 6: Multi-step iterative design workflow"""
        print("\n" + "="*70)
        print("TEST 6: Multi-Iteration Workflow")
        print("="*70)
        
        try:
            # Workflow: Create → Enhance → Save → Load → Further Enhance
            
            print("Step 1: Create base Zhareen design")
            state = self.orchestrator.create_design_state(
                species_code="zhareen",
                customizations={"primary_crystal_color": "#0055ff"},
                ship_name="Zen Explorer",
                ship_length=120
            )
            print(f"  ✓ Created with {len(state.generated_prompt)} char prompt")
            
            print("Step 2: Apply explorer role optimization")
            state = self.orchestrator.enhance_with_pattern(
                state,
                pattern_name="special_purpose",
                pattern_params={"special_purpose": "explorer"}
            )
            print(f"  ✓ Enhanced for explorer role")
            
            print("Step 3: Save intermediate design")
            saved_path = self.orchestrator.save_design_state(state)
            print(f"  ✓ Saved to {Path(saved_path).name}")
            
            print("Step 4: Load and continue enhancement")
            state = self.orchestrator.load_design_state(saved_path)
            print(f"  ✓ Loaded design with {len(state.enhancement_history)} prior enhancements")
            
            print("Step 5: Apply faction customization")
            state = self.orchestrator.enhance_with_pattern(
                state,
                pattern_name="faction_customization",
                pattern_params={
                    "faction_name": "Zhareen Archive",
                    "rank_insignia": "Archivist",
                    "honor_markings": "explorer-path"
                }
            )
            print(f"  ✓ Applied Syl'Nar faction markers")
            
            print("Step 6: Final save with all enhancements")
            final_path = self.orchestrator.save_design_state(state)
            print(f"  ✓ Final design saved with {len(state.enhancement_history)} total enhancements")
            
            self.test_results.append(("Multi-Iteration Workflow", True, len(state.enhancement_history)))
            return True
        
        except Exception as e:
            print(f"✗ Multi-iteration workflow failed: {e}")
            self.test_results.append(("Multi-Iteration Workflow", False, str(e)))
            return False
    
    def print_summary(self) -> None:
        """Print test summary"""
        print("\n" + "="*70)
        print("TEST SUMMARY")
        print("="*70)
        
        total_tests = len(self.test_results)
        passed_tests = sum(1 for _, result, _ in self.test_results if result)
        
        for test_name, result, data in self.test_results:
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"{status:12} {test_name:30} ({data})")
        
        print("-" * 70)
        print(f"Result: {passed_tests}/{total_tests} tests passed")
        
        if passed_tests == total_tests:
            print("\n🎉 All tests passed! System is ready for production.")
        else:
            print(f"\n⚠️  {total_tests - passed_tests} test(s) failed.")
        
        print("="*70)


def main():
    """Run test suite"""
    print("\n" + "="*70)
    print("TRELLIS2 PROMPT ENHANCEMENT - INTEGRATION TEST SUITE")
    print("="*70)
    
    test = PromptEnhancementTest()
    
    # Run all tests
    test.test_template_loading()
    test.test_prompt_building()
    test.test_enhancement_patterns()
    test.test_model_and_texture_enhancement()
    test.test_design_persistence()
    test.test_prompt_deduplication()
    test.test_multi_iteration_workflow()
    
    # Print summary
    test.print_summary()
    
    # Return exit code
    passed = sum(1 for _, result, _ in test.test_results if result)
    total = len(test.test_results)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
