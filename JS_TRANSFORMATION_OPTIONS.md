# 🔄 GalaxyQuest JS Transformation – Strategische Optionen

**Datum:** 2026-08-01  
**Fokus:** Aufzeigen von Transformations-Möglichkeiten  
**Kontext:** Basierend auf JAVASCRIPT_ARCHITECTURE_ANALYSIS.md

---

## Executive Summary

GalaxyQuest hat 180+ Runtime Controller ohne klare Struktur, globale Namespace-Pollution, und starke Kopplung zwischen Rendering ↔ Game Logic. 

**3 Transformations-Strategien:**
1. **OPTION A: Graduell (Modular Refactor)** – Parallel Migration, 4-6 Wochen
2. **OPTION B: Radikal (Module → ES6)** – Full Rebuild, 8-12 Wochen
3. **OPTION C: Hybrid (Facade Pattern)** – Wrapper + Schrittweise, 3-4 Wochen

---

## OPTION A: Graduell – Modular Refactor (Recommended)

### Strategie
Existierender Code bleibt weitestgehend intact. Neue Struktur wird **parallel aufgebaut** und schrittweise migriert.

### Stufen

#### **Phase 1: Kategorisierung (Week 1-2)**

**Ziel:** 180 Dateien in logische Gruppen gliedern.

```
js/engine/runtime/
├─ domains/
│   ├─ economy/              [10 files]
│   ├─ fleet/                [8 files]
│   ├─ alliances/            [6 files]
│   ├─ war/                  [12 files]
│   ├─ research/             [7 files]
│   ├─ colonization/         [15 files]
│   ├─ galaxy/               [50+ files]  ← Most complex
│   ├─ market/               [5 files]
│   ├─ espionage/            [8 files]
│   ├─ npc/                  [10 files]
│   ├─ diplomacy/            [8 files]
│   └─ events/               [5 files]
│
├─ ui/
│   ├─ windows/              [20 files]  [SettingsPanel, AudioSettings, etc]
│   ├─ components/           [25 files]  [Cards, Grids, Modals, etc]
│   └─ helpers/              [10 files]  [Theme, Tooltips, etc]
│
├─ core/
│   ├─ RuntimeCore.js        [unchanged – ticker]
│   ├─ SystemRegistry.js     [unchanged – update pipeline]
│   └─ GameContextRefs.js    [unchanged – storage]
│
└─ integration/
    ├─ RuntimeBootSetup.js
    ├─ RuntimeDesktopShell.js
    └─ RuntimeDevelopmentControllers.js
```

**Effort:** ~20 hours (reorganizing + creating folder structure)  
**Risk:** Low (no code changes, just file moves)  
**Breaking changes:** None if done carefully with find/replace

---

#### **Phase 2: Facade Creation (Week 2-3)**

**Ziel:** Zentrale Entry-Point statt `window.GQRuntimeXxx` Wildwuchs.

**Current:**
```javascript
// 180+ scattered references
window.GQRuntimeEconomyController = { ... };
window.GQRuntimeFleetController = { ... };
window.GQRuntimeAlliancesController = { ... };
// etc.
```

**New Facade:**
```javascript
// js/engine/runtime/GQGameFacade.js
export const GQGameFacade = {
  domains: {
    economy: null,      // will be initialized
    fleet: null,
    alliances: null,
    war: null,
    research: null,
    colonization: null,
    galaxy: null,
    market: null,
    espionage: null,
    npc: null,
    diplomacy: null,
    events: null,
  },
  
  ui: {
    windows: null,
    components: null,
  },
  
  core: null,           // RuntimeCore
  
  async initialize() {
    // Lazy-load each domain
    this.domains.economy = await loadDomain('economy');
    this.domains.fleet = await loadDomain('fleet');
    // ...
  },
  
  // Backwards compat layer (temporary)
  getController(name) {
    // 'economy' → this.domains.economy
    // 'economy:controller' → this.domains.economy.controller
  },
};

// Global registration (temporary)
window.GQGame = GQGameFacade;
```

**Migration step (from old to new):**
```javascript
// OLD:
const economyCtrl = window.GQRuntimeEconomyController;

// NEW:
const economyCtrl = window.GQGame.domains.economy.controller;

// BRIDGE (during transition):
// In facade.js, add backwards-compat getter:
Object.defineProperty(window, 'GQRuntimeEconomyController', {
  get() { return window.GQGame.domains.economy.controller; },
});
```

**Effort:** ~15 hours (facade pattern, initialization logic)  
**Risk:** Medium (must handle circular dependencies carefully)  
**Breaking changes:** None if bridge layer works

---

#### **Phase 3: Decouple Rendering from Logic (Week 3-4)**

**Current Problem:**
```javascript
// In Galaxy3DRendererWebGPU.js
const selectionState = window.GQRuntimeSelectionState?.getSelectionGroupHighlightedSystems();
if (selectionState) {
  material.emissive.setHex(0xff00ff);
}
```

**New Pattern – Dependency Injection:**

```javascript
// js/rendering/core/RendererConfig.js
export class RendererConfig {
  constructor() {
    this.selectionProvider = null;  // Injected dependency
    this.lightingProvider = null;
    this.weatherProvider = null;
  }
  
  registerSelectionProvider(fn) {
    this.selectionProvider = fn;  // Callback, not direct reference
  }
  
  getSelectionInfo() {
    return this.selectionProvider?.() ?? null;
  }
}

// In Galaxy3DRendererWebGPU.js
export class Galaxy3DRendererWebGPU {
  constructor(config) {
    this.config = config;  // RendererConfig instance
  }
  
  renderFrame() {
    const selectionInfo = this.config.getSelectionInfo();  // Via callback
    if (selectionInfo?.highlightedSystemIds) {
      this.applySelectionHighlight(selectionInfo);
    }
  }
}

// In RuntimeGalaxyController.js (initialization)
export async function initializeGalaxyDomain(config) {
  const rendererConfig = new RendererConfig();
  
  // Inject selection provider
  rendererConfig.registerSelectionProvider(() => {
    return {
      highlightedSystemIds: getHighlightedSystems(),  // From game logic
    };
  });
  
  const renderer = new Galaxy3DRendererWebGPU(rendererConfig);
  return { controller, renderer };
}
```

**Benefits:**
- ✅ Renderer doesn't know about `GQRuntimeSelectionState` anymore
- ✅ Easy to mock for testing
- ✅ Clear dependency direction (game logic → renderer, not vice versa)

**Effort:** ~25 hours (identify all coupling points, create DI pattern)  
**Risk:** Medium-High (must update multiple rendering layers)  
**Breaking changes:** Moderate (renderer API changes)

---

#### **Phase 4: Event Registry (Week 4-5)**

**Current Problem:**
```javascript
// Scattered, no validation
eventBus.on('galaxy:stars-loaded', ({ stars }) => {
  // What's the payload structure?
});

eventBus.emit('galaxy:stars-loaded', data);  // Wrong payload? Silent bug.
```

**New Pattern – TypeScript-like Validation (without TypeScript):**

```javascript
// js/engine/runtime/EventRegistry.js
export const EVENT_REGISTRY = {
  // Domain: Economy
  'economy:policy-changed': {
    domain: 'economy',
    description: 'Emitted when a policy is changed',
    emitter: 'RuntimeEconomyController',
    schema: {
      policyId: 'string',
      oldValue: 'number',
      newValue: 'number',
      timestamp: 'number',
    },
  },
  
  'economy:production-updated': {
    domain: 'economy',
    description: 'Emitted when colony production is recalculated',
    emitter: 'RuntimeEconomyController',
    schema: {
      colonyId: 'string',
      production: 'object',  // { food: number, energy: number, ... }
      timestamp: 'number',
    },
  },
  
  // Domain: Galaxy
  'galaxy:stars-loaded': {
    domain: 'galaxy',
    description: 'Emitted when star systems are loaded from server',
    emitter: 'RuntimeGalaxyController',
    schema: {
      stars: 'array',  // [{id, x, y, name, ...}]
      totalCount: 'number',
      timestamp: 'number',
    },
  },
  
  // ... (90+ more events)
};

// Validated event bus wrapper
export class ValidatedEventBus {
  constructor(baseEventBus) {
    this.eventBus = baseEventBus;
  }
  
  emit(eventName, payload) {
    const schema = EVENT_REGISTRY[eventName];
    if (!schema) {
      console.warn(`Event '${eventName}' not registered`);
      return;  // Optionally allow unregistered, or throw
    }
    
    // Validate payload against schema
    this.validatePayload(payload, schema.schema);
    
    // Pass to real eventBus
    this.eventBus.emit(eventName, payload);
  }
  
  on(eventName, callback) {
    const schema = EVENT_REGISTRY[eventName];
    if (!schema) {
      console.warn(`Event '${eventName}' not registered`);
    }
    
    // Wrap callback with payload validation
    const validatedCallback = (payload) => {
      this.validatePayload(payload, schema?.schema);
      callback(payload);
    };
    
    return this.eventBus.on(eventName, validatedCallback);
  }
  
  validatePayload(payload, schema) {
    if (!schema) return;  // No schema defined
    
    for (const [key, expectedType] of Object.entries(schema)) {
      const actualType = typeof payload[key];
      if (actualType !== expectedType) {
        console.error(
          `Payload mismatch: expected ${key}:${expectedType}, got ${actualType}`
        );
      }
    }
  }
  
  getRegistry() {
    return EVENT_REGISTRY;
  }
}
```

**Usage:**
```javascript
// In RuntimeEconomyController
const eventBus = new ValidatedEventBus(baseEventBus);

eventBus.emit('economy:policy-changed', {
  policyId: 'tax_rate',
  oldValue: 0.15,
  newValue: 0.20,
  timestamp: Date.now(),
});

// In RuntimeFleetController
eventBus.on('economy:policy-changed', ({ policyId, newValue }) => {
  if (policyId === 'tax_rate' && newValue > 0.25) {
    // Adjust fleet maintenance budget
  }
});
```

**Effort:** ~10 hours (define registry, create ValidatedEventBus)  
**Risk:** Low (additive, doesn't break existing eventBus)  
**Breaking changes:** None

---

#### **Phase 5: Component Hierarchy for UI (Week 5-6)**

**Current:**
```javascript
// In RuntimeEconomyController.js (~1500 lines)
function renderEconomyPanel() {
  // 1. Create outer <section>
  // 2. Create tabs container
  // 3. Create policy tab (400 lines of DOM manipulation)
  // 4. Create overview tab (300 lines)
  // 5. Create production tab (400 lines)
  // 6. Attach event handlers everywhere
  // 7. Return constructed DOM
}
```

**New Pattern – Component Tree:**

```javascript
// js/engine/runtime/ui/components/economy/PolicyTab.js
export class PolicyTab {
  constructor(controller) {
    this.controller = controller;
    this.state = { selectedPolicy: null };
  }
  
  render() {
    return `
      <div class="policy-tab">
        <select id="policy-selector">
          ${this.renderPolicyOptions()}
        </select>
        <div id="policy-details">
          ${this.renderPolicyDetails()}
        </div>
      </div>
    `;
  }
  
  renderPolicyOptions() {
    return this.controller.getPolicies()
      .map(p => `<option value="${p.id}">${p.name}</option>`)
      .join('');
  }
  
  renderPolicyDetails() {
    const policy = this.controller.getPolicy(this.state.selectedPolicy);
    if (!policy) return '';
    return `<p>${policy.description}</p>`;
  }
  
  attach(container) {
    container.innerHTML = this.render();
    
    container.querySelector('#policy-selector').addEventListener('change', (e) => {
      this.state.selectedPolicy = e.target.value;
      this.onPolicySelected(this.state.selectedPolicy);
    });
  }
  
  onPolicySelected(policyId) {
    this.controller.setPolicies({ [policyId]: true });
  }
  
  rerender() {
    // Efficient re-render on state change
    this.attach(this.container);
  }
}

// js/engine/runtime/ui/windows/economy/EconomyWindow.js
export class EconomyWindow {
  constructor(controller) {
    this.controller = controller;
    this.tabs = {
      policy: new PolicyTab(controller),
      overview: new OverviewTab(controller),
      production: new ProductionTab(controller),
    };
  }
  
  render() {
    return `
      <section class="wm-window economy-window">
        <header class="wm-header">
          <h2>Economy</h2>
          <button class="close">×</button>
        </header>
        <nav class="tabs">
          <button class="tab-btn" data-tab="policy">Policy</button>
          <button class="tab-btn" data-tab="overview">Overview</button>
          <button class="tab-btn" data-tab="production">Production</button>
        </nav>
        <main class="tab-content">
          <div id="policy-panel"></div>
          <div id="overview-panel"></div>
          <div id="production-panel"></div>
        </main>
      </section>
    `;
  }
  
  attach(container) {
    container.innerHTML = this.render();
    this.tabs.policy.attach(container.querySelector('#policy-panel'));
    this.tabs.overview.attach(container.querySelector('#overview-panel'));
    this.tabs.production.attach(container.querySelector('#production-panel'));
    
    this.attachTabSwitcher(container);
  }
  
  attachTabSwitcher(container) {
    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
        this.showTab(tabName);
      });
    });
  }
  
  showTab(tabName) {
    // Hide all, show one
    document.querySelectorAll('.tab-content > div').forEach(el => {
      el.style.display = 'none';
    });
    document.querySelector(`#${tabName}-panel`).style.display = 'block';
  }
}
```

**Benefits:**
- ✅ Easy to test each component in isolation
- ✅ Reusable components (PolicyTab can be used in Settings too)
- ✅ Clean separation of concerns
- ✅ Easier to parallelize work (different teams on different components)

**Effort:** ~30 hours (identify components, extract logic, create hierarchy)  
**Risk:** Medium (refactoring large chunks of UI)  
**Breaking changes:** Moderate (UI layer changes, but not exposed to game logic)

---

### Summary: OPTION A Timeline & Effort

| Phase | Duration | Effort | Risk | Breaking Changes |
|-------|----------|--------|------|------------------|
| 1: Categorization | 1-2 weeks | 20h | 🟢 Low | None |
| 2: Facade Creation | 2-3 weeks | 15h | 🟡 Medium | None (bridge layer) |
| 3: Decouple Rendering | 3-4 weeks | 25h | 🟡 Medium | Moderate |
| 4: Event Registry | 4-5 weeks | 10h | 🟢 Low | None |
| 5: UI Components | 5-6 weeks | 30h | 🟡 Medium | Moderate |
| **Total** | **4-6 weeks** | **~100h** | **🟡 Medium** | **~50% codebase** |

**Advantages:**
- ✅ Parallel work possible (domains can be migrated independently)
- ✅ Low risk of total breakage
- ✅ Can be merged gradually into develop
- ✅ Existing code keeps working

**Disadvantages:**
- ❌ Bridge layers create temporary technical debt
- ❌ Migration takes longer (4-6 weeks)
- ❌ Two parallel systems for a while

---

## OPTION B: Radikal – Full ES6 Module Migration

### Strategie
Kompletter Rewrite zu ES6 Modules. `window.GQRuntime*` wird komplett weggelassen.

### Neue Struktur

```javascript
// js/engine/runtime/domains/economy/index.js
import { RuntimeEconomyController } from './controller.js';
import { EconomyCalculations } from './calculations.js';
import { setupEconomyEventBindings } from './events.js';

export async function initializeEconomyDomain({ eventBus, api, logger }) {
  const controller = new RuntimeEconomyController({ api, logger });
  const calculations = new EconomyCalculations();
  
  setupEconomyEventBindings(controller, eventBus);
  
  return {
    name: 'economy',
    controller,
    calculations,
    lifecycle: {
      async onGameStart() { /* ... */ },
      async onGameStop() { /* ... */ },
    },
  };
}

// js/engine/runtime/domains/economy/controller.js
export class RuntimeEconomyController {
  constructor({ api, logger }) {
    this.api = api;
    this.logger = logger;
    this.state = new State(economySchema);
  }
  
  async fetchEconomyData() {
    try {
      const data = await this.api.getEconomy();
      this.state.set('economy', data);
      return data;
    } catch (error) {
      this.logger.error('Failed to fetch economy', { error });
      throw error;
    }
  }
  
  async setPolicies(policies) {
    const response = await this.api.updateEconomy({ policies });
    this.state.set('policies', response.policies);
    return response;
  }
}

// js/engine/runtime/game.js (Main entry point)
import { initializeEconomyDomain } from './domains/economy/index.js';
import { initializeFleetDomain } from './domains/fleet/index.js';
import { initializeWar Domain } from './domains/war/index.js';
// ... all 12 domains

export class GQGameEngine {
  constructor({ eventBus, api, logger, renderer }) {
    this.eventBus = eventBus;
    this.api = api;
    this.logger = logger;
    this.renderer = renderer;
    this.domains = {};
  }
  
  async initialize() {
    // Sequential initialization with dependency injection
    this.domains.economy = await initializeEconomyDomain({
      eventBus: this.eventBus,
      api: this.api,
      logger: this.logger,
    });
    
    this.domains.fleet = await initializeFleetDomain({
      eventBus: this.eventBus,
      api: this.api,
      logger: this.logger,
    });
    
    // ... all 12 domains
    
    this.setupInterDomainBindings();
  }
  
  setupInterDomainBindings() {
    // Connect domains to each other
    this.eventBus.on('economy:policy-changed', ({ policyId, value }) => {
      if (policyId === 'maintenance_budget') {
        this.domains.fleet.controller.setMaintenanceBudget(value);
      }
    });
  }
}

// Bootstrap: index.html
<script type="module">
  import { GQGameEngine } from './js/engine/runtime/game.js';
  
  const game = new GQGameEngine({
    eventBus: window.GQEventBus,
    api: window.API,
    logger: window.Logger,
    renderer: window.Renderer,
  });
  
  await game.initialize();
  window.GQGame = game;  // Single global
</script>
```

### Advantages
- ✅ Clean module boundary
- ✅ No global namespace pollution
- ✅ Natural dependency injection
- ✅ Tree-shaking friendly
- ✅ Each domain is testable in isolation

### Disadvantages
- ❌ Major rewrite (all 180 files)
- ❌ High breakage risk
- ❌ Requires Webpack/Vite bundler configuration
- ❌ 8-12 weeks timeline
- ❌ Can't merge gradually

### Effort Breakdown

| Phase | Task | Effort |
|-------|------|--------|
| Setup | Bundler config, test infra | 10h |
| Economy Domain | Full rewrite | 15h |
| Fleet Domain | Full rewrite | 12h |
| War Domain | Full rewrite | 18h |
| ... (9 more domains) | | 120h |
| UI Components | Hierarchy refactor | 40h |
| Rendering Decouple | DI pattern | 20h |
| Testing | Unit test suite | 30h |
| **Total** | | **~265h (8-12 weeks)** |

---

## OPTION C: Hybrid – Facade + Wrapper (Fast-Track)

### Strategie
Minimal changes to existing code. Add **Facade layer + DI wrapper** without refactoring internals.

### Phase 1: Global Facade (Week 1)

```javascript
// js/engine/runtime/GQGameFacade.js
window.GQGame = {
  domains: {},
  async initialize() {
    // Lazy-load all RuntimeXxx modules via script tags (unchanged)
    // Then register them in this facade
    
    this.domains.economy = {
      controller: window.GQRuntimeEconomyController,  // Still global!
      ui: window.GQRuntimeEconomyWindowUI,
    };
    
    // ... for all 12 domains
  },
  
  // Getters for backwards compatibility
  getController(domain) {
    return this.domains[domain]?.controller;
  },
  
  // New API (for future code)
  getDomain(name) {
    return this.domains[name];
  },
};
```

**Index.html:**
```html
<!-- Load facade first -->
<script src="js/engine/runtime/GQGameFacade.js"></script>

<!-- Load all RuntimeXxx modules (unchanged) -->
<script src="js/engine/runtime/RuntimeEconomyController.js"></script>
<script src="js/engine/runtime/RuntimeFleetController.js"></script>
<!-- ... 180 more ... -->

<!-- Boot sequence -->
<script>
  window.GQGame.initialize().then(() => {
    console.log('Game ready');
  });
</script>
```

**Advantage:** No refactoring needed! Just wrapping.  
**Effort:** ~5 hours  
**Risk:** 🟢 None

---

### Phase 2: Optional DI Wrapper (Week 1-2)

For **new domains only** (like Event domain from recent session):

```javascript
// js/engine/runtime/domains/event/index.js
// Use clean ES6 modules + DI pattern

import { EventController } from './EventController.js';
import { EventUI } from './EventUI.js';

export async function initializeEventDomain({ eventBus, api, logger }) {
  const controller = new EventController({ api });
  const ui = new EventUI(controller);
  
  eventBus.on('engine:ready', () => {
    controller.loadEvents();
  });
  
  return {
    controller,
    ui,
    name: 'events',
  };
}

// In GQGameFacade.js
async initialize() {
  // Old domains (unchanged)
  this.domains.economy = window.GQRuntimeEconomyController;
  
  // New domains (clean)
  this.domains.events = await initializeEventDomain({
    eventBus: this.eventBus,
    api: this.api,
    logger: this.logger,
  });
}
```

**Advantage:** New code is clean, old code is unchanged  
**Effort:** ~15 hours  
**Risk:** 🟢 Low (new code is isolated)

---

### Phase 3: Gradual Modernization (Week 2+)

Each domain can be modernized incrementally:

```javascript
// js/engine/runtime/domains/economy/index.js (NEW WRAPPER)
import { RuntimeEconomyController } from '../../../legacy/RuntimeEconomyController.js';  // Old code

// Wrap old code with modern DI pattern
export async function initializeEconomyDomain({ eventBus, api, logger }) {
  // Old code still runs
  const controller = window.GQRuntimeEconomyController;
  
  // Inject dependencies via side effects (temporary solution)
  controller._eventBus = eventBus;
  controller._logger = logger;
  
  return {
    controller,
    name: 'economy',
  };
}
```

Then gradually **refactor the internals** of `RuntimeEconomyController`:
- Remove `window.GQRuntime*` dependencies → take from DI
- Break large IIFE into smaller modules
- Add unit tests

**Timeline:** Can do 1-2 domains per sprint  
**Effort:** ~15h per domain (incremental)  
**Risk:** 🟡 Medium (refactoring existing code)

---

### Summary: OPTION C Timeline & Effort

| Phase | Duration | Effort | Risk | Breaking Changes |
|-------|----------|--------|------|------------------|
| 1: Facade | 1 week | 5h | 🟢 None | None |
| 2: DI Wrapper | 1-2 weeks | 15h | 🟢 Low | None |
| 3: Incremental Modernization | 6+ weeks | ~120h | 🟡 Medium | Gradual |
| **Total (if done to completion)** | **6-8 weeks** | **~140h** | **🟡 Medium** | **~40%** |

**Advantages:**
- ✅ Can start immediately (no infrastructure work)
- ✅ New code is clean from day 1
- ✅ No breakage during transition
- ✅ Mix old + new patterns freely
- ✅ Easiest to parallelize (old team keeps maintaining, new team builds clean modules)

**Disadvantages:**
- ❌ Two patterns in codebase for a while
- ❌ Refactoring old code still risky
- ❌ DI pattern adds indirection

---

## Comparison Matrix

| Criterion | OPTION A (Gradual) | OPTION B (Radical) | OPTION C (Hybrid) |
|-----------|-------------------|-------------------|-------------------|
| **Timeline** | 4-6 weeks | 8-12 weeks | 6-8 weeks (to completion) |
| **Effort** | ~100 hours | ~265 hours | ~140 hours |
| **Risk** | 🟡 Medium | 🔴 High | 🟢 Low |
| **Can parallelize?** | ✅ Yes (by domain) | ⚠️ Partial | ✅ Yes (old vs. new) |
| **Backwards compat?** | ✅ (via bridge) | ❌ No | ✅ Full |
| **Code quality at end** | 7/10 | 9/10 | 8/10 |
| **Testing coverage at end** | 60% | 85% | 70% |
| **Refactoring effort** | High | Very High | Medium |
| **Start immediately?** | ✅ Week 1 | ⚠️ After setup | ✅ Today |

---

## Recommendation Based on Constraints

### If you want **stability** + **quality**:
👉 **OPTION A (Gradual Refactor)**
- Steady progress, low risk
- Merge to develop weekly
- Takes longer but safer

### If you want **modern clean code** + **time to spare**:
👉 **OPTION B (Full ES6)**
- Best architecture long-term
- High effort upfront
- Worth it if > 2 year horizon

### If you want **quick wins** + **long-term improvement**:
👉 **OPTION C (Hybrid)** ← **RECOMMENDED**
- Facade works day 1 (0 breakage)
- New domains use clean pattern
- Can gradually modernize old code
- Most flexible approach

---

## Proof-of-Concept Candidates

### For OPTION A:
```
Categorize + test:
  ├─ Economy domain (10 files)
  ├─ Fleet domain (8 files)
  └─ War domain (12 files)  ← Most complex example
  
PoC effort: ~20 hours
Outcome: Proof that folder reorganization works
```

### For OPTION B:
```
Full rewrite:
  └─ Event domain (new, already clean)
  
PoC effort: ~5 hours (already done in previous session!)
Outcome: Show that clean ES6 + DI pattern works for GalaxyQuest
```

### For OPTION C:
```
Phase 1: Create GQGameFacade (~5h)
Phase 2: Wrap Event domain cleanly (~10h)
Phase 3: Bridge Economy domain (old code + new wrapper) (~10h)

PoC effort: ~25 hours (can be done in 3-4 days)
Outcome: Show facade + wrapper pattern works
```

---

## Next Steps (Depending on Choice)

### If OPTION A:
1. Create `/domains` folder structure
2. Move files (no code changes)
3. Update boot-manifest.js to load from new paths
4. Create GQGameFacade wrapper
5. Test each domain independently

### If OPTION B:
1. Setup bundler (Vite/Webpack with TS)
2. Create ES6 module for Economy domain
3. Migrate test suite to new module system
4. Gradually convert remaining domains

### If OPTION C:
1. Create GQGameFacade (TODAY, 5 hours)
2. Modernize Event domain internals (optional)
3. Gradually wrap each domain with DI pattern
4. Incrementally refactor insides of old controllers

---

**Questions to Answer Before Committing:**

1. **What's the timeline pressure?** (OPTION C if urgent, OPTION A if medium, OPTION B if long-term)
2. **Who will do the work?** (OPTION A if small team, OPTION B if large dedicated team, OPTION C if mixed)
3. **How risk-averse is the team?** (OPTION C if very, OPTION A if medium, OPTION B if confident)
4. **Will we need to maintain old code in parallel?** (OPTION C yes, OPTION A maybe, OPTION B no)

---

**Created:** 2026-08-01  
**Status:** Exploration Phase (Ready for decision)
