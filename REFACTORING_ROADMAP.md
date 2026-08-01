# GalaxyQuest JavaScript Refactoring-Roadmap

**Status:** Architecture Review Complete  
**Current Score:** 4/10 (Modular aber Fragil)  
**Target Score:** 8/10 (Enterprise-ready)  
**Estimated Timeline:** 4-6 Wochen

---

## 🎯 Ziele der Refactorierung

### Separation of Concerns (SOC)
- ✅ Desktop UI ← Eigenständig, nur Rendering
- ✅ Window Manager ← API für UI-Container  
- ✅ Game Framework ← Geschäftslogik, UI-agnostisch
- ✅ Runtime Controllers ← **Derzeitig 180 Dateien unorganisiert** 🔴
- ✅ Game Engine ← Event-Koordination
- ✅ 3D Rendering ← WebGPU/WebGL, keine GameLogic-Abhängigkeiten
- ✅ Network/API ← Transport-abstrahiert

### Qualitäts-Metriken
- **Zirkuläre Abhängigkeiten:** 0 (derzeit: 3+ identifiziert)
- **Global Namespace:** < 5 Entry Points (derzeit: 180+)
- **Coupling:** Layer-API, nicht Direct-Access
- **Testability:** Unit-Tests für jedes Modul möglich

---

## 🚨 PRIORITY 1: Runtime Controller Chaos (3-5 Tage)

### Das Problem
```
js/engine/runtime/
├─ RuntimeEconomyController.js        (900 Zeilen)
├─ RuntimeFleetController.js           (700 Zeilen)
├─ RuntimeEconomyDemandCalculator.js  (200 Zeilen)
├─ RuntimeFleetFormationBuilder.js    (300 Zeilen)
├─ RuntimeGalaxyController.js          (1200 Zeilen) 🔴
├─ RuntimeGalaxyRenderer.js            (RENDERING - falsch hier!)
├─ RuntimeSelectionMarker.js           (Rendering + Logic)
├─ ... +170 mehr
└─ Keine Kategorisierung!
```

### Die Lösung: Domain-basierte Modularisierung

```
js/engine/runtime/
│
├─ __manifest.js                    # Zentrale Export-Liste
│
├─ domains/
│  │
│  ├─ economy/
│  │  ├─ EconomyController.js       # Main facade (vorher RuntimeEconomyController)
│  │  ├─ EconomyCalculations.js     # Rechner
│  │  ├─ EconomyUI.js               # Rendering-Callbacks
│  │  └─ __exports.js               # window.GQRuntime.economy
│  │
│  ├─ fleet/
│  │  ├─ FleetController.js
│  │  ├─ FormationBuilder.js
│  │  └─ __exports.js
│  │
│  ├─ war/
│  │  ├─ WarController.js
│  │  ├─ OfferLifecycle.js
│  │  └─ __exports.js
│  │
│  ├─ galaxy/
│  │  ├─ GalaxyController.js
│  │  ├─ StarNetwork.js
│  │  ├─ SelectionState.js          # ⚠️ Nur State, keine Rendering!
│  │  └─ __exports.js
│  │
│  ├─ research/
│  │  ├─ ResearchController.js
│  │  └─ __exports.js
│  │
│  ├─ colonization/
│  │  └─ ColonizationController.js
│  │
│  └─ ... [8-10 mehr]
│
├─ shared/
│  ├─ State.js                      # MutableState mit Validierung
│  ├─ Constants.js                  # Spielmechanik-Konstanten
│  └─ Validators.js                 # Input-Validierung
│
└─ boot.js                          # Zentrale Initialisierer aller Domains
```

### Code-Beispiel: Economy Domain Refactor

**VOR (Monolit):**
```javascript
// js/engine/runtime/RuntimeEconomyController.js (900 Zeilen, alles durcheinander)
const RuntimeEconomyController = (() => {
  let state = { tab: 'overview', loading: false, ... };
  
  function render() {
    const html = `<div>... 500 Zeilen HTML ... </div>`;
    updateDOM(html);
  }
  
  function calculateDemand() {
    // 200 Zeilen Mathe
  }
  
  function onTaxSliderChange(value) {
    state.tax = value;
    render();  // Re-render alles
  }
  
  // ... 400 Zeilen mehr verschachtelt
  
  return { render, onTaxSliderChange, calculateDemand };
})();
window.GQRuntimeEconomyController = RuntimeEconomyController;
```

**NACH (Modular, Domain-organisiert):**
```javascript
// js/engine/runtime/domains/economy/EconomyController.js
class EconomyController {
  constructor(state) {
    this.state = state;
    this.callbacks = {};  // Rendering callbacks
  }
  
  // ✅ PURE LOGIC - keine DOM-Operationen
  setTaxRate(value) {
    if (value < 0 || value > 100) throw new Error('Invalid tax');
    this.state.taxRate = value;
    this.state.dirty = true;
    this._emitChange('taxRate', value);
  }
  
  // ✅ PURE LOGIC - kein UI-Zugriff
  calculateDemand(colony) {
    return EconomyCalculations.demandByColony(colony, this.state);
  }
  
  // ✅ CALLBACK-PATTERN statt direktem Rendering
  onStateChange(callback) {
    this.callbacks.onChange = callback;
  }
  
  _emitChange(field, value) {
    if (this.callbacks.onChange) {
      this.callbacks.onChange({ field, value });
    }
  }
}

// js/engine/runtime/domains/economy/EconomyUI.js
class EconomyUI {
  constructor(controller, domTarget) {
    this.controller = controller;
    this.target = domTarget;
    
    // ✅ UI Listen auf State-Änderungen, nicht umgekehrt!
    this.controller.onStateChange(({ field, value }) => {
      this.render();  // Re-render nur notwendiges
    });
  }
  
  render() {
    // ✅ Nur Rendering-Logik hier (500 Zeilen → 150 Zeilen)
    this.target.innerHTML = this._buildHtml();
    this._attachEventHandlers();
  }
  
  _buildHtml() {
    // Template
  }
  
  _attachEventHandlers() {
    this.target.querySelector('[data-slider=tax]')
      ?.addEventListener('input', (e) => {
        this.controller.setTaxRate(Number(e.target.value));
      });
  }
}

// js/engine/runtime/domains/economy/__exports.js
window.GQRuntime = window.GQRuntime || {};
window.GQRuntime.economy = {
  controller: new EconomyController(...),
  ui: new EconomyUI(...),
  calculations: EconomyCalculations
};
```

### Implementierungs-Checkliste (PRIORITY 1)

- [ ] Erstelle `js/engine/runtime/domains/` Struktur
- [ ] Identifiziere ~10-15 Top-Level-Domains (economy, fleet, war, galaxy, research, ...)
- [ ] Kategorisiere alle 180 RuntimeXxx-Dateien in Domains
- [ ] Extrahiere Geschäftslogik aus UI-Code
- [ ] Implementiere Callback-Pattern statt direktem DOM-Zugriff
- [ ] Erstelle `__manifest.js` mit Dependency-Graph
- [ ] Update `index.html` boot-sequence für neue Struktur
- [ ] Teste: Jede Domain lädt unabhängig (IIFE, nicht global)
- [ ] Dokumentiere: Domain API & Callback-Schnittstellen

---

## 🟡 PRIORITY 2: API Facade & Namespace Consolidation (2-3 Tage)

### Das Problem
```javascript
// Derzeit: 180 globale Namen
window.GQRuntimeEconomyController
window.GQRuntimeFleetController
window.GQRuntimeWarController
// ... +177 mehr
```

### Die Lösung: Single Entry Point

```javascript
// js/runtime/game.js - TOP-LEVEL FACADE
window.GQGame = {
  // Versionierung
  version: '1.0.0',
  build: '20260405p1',
  
  // Alle Domains unter einem Dach
  domains: {
    economy: window.GQRuntime.economy,
    fleet: window.GQRuntime.fleet,
    war: window.GQRuntime.war,
    galaxy: window.GQRuntime.galaxy,
    // ... rest
  },
  
  // Systems
  systems: {
    npc: window.GQNPCDialogueSystem,
    guide: window.GQGameGuideSystem
  },
  
  // Infrastructure
  api: window.API,
  events: window.GQEventBus,
  renderer: window.GQRenderFactory,
  
  // Lifecycle hooks
  initialize() {
    // Setup all domains
  },
  
  shutdown() {
    // Cleanup
  },
  
  // Query API
  getState(path) {
    // window.GQGame.getState('economy.taxRate')
  }
};
```

### Code-Beispiel: Verwendung in Rendering

**VOR (Direct Access):**
```javascript
// js/rendering/Galaxy3DRendererWebGPU.js
class Galaxy3DRenderer {
  updateMarkers() {
    // 🔴 DIREKTER ZUGRIFF
    const selection = window.GQRuntimeSelectionState.selectedSystems;
    const galaxy = window.GQRuntimeGalaxyController.galaxyData;
    
    // Problem: Wenn GQRuntimeSelectionState später renamed wird, Crash!
    this.markers.forEach(m => m.highlight = selection.includes(m.id));
  }
}
```

**NACH (Via Facade & Callbacks):**
```javascript
// js/rendering/Galaxy3DRendererWebGPU.js
class Galaxy3DRenderer {
  constructor(gameInstance) {
    this.game = gameInstance;  // Dependency Injection!
    
    // ✅ Register callback, nicht direkter Zugriff
    this.game.events.on('selection:changed', (selection) => {
      this.updateMarkers(selection);
    });
  }
  
  updateMarkers(selection) {
    this.markers.forEach(m => m.highlight = selection.includes(m.id));
  }
}

// Verwendung in game.js:
const renderer = new Galaxy3DRenderer(window.GQGame);
```

### Implementierungs-Checkliste (PRIORITY 2)

- [ ] Erstelle `window.GQGame` Facade
- [ ] Migriere alle direkten `window.GQRuntimeXxx` Zugriffe auf `window.GQGame.domains.xxx`
- [ ] Implementiere DI-Pattern (Constructor Injection)
- [ ] Update Rendering zu Callback-Pattern
- [ ] Verifiziere: Keine direkten `window.GQRuntime` Zugriffe mehr
- [ ] ESLint Rule: Ban `window.GQRuntime` direkt (nur via Facade)

---

## 🟢 PRIORITY 3: Event Registry (2 Tage)

### Das Problem
```javascript
// Wo kommt 'economy:tax-changed' her? Wer braucht das?
eventBus.on('economy:tax-changed', (taxRate) => { ... });

// Was ist die exakte Payload?
// Wer emitted das Event?
// Wann wird es emitted?
// → KEINE ANTWORT!
```

### Die Lösung: Zentrale Event-Registrierung

```javascript
// js/runtime/EventRegistry.js
export const EVENT_REGISTRY = {
  // Economy Domain Events
  'economy:tax-changed': {
    description: 'Emitted when player changes tax rate',
    payload: { taxRate: number, timestamp: number },
    emitter: 'EconomyController.setTaxRate()',
    subscribers: ['EconomyUI', 'Galaxy3DRenderer'] // Who listens?
  },
  
  'economy:demand-recalculated': {
    description: 'Emitted after demand calculation',
    payload: { demands: ColonyDemands[], timestamp: number },
    emitter: 'EconomyController.recalculate()',
    subscribers: ['EconomyUI']
  },
  
  // Fleet Domain Events
  'fleet:formation-changed': {
    description: 'Emitted when fleet formation is modified',
    payload: { fleetId: string, formation: Formation },
    emitter: 'FleetController.setFormation()',
    subscribers: ['FleetUI', 'Galaxy3DRenderer']
  },
  
  // Render Events
  'render:frame': {
    description: 'Fired every frame by GameLoop',
    payload: { dt: number, alpha: number, frameCount: number },
    emitter: 'GameLoop.tick()',
    subscribers: ['Galaxy3DRenderer', 'ParticleSystem']
  },
  
  // ... 50 mehr
};

// Validierungs-Helper
export function validateEventPayload(eventName, payload) {
  const schema = EVENT_REGISTRY[eventName];
  if (!schema) throw new Error(`Unknown event: ${eventName}`);
  
  // Type-check payload gegen schema.payload
  for (const [field, expectedType] of Object.entries(schema.payload)) {
    if (typeof payload[field] !== expectedType) {
      throw new TypeError(
        `Event ${eventName}: field ${field} must be ${expectedType}, got ${typeof payload[field]}`
      );
    }
  }
  return true;
}

// EventBus Wrapper mit Validierung
export class ValidatedEventBus {
  on(eventName, callback) {
    if (!EVENT_REGISTRY[eventName]) {
      console.warn(`[EventBus] Unregistered event: ${eventName}`);
    }
    this._bus.on(eventName, callback);
  }
  
  emit(eventName, payload) {
    validateEventPayload(eventName, payload);
    this._bus.emit(eventName, payload);
  }
}
```

### Implementierungs-Checkliste (PRIORITY 3)

- [ ] Erstelle `EventRegistry.js` mit allen bekannten Events
- [ ] Dokumentiere Payload-Schema für jedes Event
- [ ] Implementiere Validierungs-Wrapper
- [ ] Ersetze `eventBus` mit `ValidatedEventBus`
- [ ] Tool: Event-Subscriber-Mapper (wer listened wo?)
- [ ] LSP Integration: Autocomplete für Event-Namen

---

## 🟢 PRIORITY 4: Decoupling Rendering from Runtime (3-5 Tage)

### Das Problem
```javascript
// js/rendering/Galaxy3DRendererWebGPU.js
class Galaxy3DRenderer {
  render() {
    // 🔴 DIRECT IMPORT & CALL
    const markers = window.GQRuntimeSelectionMarker.getMarkers();
    const selected = window.GQRuntimeSelectionState.selectedIds;
    
    // Problem: Renderer ist jetzt an SelectionMarker gekoppelt
    // Testing: Kann nicht ohne SelectionMarker getestet werden!
  }
}
```

### Die Lösung: Callback & Config-basiert

```javascript
// js/rendering/Galaxy3DRendererWebGPU.js
class Galaxy3DRenderer {
  constructor(config = {}) {
    this.config = {
      getSelectionInfo: config.getSelectionInfo || (() => null),
      onSelectionHover: config.onSelectionHover || (() => {}),
      onSelectionClick: config.onSelectionClick || (() => {}),
      // ... andere callbacks
    };
  }
  
  render() {
    // ✅ KEIN DIREKTER ZUGRIFF
    const selectionInfo = this.config.getSelectionInfo?.();
    if (selectionInfo?.selectedIds) {
      this.applySelectionHighlight(selectionInfo.selectedIds);
    }
  }
  
  onMarkerHover(marker) {
    // ✅ CALLBACK statt Seiteneffekt
    this.config.onSelectionHover?.(marker.id);
  }
}

// js/runtime/game.js - Renderer Setup
const renderer = new Galaxy3DRenderer({
  getSelectionInfo: () => ({
    selectedIds: window.GQGame.domains.galaxy.selectionState.selectedIds,
    hoveredId: window.GQGame.domains.galaxy.selectionState.hoveredId
  }),
  
  onSelectionHover: (systemId) => {
    window.GQGame.domains.galaxy.selectSystem(systemId);
  }
});
```

### Implementierungs-Checkliste (PRIORITY 4)

- [ ] Identifiziere alle `window.GQRuntime*` Zugriffe in Rendering
- [ ] Erstelle Config-Objekt für jeden Renderer
- [ ] Implementiere Callback-Pattern
- [ ] Testbar machen: Unit-Tests für Renderer ohne Runtime-Abhängigkeiten
- [ ] Update boot-sequence: Renderer nach Domains konstruieren

---

## 🟢 PRIORITY 5: Boot-Sequence Hardening (2 Tage)

### Das Problem
```html
<!-- index.html: 80 Zeilen Script-Tags, keine zentrale Quelle der Wahrheit -->
<script src="js/runtime/wm.js"></script>
<script src="js/runtime/gqwm.js"></script>
<!-- Wenn jemand vergisst, ein Skript hinzuzufügen, schweigt es! -->
```

### Die Lösung: Manifest-driven Loader

```javascript
// js/runtime/boot-manifest.js - QUELLE DER WAHRHEIT
export const BOOT_MANIFEST = {
  version: '20260405p1',
  
  phases: [
    // Phase 0: Versioning & Assets
    { name: 'manifest', files: ['boot-manifest.js', 'boot-assets.js'] },
    
    // Phase 1: Core UI Framework
    {
      name: 'ui-framework',
      files: ['terminal.js', 'wm.js', 'wm-widgets.js', 'gqwm.js'],
      dependsOn: ['manifest']
    },
    
    // Phase 2: Network Infrastructure
    {
      name: 'network',
      files: [
        'api-transport.js',
        'api-queue.js',
        'api-cache.js',
        'api-session.js',
        'api-schema-adapters.js',
        'api.js'
      ],
      dependsOn: ['manifest']
    },
    
    // Phase 3: Game Framework
    {
      name: 'game-framework',
      files: [
        'event-bus.js',
        'game-loop.js',
        'system-registry.js',
        'asset-registry.js'
      ],
      dependsOn: ['network']
    },
    
    // Phase 4: Runtime Domains
    {
      name: 'runtime-domains',
      files: [
        'domains/economy/__exports.js',
        'domains/fleet/__exports.js',
        'domains/war/__exports.js',
        'domains/galaxy/__exports.js',
        // ... rest
      ],
      dependsOn: ['game-framework']
    },
    
    // Phase 5: Rendering
    {
      name: 'rendering',
      files: [
        'graphics-context.js',
        'renderer-factory.js',
        'galaxy-3d-renderer-webgpu.js',
        'particle-system.js'
      ],
      dependsOn: ['runtime-domains']
    },
    
    // Phase 6: Game Systems
    {
      name: 'game-systems',
      files: [
        'systems/npc-dialogue.js',
        'systems/game-guide.js',
        'advisor-npc-integration.js'
      ],
      dependsOn: ['rendering']
    },
    
    // Phase 7: Main Coordinator
    {
      name: 'main',
      files: ['game.js'],
      dependsOn: ['game-systems']
    }
  ]
};

// js/runtime/boot-loader.js - AUTOMATISCHER LOADER
export async function loadBootPhases() {
  const loaded = new Set();
  const failed = [];
  
  for (const phase of BOOT_MANIFEST.phases) {
    // ✅ Verifiziere Abhängigkeiten
    for (const dep of phase.dependsOn) {
      if (!loaded.has(dep)) {
        throw new Error(`Phase ${phase.name} needs ${dep}, but it failed to load`);
      }
    }
    
    // ✅ Lade Dateien mit Fehlerbehandlung
    for (const file of phase.files) {
      try {
        await loadScript(`js/${file}?v=${BOOT_MANIFEST.version}`);
        console.log(`[Boot] ✓ ${file}`);
      } catch (err) {
        console.error(`[Boot] ✗ ${file}:`, err);
        failed.push({ file, phase, error: err });
      }
    }
    
    // ✅ Verifiziere Phase-Exports
    const expectedExport = phase.exportKey;
    if (expectedExport && !window[expectedExport]) {
      throw new Error(`Phase ${phase.name} didn't export ${expectedExport}`);
    }
    
    loaded.add(phase.name);
    console.log(`[Boot] Phase ${phase.name} complete`);
  }
  
  if (failed.length > 0) {
    console.error(`[Boot] ${failed.length} files failed to load:`, failed);
    return false;
  }
  
  return true;
}
```

### Implementierungs-Checkliste (PRIORITY 5)

- [ ] Erstelle zentrale `BOOT_MANIFEST` mit allen Phases & Dependencies
- [ ] Implementiere `loadBootPhases()` mit Validierung
- [ ] Update `index.html`: Nur noch `boot-loader.js` laden
- [ ] Automatisiere Verifikation: Alle exports prüfen
- [ ] Error-Handling: Detaillierte Fehler-Meldungen wenn Phase fehlschlägt
- [ ] Dev-Tool: Boot-Visualizer (Dependency-Graph in Browser anzeigen)

---

## 📊 Implementation Timeline

| Woche | PRIORITY | Aufgaben | Owner | Status |
|-------|----------|----------|-------|--------|
| **W1** | 1 | Runtime Controller Reorganisation (50% done) | Team | 🟡 In Progress |
| **W1-W2** | 1 | Economy, Fleet, War Domain Refactor | Frontend Lead | ⏳ Pending |
| **W2** | 2 | API Facade `window.GQGame` | Frontend Lead | ⏳ Pending |
| **W2** | 3 | Event Registry erstellen | Architektur | ⏳ Pending |
| **W3** | 4 | Rendering Decoupling | 3D-Engineer | ⏳ Pending |
| **W3** | 5 | Boot-Sequence Hardening | DevOps | ⏳ Pending |
| **W4** | - | Testing & Refactor-Validierung | QA | ⏳ Pending |

---

## ✅ Success Criteria

- [ ] Architektur-Score: 8/10
- [ ] Zero circular dependencies
- [ ] Rendering Unit-Tests: 70%+ coverage
- [ ] Boot-Time: < 2s (current: 3-4s)
- [ ] Error Rate in Console: 0 (currently: 5-8 per load)
- [ ] Memory Leaks: 0 (EventBus cleanup auf Domain-Shutdown)
- [ ] LSP Autocomplete: Domain-API fully documented

---

## 📚 Resources

- [JAVASCRIPT_ARCHITECTURE_ANALYSIS.md](JAVASCRIPT_ARCHITECTURE_ANALYSIS.md) - Vollständige technische Analyse
- [Dependency Graph](#) - Visual chart (to be created)
- [Event Registry Template](#) - Copy-paste starter (to be created)
- [Domain Template](#) - Boilerplate für neue Domains (to be created)

---

**Last Updated:** 2026-08-01  
**Next Review:** 2026-08-15 (Architecture Check-in)
