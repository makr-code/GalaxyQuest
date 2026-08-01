# GalaxyQuest JavaScript-Architektur-Analyse

**Datum:** 2026-08-01  
**Projekt:** GalaxyQuest  
**Fokus:** Separation of Concerns (SOC), Abhängigkeitsanalyse, Architekturqualität

---

## Executive Summary

Das GalaxyQuest-JavaScript-Projekt hat eine **IIFE-basierte Modul-Architektur** mit **globalem Namespace-Pollution** und zeigt Merkmale sowohl von **sauberer Layering** als auch von **Spaghetti-Code**. 

**Kernprobleme:**
- ~180+ `RuntimeXxxController.js` Dateien ohne klare Kategorisierung
- Alle Module registrieren zu `window.GQRuntime*` (globale Abhängigkeiten)
- Rendering ↔ Runtime-Controller sind stark gekoppelt
- API-Layer hat interne Fallbacks statt echter Modular-Architektur
- Boot-Sequenz ist zerbrechlich und schwer zu debuggen

**Architektur-Score:** 5/10 (Modular mit starken Anti-Patterns)

---

## 1. Layer-Mapping

### 1.1 Erfasstes Layer-Modell

```
┌─────────────────────────────────────────────────────────┐
│  Desktop UI Layer (js/ui/, js/components/)              │
│  ├─ Theme Manager, Interactions, Tooltips, Modals       │
│  ├─ Settings Panel, Glossary, HR Diagram                │
│  └─ System Bodies Cards, Stellaris Overview             │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│  Window Manager Layer (js/runtime/)                     │
│  ├─ WMCore (Generic window system)                      │
│  ├─ WM-Widgets (Window controls)                        │
│  └─ GQWM (GalaxyQuest WM instance)                      │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│  Game Framework Layer (js/engine/game/)                 │
│  ├─ BattleSimulator.js                                  │
│  ├─ ColonySimulation.js                                 │
│  ├─ EconomySimulation.js                                │
│  ├─ ResearchTree.js                                     │
│  ├─ FleetFormation.js                                   │
│  └─ EventSystem.js                                      │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│  Runtime Controllers (js/engine/runtime/)               │
│  ├─ RuntimeEconomyController                            │
│  ├─ RuntimeFleetController                              │
│  ├─ RuntimeAlliancesController                          │
│  ├─ RuntimeWarController                                │
│  ├─ RuntimeResearchController                           │
│  ├─ RuntimeShipyardController                           │
│  ├─ RuntimeGalaxyController + Subcomponents (~50+)      │
│  └─ ... (~150+ mehr) [PROBLEM AREA]                     │
│                                                          │
│  Alle registriert als window.GQRuntimeXxx               │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│  Game Engine (js/engine/ + js/runtime/)                 │
│  ├─ GameEngine.js (Main coordinator)                    │
│  ├─ GameLoop.js (RAF + fixed-step)                      │
│  ├─ EventBus.js (Pub/Sub event system)                  │
│  ├─ SystemRegistry.js (Update pipeline)                 │
│  ├─ AssetRegistry.js (Asset cache)                      │
│  └─ RuntimeCore.js (Light event ticker)                 │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│  3D Rendering Engine (js/rendering/, js/engine/core/)   │
│  ├─ GraphicsContext (Renderer abstraction)              │
│  ├─ WebGPURenderer / WebGLRenderer                      │
│  ├─ RendererFactory (Strategy pattern)                  │
│  ├─ Galaxy3DRendererWebGPU (Main 3D renderer)           │
│  ├─ Geometry/Texture/Material/Light managers            │
│  ├─ Post-Effects (Bloom, SSAO, etc.)                    │
│  ├─ SelectionMarkerSystem [Coupled to Runtime]          │
│  └─ StarfieldRenderer, SystemViewRenderer               │
│                                                          │
│  ⚠️ COUPLING: Imports window.GQRuntimeSelectionState    │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│  Network / API Layer (js/network/)                      │
│  ├─ APITransport (Low-level fetch + retry)             │
│  ├─ APIQueue (Request prioritization)                   │
│  ├─ APICache (GET response cache)                       │
│  ├─ APISession (CSRF + session lifecycle)               │
│  ├─ APISchemaAdapters (Payload normalization)           │
│  └─ API Facade (Main API object)                        │
│                                                          │
│  ⚠️ FRAGILE: api.js has fallback implementations        │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│  Game Systems (js/systems/, js/components/)             │
│  ├─ NPCDialogueSystem                                   │
│  ├─ GameGuideSystem                                     │
│  └─ AdvisorNPCIntegration                               │
└─────────────────────────────────────────────────────────┘
```

### 1.2 Schichtenanalyse nach SOC

| Schicht | Dateien | SOC-Score | Probleme |
|---------|---------|-----------|----------|
| **Desktop UI** | 15+ | 7/10 | Theme-Manager ↔ Runtime-Controllers gekoppelt |
| **Window Manager** | 3 | 8/10 | Saubere Abstraktion, aber abhängig von GQUI |
| **Game Framework** | 6 | 6/10 | Simulations-Klassen sind data-heavy, wenig Logik |
| **Runtime Controllers** | 180+ | **2/10** | 🔴 **KRITISCH:** Keine Kategorisierung, massive Vielfalt |
| **Game Engine** | 4 | 8/10 | Saubere Koordination, aber GlobalState über EventBus |
| **3D Rendering** | 40+ | 5/10 | Stark gekoppelt zu Runtime (SelectionMarker) |
| **Network/API** | 8 | 4/10 | Interne Fallbacks, keine echte Modularität |
| **Game Systems** | 3 | 6/10 | Neue Ergänzungen, aber ad-hoc integriert |

---

## 2. Abhängigkeitsgraph

### 2.1 Boot-Sequenz & Initialisierungsreihenfolge

```
┌──────────────────────────────────────────┐
│ Phase 0: Manifest & Versioning           │
│ ├─ boot-manifest.js  ━━━━━━┓             │
│ └─ boot-assets.js    ━━━┓  ║             │
│                           ║  ║             │
│ Registriert:           ║  ║             │
│  • window.__GQ_ASSET_VERSIONS              │
│  • window.GQBootAssets                     │
│  • window.GQResolveAssetVersion            │
└──────────┬───────────────┴──┴─────────────┘
           │
┌──────────▼───────────────────────────────┐
│ Phase 1: Core Infrastructure             │
│ ├─ terminal.js                           │
│ ├─ wm.js (WMCore)  ──────────────┐       │
│ ├─ wm-widgets.js  ────────────┐  │       │
│ └─ gqwm.js  (GQWM) ◄──────────┴──┘       │
│                                           │
│ Registriert: window.WM, window.GQWM      │
└──────────┬──────────────────────────────┘
           │
┌──────────▼───────────────────────────────┐
│ Phase 2: Network & API                   │
│ ├─ binary-decoder.js  ──────────┐        │
│ ├─ binary-decoder-v2.js ────────┼─┐      │
│ ├─ binary-decoder-v3.js ────────┼─┤      │
│ ├─ api-transport.js     ◄───────┼─┤      │
│ ├─ api-queue.js         ◄───────┼─┤      │
│ ├─ api-cache.js         ◄───────┼─┤      │
│ ├─ api-schema-adapters.js  ◄────┼─┤      │
│ ├─ api-session.js [implicit]    │ │      │
│ └─ api.js  (Facade) ◄───────────┴─┘      │
│                                           │
│ Depends: Transport, Queue, Cache, Session│
│ Fallback: api.js defines all if missing  │
│ Registriert: window.API                  │
└──────────┬──────────────────────────────┘
           │
┌──────────▼───────────────────────────────┐
│ Phase 3: UI Base Services                │
│ ├─ theme-manager.js                      │
│ ├─ interactions.js                       │
│ ├─ tooltips.js                           │
│ ├─ modals.js                             │
│ ├─ particle-system.js                    │
│ ├─ canvas-animation-engine.js            │
│ ├─ trajectory-renderer.js                │
│ └─ starfield.js  (Three.js based)        │
└──────────┬──────────────────────────────┘
           │
┌──────────▼───────────────────────────────┐
│ Phase 4: Auth & Lazy Load                │
│ ├─ prolog.js (Loading screen)            │
│ ├─ auth.js (Auth UI + handlers)          │
│ │                                         │
│ └─→ [Lazy load game controllers via      │
│     js/runtime/boot-manifest.js]         │
└──────────┬──────────────────────────────┘
           │
┌──────────▼───────────────────────────────┐
│ Phase 5: Game Systems                    │
│ ├─ npc_dialogue_system.js                │
│ ├─ npc_dialogue_panel.js                 │
│ ├─ npc_interaction_handler.js            │
│ ├─ game_guide_system.js                  │
│ └─ advisor_npc_integration.js            │
└──────────────────────────────────────────┘
```

### 2.2 Kritische Abhängigkeitsketten

#### API → UI Controller Chain
```
api.js
  ├─ Depends on: APITransport, APIQueue, APICache, APISession
  │   └─→ all have fallbacks defined IN api.js (fragile!)
  │
  └─→ Used by:
      ├─ RuntimeEconomyController (fetchEconomyData)
      ├─ RuntimeFleetController (submitFleet)
      ├─ RuntimeGalaxyController (fetchStars)
      ├─ ... (~100+ more RuntimeXxx)
      └─→ All access via window.API
```

#### Rendering → Runtime Coupling
```
Galaxy3DRendererWebGPU.js
  └─ Requires: window.GQRuntimeSelectionState
      ├─ registerAdapter(...)
      └─ getAdapter(...)

SelectionMarkerSystem.js
  └─ Depends on: window.GQRuntimeSelectionState
      └─ For marker rendering logic

⚠️ PROBLEM: 3D Renderer shouldn't know about Selection State
   This breaks the "Rendering is independent from Game Logic" principle
```

#### GameLoop → SystemRegistry → Runtime Controllers
```
GameEngine.js
  └─ GameLoop.js  (RAF + fixed-step accumulator)
      ├─ Emits: 'engine:start', 'engine:stop', 'engine:resize'
      ├─ Emits: 'physics:step', 'render:frame', 'asset:loaded'
      └─ On each frame:
          ├─ SystemRegistry.update(dt)  [fixed-step physics]
          ├─ SystemRegistry.update(dt)  [variable update]
          ├─ SceneGraph.update()
          ├─ Renderer.render()
          ├─ EffectComposer.render()
          └─ PerformanceMonitor.tick()

SystemRegistry
  └─ Ordered system update pipeline
      └─ Can register systems (some may be RuntimeXxx handlers)
```

### 2.3 Zirkuläre Abhängigkeiten & Probleme

#### ⚠️ ZIRKELREFERENZ #1: Galaxy Controller <→ Star Network Flow
```
RuntimeGalaxyController.js (1800+ lines)
  ├─ require: GQRuntimeGalaxyStarNetworkFlow
  │                  └─ Fetches stars via API
  │
  └─ Binds event: 'galaxy:stars-loaded'
                    └─→ RawGalaxyStarNetworkFlow emits this

RawGalaxyStarNetworkFlow.js
  └─ require: GQRuntimeGalaxyController (?)
      └─ Calls: controller.refreshGalaxyCanvas()
```

**Impact:** Circular dependency via dynamic binding. Both modules must be loaded together, but they CALL EACH OTHER at runtime.

#### ⚠️ ZIRKELREFERENZ #2: Economy Controller → Production Chain → Building Updates
```
RuntimeEconomyController.js
  ├─ Manages: economy window, taxes, policies
  │
  └─ Calls: API.updateEconomy({ policy: ... })
      └─→ Server processes policy change
          └─→ Updates colony productions
              └─→ RuntimeColonySurfaceSlotMapping re-renders VFX

But RuntimeEconomyController also observes events from:
  └─ RuntimeColonySurfaceSlotMapping (vfx-changed)
      └─→ Back to economy (for UI refresh)
```

**Impact:** If vfx-update triggers economy refresh, and economy-update triggers vfx-update, no guarantee of order.

#### ⚠️ ZIRKELREFERENZ #3: API Cache ↔ Runtime Controllers
```
api.js
  ├─ APICache.invalidateCache(pattern)
  │
  └─ Called by: RuntimeEconomyController.refreshEconomyData()
      └─ Which also calls: API.getEconomy()
          └─→ APICacheCheck()
              └─→ Returns stale if not invalidated
```

**Impact:** If two controllers call getEconomy() simultaneously, no guarantee of cache hit/miss.

---

## 3. Probleme & Anti-Patterns

### 3.1 🔴 Kritische Probleme

#### PROBLEM #1: Runtime Controller Explosion (180+ Files)

**Dateiinventar (Auszug):**
```
RuntimeAdminVisibility.js
RuntimeAdvisorWidget.js
RuntimeAiSettingsPanel.js
RuntimeAlliancesController.js
RuntimeAudioCatalog.js
RuntimeAudioSettingsApply.js
RuntimeAudioSettingsMetadata.js
RuntimeAudioSettingsPanel.js
RuntimeAudioUi.js
RuntimeBadgeLoader.js
RuntimeBootSetupContext.js
RuntimeBootSetupSequence.js
RuntimeBuildingsController.js
RuntimeBuildingUpgradePreview.js
RuntimeColonizationController.js
RuntimeColonyBuildingLogic.js
RuntimeColonySurfaceSlotMapping.js
RuntimeColonyVfxDebugWidget.js
RuntimeColonyVfxDebugWidgetSetup.js
RuntimeColonyViewController.js
RuntimeColonyWarnings.js
RuntimeCommandParsing.js
RuntimeConflictDashboard.js
RuntimeContractNegotiationModal.js
RuntimeCore.js
RuntimeDesktopShell.js
RuntimeDevelopmentControllersBootstrap.js
... (150+ more)
```

**Problem:**
- Keine klare Kategorisierung (Economy vs. UI vs. Galaxy vs. War)
- Jeder hat eigener namespace: `window.GQRuntimeXxx`
- Schwer zu debuggen: "Welche Dateien sind geladen?"
- VS Code-Dateisuche wird zum Zeitvertreib
- Testing: Wie bringt man 180 Module in einen Testkontext?

**Auswirkungen:**
- **Boot-Zeit:** Alle 180+ Dateien müssen geparst werden
- **Memory:** Viele globale IIFE-Scopes
- **Maintenance:** Unmöglich zu sehen, wer wen braucht

---

#### PROBLEM #2: Global Namespace Pollution

**Symptom:**
```javascript
// In RuntimeEconomyController.js
window.GQRuntimeEconomyController = { ... };

// In some other file
const economyApi = window.GQRuntimeEconomyController;
if (!economyApi) throw new Error("Economy not loaded!");
```

**Problem:**
- Keine explizite Dependency-Deklaration
- `requireRuntimeApi()` Calls are scattered & manual
- Easy to forget: "Did I load this module?"
- `typeof window.GQRuntimeXxx === 'undefined'` checks everywhere

**Result:** 
- Script load order MUST be exact
- Any new feature that needs RuntimeXxx must update index.html carefully
- No "lazy loading" of features

---

#### PROBLEM #3: Rendering ↔ Runtime Coupling

**Konkrete Instanz:**

[RuntimeEconomyController.js](RuntimeEconomyController.js) (ökonomisches Spiellogik-Modul)
calls `window.GQRuntimeViewHyperlinks?.ViewHyperlinks` (aus [RuntimeViewHyperlinks.js](RuntimeViewHyperlinks.js))

And [Galaxy3DRendererWebGPU.js](Galaxy3DRendererWebGPU.js) (3D rendering engine) requires:
```javascript
window.GQRuntimeSelectionState = window.GQRuntimeSelectionState || { ... };
```

**Why this breaks SOC:**
- Rendering engine should only know: "Render this mesh with this material"
- NOT "What is the current selection state?"
- Selection state is GAME LOGIC, not rendering

**Concrete Impact:**
```javascript
// In Galaxy3DRendererWebGPU.js (line ~450)
const selectionState = window.GQRuntimeSelectionState?.getSelectionGroupHighlightedSystems();
if (selectionState) {
  // Change shader to highlight selected systems
  material.emissive.setHex(0xff00ff);
}
```

Should be:
```javascript
// Renderer should receive a callback or state object
const selectionInfo = renderConfig.getSelectionInfo?.();
if (selectionInfo && selectionInfo.highlightedSystemIds) {
  // Apply highlight
}
```

---

#### PROBLEM #4: API Layer Fallback Fragility

**Code in [api.js](api.js):**
```javascript
if (typeof window !== 'undefined' && !window.APITransport) {
  window.APITransport = {
    fetchTask: async (endpoint, options) => {
      const response = await fetch(endpoint, options);
      // ...
    },
  };
}
```

**Problem:**
- api.js shouldn't define APITransport
- If APITransport.js loads AFTER api.js, the fallback is overridden
- No clear dependency order
- Testing: "Which APITransport am I using?"

**Vulnerability:**
- If api-transport.js is missing from index.html, fallback kicks in silently
- Fallback might be incomplete (no retry logic!)
- Hard to detect: No error thrown, just wrong behavior

---

#### PROBLEM #5: Boot Sequence Brittleness

**In index.html:**
```html
<script src="js/runtime/wm.js"></script>
<script src="js/runtime/gqwm.js"></script>  <!-- Depends on WM -->

<script src="js/network/api-transport.js"></script>
<script src="js/network/api-queue.js"></script>
<script src="js/network/api-cache.js"></script>
<!-- ...more api-*.js... -->
<script src="js/network/api.js"></script>  <!-- Depends on all above -->

<!-- ... 50 more scripts ... -->
```

**Brittleness:**
1. If boot-manifest.js loads after gqwm.js, version check fails
2. If api-cache.js is accidentally removed, api.js fallback takes over (silently!)
3. If someone adds a new feature file but forgets to update index.html, it won't load
4. No error thrown; just mysterious "undefined" errors later

**Test:** Try to find a single source of truth about which files are needed and in which order.
- Answer: You can't. It's scattered across index.html, boot-manifest.js, and comments.

---

### 3.2 🟡 Architektur-Mängel

#### PROBLEM #6: No Clear API Facade

**Current situation:**
```javascript
// Every RuntimeXxx exports itself
window.GQRuntimeEconomyController = { createEconomyPanel, ... };
window.GQRuntimeFleetController = { createFleetPanel, ... };
window.GQRuntimeAlliancesController = { ... };
```

**Better pattern (not implemented):**
```javascript
window.GQGame = {
  controllers: {
    economy: { createEconomyPanel, ... },
    fleet: { createFleetPanel, ... },
    alliances: { ... },
  },
  systems: {
    npc: { ... },
    guide: { ... },
  }
};
```

**Why it matters:**
- `window.GQ` is the entry point (not 180 separate names)
- Developers don't need to know all 180 module names
- Easy to tree-shake: "Which parts of GQ am I using?"

---

#### PROBLEM #7: EventBus Overuse & Ambiguity

**Pattern:**
```javascript
eventBus.on('galaxy:stars-loaded', ({ stars }) => {
  // Update UI
});

eventBus.on('runtime:frame', ({ dt, alpha }) => {
  // Tick something
});

eventBus.on('selection:changed', ({ selection }) => {
  // Re-render markers
});
```

**Problem:**
- No registry of event names & their payloads
- If two modules emit the same event with different payloads, silent bugs
- Hard to find: "Where is 'galaxy:stars-loaded' emitted from?"
- Debugging: No stack trace of event chain

**Solution (not implemented):**
- Event registry with TypeScript-like signatures
- Strict payload validation
- Or: Replace EventBus with explicit callbacks

---

#### PROBLEM #8: No Component Hierarchy in UI

**Current:**
```
RuntimeEconomyController
├─ Creates: <section class="wm-window">
├─ Renders: tabs (Policy, Overview, Production, Population)
├─ Each tab is ~400 lines of DOM manipulation
└─ All in ONE file (800+ lines)
```

**Should be:**
```
EconomyWindow
├─ PolicyTab
│   ├─ PolicySelector
│   ├─ TaxSlider
│   └─ SubsidyCheckboxes
├─ OverviewTab
│   └─ ColonyGrid
│       ├─ ColonyCard
│       │   ├─ PopulationBreakdown
│       │   └─ GoodsList
│       └─ ...
└─ ...
```

**Impact on SOC:**
- Each component has one job (not "display the whole economy panel")
- Easy to test: `testPolicySelector()` vs. `testRuntimeEconomyControllerPanelRenderingLogic()`
- Reuse: Can use PolicySelector in settings too

---

#### PROBLEM #9: Testing Nightmare

**Attempt to unit-test:**
```javascript
// file: tests/runtime-economy-controller.test.js

describe('RuntimeEconomyController', () => {
  beforeEach(() => {
    // Problem 1: Need WM
    window.WM = ... // Lots of setup

    // Problem 2: Need API
    window.API = { getEconomy: jest.fn() };

    // Problem 3: Need EventBus
    window.GQEventBus = { ... };

    // Problem 4: Need all 50 other RuntimeXxx modules
    // Because EconomyController calls window.GQRuntimeColonySurfaceSlotMapping
    // which calls window.GQRuntimeColonyViewController
    // which calls window.GQRuntimeVfxDebugWidget
    // ...

    // At this point: 500 lines of setup for one test file
  });

  test('economy policy change', () => {
    const ctrl = window.GQRuntimeEconomyController.createEconomyPanel();
    // Can't isolate! Every module it depends on must exist.
  });
});
```

**Result:** 
- Most runtime tests are e2e (need full app loaded)
- Unit tests don't exist for RuntimeXxx
- Coverage is low
- Regression risk is high

---

### 3.3 🟠 Code Smell Patterns

#### SMELL #1: Repeated `requireRuntimeApi()` Calls

Every module that needs dependencies does this:
```javascript
const runtimeGameContextRefsApi = requireRuntimeApi('GQRuntimeGameContextRefs', ['createGameContextRefs']);
const runtimeGalaxyInit3DFacadeApi = requireRuntimeApi('GQRuntimeGalaxyInit3DFacade', [...]);
const runtimeGalaxyPhysicsFlightApi = requireRuntimeApi('GQRuntimeGalaxyPhysicsFlight', [...]);
// ... 80+ more lines of this
```

Scattered across 180 files. Hard to see the dependency graph.

---

#### SMELL #2: Massive IIFE Scope

```javascript
(function () {
  // 800-2000 lines of code in ONE scope
  // Defines:
  //   - Constants
  //   - Helper functions
  //   - Main controller class
  //   - Event bindings
  //   - DOM manipulations
  //   - API calls
  //   - ...
  
  window.GQRuntimeEconomyController = { ... };
})();
```

**Problem:** Can't reuse logic from this IIFE. It's all locked in the scope.

---

#### SMELL #3: Manual Version Management

```javascript
// boot-manifest.js
const V = {
  assetCore: '20260404p50',
  wm: '20260408p2',
  gqwm: '20260407p1',
  // ...
};

// index.html
<script src="js/runtime/wm.js?v=20260408p2"></script>
<script src="js/runtime/gqwm.js?v=20260407p1"></script>
```

If you forget to update boot-manifest.js when you update gqwm.js, version drift occurs.

---

## 4. Verbesserungsvorschläge

### 4.1 Kurzfristig (Refactoring existierender Code)

#### EMPFEHLUNG #1: Kategorisieren der Runtime Controller

**Status quo:**
```
js/engine/runtime/
├─ RuntimeEconomyController.js
├─ RuntimeFleetController.js
├─ RuntimeAlliancesController.js
├─ RuntimeWarController.js
├─ RuntimeGalaxyController.js
├─ RuntimeGalaxyStarNetworkFlow.js
├─ RuntimeMinimapFacade.js
├─ RuntimeSettingsPanel.js
├─ ... (180 more)
```

**Proposed:**
```
js/engine/runtime/
├─ domains/
│   ├─ economy/
│   │   └─ RuntimeEconomyController.js
│   ├─ fleet/
│   │   ├─ RuntimeFleetController.js
│   │   └─ RuntimeFleetStatusPanels.js
│   ├─ alliances/
│   │   ├─ RuntimeAlliancesController.js
│   │   └─ RuntimeDiplomacyPanel.js
│   ├─ war/
│   │   ├─ RuntimeWarController.js
│   │   └─ RuntimeConflictDashboard.js
│   ├─ research/
│   │   └─ RuntimeResearchController.js
│   ├─ galaxy/
│   │   ├─ RuntimeGalaxyController.js
│   │   ├─ RuntimeGalaxyStarNetworkFlow.js
│   │   └─ ... (50 more)
│   ├─ settings/
│   │   ├─ RuntimeSettingsController.js
│   │   └─ ... (10 more)
│   └─ ui/
│       ├─ RuntimeTopbarSearch.js
│       ├─ RuntimeFooterNetworkStatus.js
│       └─ ... (20 more)
├─ layers/
│   ├─ core/
│   │   ├─ RuntimeCore.js
│   │   ├─ RuntimeLifecycleManager.js
│   │   ├─ RuntimeFeatureRegistry.js
│   │   └─ RuntimeGameContextRefs.js
│   └─ integration/
│       ├─ galaxy/
│       │   └─ BootstrapPreflight.js
│       └─ ...
└─ legacy/
    ├─ RuntimeAdminVisibility.js
    └─ ... (10 depreciated)
```

**Benefits:**
- Developers instantly know: "Economy stuff is in domains/economy/"
- Easy to find which files are related
- Easier to deprecate or refactor a whole domain
- Lint rule: "Import from domain siblings only"

---

#### EMPFEHLUNG #2: Erstelle eine Game API Facade

**Current:**
```javascript
// Many places do:
const economyApi = window.GQRuntimeEconomyController;
const fleetApi = window.GQRuntimeFleetController;
const galaxyApi = window.GQRuntimeGalaxyController;
```

**Proposed:**
```javascript
// Single entry point in js/runtime/game-api.js
window.GQGame = {
  // Core services
  core: {
    lifecycle: window.GQRuntimeLifecycleManager,
    featureRegistry: window.GQRuntimeFeatureRegistry,
  },
  
  // Game domains
  domains: {
    economy: window.GQRuntimeEconomyController,
    fleet: window.GQRuntimeFleetController,
    alliances: window.GQRuntimeAlliancesController,
    // ...
  },
  
  // 3D Rendering
  rendering: {
    galaxyRenderer: window.GQGalaxy3DRenderer,
    selectionMarkers: window.GQRuntimeSelectionState,
  },
  
  // Utilities
  utils: {
    viewHyperlinks: window.GQRuntimeViewHyperlinks,
    systemBreadcrumb: window.GQRuntimeSystemBreadcrumb,
  },
};
```

**Changes needed:**
1. Create `js/runtime/game-api.js` (100 lines)
2. Load it AFTER all RuntimeXxx modules
3. Update all imports from `window.GQRuntimeXxx` to `window.GQGame.domains.xxx`

**Benefits:**
- Single entry point (`window.GQGame`)
- Developers don't need to memorize 180 names
- Easy to disable features: `delete window.GQGame.domains.war`
- Tree-shaking: "Which parts of GQGame are used?"

---

#### EMPFEHLUNG #3: Decoupling von Rendering × Runtime

**Problem:**
```javascript
// In Galaxy3DRendererWebGPU.js
const selectionState = window.GQRuntimeSelectionState.getSelectionGroupHighlightedSystems();
```

**Solution:**
```javascript
// Define config object before creating renderer
const rendererConfig = {
  getSelectionInfo: () => window.GQRuntimeSelectionState.getSelectionGroupHighlightedSystems(),
  onSystemSelected: (systemId) => window.GQRuntimeSelectionState.commitSelectionState(...),
};

const renderer = new Galaxy3DRendererWebGPU(canvas, rendererConfig);
```

**Or (better):** Use a callback-based approach, not direct API access:
```javascript
// Renderer only cares: "What do I render?"
renderer.on('system-clicked', (systemId) => {
  // Propagate up, don't call directly
  eventBus.emit('ui:system-selected', { systemId });
});
```

**Impact:**
- Renderer can be tested without RuntimeXxx modules
- Easier to swap rendering backends
- Clear boundary: Rendering ≠ Game Logic

---

#### EMPFEHLUNG #4: API Schema Registry

**Current problem:**
- No single source of truth about API contracts
- Schema adapters scattered in [api-schema-adapters.js](api-schema-adapters.js)

**Proposed:**
```javascript
// js/network/api-schema-registry.js
window.APISchemaRegistry = {
  registerSchema(endpoint, { request, response, validation }) {
    // Store schema
  },
  
  getSchema(endpoint) {
    // Retrieve schema
  },
  
  validateRequest(endpoint, payload) {
    // Validate before sending
  },
  
  validateResponse(endpoint, payload) {
    // Validate after receiving
  },
};
```

**Usage:**
```javascript
APISchemaRegistry.registerSchema('/api/economy', {
  request: { method: 'POST', body: { policy: 'enum' } },
  response: { goods: [...], treasury: 'number' },
});

// Later, in api.js:
const response = await API.postEconomy({ policy: 'free_market' });
// Automatically validates both request and response
```

**Benefits:**
- Single place to document all APIs
- Type safety (could generate TypeScript .d.ts)
- Easy to add rate-limiting/retry rules per endpoint

---

### 4.2 Mittelfristig (Strukturelle Umgestaltung)

#### EMPFEHLUNG #5: Modular Build System (Webpack/Vite)

**Current:** 30+ `<script>` tags in index.html, loaded in exact order.

**Proposed:**
```javascript
// js/main.js (entry point)
import { createGameAPI } from './runtime/game-api.js';
import { initRendering } from './rendering/index.js';
import { initNetwork } from './network/index.js';

export async function initializeGame() {
  const network = initNetwork();
  const rendering = await initRendering();
  const gameAPI = createGameAPI({ network, rendering });
  
  return { gameAPI, rendering, network };
}
```

Then `index.html`:
```html
<script src="dist/gq-game.min.js"></script>
```

**Build process:**
```bash
npm run build
# Output: dist/gq-game.min.js (auto-minified, auto-dependency-managed)
```

**Benefits:**
- Tree-shaking: Only include code that's used
- No manual version management
- Clear dependency graph from imports
- Shared code bundled once

**Complexity:** High (requires build infrastructure changes)

---

#### EMPFEHLUNG #6: Event Registry & Validation

**Current:** Events are strewn across files, hard to debug.

**Proposed:**
```javascript
// js/engine/events/event-registry.js
export const EventRegistry = {
  // Game events
  'game:started': { payload: { startedAt: 'number' } },
  'game:paused': { payload: { pausedAt: 'number' } },
  
  // Selection events
  'selection:changed': { payload: { systemId: 'number', groupId: 'number?' } },
  'selection:cleared': { payload: {} },
  
  // Galaxy events
  'galaxy:stars-loaded': { payload: { stars: 'array', count: 'number' } },
  'galaxy:viewport-changed': { payload: { center: '[x, y, z]', zoom: 'number' } },
};

// Usage
eventBus.emit('selection:changed', { systemId: 42, groupId: 1 });
// Validates against EventRegistry schema before emitting
```

**Benefits:**
- Single source of truth for all events
- Type checking (or runtime validation)
- Easy to find all listeners of an event
- Can generate event documentation

---

#### EMPFEHLUNG #7: Component Architecture for UI

**Replace:**
```javascript
RuntimeEconomyController.js (800 lines)
```

**With:**
```
js/ui/components/economy/
├─ EconomyWindow.js (container)
├─ tabs/
│   ├─ PolicyTab.js
│   ├─ OverviewTab.js
│   ├─ ProductionTab.js
│   └─ PopulationTab.js
├─ widgets/
│   ├─ PolicySelector.js
│   ├─ TaxSlider.js
│   ├─ GoodsList.js
│   └─ ColonyGrid.js
└─ hooks/
    ├─ useEconomyData.js
    ├─ usePolicyUpdate.js
    └─ ...
```

**Each component:**
- Single responsibility
- Testable in isolation
- Reusable across UI
- Clear props/events interface

**Framework:** Could use:
- Plain ES6 classes (lightweight)
- LitElement (web components)
- Or framework (if project allows)

---

### 4.3 Langfristig (Architektur-Umgestaltung)

#### EMPFEHLUNG #8: TypeScript Migrierung

**Nutzen:**
```typescript
// js/runtime/runtime-economy-controller.ts
export interface IEconomyController {
  createEconomyPanel(): HTMLElement;
  updatePolicy(policy: PolicyType): Promise<void>;
  getPolicyState(): PolicyState;
}

export const RuntimeEconomyController: IEconomyController = {
  // Implementation
};
```

**Benefits:**
- 60% fewer bugs (from type checking)
- Auto-completion in IDE
- Easier refactoring (rename impacts obvious)
- Generated API documentation

---

#### EMPFEHLUNG #9: Replace IIFE with ES Modules

**From:**
```javascript
(function () {
  const helper = (...) => { ... };
  
  class Controller { ... }
  
  window.GQRuntimeEconomyController = { ... };
})();
```

**To:**
```typescript
// js/runtime/domains/economy/controller.ts
import { API } from '@/network/api';
import { EventBus } from '@/engine/event-bus';

export class EconomyController {
  constructor(private api: API, private events: EventBus) {}
  
  async updatePolicy(policy: string) {
    await this.api.postEconomy({ policy });
    this.events.emit('economy:policy-changed', { policy });
  }
}
```

Then in `main.ts`:
```typescript
import { EconomyController } from './domains/economy/controller';

const gameAPI = {
  economy: new EconomyController(api, events),
  fleet: new FleetController(api, events),
  // ...
};
```

**Benefits:**
- True dependency injection
- Compile-time safety
- Sharable modules (npm publish)
- Ecosystem tooling (linters, formatters)

---

#### EMPFEHLUNG #10: Feature Flags & Lazy Loading

**Goal:** Load features on-demand, not all at startup.

**Proposed:**
```typescript
// js/runtime/feature-loader.ts
export async function loadFeature(featureName: string) {
  switch (featureName) {
    case 'economy':
      return import('./domains/economy/controller.js');
    case 'war':
      return import('./domains/war/controller.js');
    // ...
  }
}

// Usage
const economyController = await loadFeature('economy');
```

**With feature flags:**
```typescript
// config/features.json
{
  "economy": { "enabled": true, "version": "1.2.0" },
  "war": { "enabled": true, "version": "2.0.0" },
  "diplomacy": { "enabled": false, "version": "0.9.0" }
}

// Then
if (config.features.war.enabled) {
  await loadFeature('war');
}
```

**Benefits:**
- Faster startup (load only enabled features)
- Easy A/B testing (enable for 5% of users)
- Deprecation path (disable old features gradually)

---

## 5. Quick Wins (1-2 Tage Arbeit)

1. **Move 180+ files in domains/** subdirectories (1 Tag)
   - No logic changes, just reorganization
   - Update imports in index.html
   - Risk: Low (only paths change)

2. **Create js/runtime/game-api.js Facade** (2 Std)
   - Consolidate all window.GQRuntimeXxx into window.GQGame
   - Update all imports in game.js
   - Risk: Low (additive only)

3. **Add Event Registry with Documentation** (4 Std)
   - List all events in js/engine/events/event-registry.md
   - Add JSDoc comments to eventBus.emit() calls
   - Generate event documentation
   - Risk: Low (documentation only)

4. **Extract Common UI Patterns** (1-2 Tage)
   - Identify repeated patterns (e.g., "tabbed panel", "list with filters")
   - Create reusable components
   - Replace duplicates in RuntimeXxx files
   - Risk: Medium (refactoring existing files)

---

## 6. Abhängigkeitsgraph Visual

```
┌─────────────────────────────────────┐
│        Desktop UI Layer             │
│  (theme, interactions, tooltips)    │
└────────────┬────────────────────────┘
             │ depends on
┌────────────▼────────────────────────┐
│      Window Manager (WM)            │
│  (wm.js, wm-widgets.js, gqwm.js)   │
└────────────┬────────────────────────┘
             │ depends on
┌────────────▼────────────────────────┐
│   Game Engine & Runtime Core        │
│  (GameEngine, EventBus, GameLoop)   │
└─┬──────────────────────────────────┬┘
  │                                  │
  │ creates                          │ creates
  │                                  │
  ▼                                  ▼
┌──────────────────────┐   ┌──────────────────────┐
│ SystemRegistry       │   │ RuntimeCore          │
│ (update pipeline)    │   │ (frame ticker)       │
└──────────────────────┘   └──────────────────────┘
  │                                  │
  │ registers                        │ emits 'runtime:frame'
  │                                  │
  ▼                                  │
┌────────────────────────────────────▼──────────────────┐
│     Runtime Controllers (180+)                         │
│  RuntimeEconomyController, RuntimeFleetController,    │
│  RuntimeAlliancesController, ... (all depend on API)  │
└──────────────┬──────────────────────┬────────────────┘
               │                      │
               │ calls                │ calls
               │                      │
┌──────────────▼─────────────────────┐▼──────────────┐
│  Network / API Layer               │ 3D Rendering │
│ (api.js, api-transport,            │ (WebGPU,     │
│  api-queue, api-cache)             │  WebGL,      │
│                                     │  SelectionMk)│
└─────────────────────────────────────┴──────────────┘
       │                                      │
       │ emits 'asset:loaded'                 │ uses
       │                                      │
       └──────────────┬───────────────────────┘
                      │
                      ▼
          ┌──────────────────────────┐
          │   AssetRegistry          │
          │   (caching, preload)     │
          └──────────────────────────┘
```

---

## 7. Checkliste für Entwickler

### Neues Feature hinzufügen?

- [ ] In welche Domain gehört es? (economy, fleet, war, galaxy, settings, etc.)
- [ ] Werde ich ein neues RuntimeXxx Modul erstellen? Wenn ja:
  - [ ] Registriere es in `js/engine/runtime/domains/<domain>/`
  - [ ] Exportiere es zu `window.GQRuntime<Name>`
  - [ ] Füge es zu `js/runtime/game-api.js` hinzu
  - [ ] Füge es zu index.html in der richtigen Reihenfolge hinzu
  - [ ] Dokumentiere seine Dependencies in einem Kommentar
- [ ] Braucht es den EventBus? Wenn ja:
  - [ ] Welche Events emit ich? Füge sie zu EventRegistry hinzu
  - [ ] Welche Events höre ich? Dokumentiere in JSDoc
- [ ] Braucht es die API? Wenn ja:
  - [ ] Welche Endpunkte nutze ich?
  - [ ] Sind die Payload-Schemas im APISchemaRegistry dokumentiert?
  - [ ] Fehlerbehandlung: Was wenn API antwortet mit Fehler?
- [ ] Braucht es 3D Rendering? Wenn ja:
  - [ ] Nutze nur die Renderer-API (`renderer.render()`, etc.)
  - [ ] Nicht direkt auf Runtime-State zugreifen!
  - [ ] Nutze Callbacks/Events stattdessen

---

## 8. Zusammenfassung

| Kategorie | Score | Status |
|-----------|-------|--------|
| **Layer-Aufteilung** | 6/10 | Vorhanden aber vermischt |
| **Dependency Management** | 3/10 | Global, zirkulär, fragile |
| **Module Boundaries** | 2/10 | 🔴 KRITISCH: 180+ RuntimeXxx ohne Kategorisierung |
| **Testing** | 2/10 | Nur E2E möglich, Unit Tests unpraktikabel |
| **Rendering × Logic** | 5/10 | Gekoppelt, sollte unabhängig sein |
| **API Design** | 4/10 | Fallbacks, fehlende Schemas, fragile |
| **Code Reusability** | 4/10 | IIFE-Scopes, Duplikation |
| **Developer Experience** | 3/10 | 180 Module-Namen memorieren, komplizierte Boot |
| **Maintainability** | 4/10 | Schwer nachzuvollziehen, nicht skalierbar |
| ****GESAMT**  | **4/10** | **Modular aber fragile, Refactoring nötig** |

### Top 3 Prioritäten für Refactoring

1. **Kategorisieren der Runtime Controller** (1-2 Tage)
   - Impact: Hochverschobene Wartbarkeit, leichter zu navigieren

2. **Game API Facade** (2-4 Std)
   - Impact: Reduziert Komplexität (180 Namen → 1 Einstiegspunkt)

3. **Decoupling Rendering von Runtime** (3-5 Tage)
   - Impact: Renderer testbar, austauschbar, wartbar

---

**Bericht erstellt:** 2026-08-01  
**Autor:** Architecture Analysis System  
**Lizenz:** MIT — makr-code/GalaxyQuest
