# 🚀 TRELLIS2 Prompt Enhancement - Quick Start Guide

**Get started in 5 minutes!**

---

## What You Get

A **LLM Wiki-based system** for creating custom 3D spaceships:

```
🎨 Design (Choose Species)
    ↓
⚙️ Customize (Adjust Parameters)
    ↓
✨ Enhance (Apply Patterns)
    ↓
🚀 Generate (TRELLIS2 GPU)
    ↓
🎬 Display (WebGL Viewer)
```

---

## 🎯 Quick Start (5 minutes)

### Step 1: Access the WebUI
```
Open browser: http://localhost:7864
```

### Step 2: Select a Species
**Tab: 🎨 Design Customization**

Choose one:
- **Terran** - Military, industrial (wedge-shaped ships)
- **Xylothian** - Organic, biomechanical (flowing alien forms)
- **Ethereal** - Geometric, crystalline (transcendent beauty)
- **Mech-Collective** - Robotic, modular (precise engineering)

### Step 3: Customize Parameters
Adjust the sliders/dropdowns for your design:

**Terran Example:**
```
Hull Material: titanium-composite
Accent Color: #0088FF (electric blue)
Weapon Loadout: balanced
Faction Markings: ON
Age/Weathering: 25% (some battle scars)
```

### Step 4: Preview Prompt
Click: **👁️ Preview Prompt**

You'll see the generated TRELLIS2 prompt that will drive 3D generation.

### Step 5: Apply Enhancements (Optional)
**Tab: ✨ Enhancement Patterns**

Add extra details:
- **Weathering** - Add rust, corrosion, age
- **Faction Markings** - Military insignia, rank colors
- **Special Purpose** - Optimize for scout/carrier/battleship role

### Step 6: Generate 3D Model
**Tab: 🎬 Generation & Display**

Click: **🚀 Generate 3D Model**

Wait ~45 seconds for GPU inference. Your ship is being generated!

### Step 7: View in WebGL
Your 3D model appears in the embedded WebGL Viewer:
- **Rotate**: Mouse drag
- **Zoom**: Mouse scroll
- **Wireframe**: Press W
- **Grid**: Press G
- **Screenshot**: Press S

---

## 💻 Using the Python API

### Quick Example: Create Terran Warship

```python
from trellis2_prompt_enhancement import (
    SpeciesDesignTemplateLoader,
    EnhancementOrchestrator
)

# Initialize
loader = SpeciesDesignTemplateLoader()
orchestrator = EnhancementOrchestrator(loader)

# Define customizations
warship_custom = {
    "hull_material": "titanium-composite",
    "accent_color": "#FF0000",  # Red for military
    "weapon_loadout": "kinetic-heavy",
    "faction_markings": True,
    "age_weathering": 0,  # Brand new
}

# Create design
state = orchestrator.create_design_state(
    species_code="terran",
    customizations=warship_custom,
    ship_name="Vanguard",
    ship_length=250
)

# View generated prompt
print(state.generated_prompt)
# Output:
# ┌─────────────────────────────────────────────────────┐
# │ 3D spaceship design: Vanguard                       │
# │ Species: Terran (human-descendant)                  │
# │ Hull Material: titanium-composite                   │
# │ Primary Color: #FF0000                              │
# │ Weapon Loadout: kinetic-heavy                       │
# │ ... [full prompt] ...                               │
# └─────────────────────────────────────────────────────┘

# Enhance it
state = orchestrator.enhance_with_pattern(
    state,
    pattern_name="faction_customization",
    pattern_params={
        "faction_name": "Iron Fleet",
        "rank_insignia": "Admiral",
        "honor_markings": "10-time victor"
    }
)

# Save for later
saved_path = orchestrator.save_design_state(state)
print(f"Saved to: {saved_path}")
```

### Quick Example: Create Xylothian Hive Ship

```python
# Ancient, battle-scarred hive carrier
hive_custom = {
    "chitin_hardness": 85,
    "bioluminescence_color": "#00FF88",  # Green glow
    "hive_role": "carrier",
    "bio_mutation_level": 30,
}

state = orchestrator.create_design_state(
    species_code="xylothian",
    customizations=hive_custom,
    ship_name="Swarm Mother",
    ship_length=220
)

# Add age
state = orchestrator.enhance_with_pattern(
    state,
    pattern_name="weathering",
    pattern_params={
        "age_level": 80,  # Very ancient
        "damage_intensity": 50,  # Battle-scarred
        "patina_type": "bio-growth"
    }
)

# View final prompt
print(state.generated_prompt)
```

---

## 🔧 Run Tests

Verify everything works:

```bash
cd /workspace
python scripts/trellis2_prompt_enhancement_test.py
```

Expected output:
```
======================================================================
TRELLIS2 PROMPT ENHANCEMENT - INTEGRATION TEST SUITE
======================================================================

======================================================================
TEST 1: Template Loading
======================================================================
✓ Loaded 4 species templates:
  • terran               → Terran
  • xylothian           → Xylothian
  • ethereal            → Ethereal
  • mech_collective     → Mech-Collective

======================================================================
TEST 2: Prompt Building
======================================================================
✓ terran                → Prompt (847 chars)
✓ xylothian            → Prompt (923 chars)
✓ ethereal             → Prompt (786 chars)
✓ mech_collective      → Prompt (891 chars)

[... more tests ...]

======================================================================
TEST SUMMARY
======================================================================
✅ PASS           Template Loading              (4)
✅ PASS           Prompt Building               (4)
✅ PASS           Enhancement Patterns          (3)
✅ PASS           Design Persistence            (/workspace/generated/...)
✅ PASS           Prompt Deduplication          (...)
✅ PASS           Multi-Iteration Workflow      (3)

Result: 6/6 tests passed

🎉 All tests passed! System is ready for production.
======================================================================
```

---

## 📁 Key Files

| File | Purpose |
|------|---------|
| `tools/trellis2/species_design_templates.yaml` | Base species designs (YAML specs) |
| `scripts/trellis2_prompt_enhancement.py` | Core engine (Python) |
| `tools/trellis2/gradio_ui_enhancement.py` | WebUI interface |
| `docs/TRELLIS2_PROMPT_ENHANCEMENT_GUIDE.md` | Full documentation |
| `scripts/trellis2_prompt_enhancement_test.py` | Integration tests |
| `generated/designs/` | Output directory for saved designs |
| `generated/logs/prompt_registry.json` | Prompt usage tracking |

---

## 🎨 Species at a Glance

### Terran
```
Philosophy: Form follows function
Aesthetic: Industrial cyberpunk
Ships: Wedge-forward, weapon turrets
Customization: Hull material, accent color, weapons, age
Example: "Vanguard" - sleek military destroyer
```

### Xylothian
```
Philosophy: Organic efficiency
Aesthetic: Biopunk, living-tech
Ships: Bio-form, pulsing with life
Customization: Chitin hardness, bioluminescence, hive role
Example: "Swarm Mother" - ancient hive carrier
```

### Ethereal
```
Philosophy: Harmony of form and energy
Aesthetic: Geometric transcendence
Ships: Crystalline matrices, mandala symmetry
Customization: Crystal color, symmetry, energy level
Example: "Zen Garden" - spiritual explorer
```

### Mech-Collective
```
Philosophy: Efficient modularity
Aesthetic: Hard sci-fi precision
Ships: Angular, modular, exposed systems
Customization: Armor type, LED color, modularity
Example: "Nexus Prime" - collective flagship
```

---

## 🚀 Common Workflows

### Workflow 1: Create Military Fleet
```python
factions_ships = {
    "Terran": {"species": "terran", "weapon_loadout": "kinetic-heavy"},
    "Xylothian": {"species": "xylothian", "hive_role": "warrior"},
    "Ethereal": {"species": "ethereal", "harmonic_resonance": "aggressive"},
    "Mech-Collective": {"species": "mech_collective", "armor_type": "heavy-assault"},
}

for faction, custom in factions_ships.items():
    state = orchestrator.create_design_state(
        species_code=custom["species"],
        customizations=custom,
        ship_name=f"{faction} Battleship"
    )
    # Save/generate...
```

### Workflow 2: Age Variants of Same Design
```python
for age in [0, 25, 50, 75, 100]:
    state = orchestrator.create_design_state(
        species_code="terran",
        customizations={"hull_material": "titanium-composite"}
    )
    
    if age > 0:
        state = orchestrator.enhance_with_pattern(
            state,
            "weathering",
            {"age_level": age, "damage_intensity": age//2}
        )
    
    # Generate and save...
```

### Workflow 3: Role-Optimized Fleet
```python
roles = ["scout", "carrier", "battleship", "explorer", "colony_ship"]

for role in roles:
    state = orchestrator.create_design_state(
        species_code="xylothian",
        customizations={"hive_role": role}
    )
    
    state = orchestrator.enhance_with_pattern(
        state,
        "special_purpose",
        {"special_purpose": role}
    )
    
    # Generate...
```

---

## 📊 Monitoring

### View Generation Stats
```python
from trellis2_prompt_enhancement import PromptHashRegistry

registry = PromptHashRegistry()
stats = registry.get_stats()

print(f"Total Unique Prompts: {stats['total_unique_prompts']}")
print(f"Total Generations: {stats['total_generations']}")
print(f"Avg Reuse: {stats['total_generations'] / max(stats['total_unique_prompts'], 1):.1f}x")
```

### View Design History
```python
print(f"Enhancement History ({len(state.enhancement_history)} steps):")
for i, entry in enumerate(state.enhancement_history, 1):
    print(f"  {i}. {entry['pattern']} - {entry['timestamp']}")
```

---

## ⚡ Performance Tips

1. **Cache templates** - Load once, use many times
2. **Batch generate** - Create multiple designs, then generate all
3. **Monitor GPU** - Check `docker compose logs trellis2` during generation
4. **Reuse patterns** - Enhancement patterns are fast (~100ms each)
5. **Save designs** - Load and iterate later

---

## 🐛 Troubleshooting

### WebUI doesn't load
```bash
# Check if port 7864 is in use
lsof -i :7864  # Linux/Mac
netstat -ano | findstr :7864  # Windows

# Restart Gradio
docker compose restart trellis2
```

### Prompts not generating
```bash
# Check templates file
ls -la tools/trellis2/species_design_templates.yaml

# Verify YAML syntax
python -c "import yaml; yaml.safe_load(open('tools/trellis2/species_design_templates.yaml'))"
```

### 3D generation timing out
```bash
# Monitor GPU
docker compose exec trellis2 nvidia-smi

# Check logs
docker compose logs trellis2 | grep -i "error\|gpu\|cuda"
```

---

## 📖 Next Steps

1. **Try WebUI** - Open http://localhost:7864 and create first design
2. **Read Full Guide** - `docs/TRELLIS2_PROMPT_ENHANCEMENT_GUIDE.md`
3. **Run Tests** - `scripts/trellis2_prompt_enhancement_test.py`
4. **Explore API** - Use Python directly for batch workflows
5. **Integrate** - Connect to game backend via asset pipeline

---

## 🎉 You're Ready!

Start creating amazing 3D spaceships with the power of LLM-guided design templates!

**Questions?** Check [TRELLIS2_PROMPT_ENHANCEMENT_GUIDE.md](../docs/TRELLIS2_PROMPT_ENHANCEMENT_GUIDE.md)

**Issues?** Check logs: `docker compose logs trellis2`

**Contribute?** Extend species templates in `species_design_templates.yaml`

---

**Happy designing! 🚀**
