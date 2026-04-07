# JS Layer Restructure Plan

## Ziel
Die JavaScript-Codebasis nach klaren Layern strukturieren, um Abhaengigkeiten, Boot-Reihenfolge und Wartbarkeit zu verbessern.

## Aktueller Struktur-Snapshot
Top-Level unter `js/`:
- `engine/`: Render-, Runtime- und Simulationskern
- `runtime/`: Bootloader, globale App-Skripte, WM, Audio
- `rendering/`: Renderer-nahe Adapter/Legacy-Glue
- `network/`: API/Auth/Decoder
- `ui/`: UI-Widgets und Panels
- `telemetry/`: Flight-/Performance-Module
- `traders/`, `game/`, `audio/`, `admin/`, `ki/`: Domainenahes Feature-Coding
- `legacy/`: Altpfade/Kompatibilitaet
- `tests/`: Browsernahe JS-Tests

## Ziel-Layer
- `core`: Lebenszyklus, Registry, fundamentale Runtime-Orchestrierung
- `bootstrap`: Start- und Post-Boot-Flows
- `domain`: Spielsysteme (Economy, Fleet, Diplomacy, Pirates, War, etc.)
- `ui`: Rendering-unabhaengige UI-Controller
- `integration`: API/Netzwerk, Event-Bindings, Renderer-Glue

## Bereits umgesetzt
Neue Layer-Pfade unter `js/engine/runtime/layers/`:
- `core/LifecyclePhases.js`
- `core/FeatureRegistry.js`
- `core/LifecycleManager.js`
- `bootstrap/StartupBoot.js`
- `bootstrap/PostBootFlow.js`

Zusatzwelle Galaxy (Domain/UI-Schnitt):
- `domain/galaxy/NavActions.js`
- `domain/galaxy/ControllerNavigation.js`
- `domain/galaxy/ControllerActions.js`
- `ui/galaxy/OverlayControls.js`
- `ui/galaxy/ControllerWindow.js`

Zusatzwelle Galaxy (Integration/Debug-Glue):
- `integration/galaxy/DebugLog.js`
- `integration/galaxy/CanvasDebug.js`
- `integration/galaxy/EventProbe.js`
- `integration/galaxy/RendererDebug.js`

Zusatzwelle Galaxy (UI + Render-Flow):
- `ui/galaxy/VisualUtils.js`
- `ui/galaxy/ControlUi.js`
- `ui/galaxy/ControllerControlUi.js`
- `integration/galaxy/ControllerRenderWindowFlow.js`

Zusatzwelle Galaxy (Loading + Window Glue):
- `integration/galaxy/ControllerStarLoading.js`
- `integration/galaxy/StarLoadingHelpers.js`
- `integration/galaxy/WindowBindings.js`

Zusatzwelle Galaxy (Star Loader Facade + Flow):
- `integration/galaxy/FlowOrchestrator.js`
- `integration/galaxy/LoaderFacade.js`

Zusatzwelle Galaxy (Error + Status Flow):
- `integration/galaxy/FallbackRecovery.js`
- `integration/galaxy/ErrorUi.js`
- `integration/galaxy/UiStatus.js`

Zusatzwelle Galaxy (Network + Persistence + Preflight):
- `integration/galaxy/NetworkFlow.js`
- `integration/galaxy/Persistence.js`
- `integration/galaxy/BootstrapPreflight.js`

Zusatzwelle Galaxy (Territory + Cache Read):
- `integration/galaxy/TerritorySync.js`
- `integration/galaxy/CacheRead.js`

Zusatzwelle Galaxy (Controller Orchestration):
- `integration/galaxy/ControllerFacade.js`
- `integration/galaxy/ControllerBootstrap.js`

Zusatzwelle Galaxy (Init3D Facade):
- `integration/galaxy/Init3DFacade.js`

Zusatzwelle Galaxy (Nav Orb):
- `integration/galaxy/NavOrbRepeat.js`
- `integration/galaxy/NavOrb.js`

Zusatzwelle Commands (Domain + UI):
- `domain/commands/CommandParsing.js`
- `ui/commands/TransitionsCommand.js`

Welle 12 – RuntimeGame-Helpers + Commands Manifest Correction:
- `core/GameContextRefs.js` (migrated)
- `bootstrap/GameBootstrapHelpers.js` (migrated)
- `bootstrap/GameInfraHelpers.js` (migrated)
- `domain/commands/CommandParsing.js` (manifest updated)
- `ui/commands/TransitionsCommand.js` (manifest updated)
✅ Boot-manifest.js: Pfade aktualisiert
✅ Alle 91 Galaxy-Tests bestanden

Welle 13 – RuntimeSystemBreadcrumbHelpers + RuntimeUiConsole* Familie:
- `ui/system/SystemBreadcrumbHelpers.js` (migrated)
- `ui/console/Store.js` (migrated)
- `ui/console/Panel.js` (migrated)
- `ui/console/MetaCommand.js` (migrated)
- `ui/console/CommandRegistry.js` (migrated)
- `ui/console/CommandExecutor.js` (migrated)
✅ Boot-manifest.js: 6 alte Pfade → neue Layer-Pfade aktualisiert
✅ Alle 91 Galaxy-Tests bestanden

Welle 14 – RuntimeAdmin + RuntimeUiTemplate + RuntimeRenderer/Audio Settings:
- `ui/admin/AdminVisibility.js` (migrated)
- `ui/helpers/TemplateHelpers.js` (migrated)
- `ui/settings/RendererSettingsApply.js` (migrated)
- `ui/settings/audio/SettingsPanel.js` (migrated)
- `ui/settings/audio/SettingsMetadata.js` (migrated)
- `ui/settings/audio/SettingsApply.js` (migrated)
✅ Boot-manifest.js: 7 alte Pfade → neue Layer-Pfade aktualisiert (2 Stellen)
✅ Alle 91 Galaxy-Tests bestanden

Welle 1 – RuntimeGalaxy* Restmodule (Renderer/API-Glue + Domain):
- `domain/galaxy/SearchScoring.js`
- `domain/galaxy/PhysicsFlight.js`
- `integration/galaxy/ControllerFacade.js`
- `integration/galaxy/ControllerBootstrap.js`
- `integration/galaxy/StarTerritorySync.js`
- `integration/galaxy/StarCacheRead.js`
- `integration/galaxy/StarNetworkFlow.js`
- `integration/galaxy/StarFallbackRecovery.js`
- `integration/galaxy/StarPersistence.js`
- `integration/galaxy/StarBootstrapPreflight.js`
- `integration/galaxy/StarFlowOrchestrator.js`
- `integration/galaxy/StarLoaderFacade.js`
- `integration/galaxy/Init3DFacade.js`
- `ui/galaxy/StarErrorUi.js`
- `ui/galaxy/StarUiStatus.js`
- `ui/galaxy/NavOrbRepeat.js`
- `ui/galaxy/NavOrb.js`
- `ui/galaxy/HoverCardFacade.js`
- `ui/galaxy/ClusterRangeControls.js`
- `ui/galaxy/SystemDetailsFacade.js`

Boot-Manifest umgestellt auf neue Layer-Dateien:
- `js/runtime/boot-manifest.js`

## Naechste sinnvolle Wellen
1. `RuntimeSettings*` in `layers/ui/settings/*` und `layers/domain/settings/*` trennen.
2. `RuntimeMessage*`, `RuntimeTrade*`, `RuntimeWar*`, `RuntimePirates*` je Feature in eigene Domain-Subtrees.
3. Nach jeder Welle: Boot-Manifest-Umstellung + gezielte Vitest-Smokes.

## Regeln fuer weitere Migrationen
- Altes Public-API-Surface (`window.GQ...`) beibehalten.
- Nur inkrementelle Moves in kleinen Batches.
- Boot-Reihenfolge strikt erhalten (Dependencies vor Consumers).
- Nach jedem Batch: Tests + Smoke-Runs.
