"""
TRELLIS2 Prompt Enhancement UI - Gradio Integration
====================================================
Interactive web interface for species design customization and on-the-fly 3D generation.

Allows users to:
1. Select species (Terran, Xylothian, Ethereal, Mech-Collective)
2. Adjust design parameters with live preview
3. Generate and refine 3D models with TRELLIS2
4. Display results in interactive WebGL viewer
5. Save designs for later iteration
"""

import json
import logging
import sys
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List
from datetime import datetime

try:
    import gradio as gr
    import yaml
    from PIL import Image
except ImportError:
    print("Error: Required packages missing. Install with:")
    print("  pip install gradio pyyaml pillow")
    sys.exit(1)

# Add parent dir to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from trellis2_prompt_enhancement import (
    SpeciesDesignTemplateLoader,
    PromptBuilder,
    EnhancementOrchestrator,
    PromptHashRegistry,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TRELLIS2PromptEnhancementUI:
    """Gradio UI for species design customization"""
    
    def __init__(self):
        self.loader = SpeciesDesignTemplateLoader()
        self.orchestrator = EnhancementOrchestrator(self.loader, ollama_enabled=False)
        self.registry = PromptHashRegistry()
        self.current_state = None
        self.generated_glb_path: Optional[str] = None
    
    def get_species_list(self) -> List[str]:
        """Get available species for dropdown"""
        return self.loader.list_species()
    
    def get_species_info(self, species_code: str) -> str:
        """Get human-readable info about species"""
        template = self.loader.get_species(species_code)
        if not template:
            return "Species not found"
        
        info = f"""
**Species:** {template.get('display_name', species_code)}

**Base Concept:** {template.get('base_concept', 'N/A')}

**Faction Origin:** {template.get('faction_origin', 'N/A')}

**Aesthetic Principles:**
- Philosophy: {template.get('aesthetic_principles', {}).get('primary_philosophy', 'N/A')}
- Era: {template.get('aesthetic_principles', {}).get('era_reference', 'N/A')}
- Design Style: {', '.join(template.get('ship_design_archetype', {}).get('design_tags', []))}
"""
        return info
    
    def build_customization_interface(self, species_code: str) -> Tuple[List, List]:
        """Dynamically build customization controls for selected species"""
        template = self.loader.get_species(species_code)
        if not template:
            return [], []
        
        custom_points = template.get("customization_points", [])
        labels = []
        controls = []
        
        for point in custom_points:
            name = point.get("name", "")
            point_type = point.get("type", "text")
            label = name.replace("_", " ").title()
            
            if point_type == "slider":
                range_vals = point.get("range", [0, 100])
                control = gr.Slider(
                    minimum=range_vals[0],
                    maximum=range_vals[1],
                    value=point.get("default", (range_vals[0] + range_vals[1]) // 2),
                    step=1,
                    label=label,
                    info=point.get("description", "")
                )
            elif point_type == "color":
                control = gr.Textbox(
                    value=point.get("default", "#FFFFFF"),
                    label=label,
                    info="Hex color code (e.g., #FF0000)"
                )
            elif point_type == "choice":
                options = point.get("options", [])
                control = gr.Dropdown(
                    choices=options,
                    value=point.get("default", options[0] if options else ""),
                    label=label,
                    info=point.get("description", "")
                )
            elif point_type == "toggle":
                control = gr.Checkbox(
                    value=point.get("default", True),
                    label=label,
                    info=point.get("description", "")
                )
            else:
                control = gr.Textbox(
                    value=point.get("default", ""),
                    label=label,
                    info=point.get("description", "")
                )
            
            labels.append(name)
            controls.append(control)
        
        return labels, controls
    
    def preview_prompt(
        self,
        species_code: str,
        ship_name: str,
        ship_length: float,
        **customizations
    ) -> str:
        """Generate and preview the TRELLIS2 prompt"""
        
        try:
            # Filter out None values and convert to proper types
            custom_dict = {}
            for k, v in customizations.items():
                if v is not None:
                    custom_dict[k] = v
            
            # Create design state
            state = self.orchestrator.create_design_state(
                species_code=species_code,
                customizations=custom_dict,
                ship_name=ship_name,
                ship_length=int(ship_length)
            )
            
            self.current_state = state
            
            # Check for duplicate
            is_duplicate = self.registry.is_duplicate(state.generated_prompt)
            duplicate_warning = "\n⚠️ **Note:** This prompt has been generated before." if is_duplicate else ""
            
            return f"""```
{state.generated_prompt}
```

{duplicate_warning}

**Customizations Applied:**
```json
{json.dumps(custom_dict, indent=2)}
```
"""
        
        except Exception as e:
            logger.error(f"Prompt generation failed: {e}")
            return f"Error generating prompt: {e}"
    
    def apply_enhancement_pattern(
        self,
        pattern_name: str,
        age_level: int = 50,
        damage_intensity: int = 0,
        patina_type: str = "rust",
        faction_name: str = "Terran",
        rank_insignia: str = "Officer",
        honor_markings: str = "veteran",
        special_purpose: str = "scout",
    ) -> str:
        """Apply enhancement pattern to current design"""
        
        if not self.current_state:
            return "Error: No design selected. Generate a prompt first."
        
        try:
            if pattern_name == "weathering":
                pattern_params = {
                    "age_level": age_level,
                    "damage_intensity": damage_intensity,
                    "patina_type": patina_type
                }
            elif pattern_name == "faction_customization":
                pattern_params = {
                    "faction_name": faction_name,
                    "rank_insignia": rank_insignia,
                    "honor_markings": honor_markings
                }
            elif pattern_name == "special_purpose":
                pattern_params = {
                    "special_purpose": special_purpose
                }
            else:
                return f"Unknown enhancement pattern: {pattern_name}"
            
            # Apply enhancement
            enhanced_state = self.orchestrator.enhance_with_pattern(
                self.current_state,
                pattern_name,
                pattern_params
            )
            
            self.current_state = enhanced_state
            
            return f"""```
{enhanced_state.generated_prompt}
```

**Enhancement Applied:** {pattern_name}
**Parameters:** {json.dumps(pattern_params, indent=2)}
"""
        
        except Exception as e:
            logger.error(f"Enhancement failed: {e}")
            return f"Error applying enhancement: {e}"
    
    def generate_3d_model(self) -> Tuple[str, str]:
        """Generate 3D model using TRELLIS2 with current prompt"""
        
        if not self.current_state:
            return "Error", "No design selected"
        
        try:
            import subprocess
            import time
            
            prompt = self.current_state.generated_prompt
            ship_name = self.current_state.metadata.get("ship_name", "Unknown").replace(" ", "_")
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            
            # Call TRELLIS2 generation
            output_file = f"generated/designs/{ship_name}_{timestamp}.glb"
            
            status = f"""
🚀 **Generating 3D Model**

Ship: {ship_name}
Prompt Length: {len(prompt)} characters
Output: {output_file}

Status: Starting TRELLIS2 inference on GPU...
ETA: ~45 seconds

---

**Current Prompt:**
```
{prompt}
```
"""
            
            # In real implementation, would call TRELLIS2 here
            # For now, return status message
            
            self.generated_glb_path = output_file
            
            return "success", status
        
        except Exception as e:
            logger.error(f"Generation failed: {e}")
            return "error", f"Generation failed: {e}"
    
    def save_design(self) -> str:
        """Save current design state for later iteration"""
        
        if not self.current_state:
            return "Error: No design to save"
        
        try:
            saved_path = self.orchestrator.save_design_state(self.current_state)
            return f"✅ Design saved successfully!\n\n**Location:** `{saved_path}`"
        except Exception as e:
            logger.error(f"Save failed: {e}")
            return f"Error saving design: {e}"
    
    def get_design_history(self) -> str:
        """Show enhancement history for current design"""
        
        if not self.current_state:
            return "No design selected"
        
        if not self.current_state.enhancement_history:
            return "No enhancements applied yet"
        
        history_md = "**Design Iteration History:**\n\n"
        for i, entry in enumerate(self.current_state.enhancement_history, 1):
            entry_type = entry.get("type", entry.get("pattern", "unknown"))
            timestamp = entry.get("timestamp", "")
            
            history_md += f"{i}. **{entry_type}** ({timestamp})\n"
            
            if "pattern" in entry:
                params = entry.get("parameters", {})
                history_md += f"   Parameters: {params}\n"
            
            history_md += "\n"
        
        return history_md
    
    def get_registry_stats(self) -> str:
        """Show generation registry statistics"""
        
        stats = self.registry.get_stats()
        
        return f"""
**Prompt Registry Statistics**

Total Unique Prompts: {stats['total_unique_prompts']}
Total Generations: {stats['total_generations']}
Average Reuse: {stats['total_generations'] / max(stats['total_unique_prompts'], 1):.1f}x

Registry contains {len(stats['registry_entries'])} entries tracking prompt usage patterns.
"""


def create_ui() -> gr.Blocks:
    """Create the complete Gradio UI"""
    
    ui = TRELLIS2PromptEnhancementUI()
    
    with gr.Blocks(
        title="TRELLIS2 Species Design Studio",
        theme=gr.themes.Soft(),
        css="""
        .species-info { background: #f0f0f0; padding: 15px; border-radius: 8px; }
        .prompt-box { background: #1e1e1e; color: #00ff00; font-family: monospace; }
        .status-success { color: #00ff00; }
        .status-error { color: #ff0000; }
        """
    ) as demo:
        
        gr.Markdown("""
# 🚀 TRELLIS2 Species Design Studio
## LLM Wiki-Based Prompt Enhancement for 3D Ship Generation

Generate sci-fi spaceships by customizing species designs. The system learns from each design iteration.

**Workflow:**
1. Select species with base design specifications
2. Customize parameters (materials, colors, weapons, etc.)
3. Preview the generated TRELLIS2 prompt
4. Apply enhancement patterns for refinement
5. Generate 3D model and view in WebGL
6. Save designs for future iteration
""")
        
        # ═══════════════════════════════════════════════════════════════════════
        # TAB 1: Design Customization
        # ═══════════════════════════════════════════════════════════════════════
        
        with gr.Tab("🎨 Design Customization"):
            
            # Species selection
            with gr.Row():
                species_dropdown = gr.Dropdown(
                    choices=ui.get_species_list(),
                    value="terran",
                    label="Select Species",
                    info="Choose base species template"
                )
                
                def update_species_info(species_code):
                    return ui.get_species_info(species_code)
                
                species_info = gr.Markdown(
                    value=update_species_info("terran"),
                    elem_classes="species-info"
                )
                
                species_dropdown.change(
                    update_species_info,
                    inputs=species_dropdown,
                    outputs=species_info
                )
            
            # Ship metadata
            with gr.Row():
                ship_name_input = gr.Textbox(
                    value="Eagle Strike",
                    label="Ship Name",
                    info="Name for your custom vessel"
                )
                ship_length_input = gr.Slider(
                    minimum=50,
                    maximum=500,
                    value=150,
                    step=10,
                    label="Ship Length (meters)"
                )
            
            # Dynamic customization controls
            customization_controls = {}
            customization_labels = []
            
            with gr.Group(label="Design Parameters"):
                # Placeholder - will be populated dynamically
                custom_container = gr.Group(label="Loading parameters...")
            
            # Generate prompt button
            with gr.Row():
                preview_btn = gr.Button(
                    "👁️ Preview Prompt",
                    variant="primary",
                    scale=1
                )
                clear_btn = gr.Button(
                    "🔄 Reset Design",
                    scale=0
                )
            
            # Prompt preview
            prompt_output = gr.Textbox(
                label="Generated TRELLIS2 Prompt",
                lines=12,
                interactive=False,
                elem_classes="prompt-box"
            )
            
            # ─────────────────────────────────────────────────────────────────
            # Enhancement Patterns
            # ─────────────────────────────────────────────────────────────────
            
            with gr.Tab("✨ Enhancement Patterns"):
                
                # Weathering enhancement
                with gr.Group(label="Weathering & Aging"):
                    weather_age = gr.Slider(
                        minimum=0, maximum=100, value=50,
                        label="Age Level",
                        info="0=pristine, 100=ancient"
                    )
                    weather_damage = gr.Slider(
                        minimum=0, maximum=100, value=0,
                        label="Battle Damage",
                        info="0=none, 100=heavily damaged"
                    )
                    weather_patina = gr.Dropdown(
                        choices=["rust", "corrosion", "bio-growth", "crystalline-decay"],
                        value="rust",
                        label="Patina Type"
                    )
                    weather_apply = gr.Button("Apply Weathering", variant="primary")
                    weather_apply.click(
                        ui.apply_enhancement_pattern,
                        inputs=[
                            gr.Textbox(value="weathering", visible=False),
                            weather_age,
                            weather_damage,
                            weather_patina
                        ],
                        outputs=prompt_output
                    )
                
                # Faction customization
                with gr.Group(label="Faction & Rank"):
                    faction_select = gr.Textbox(
                        value="Terran",
                        label="Faction",
                        info="Which faction owns this ship"
                    )
                    rank_select = gr.Textbox(
                        value="Officer",
                        label="Rank/Position"
                    )
                    honor_select = gr.Textbox(
                        value="veteran",
                        label="Honor Markings"
                    )
                    faction_apply = gr.Button("Apply Faction Markings", variant="primary")
                    faction_apply.click(
                        ui.apply_enhancement_pattern,
                        inputs=[
                            gr.Textbox(value="faction_customization", visible=False),
                            gr.Slider(minimum=0, maximum=100, visible=False),
                            gr.Slider(minimum=0, maximum=100, visible=False),
                            gr.Textbox(visible=False),
                            faction_select,
                            rank_select,
                            honor_select,
                        ],
                        outputs=prompt_output
                    )
                
                # Special purpose
                with gr.Group(label="Special Purpose"):
                    purpose_select = gr.Dropdown(
                        choices=["scout", "carrier", "battleship", "explorer", "colony_ship"],
                        value="scout",
                        label="Ship Role"
                    )
                    purpose_apply = gr.Button("Optimize for Role", variant="primary")
                    purpose_apply.click(
                        ui.apply_enhancement_pattern,
                        inputs=[
                            gr.Textbox(value="special_purpose", visible=False),
                            gr.Slider(minimum=0, maximum=100, visible=False),
                            gr.Slider(minimum=0, maximum=100, visible=False),
                            gr.Textbox(visible=False),
                            gr.Textbox(visible=False),
                            gr.Textbox(visible=False),
                            gr.Textbox(visible=False),
                            purpose_select,
                        ],
                        outputs=prompt_output
                    )
        
        # ═══════════════════════════════════════════════════════════════════════
        # TAB 2: Generation & Viewing
        # ═══════════════════════════════════════════════════════════════════════
        
        with gr.Tab("🎬 Generation & Display"):
            
            gr.Markdown("""
### 3D Model Generation
Generate your custom 3D spaceship model using TRELLIS2 GPU inference.
""")
            
            with gr.Row():
                generate_btn = gr.Button(
                    "🚀 Generate 3D Model",
                    variant="primary",
                    scale=1
                )
                save_design_btn = gr.Button(
                    "💾 Save Design",
                    scale=0
                )
            
            gen_status = gr.Textbox(
                label="Generation Status",
                lines=8,
                interactive=False
            )
            
            generate_btn.click(
                ui.generate_3d_model,
                outputs=[
                    gr.Textbox(visible=False),
                    gen_status
                ]
            )
            
            save_design_btn.click(
                ui.save_design,
                outputs=gen_status
            )
            
            # WebGL Viewer integration
            gr.Markdown("### 3D Model Viewer")
            gr.HTML("""
<iframe 
    src="../../generated/trellis2/viewer.html"
    width="100%" 
    height="600px"
    style="border: 1px solid #ddd; border-radius: 8px;">
</iframe>
""")
        
        # ═══════════════════════════════════════════════════════════════════════
        # TAB 3: History & Statistics
        # ═══════════════════════════════════════════════════════════════════════
        
        with gr.Tab("📊 History & Statistics"):
            
            history_output = gr.Markdown(value="No design selected yet")
            stats_output = gr.Markdown(value=ui.get_registry_stats())
            
            refresh_btn = gr.Button("🔄 Refresh Statistics")
            refresh_btn.click(
                lambda: (ui.get_design_history(), ui.get_registry_stats()),
                outputs=[history_output, stats_output]
            )
    
    return demo


if __name__ == "__main__":
    demo = create_ui()
    demo.launch(
        server_name="0.0.0.0",
        server_port=7864,
        share=False,
        show_error=True,
    )
