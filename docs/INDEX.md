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
| [../ROADMAP.md](../ROADMAP.md) | **Production-Readiness-Roadmap** — verbindlicher Weg zum Launch (Phasen 0–9, Go-Live-Gates) |
| [technical/PRODUCTION_AUDIT_2026-10-31.md](technical/PRODUCTION_AUDIT_2026-10-31.md) | **Production-Readiness-Audit** — Befunde mit IDs (Security, Backend, DB, Frontend, CI, Infra, Legal), Stand 31.10.2026 |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Branch, pull request, and quality-check guidance |
| [technical/PLESK_DEPLOYMENT.md](technical/PLESK_DEPLOYMENT.md) | Immutable GitHub-to-Plesk delivery, separate staging/production, GPU, SMTP, backup and recovery gates |
| [../CACHE_QUICK_REFERENCE.md](../CACHE_QUICK_REFERENCE.md) | Cache operations quick reference; diagnostics are admin-only and metrics require explicit recording |
| [../SECURITY.md](../SECURITY.md) | Private vulnerability reporting policy |
| [technical/REALITY_CHECK_2026-10-29.md](technical/REALITY_CHECK_2026-10-29.md) | **Reality Check** — evidenzbasierter Implementierungsstand, Stand 29.10.2026 |
| [technical/ARCHITECTURE.md](technical/ARCHITECTURE.md) | **Main technical reference** — backend, frontend, engine, DB, security |
| [../SHIP_DESIGNER_README.md](../SHIP_DESIGNER_README.md) | Ship Designer prompt/UI prototype — REST generation route and standalone page are currently unavailable; not production-ready |
| [technical/DOCUMENTATION_GUIDE.md](technical/DOCUMENTATION_GUIDE.md) | How to navigate and contribute to docs |
| [technical/IMPLEMENTATION_AUDIT.md](technical/IMPLEMENTATION_AUDIT.md) | Implementierungs-Audit — historischer Snapshot vom 31.07.2026; alte Prozent- und Stack-Angaben zurückgezogen |
| [technical/GAP_TODO.md](technical/GAP_TODO.md) | **Gap-TODO** — priorisierte Lücken zwischen Design und Implementierung |
| [technical/TEMPLATE_SYSTEM_DESIGN.md](technical/TEMPLATE_SYSTEM_DESIGN.md) | **Template system design** — Mustache in PHP, JS & CSS: Vorgaben, Vor-/Nachteile, Migrationsplan |
| [technical/MIGRATION_STRATEGY_OOP.md](technical/MIGRATION_STRATEGY_OOP.md) | OOP refactoring roadmap and conventions |
| [technical/PROJECTION_RUNBOOK.md](technical/PROJECTION_RUNBOOK.md) | Projection runtime operations guide |
| [technical/OLLAMA_SETUP.md](technical/OLLAMA_SETUP.md) | Ollama local LLM setup and configuration |
| [technical/DEV_USERS.md](technical/DEV_USERS.md) | Pre-seeded development accounts |
| [technical/ROADMAP.md](technical/ROADMAP.md) | Engine & feature development roadmap (Feature-Backlog, historisch, Stand 11.04.2026) |
| [technical/FUTURE_ENHANCEMENTS.md](technical/FUTURE_ENHANCEMENTS.md) | Feature backlog and ideas; not an authoritative implementation or release status |
| [technical/FACTION_3D_VFX_RUNTIME_MAPPING.md](technical/FACTION_3D_VFX_RUNTIME_MAPPING.md) | Runtime-Mapping: gqVfxEmitters/gqWeaponFx -> ParticleEmitter/BeamEffect |
| [technical/WAVE_17_IMPLEMENTATION_PLAN.md](technical/WAVE_17_IMPLEMENTATION_PLAN.md) | Historischer Wave-17-Plan; Prozentwerte sind Schätzungen vom 07.04.2026, keine aktuellen Fertigstellungsgrade |
| [technical/IMPLEMENTATION_STATUS_SUMMARY.md](technical/IMPLEMENTATION_STATUS_SUMMARY.md) | Implementation status: Pirates, Economy, War systems (historischer Snapshot, keine Release-Aussage) |

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
| [technical/PERFORMANCE_BASELINE.md](technical/PERFORMANCE_BASELINE.md) | Historical desktop measurements and current runtime-monitor limits; not a CI gate |
| [CACHING_ARCHITECTURE.md](CACHING_ARCHITECTURE.md) | Cache architecture reference; coverage counts and recommendations are historical snapshots |
| [CACHE_IMPLEMENTATION_ROADMAP.md](CACHE_IMPLEMENTATION_ROADMAP.md) | Historical cache-expansion proposal; not the current project roadmap |
| [technical/BENCHMARK_RESULTS.md](technical/BENCHMARK_RESULTS.md) | Benchmark analysis |
| [technical/BENCHMARK_QUICKSTART.md](technical/BENCHMARK_QUICKSTART.md) | How to run benchmarks |
| [technical/BINARY_ENCODING_V2.md](technical/BINARY_ENCODING_V2.md) | Optional binary V2 format specification; JSON remains the browser default |
| [technical/DELTA_ENCODING_V3.md](technical/DELTA_ENCODING_V3.md) | V3 compression research/prototype; estimates are unmeasured and not production approval |
| [technical/COMPRESSION.md](technical/COMPRESSION.md) | Historical compression estimates; current JSON default and optional binary formats |
| [technical/SCIENTIFIC_REFERENCES.md](technical/SCIENTIFIC_REFERENCES.md) | Academic references for compression algorithms |

### VFX & Combat Implementation Reports

| Document | Content |
|---|---|
| [technical/WEAPON_FIRE_INTEGRATION.md](technical/WEAPON_FIRE_INTEGRATION.md) | Weapon fire VFX — architecture, event flow, usage guide |
| [technical/VFX_PROJECT_COMPLETION_REPORT.md](technical/VFX_PROJECT_COMPLETION_REPORT.md) | Historical VFX implementation report (2026-04-02); not a production-readiness approval |
| [technical/PHASE_1_COMPLETION_SUMMARY.md](technical/PHASE_1_COMPLETION_SUMMARY.md) | Historical Combat/VFX Phase 1 summary; completion is not release acceptance |
| [technical/PHASE_2_COMPLETION.md](technical/PHASE_2_COMPLETION.md) | Historical Combat Phase 2 multi-entity weapon-fire implementation report |
| [technical/PHASE_2_IMPLEMENTATION.md](technical/PHASE_2_IMPLEMENTATION.md) | Combat Phase 2 implementation design |
| [technical/PHASE_2_VERIFICATION.md](technical/PHASE_2_VERIFICATION.md) | Historical Combat Phase 2 verification checklist (2026-04-02) |
| [technical/PHASE_3_COMPLETION.md](technical/PHASE_3_COMPLETION.md) | Historical Combat Phase 3 debris-system implementation report |
| [technical/PHASE_3_DEBRIS_SYSTEM.md](technical/PHASE_3_DEBRIS_SYSTEM.md) | Debris destruction system design |

### Traders System

| Document | Content |
|---|---|
| [technical/TRADERS_README.md](technical/TRADERS_README.md) | Historical traders implementation snapshot; examples omit authentication and CSRF |
| [technical/TRADERS_INTEGRATION_GUIDE.md](technical/TRADERS_INTEGRATION_GUIDE.md) | Historical traders integration proposal; current scheduling uses the global simulation tick |
| [technical/TRADERS_SYSTEM_IMPLEMENTATION.md](technical/TRADERS_SYSTEM_IMPLEMENTATION.md) | Historical traders design proposal; API action list is stale |

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
| [gamedesign/FTL_DRIVE_DESIGN.md](gamedesign/FTL_DRIVE_DESIGN.md) | FTL drive design and balancing; faction-specific runtime paths are partial, not a release sign-off |
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
| [gamedesign/GAMEDESIGN.md](gamedesign/GAMEDESIGN.md) | **Authoritative faction lore** — Rassen, Biologie, Kultur, Nebenfraktionen |
| [lore/gamedesign_fractions.md](lore/gamedesign_fractions.md) | ⚠️ Deprecated tombstone — redirects to GAMEDESIGN.md |
| [lore/gamedesign_fractions_backup.md](lore/gamedesign_fractions_backup.md) | Full legacy archive (8200 lines) — reference only |
| [lore/ART_PROMPTS_SDXL.md](lore/ART_PROMPTS_SDXL.md) | SDXL image generation prompts (portraits, environments) |
| [lore/ART_QUICKSTART.md](lore/ART_QUICKSTART.md) | Art generation quick start guide (SwarmUI / ComfyUI) |
| [lore/LORA_TRAINING_GUIDE.md](lore/LORA_TRAINING_GUIDE.md) | LoRA model training guide for faction-specific art generation |
| [lore/side_factions/](lore/side_factions/) | **Nebenfraktionen** — NPC-only side faction lore, NPC rosters, plot arcs (12 factions) |

## 🗄️ Historical Documentation

Reports, completed experiments, and superseded proposals are kept in the [documentation archive](archive/). Archived documents are historical references, not current implementation or production-readiness approval.

- **Advanced 3D feature snapshot:** [feature guide](archive/ADVANCED_3D_FEATURES_GUIDE.md), [integration examples](archive/INTEGRATION_EXAMPLES.md), [quick start](archive/QUICK_START.md), and [superseded implementation roadmap](archive/IMPLEMENTATION_ROADMAP.md).
- **Visual-effects snapshots:** [implementation report](archive/VISUAL_EFFECTS_COMPLETE_GUIDE.md), [integration guide](archive/VISUAL_EFFECTS_INTEGRATION.md), [Phase 4 performance guide](archive/VISUAL_EFFECTS_PHASE4_PERFORMANCE.md), [visual-feedback guide](archive/VISUAL_FEEDBACK_GUIDE.md), [integration example](archive/INTEGRATION_EXAMPLE_VISUAL_FEEDBACK.md), and [historical testing guide](archive/TESTING_AND_PROFILING.md).
- **JavaScript architecture proposals:** [transformation options](archive/JS_TRANSFORMATION_OPTIONS.md) and [refactoring roadmap](archive/REFACTORING_ROADMAP.md) (both historical, August 2026).
- **Post-launch AI asset-generation guides:** [ComfyUI integration](archive/COMFYUI_INTEGRATION_API.md) and [TRELLIS2 prompt-enhancement quick start](archive/TRELLIS2_PROMPT_ENHANCEMENT_QUICKSTART.md); neither is production approval.
- **Historical updater implementation snapshot:** [MVP integration guide](archive/INTEGRATION_GUIDE_UPDATES.md); use the maintained [update-system guide](UPDATE_SYSTEM.md) for current operations.
- **Unimplemented NPC API proposal:** [NPC game consequences endpoint sketch](archive/API_NPC_GAME_INTEGRATION_GUIDE.md); the proposed handler is not available in the current endpoint.
- **Unconnected NPC game-action prototype:** [action and consequences reference](archive/NPC_GAME_INTEGRATION_ACTIONS.md); it is not wired to NPC chat or an active endpoint.
- **Legacy NPC dialogue panel guide:** [historical integration prototype](archive/NPC_DIALOGUE_INTEGRATION_GUIDE.md); not enabled in the main page and its frontend/API contracts are mismatched.
- **TRELLIS2 quick reference:** [historical deployment snapshot](archive/TRELLIS2_QUICK_REFERENCE.md); its production claim and admin-authentication examples are stale.
- **TRELLIS2 deployment snapshot:** [historical local-development guide](archive/TRELLIS2_DEPLOYMENT_GUIDE.md); remote deployment, health-check, authentication, and permission recipes are unverified and not approved for production.
- **TRELLIS2 production setup checklist:** [archived historical snapshot](archive/TRELLIS2_PRODUCTION_READY_SETUP.md); its service, security, testing, and production-readiness claims are unverified and its deployment examples are not operational instructions.
- **TRELLIS2 launch proposal:** [historical test/auth/deployment plan](archive/TEST_AUTH_PRODUCTION_LAUNCH.md); its test counts, auth, service health, and go-live claims were not verified.
- **Ship Designer integration prototype:** [historical guide](archive/SHIP_DESIGNER_INTEGRATION.md); queue, persistence, worker, and polling examples are not current API contracts. Use the active [prompt/UI prototype quickstart](../SHIP_DESIGNER_README.md).
- **Shipyard Blueprint Forge:** [UI prototype reference](technical/SHIPYARD_BLUEPRINT_FORGE.md); it is not loaded by the main game entrypoint, and its API examples do not match current response/CSRF/build contracts.
- **Rendering status snapshots:** [Phase Alpha summary](archive/PHASE_ALPHA_IMPLEMENTATION_SUMMARY.md) and [older Three.js integration roadmap](archive/GALAXY_THREE_INTEGRATION_ROADMAP.md); historical plans/claims, not current renderer status.
- **VFX verification snapshot:** [Phase 1 checklist](archive/IMPLEMENTATION_CHECKLIST.md); its test-coverage and production-readiness claims are unverified and not current release evidence.
