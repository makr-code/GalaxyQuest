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

Boot-Manifest umgestellt auf neue Layer-Dateien:
- `js/runtime/boot-manifest.js`

## Naechste sinnvolle Wellen
1. `RuntimeGalaxy*` Restmodule in `layers/integration/galaxy/*` fuer Renderer/API-Glue auslagern.
2. `RuntimeSettings*` in `layers/ui/settings/*` und `layers/domain/settings/*` trennen.
3. `RuntimeMessage*`, `RuntimeTrade*`, `RuntimeWar*`, `RuntimePirates*` je Feature in eigene Domain-Subtrees.
4. Nach jeder Welle: Boot-Manifest-Umstellung + gezielte Vitest-Smokes.

## Regeln fuer weitere Migrationen
- Altes Public-API-Surface (`window.GQ...`) beibehalten.
- Nur inkrementelle Moves in kleinen Batches.
- Boot-Reihenfolge strikt erhalten (Dependencies vor Consumers).
- Nach jedem Batch: Tests + Smoke-Runs.
