# GalaxyQuest — Documentation Index

> Navigation index for all project documentation.  
> Documentation is divided into three strictly separate areas:
>
> | Folder | Content |
> |---|---|
> | [`technical/`](technical/) | Implementation, architecture, engineering |
> | [`gamedesign/`](gamedesign/) | Game design, mechanics, balancing |
> | [`lore/`](lore/) | Narrative, factions, LORA / art generation |

---

## 🚀 Quick Start

| Document | Content | Time |
|---|---|---|
| [../README.md](../README.md) | Installation, Docker setup, Quick Start | 5 min |
| [technical/DEV_USERS.md](technical/DEV_USERS.md) | Pre-seeded dev accounts | 2 min |
| [gamedesign/START_HERE.md](gamedesign/START_HERE.md) | Game design orientation | 5 min |

---

## 🏗️ Technical — Implementation & Engineering

> Everything about the code, infrastructure, and system architecture.

| Document | Content |
|---|---|
| [technical/ARCHITECTURE.md](technical/ARCHITECTURE.md) | **Main technical reference** — backend, frontend, engine, DB, security |
| [technical/DOCUMENTATION_GUIDE.md](technical/DOCUMENTATION_GUIDE.md) | How to navigate and contribute to docs |
| [technical/IMPLEMENTATION_AUDIT.md](technical/IMPLEMENTATION_AUDIT.md) | **Implementierungs-Audit** — Vollständige Statusanalyse aller Systeme (Stand 11.04.2026) |
| [technical/GAP_TODO.md](technical/GAP_TODO.md) | **Gap-TODO** — priorisierte Lücken zwischen Design und Implementierung |
| [technical/TEMPLATE_SYSTEM_DESIGN.md](technical/TEMPLATE_SYSTEM_DESIGN.md) | **Template system design** — Mustache in PHP, JS & CSS: Vorgaben, Vor-/Nachteile, Migrationsplan |
| [technical/MIGRATION_STRATEGY_OOP.md](technical/MIGRATION_STRATEGY_OOP.md) | OOP refactoring roadmap and conventions |
| [technical/PROJECTION_RUNBOOK.md](technical/PROJECTION_RUNBOOK.md) | Projection runtime operations guide |
| [technical/OLLAMA_SETUP.md](technical/OLLAMA_SETUP.md) | Ollama local LLM setup and configuration |
| [technical/DEV_USERS.md](technical/DEV_USERS.md) | Pre-seeded development accounts |
| [technical/ROADMAP.md](technical/ROADMAP.md) | Engine & feature development roadmap |
| [technical/FUTURE_ENHANCEMENTS.md](technical/FUTURE_ENHANCEMENTS.md) | Planned features and extension points |
| [technical/FACTION_3D_VFX_RUNTIME_MAPPING.md](technical/FACTION_3D_VFX_RUNTIME_MAPPING.md) | Runtime-Mapping: gqVfxEmitters/gqWeaponFx -> ParticleEmitter/BeamEffect |
| [technical/WAVE_17_IMPLEMENTATION_PLAN.md](technical/WAVE_17_IMPLEMENTATION_PLAN.md) | Wave 17 — Pirates + Economy + War full domain feature completion plan |
| [technical/IMPLEMENTATION_STATUS_SUMMARY.md](technical/IMPLEMENTATION_STATUS_SUMMARY.md) | Implementation status: Pirates, Economy, War systems (~70 % complete) |
| [technical/IMPLEMENTATION_CHECKLIST.md](technical/IMPLEMENTATION_CHECKLIST.md) | VFX Phase 1 implementation final verification checklist |

### WebGPU Engine

| Document | Content |
|---|---|
| [technical/webgpu_architecture.md](technical/webgpu_architecture.md) | Engine architecture overview |
| [technical/webgpu_implementation_guide.md](technical/webgpu_implementation_guide.md) | Implementation guide and usage |
| [technical/webgpu_api_reference.md](technical/webgpu_api_reference.md) | Engine API reference |
| [technical/webgpu_migration_roadmap.md](technical/webgpu_migration_roadmap.md) | WebGL → WebGPU migration plan |
| [technical/webgl_engine_analysis.md](technical/webgl_engine_analysis.md) | Legacy WebGL engine analysis |
| [technical/WEBGPU_ENGINE_ATTRIBUTION.md](technical/WEBGPU_ENGINE_ATTRIBUTION.md) | Third-party attributions and licenses |
| [technical/GALAXY_POSTPROCESS_ROADMAP.md](technical/GALAXY_POSTPROCESS_ROADMAP.md) | Post-processing pipeline roadmap |
| [technical/COLONY_BUILDING_WEBGPU_DESIGN.md](technical/COLONY_BUILDING_WEBGPU_DESIGN.md) | Colony building system — WebGPU integration design |

### Performance & Data Encoding

| Document | Content |
|---|---|
| [technical/PERFORMANCE_BASELINE.md](technical/PERFORMANCE_BASELINE.md) | Performance baselines and QA gates |
| [technical/BENCHMARK_RESULTS.md](technical/BENCHMARK_RESULTS.md) | Benchmark analysis |
| [technical/BENCHMARK_QUICKSTART.md](technical/BENCHMARK_QUICKSTART.md) | How to run benchmarks |
| [technical/BINARY_ENCODING_V2.md](technical/BINARY_ENCODING_V2.md) | Binary protocol V2 specification |
| [technical/DELTA_ENCODING_V3.md](technical/DELTA_ENCODING_V3.md) | Delta encoding V3 specification |
| [technical/COMPRESSION.md](technical/COMPRESSION.md) | Gzip + trimming compression overview |
| [technical/SCIENTIFIC_REFERENCES.md](technical/SCIENTIFIC_REFERENCES.md) | Academic references for compression algorithms |

### VFX & Combat Implementation Reports

| Document | Content |
|---|---|
| [technical/WEAPON_FIRE_INTEGRATION.md](technical/WEAPON_FIRE_INTEGRATION.md) | Weapon fire VFX — architecture, event flow, usage guide |
| [technical/VFX_PROJECT_COMPLETION_REPORT.md](technical/VFX_PROJECT_COMPLETION_REPORT.md) | VFX project completion report |
| [technical/PHASE_1_COMPLETION_SUMMARY.md](technical/PHASE_1_COMPLETION_SUMMARY.md) | Combat/VFX Phase 1 completion summary |
| [technical/PHASE_2_COMPLETION.md](technical/PHASE_2_COMPLETION.md) | Combat Phase 2 — multi-entity weapon-fire completion |
| [technical/PHASE_2_IMPLEMENTATION.md](technical/PHASE_2_IMPLEMENTATION.md) | Combat Phase 2 implementation design |
| [technical/PHASE_2_VERIFICATION.md](technical/PHASE_2_VERIFICATION.md) | Combat Phase 2 verification report |
| [technical/PHASE_3_COMPLETION.md](technical/PHASE_3_COMPLETION.md) | Combat Phase 3 — debris destruction system completion |
| [technical/PHASE_3_DEBRIS_SYSTEM.md](technical/PHASE_3_DEBRIS_SYSTEM.md) | Debris destruction system design |

### Traders System

| Document | Content |
|---|---|
| [technical/TRADERS_README.md](technical/TRADERS_README.md) | Traders system overview |
| [technical/TRADERS_INTEGRATION_GUIDE.md](technical/TRADERS_INTEGRATION_GUIDE.md) | Traders system integration guide |
| [technical/TRADERS_SYSTEM_IMPLEMENTATION.md](technical/TRADERS_SYSTEM_IMPLEMENTATION.md) | Traders system implementation details |

---

## 🎮 Game Design — Mechanics & Balancing

> Everything about what the game does: rules, mechanics, systems, and balance.

| Document | Content |
|---|---|
| [gamedesign/GAMEDESIGN.md](gamedesign/GAMEDESIGN.md) | **Definitive game design document** (~1 100 lines) |
| [gamedesign/README_GAMEDESIGN.md](gamedesign/README_GAMEDESIGN.md) | 5-minute game design overview |
| [gamedesign/ARCHITECTURE_GAMEDESIGN.md](gamedesign/ARCHITECTURE_GAMEDESIGN.md) | Design document structure and navigation |
| [gamedesign/START_HERE.md](gamedesign/START_HERE.md) | Orientation guide for game design contributors |
| [gamedesign/GAMEPLAY_DATA_MODEL.md](gamedesign/GAMEPLAY_DATA_MODEL.md) | Data model, mechanics, balancing formulas |
| [gamedesign/EMPIRE_CATEGORIES.md](gamedesign/EMPIRE_CATEGORIES.md) | **Empire categories** — Wirtschaft, Militär, Forschung, Wachstum, Stabilität, Diplomatie, Spionage |
| [gamedesign/FTL_DRIVE_DESIGN.md](gamedesign/FTL_DRIVE_DESIGN.md) | FTL drive system — faction designs and balancing |
| [gamedesign/VESSEL_MODULE_BLUEPRINT_DESIGN.md](gamedesign/VESSEL_MODULE_BLUEPRINT_DESIGN.md) | Vessel blueprint and module system |
| [gamedesign/FACTION_3D_OBJECT_DESIGN_LANGUAGE.md](gamedesign/FACTION_3D_OBJECT_DESIGN_LANGUAGE.md) | Fraktionsspezifische 3D-Objekt-Designsprache (KI -> Three.js JSON) |
| [gamedesign/FACTION_3D_GENERATION_EXAMPLES.md](gamedesign/FACTION_3D_GENERATION_EXAMPLES.md) | Prompt- und JSON-Beispiele fuer fraktionsspezifische 3D-Objekte |
| [gamedesign/GAME_CLASSICS_INSPIRATION.md](gamedesign/GAME_CLASSICS_INSPIRATION.md) | Classic game inspirations and adopted mechanics |
| [gamedesign/COLONIZATION_SYSTEM_DESIGN.md](gamedesign/COLONIZATION_SYSTEM_DESIGN.md) | Colonization system — Empire Sprawl, sectors, governors, buildings |
| [gamedesign/COMBAT_SYSTEM_DESIGN.md](gamedesign/COMBAT_SYSTEM_DESIGN.md) | Combat system — battle simulator, war mechanics, PvP, exhaustion |
| [gamedesign/COLONY_BUILDING_SYSTEM_DESIGN.md](gamedesign/COLONY_BUILDING_SYSTEM_DESIGN.md) | Colony building system — isometric 3D layout, building slots, districts |
| [gamedesign/FACTION_INTRODUCTION.md](gamedesign/FACTION_INTRODUCTION.md) | **Spielerstart & Fraktionsaufstieg** — Herolde, Reputationssystem, Tutorial-Klimax |
| [gamedesign/ONBOARDING_PROLOGUE_DESIGN.md](gamedesign/ONBOARDING_PROLOGUE_DESIGN.md) | **Narrativer Registrierungsprolog** — 5-stufiger Onboarding-Flow, fraktionsspezifische Prologe |

---

## 📖 Lore — Narrative, Factions & Art

> Story, world-building, faction lore, and LORA / image generation assets.

| Document | Content |
|---|---|
| [lore/gamedesign_fractions.md](lore/gamedesign_fractions.md) | Faction species — detailed lore and world-building |
| [lore/gamedesign_fractions_backup.md](lore/gamedesign_fractions_backup.md) | Faction lore — backup / previous version |
| [lore/ART_PROMPTS_SDXL.md](lore/ART_PROMPTS_SDXL.md) | SDXL image generation prompts (portraits, environments) |
| [lore/ART_QUICKSTART.md](lore/ART_QUICKSTART.md) | Art generation quick start guide (SwarmUI / ComfyUI) |
| [lore/LORA_TRAINING_GUIDE.md](lore/LORA_TRAINING_GUIDE.md) | LoRA model training guide for faction-specific art generation |
| [lore/side_factions/](lore/side_factions/) | **Nebenfraktionen** — NPC-only side faction lore, NPC rosters, plot arcs (12 factions) |
