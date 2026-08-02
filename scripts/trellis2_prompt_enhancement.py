#!/usr/bin/env python3
"""
TRELLIS2 Prompt Enhancement Engine (LLM Wiki Pattern)
=========================================================
Converts Species Design Templates + User Customization into optimized TRELLIS2 prompts.

Based on Karpathy's LLM Wiki concept:
- Base Specification (YAML species templates)
- User Customization (parameter modifications)
- Iterative Enhancement (LLM-based refinement)

Workflow:
  1. Load species template → defines base characteristics
  2. Apply user customizations → modifies parameters
  3. Generate prompt → creates TRELLIS2-compatible prompt
  4. [Optional] Enhance prompt → LLM refines and optimizes
  5. Generate 3D model → TRELLIS2 creates asset
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, asdict
from datetime import datetime
import yaml
import hashlib

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class SpeciesDesignState:
    """Represents the state of a species design customization"""
    species_code: str
    base_template: Dict[str, Any]
    customizations: Dict[str, Any]
    enhancement_history: List[Dict[str, Any]]
    generated_prompt: str
    metadata: Dict[str, Any]
    created_at: str
    updated_at: str
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class SpeciesDesignTemplateLoader:
    """Load and cache species design templates from YAML"""
    
    def __init__(self, templates_path: str = "tools/trellis2/species_design_templates.yaml"):
        self.templates_path = Path(templates_path)
        self._cache: Dict[str, Dict] = {}
        self._load_templates()
    
    def _load_templates(self) -> None:
        """Load templates from YAML file"""
        if not self.templates_path.exists():
            logger.warning(f"Templates file not found: {self.templates_path}")
            self._cache = {"species": {}, "enhancement_patterns": {}}
            return
        
        try:
            with open(self.templates_path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f) or {}
                self._cache = data
                logger.info(f"Loaded {len(self._cache.get('species', {}))} species templates")
        except Exception as e:
            logger.error(f"Failed to load templates: {e}")
            self._cache = {"species": {}, "enhancement_patterns": {}}
    
    def get_species(self, species_code: str) -> Optional[Dict[str, Any]]:
        """Get a single species template"""
        return self._cache.get("species", {}).get(species_code)
    
    def list_species(self) -> List[str]:
        """List all available species codes"""
        return list(self._cache.get("species", {}).keys())
    
    def get_enhancement_patterns(self) -> Dict[str, Any]:
        """Get all enhancement patterns"""
        return self._cache.get("enhancement_patterns", {})


class PromptBuilder:
    """Convert customizations into TRELLIS2-compatible 3D generation prompts"""
    
    def __init__(self, templates_loader: SpeciesDesignTemplateLoader):
        self.loader = templates_loader
    
    def build_prompt(
        self,
        species_code: str,
        customizations: Dict[str, Any],
        ship_name: str = "Unknown Vessel",
        ship_length: int = 150,
    ) -> str:
        """
        Build a TRELLIS2 prompt from species template + customizations.
        
        Args:
            species_code: Code for species (e.g., 'vortak', 'sylnar', 'aereth', 'kryltha', 'zhareen', 'velar')
            customizations: Dict of parameter customizations
            ship_name: Name of the ship/model
            ship_length: Length in meters
        
        Returns:
            Formatted prompt ready for TRELLIS2
        """
        template = self.loader.get_species(species_code)
        if not template:
            logger.error(f"Species not found: {species_code}")
            return ""
        
        # Extract prompt template and substitute variables
        prompt_template = template.get("prompt_template", "")
        if not prompt_template:
            logger.warning(f"No prompt template for species: {species_code}")
            return ""
        
        # Prepare substitution variables
        variables = {
            "ship_name": ship_name,
            "ship_length": ship_length,
        }
        
        # Apply customizations
        variables.update(self._process_customizations(template, customizations))
        
        # Substitute in template
        try:
            prompt = prompt_template.format(**variables)
            logger.info(f"Built prompt for {species_code} ship '{ship_name}'")
            return prompt
        except KeyError as e:
            logger.error(f"Missing variable in prompt template: {e}")
            return prompt_template
    
    def _process_customizations(
        self,
        template: Dict[str, Any],
        customizations: Dict[str, Any]
    ) -> Dict[str, str]:
        """
        Process customizations to match prompt template requirements.
        Maps user inputs to prompt-ready strings.
        """
        result = {}
        customization_points = template.get("customization_points", [])
        
        for point in customization_points:
            name = point.get("name")
            if not name:
                continue
            
            custom_value = customizations.get(name)
            if custom_value is None:
                # Use default if available
                custom_value = point.get("default", "")
            
            # Convert based on type
            point_type = point.get("type", "text")
            
            if point_type == "slider":
                result[name] = str(int(custom_value)) if custom_value is not None else "50"
            elif point_type == "color":
                result[name] = str(custom_value) or point.get("default", "#FFFFFF")
            elif point_type == "choice":
                result[name] = str(custom_value) or point.get("default", "")
            elif point_type == "toggle":
                toggle_value = custom_value if custom_value is not None else point.get("default", True)
                result[name + "_text"] = "with faction markings" if toggle_value else "without faction markings"
            else:
                result[name] = str(custom_value) if custom_value else ""
        
        return result


class EnhancementOrchestrator:
    """
    Orchestrate prompt enhancement following LLM Wiki pattern.
    Tracks enhancement history for iterative refinement.
    """
    
    def __init__(
        self,
        templates_loader: SpeciesDesignTemplateLoader,
        ollama_enabled: bool = False,
        ollama_base_url: str = "http://localhost:11434"
    ):
        self.loader = templates_loader
        self.builder = PromptBuilder(templates_loader)
        self.ollama_enabled = ollama_enabled
        self.ollama_base_url = ollama_base_url
    
    def create_design_state(
        self,
        species_code: str,
        customizations: Dict[str, Any],
        ship_name: str = "Unknown Vessel",
        ship_length: int = 150,
    ) -> SpeciesDesignState:
        """Create initial design state from species + customizations"""
        
        template = self.loader.get_species(species_code)
        if not template:
            raise ValueError(f"Unknown species: {species_code}")
        
        # Build base prompt
        prompt = self.builder.build_prompt(
            species_code,
            customizations,
            ship_name,
            ship_length
        )
        
        # Create state object
        state = SpeciesDesignState(
            species_code=species_code,
            base_template=template,
            customizations=customizations,
            enhancement_history=[],
            generated_prompt=prompt,
            metadata={
                "ship_name": ship_name,
                "ship_length": ship_length,
                "design_version": 1,
            },
            created_at=datetime.utcnow().isoformat(),
            updated_at=datetime.utcnow().isoformat(),
        )
        
        logger.info(f"Created design state for {species_code} ship: {ship_name}")
        return state
    
    def enhance_with_pattern(
        self,
        state: SpeciesDesignState,
        pattern_name: str,
        pattern_params: Dict[str, Any]
    ) -> SpeciesDesignState:
        """
        Apply enhancement pattern to modify prompt.
        
        Patterns available (from YAML):
        - weathering: Add age/battle-wear
        - faction_customization: Add faction markers
        - special_purpose: Optimize for role
        """
        
        patterns = self.loader.get_enhancement_patterns()
        pattern_def = patterns.get(pattern_name)
        
        if not pattern_def:
            logger.warning(f"Unknown enhancement pattern: {pattern_name}")
            return state
        
        # Build enhancement text
        enhancement_text = pattern_def.get("affects_prompt", "")
        try:
            enhancement_text = enhancement_text.format(**pattern_params)
        except KeyError:
            logger.warning(f"Missing parameters for pattern {pattern_name}")
            return state
        
        # Append enhancement to prompt
        enhanced_prompt = state.generated_prompt + "\n\nEnhancement: " + enhancement_text
        
        # Record in history
        enhancement_record = {
            "timestamp": datetime.utcnow().isoformat(),
            "pattern": pattern_name,
            "parameters": pattern_params,
            "prompt_modification": enhancement_text,
        }
        
        state.enhancement_history.append(enhancement_record)
        state.generated_prompt = enhanced_prompt
        state.updated_at = datetime.utcnow().isoformat()
        
        logger.info(f"Applied enhancement '{pattern_name}' to design")
        return state
    
    def refine_with_ollama(
        self,
        state: SpeciesDesignState,
        refinement_focus: str = "visual accuracy and 3D model compatibility"
    ) -> Optional[SpeciesDesignState]:
        """
        Use Ollama LLM to iteratively refine and enhance the prompt.
        
        This implements the iterative enhancement concept from LLM Wiki:
        - Takes current prompt
        - LLM suggests improvements
        - Returns enhanced version
        """
        
        if not self.ollama_enabled:
            logger.info("Ollama enhancement disabled (not configured)")
            return None
        
        try:
            import requests
        except ImportError:
            logger.error("requests library not available for Ollama")
            return None
        
        system_prompt = f"""You are a 3D model prompt optimization expert for sci-fi spaceship generation.
Your task is to refine and enhance prompts for better TRELLIS2 3D model generation.

Focus on: {refinement_focus}

Current prompt quality factors:
- Technical accuracy (3D modeling compatibility)
- Visual clarity and detail
- Actionable specifications for AI generation
- Consistent style and aesthetic

Return ONLY the refined prompt, no explanation."""
        
        user_message = f"""Refine this spaceship prompt for TRELLIS2 3D generation:

{state.generated_prompt}

Make it more detailed, clear, and optimized for 3D model generation. Add specific measurements, materials, and visual characteristics."""
        
        try:
            response = requests.post(
                f"{self.ollama_base_url}/api/generate",
                json={
                    "model": "neural-chat",  # or any available model
                    "prompt": user_message,
                    "system": system_prompt,
                    "stream": False,
                    "temperature": 0.5,
                },
                timeout=60
            )
            response.raise_for_status()
            
            refined_text = response.json().get("response", "")
            if refined_text:
                enhancement_record = {
                    "timestamp": datetime.utcnow().isoformat(),
                    "type": "ollama_refinement",
                    "focus": refinement_focus,
                    "original_prompt": state.generated_prompt,
                    "refined_prompt": refined_text,
                }
                
                state.enhancement_history.append(enhancement_record)
                state.generated_prompt = refined_text
                state.updated_at = datetime.utcnow().isoformat()
                state.metadata["design_version"] = state.metadata.get("design_version", 1) + 1
                
                logger.info("Successfully refined prompt with Ollama")
                return state
        
        except Exception as e:
            logger.error(f"Ollama refinement failed: {e}")
            return None
    
    def save_design_state(
        self,
        state: SpeciesDesignState,
        output_dir: str = "generated/designs"
    ) -> str:
        """
        Save design state to JSON file for later retrieval and iteration.
        
        Returns:
            Path to saved design file
        """
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        # Generate unique filename from ship name + timestamp
        ship_name_safe = state.metadata["ship_name"].replace(" ", "_").lower()
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename = f"design_{ship_name_safe}_{timestamp}.json"
        
        filepath = output_path / filename
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(state.to_dict(), f, indent=2, ensure_ascii=False)
        
        logger.info(f"Saved design state to {filepath}")
        return str(filepath)
    
    def load_design_state(self, filepath: str) -> Optional[SpeciesDesignState]:
        """Load design state from JSON file for continued iteration"""
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return SpeciesDesignState(**data)
        except Exception as e:
            logger.error(f"Failed to load design state: {e}")
            return None


class PromptHashRegistry:
    """Track unique prompts to prevent duplicate generations"""
    
    def __init__(self, registry_path: str = "generated/logs/prompt_registry.json"):
        self.registry_path = Path(registry_path)
        self._registry: Dict[str, Dict] = {}
        self._load_registry()
    
    def _load_registry(self) -> None:
        """Load existing registry"""
        if self.registry_path.exists():
            try:
                with open(self.registry_path, 'r') as f:
                    self._registry = json.load(f)
                logger.info(f"Loaded prompt registry with {len(self._registry)} entries")
            except Exception as e:
                logger.warning(f"Failed to load registry: {e}")
                self._registry = {}
    
    def register_prompt(self, prompt: str, metadata: Dict[str, Any] = None) -> str:
        """
        Register a prompt and return its unique hash.
        
        Returns:
            SHA256 hash of prompt
        """
        prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()[:16]
        
        if prompt_hash not in self._registry:
            self._registry[prompt_hash] = {
                "prompt_hash": prompt_hash,
                "first_seen": datetime.utcnow().isoformat(),
                "usage_count": 0,
                "metadata": metadata or {},
            }
        
        # Increment usage count
        self._registry[prompt_hash]["usage_count"] += 1
        self._registry[prompt_hash]["last_used"] = datetime.utcnow().isoformat()
        
        self._save_registry()
        return prompt_hash
    
    def is_duplicate(self, prompt: str) -> bool:
        """Check if prompt has been generated before"""
        prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()[:16]
        return prompt_hash in self._registry
    
    def get_stats(self) -> Dict[str, Any]:
        """Get registry statistics"""
        return {
            "total_unique_prompts": len(self._registry),
            "total_generations": sum(e["usage_count"] for e in self._registry.values()),
            "registry_entries": list(self._registry.values()),
        }
    
    def _save_registry(self) -> None:
        """Persist registry to disk"""
        self.registry_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.registry_path, 'w') as f:
            json.dump(self._registry, f, indent=2)


# ═══════════════════════════════════════════════════════════════════════════════
# EXAMPLE USAGE
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    # Initialize system
    loader = SpeciesDesignTemplateLoader()
    orchestrator = EnhancementOrchestrator(loader, ollama_enabled=False)
    registry = PromptHashRegistry()
    
    # Example 1: Simple Terran ship customization
    terran_custom = {
        "hull_material": "titanium-composite",
        "accent_color": "#0088FF",
        "weapon_loadout": "balanced",
        "faction_markings": True,
        "age_weathering": 25,
    }
    
    state = orchestrator.create_design_state(
        species_code="terran",
        customizations=terran_custom,
        ship_name="Eagle Strike",
        ship_length=180
    )
    
    print("Generated Prompt:")
    print("-" * 80)
    print(state.generated_prompt)
    print("-" * 80)
    
    # Add enhancement pattern
    state = orchestrator.enhance_with_pattern(
        state,
        pattern_name="weathering",
        pattern_params={"age_level": 25, "damage_intensity": 15, "patina_type": "rust"}
    )
    
    print("\nEnhanced Prompt:")
    print("-" * 80)
    print(state.generated_prompt)
    print("-" * 80)
    
    # Save design state
    saved_path = orchestrator.save_design_state(state)
    print(f"\nDesign saved to: {saved_path}")
    
    # Register prompt
    prompt_hash = registry.register_prompt(state.generated_prompt, metadata=state.metadata)
    print(f"Prompt hash: {prompt_hash}")
    
    # Show stats
    stats = registry.get_stats()
    print(f"\nRegistry stats: {json.dumps(stats, indent=2)}")
