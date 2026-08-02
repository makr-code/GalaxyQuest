# TRELLIS2 Prompt Enhancement System - Complete Guide
## LLM Wiki-Based Species Design & Iterative 3D Generation

**Status:** ✅ COMPLETE & PRODUCTION READY  
**Date:** 2026-08-02  
**Version:** 1.0

---

## 📚 Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Species Templates](#species-templates)
4. [Prompt Enhancement Engine](#prompt-enhancement-engine)
5. [WebUI Interface](#webui-interface)
6. [Workflow Examples](#workflow-examples)
7. [API Reference](#api-reference)
8. [Advanced Features](#advanced-features)
9. [Troubleshooting](#troubleshooting)

---

## System Overview

### What is TRELLIS2 Prompt Enhancement?

A **LLM Wiki-based system** for converting fixed species design specifications into customized, iteratively-refined 3D model prompts.

**Key Concept**: 
- **Base Specification** (YAML templates) ← Defines species characteristics
- **User Customization** (parameters) ← User adjusts design
- **Iterative Enhancement** (LLM patterns) ← System refines and optimizes
- **3D Generation** (TRELLIS2) ← GPU generates final model

### Why This Approach?

**Problem**: "Generate any spaceship" leads to inconsistent results.  
**Solution**: Species-specific design templates + structured customization → consistent, high-quality 3D models.

**Benefits**:
- ✅ Consistent visual language per species
- ✅ User control without overwhelming complexity
- ✅ Iterative refinement (enhancement patterns)
- ✅ Reproducible designs (prompt tracking)
- ✅ Game-integrated asset pipeline

---

## Architecture

### Component Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    WebUI (Gradio)                           │
│  - Species Selection                                        │
│  - Parameter Sliders/Dropdowns                              │
│  - Enhancement Pattern Application                          │
│  - Real-time Prompt Preview                                 │
│  - Generation Status Monitoring                             │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│         Prompt Enhancement Engine (Python)                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ SpeciesDesignTemplateLoader - Load YAML specs       │   │
│  │ PromptBuilder - Convert customizations → prompts    │   │
│  │ EnhancementOrchestrator - Manage iterations         │   │
│  │ PromptHashRegistry - Track unique prompts           │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│     Species Design Templates (YAML)                          │
│  - Terran (military, industrial)                            │
│  - Xylothian (organic, biomechanical)                       │
│  - Ethereal (crystal, geometric)                            │
│  - Mech-Collective (robotic, modular)                       │
│  - Enhancement Patterns (weathering, faction, roles)        │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│             TRELLIS2 GPU Pipeline                           │
│  - Text/Prompt → 3D GLB Generation                         │
│  - ~45 seconds per model (RTX 3060)                        │
│  - Event logging & asset tracking                          │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│         WebGL Viewer + Game Integration                     │
│  - Three.js interactive 3D display                         │
│  - Asset import to game database                           │
│  - Persistent storage in /generated/                       │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow Diagram

```
User Input
    ↓
┌─────────────────────────────┐
│ Species: Terran             │
│ Hull Material: Titanium     │
│ Accent Color: #0088FF       │
│ Age: 25%                    │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────────────────────────────────────┐
│ PromptBuilder.build_prompt()                                │
│                                                             │
│ Template → Substitute Variables → Enhanced Prompt          │
└──────────────┬────────────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────────────┐
│ Generated Prompt:                                           │
│ "3D spaceship design: Eagle Strike                          │
│  Species: Terran (human-descendant)                         │
│  Hull Material: titanium-composite                          │
│  Primary Color: #0088FF                                     │
│  ...                                                        │
│  Visual Style: Industrial, high-tech, militaristic..."      │
└──────────────┬────────────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────────────┐
│ Enhancement Pattern: weathering                             │
│ Add: 25% age + rust patina                                  │
└──────────────┬────────────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────────────┐
│ Final Optimized Prompt → Sent to TRELLIS2                   │
└──────────────┬────────────────────────────────────────────┘
               ↓
        [GPU INFERENCE]
          (~45 seconds)
               ↓
┌─────────────────────────────────────────────────────────────┐
│ Generated GLB File                                          │
│ /generated/designs/eagle_strike_20260802_120345.glb        │
└──────────────┬────────────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────────────┐
│ WebGL Viewer                                                │
│ - Interactive 3D display                                    │
│ - Real-time controls (rotate, zoom)                        │
│ - Statistics overlay                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Species Templates

### Template Structure (YAML)

```yaml
species:
  species_code:
    display_name: "Human Readable Name"
    base_concept: "Brief description"
    faction_origin: "Which faction created this"
    
    morphology:
      base_form: "Body structure"
      height_cm: [min, max]
      facial_features: "..."
      skin_variations: ["option1", "option2"]
      # ... more biological specs
    
    aesthetic_principles:
      primary_philosophy: "Design philosophy"
      material_preference: ["mat1", "mat2"]
      color_palette: ["color1", "color2"]
      texture_traits: ["trait1", "trait2"]
      cultural_markers: ["mark1", "mark2"]
    
    ship_design_archetype:
      hull_shape: "..."
      propulsion_style: "..."
      # ... spaceship-specific design
    
    customization_points:
      - name: "parameter_name"
        type: "slider|choice|color|toggle"
        default: value
        affects: ["visual", "effect"]
      # ... more parameters
    
    prompt_template: |
      3D spaceship design: {ship_name}
      Species: ...
      # Template with variable substitution
```

### Available Species

#### 🟦 **Terran**
- **Faction**: Iron Fleet, Kalytherion Convergence
- **Aesthetic**: Cyberpunk military, industrial elegance
- **Ships**: Wedge-forward, weapon turrets, dark metals
- **Key Customizations**: Hull material, accent color, weapon loadout, faction markings, weathering

#### 🟪 **Xylothian**
- **Faction**: Kryl'Tha (Hive-mind)
- **Aesthetic**: Biopunk, organic-mechanical, living tissue
- **Ships**: Bio-form hulls, organic curves, pulsing bioluminescence
- **Key Customizations**: Chitin hardness, bioluminescence color, hive role, mutation level

#### 🟦 **Ethereal**
- **Faction**: Syl'Nar, Zhareen
- **Aesthetic**: Geometric transcendence, far-future energy tech
- **Ships**: Crystalline matrices, mandala symmetry, luminous surfaces
- **Key Customizations**: Crystal color, geometric symmetry, energy intensity, harmonic resonance

#### 🟫 **Mech-Collective**
- **Faction**: Omniscienta, Aethernox
- **Aesthetic**: Hard sci-fi, precise engineering, cold efficiency
- **Ships**: Modular angular forms, exposed systems, computational displays
- **Key Customizations**: Armor type, accent LED color, modularity, computational theme

---

## Prompt Enhancement Engine

### Python API

#### 1. Load Templates
```python
from trellis2_prompt_enhancement import SpeciesDesignTemplateLoader

loader = SpeciesDesignTemplateLoader()
species = loader.get_species("terran")
print(species["display_name"])  # "Terran"
```

#### 2. Build Prompt
```python
from trellis2_prompt_enhancement import PromptBuilder

builder = PromptBuilder(loader)
customizations = {
    "hull_material": "titanium-composite",
    "accent_color": "#0088FF",
    "weapon_loadout": "balanced",
    "age_weathering": 25,
}

prompt = builder.build_prompt(
    species_code="terran",
    customizations=customizations,
    ship_name="Eagle Strike",
    ship_length=180
)
print(prompt)
```

#### 3. Manage Design State
```python
from trellis2_prompt_enhancement import EnhancementOrchestrator

orchestrator = EnhancementOrchestrator(loader)

# Create initial design
state = orchestrator.create_design_state(
    species_code="terran",
    customizations=customizations,
    ship_name="Eagle Strike",
    ship_length=180
)

# Apply enhancement pattern
state = orchestrator.enhance_with_pattern(
    state,
    pattern_name="weathering",
    pattern_params={
        "age_level": 25,
        "damage_intensity": 15,
        "patina_type": "rust"
    }
)

# Save for later iteration
saved_path = orchestrator.save_design_state(state)
```

#### 4. Track Prompts
```python
from trellis2_prompt_enhancement import PromptHashRegistry

registry = PromptHashRegistry()

# Register a prompt
prompt_hash = registry.register_prompt(prompt, metadata={"ship": "Eagle Strike"})

# Check for duplicates
is_duplicate = registry.is_duplicate(prompt)

# Get statistics
stats = registry.get_stats()
```

---

## WebUI Interface

### Access URL
```
http://localhost:7864
```

### Main Tabs

#### 🎨 Design Customization
- **Species Selection** - Choose from 4 species
- **Species Info** - Auto-display template details
- **Ship Metadata** - Name & length
- **Dynamic Controls** - Customization sliders/dropdowns
- **Preview Button** - Generate prompt preview
- **Prompt Display** - Full TRELLIS2 prompt in code block
- **Enhancement Patterns** - Weathering, faction, special purpose

#### 🎬 Generation & Display
- **Generate Button** - Start TRELLIS2 inference
- **Status Monitoring** - Real-time progress
- **Save Design** - Persist design state
- **WebGL Viewer** - Embedded 3D model display
- **Interactive Controls** - Rotate (mouse), zoom (scroll), wireframe (W key)

#### 📊 History & Statistics
- **Design History** - Show all enhancements applied
- **Registry Stats** - Prompt usage statistics
- **Refresh Button** - Update stats in real-time

---

## Workflow Examples

### Example 1: Create Military Warship (Terran)

```python
# 1. Load system
loader = SpeciesDesignTemplateLoader()
orchestrator = EnhancementOrchestrator(loader)

# 2. Customize for military role
warship_custom = {
    "hull_material": "titanium-composite",
    "accent_color": "#FF0000",  # Red for military
    "weapon_loadout": "kinetic-heavy",
    "faction_markings": True,
    "age_weathering": 0,  # Brand new
}

# 3. Create state
state = orchestrator.create_design_state(
    species_code="terran",
    customizations=warship_custom,
    ship_name="Vanguard",
    ship_length=250
)

# 4. Add faction markings
state = orchestrator.enhance_with_pattern(
    state,
    pattern_name="faction_customization",
    pattern_params={
        "faction_name": "Iron Fleet",
        "rank_insignia": "Admiral",
        "honor_markings": "10-time victor"
    }
)

# 5. Show prompt
print(state.generated_prompt)

# 6. Generate 3D model (via WebUI button)
# Result: /generated/designs/vanguard_*.glb
```

### Example 2: Customize Hive Ship with Age (Xylothian)

```python
hive_custom = {
    "chitin_hardness": 85,  # Very hard armor
    "bioluminescence_color": "#00FF88",  # Green glow
    "hive_role": "carrier",
    "bio_mutation_level": 30,  # Slightly mutated
}

state = orchestrator.create_design_state(
    species_code="xylothian",
    customizations=hive_custom,
    ship_name="Swarm Carrier",
    ship_length=200
)

# Add weathering for ancient hive-ship
state = orchestrator.enhance_with_pattern(
    state,
    pattern_name="weathering",
    pattern_params={
        "age_level": 75,  # Very old
        "damage_intensity": 40,  # Combat-scarred
        "patina_type": "bio-growth"  # Organic growth
    }
)

# Save and iterate
saved_path = orchestrator.save_design_state(state)
```

### Example 3: Iterative Refinement Loop

```python
# Start with base design
state = orchestrator.create_design_state(
    species_code="ethereal",
    customizations={"crystal_color": "#00FFFF"},
    ship_name="Zen Garden"
)

# Iteration 1: Apply crystal enhancements
state = orchestrator.enhance_with_pattern(
    state, "special_purpose",
    {"special_purpose": "explorer"}
)

# Iteration 2: Add spiritual markers
state = orchestrator.enhance_with_pattern(
    state, "faction_customization",
    {"faction_name": "Syl'Nar", "honor_markings": "spiritual_guide"}
)

# Iteration 3: Save intermediate state
saved_path = orchestrator.save_design_state(state)

# Later: Load and continue refining
loaded_state = orchestrator.load_design_state(saved_path)

# Continue enhancement
loaded_state = orchestrator.enhance_with_pattern(
    loaded_state, "weathering",
    {"age_level": 50, "damage_intensity": 0, "patina_type": "crystalline-decay"}
)

# Final prompt
print(loaded_state.generated_prompt)
```

---

## API Reference

### Classes

#### `SpeciesDesignTemplateLoader`
```python
class SpeciesDesignTemplateLoader:
    def get_species(species_code: str) -> Dict | None
    def list_species() -> List[str]
    def get_enhancement_patterns() -> Dict
```

#### `PromptBuilder`
```python
class PromptBuilder:
    def build_prompt(
        species_code: str,
        customizations: Dict,
        ship_name: str = "Unknown Vessel",
        ship_length: int = 150
    ) -> str
```

#### `EnhancementOrchestrator`
```python
class EnhancementOrchestrator:
    def create_design_state(...) -> SpeciesDesignState
    def enhance_with_pattern(state, pattern_name, params) -> SpeciesDesignState
    def refine_with_ollama(state, focus) -> SpeciesDesignState | None
    def save_design_state(state, output_dir) -> str
    def load_design_state(filepath) -> SpeciesDesignState | None
```

#### `PromptHashRegistry`
```python
class PromptHashRegistry:
    def register_prompt(prompt, metadata) -> str  # Returns hash
    def is_duplicate(prompt) -> bool
    def get_stats() -> Dict
```

### Data Structures

#### `SpeciesDesignState`
```python
@dataclass
class SpeciesDesignState:
    species_code: str
    base_template: Dict[str, Any]
    customizations: Dict[str, Any]
    enhancement_history: List[Dict]
    generated_prompt: str
    metadata: Dict[str, Any]
    created_at: str
    updated_at: str
    
    def to_dict() -> Dict  # Serialize to JSON
```

---

## Advanced Features

### 1. Ollama LLM Refinement
Automatically enhance prompts using local LLM (if available):

```python
orchestrator = EnhancementOrchestrator(
    loader,
    ollama_enabled=True,
    ollama_base_url="http://localhost:11434"
)

# Refine prompt with LLM
state = orchestrator.refine_with_ollama(
    state,
    refinement_focus="maximize visual impact and 3D model compatibility"
)
```

### 2. Design History Tracking
Every enhancement is logged:

```python
state.enhancement_history  # List of all modifications
# [
#   {
#     "timestamp": "2026-08-02T12:30:45.123456",
#     "pattern": "weathering",
#     "parameters": {"age_level": 25, ...},
#     "prompt_modification": "Add 25% weathering..."
#   },
#   ...
# ]
```

### 3. Prompt Deduplication
Track which prompts generate 3D models:

```python
stats = registry.get_stats()
# {
#   "total_unique_prompts": 47,
#   "total_generations": 156,
#   "registry_entries": [...]
# }
```

### 4. Batch Generation
Generate multiple variants programmatically:

```python
variants = []
for color in ["#0088FF", "#FF0000", "#00FF00"]:
    custom = {"accent_color": color}
    state = orchestrator.create_design_state(
        species_code="terran",
        customizations=custom
    )
    variants.append(state)

# All states ready for TRELLIS2 generation
```

---

## Troubleshooting

### Issue: "Templates file not found"
**Solution**: Ensure `tools/trellis2/species_design_templates.yaml` exists
```bash
ls -la tools/trellis2/species_design_templates.yaml
```

### Issue: "Unknown species"
**Solution**: Check available species
```python
print(loader.list_species())  # ['terran', 'xylothian', 'ethereal', 'mech_collective']
```

### Issue: Variables missing in prompt template
**Solution**: Verify customization_point names match template placeholders
```python
template = loader.get_species("terran")
for point in template["customization_points"]:
    print(point["name"])  # Should match {placeholders} in template
```

### Issue: WebUI not responding
**Solution**: Check port 7864 not in use
```bash
lsof -i :7864  # (Linux/Mac)
netstat -ano | findstr :7864  # (Windows)
```

### Issue: Generation too slow
**Solution**: Monitor GPU utilization
```bash
docker compose exec trellis2 nvidia-smi  # Check GPU status
docker compose logs -f trellis2 | grep -i "gpu\|cuda"
```

---

## Performance Metrics

| Operation | Time | Notes |
|-----------|------|-------|
| Load templates | <100ms | Cached after first load |
| Build prompt | <50ms | String interpolation |
| Save design state | <200ms | JSON serialization |
| Load design state | <150ms | File I/O |
| Apply enhancement | <100ms | Pattern processing |
| Register prompt | <50ms | Hash calculation |
| 3D generation | ~45s | GPU inference (RTX 3060) |

---

## Integration with Game Backend

The prompt enhancement system seamlessly integrates with the existing game pipeline:

```
Design Customization → Prompt Generation → TRELLIS2 → GLB Asset
                                              ↓
                                         AssetPipeline
                                              ↓
                                      Database Registration
                                              ↓
                                         Game Engine
```

**Files involved**:
- `tools/trellis2/species_design_templates.yaml` - Design specs
- `scripts/trellis2_prompt_enhancement.py` - Engine logic
- `tools/trellis2/gradio_ui_enhancement.py` - WebUI
- `scripts/trellis2_asset_pipeline.py` - Asset import
- `scripts/trellis2_backend_integration.php` - DB registration

---

## Future Enhancements

- [ ] Multi-species combination designs (hybrid ships)
- [ ] AI-powered design recommendations
- [ ] Texture/material library integration
- [ ] Community design sharing
- [ ] Design version control (git-like)
- [ ] Real-time collaborative editing
- [ ] Voice-to-design natural language interface

---

**Last Updated**: 2026-08-02  
**Maintained By**: GalaxyQuest Development Team  
**License**: MIT
