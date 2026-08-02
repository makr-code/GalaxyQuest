# AI Context: Frontend Architecture – Vanilla JS + WebGPU/WebGL

**Status**: Established Best Practice  
**Last Updated**: 2026-08-02  
**Scope**: GalaxyQuest frontend design patterns & coding standards  
**Current SOC Score**: 3.6/10 → Target: 8/10

---

## 🎯 ARCHITEKTUR-ENTSCHEIDUNG: Warum Vanilla JS (Kein React/Vue)?

GalaxyQuest nutzt **bewusstes No-Framework Design**:

| Aspekt | Vanilla JS | React/Vue | Entscheidung |
|--------|-----------|----------|------------|
| **Bundle Size** | 50kb | 300kb+ | ✅ Vanilla (schneller Boot) |
| **3D Rendering (Three.js)** | Direkte Integration | Overhead-Layer nötig | ✅ Vanilla (niedrig-latency) |
| **Real-time Game Loop** | Native requestAnimationFrame | Zusätzliches Rendering | ✅ Vanilla (volle Kontrolle) |
| **Desktop UI** | Custom WM + components | DOM-heavy | ✅ Vanilla (custom window system) |
| **State Management** | Observable pattern | Redux/Pinia | ✅ Vanilla (explizit, leicht testbar) |
| **Learning Curve** | Mittel (Patterns wichtig) | Steil | ✅ Vanilla (Team-Expertise) |

**Kernprinzip**: Jede Zeile Code ist bewusst geschrieben, verstanden, optimiert für Game-Performance.

---

## ✅ WANN VANILLA JS NUTZEN (Frontend)

### Verantwortungen:
- UI-Rendering (Desktop-Fenster, Panels, Modals)
- Real-time 3D Graphics (WebGPU/WebGL über Three.js)
- Game State Management (Observable pattern)
- Event Routing (EventBus, Pub/Sub)
- Network Communication (HTTP Calls)
- Asset Loading & Caching (IndexedDB via Dexie)
- Audio Playback (Tone.js)

### Code Pattern:
```javascript
// ✅ GOOD: Layered architecture with clear responsibilities

// 1. MODEL LAYER (Pure data, no side effects)
class Economy {
  constructor(state = {}) {
    this.taxRate = state.taxRate ?? 5;
    this.gdp = state.gdp ?? 100000;
  }
  
  setTaxRate(value) {
    if (value < 0 || value > 100) throw new Error('Invalid tax rate');
    this.taxRate = value;
    return this;  // Allow chaining
  }
  
  calculateRevenue() {
    return this.gdp * (this.taxRate / 100);
  }
}

// 2. CONTROLLER LAYER (Business logic, orchestration)
class EconomyController {
  constructor(deps = {}) {
    this.economy = deps.economy ?? new Economy();
    this.eventBus = deps.eventBus;
    this.db = deps.db;  // Dependency Injection
    this.listeners = [];
  }
  
  updateTaxRate(newRate) {
    this.economy.setTaxRate(newRate);
    
    // Persist to DB (async, but don't wait)
    this.db.update('economy', this.economy.toJSON()).catch(err => {
      console.error('DB update failed:', err);
    });
    
    // Notify subscribers
    this._notifyListeners('taxRateChanged', { rate: newRate });
    
    // Emit to EventBus (for other systems)
    this.eventBus.emit('game:economy:taxRateChanged', { rate: newRate });
  }
  
  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  
  _notifyListeners(event, data) {
    this.listeners.forEach(listener => listener({ event, data }));
  }
}

// 3. VIEW LAYER (Rendering, event binding)
class EconomyUI {
  constructor(container, deps = {}) {
    this.container = container;
    this.controller = deps.controller;
    this.render();
    this._bindEvents();
  }
  
  render() {
    const { taxRate, gdp } = this.controller.economy;
    const revenue = this.controller.economy.calculateRevenue();
    
    this.container.innerHTML = `
      <div class="economy-panel">
        <h3>Economy</h3>
        <div class="tax-rate">
          Tax Rate: <input type="number" id="taxRateInput" value="${taxRate}">%
        </div>
        <div class="gdp">GDP: ${gdp.toLocaleString()}</div>
        <div class="revenue">Annual Revenue: ${revenue.toLocaleString()}</div>
      </div>
    `;
  }
  
  _bindEvents() {
    this.container.querySelector('#taxRateInput').addEventListener('change', (e) => {
      try {
        this.controller.updateTaxRate(parseInt(e.target.value));
        this.render();  // Update UI after change
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
    
    // Subscribe to controller changes
    this.unsubscribe = this.controller.subscribe(({ event, data }) => {
      if (event === 'taxRateChanged') {
        this.render();  // Re-render on change
      }
    });
  }
  
  destroy() {
    if (this.unsubscribe) this.unsubscribe();
    this.container.innerHTML = '';
  }
}

// 4. INITIALIZATION (Wire it all together)
const economy = new Economy({ taxRate: 5, gdp: 100000 });
const controller = new EconomyController({
  economy,
  eventBus: window.GQGame.eventBus,
  db: window.GQGame.indexedDB
});
const ui = new EconomyUI(document.getElementById('economy-panel'), {
  controller
});
```

---

## 🏗️ LAYER STRUCTURE (Layered Architecture)

```
┌─────────────────────────────────────────────────────┐
│ UI LAYER (Interactive Components)                   │
│ ├─ Desktop Windows (WMCore-based)                   │
│ ├─ Panels & Modals                                  │
│ ├─ Theme Manager (Colors, Fonts, Layout)            │
│ └─ User Interactions (Click, Drag, Scroll)          │
└─────────────────┬───────────────────────────────────┘
                  │ (Pure callback passing)
┌─────────────────▼───────────────────────────────────┐
│ CONTROLLER LAYER (Business Logic)                   │
│ ├─ EconomyController (Taxes, GDP, Trade)            │
│ ├─ FleetController (Movement, Targeting)            │
│ ├─ ResearchController (Tech Tree)                   │
│ ├─ DiplomacyController (Alliances, Wars)            │
│ └─ SelectionController (Selection State)            │
│                                                      │
│ Rules: Pure logic, no DOM access, testable          │
└─────────────────┬───────────────────────────────────┘
                  │ (Emit events)
┌─────────────────▼───────────────────────────────────┐
│ MODEL LAYER (Data Structures)                       │
│ ├─ Economy (taxRate, gdp, revenue)                  │
│ ├─ Fleet (ships, position, health)                  │
│ ├─ Planet (resources, population, buildings)        │
│ ├─ Diplomacy (relations, treaties, wars)            │
│ └─ Selection (selectedObject, multiSelect)          │
│                                                      │
│ Rules: Pure data, simple getters/setters            │
└─────────────────┬───────────────────────────────────┘
                  │ (JSON serialization)
┌─────────────────▼───────────────────────────────────┐
│ PERSISTENCE LAYER (Storage)                         │
│ ├─ IndexedDB (Dexie.js)                             │
│ ├─ LocalStorage (User preferences)                  │
│ ├─ Memory Cache (Hot data)                          │
│ └─ Backend API (HTTP calls)                         │
└─────────────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ RENDERING ENGINE (3D & 2D)                          │
│ ├─ Three.js (3D objects, camera, lights)            │
│ ├─ WebGPU/WebGL Renderer                            │
│ ├─ Material System (PBR, shaders)                   │
│ ├─ Particle Systems (VFX)                           │
│ └─ Post-Effects (Bloom, SSAO)                       │
│                                                      │
│ Rules: No game logic, pure visualization            │
└─────────────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ GAME LOOP (Coordinator)                             │
│ ├─ requestAnimationFrame (60 FPS)                   │
│ ├─ System Registry (Update order)                   │
│ ├─ Event Bus (Pub/Sub)                              │
│ └─ Asset Registry (Resource tracking)               │
└─────────────────────────────────────────────────────┘
```

---

## 🚨 ANTI-PATTERNS: Was NICHT tun

### ❌ 1. Rendering + Logic Mix
```javascript
// FALSCH: UI und Logik vermischt
class EconomyPanel {
  render() {
    this.container.innerHTML = `<input id="tax">`;
    document.getElementById('tax').addEventListener('change', (e) => {
      // HIER ist die Geschäftslogik! → Nicht testbar
      this.state.gdp = this.state.gdp * (1 - e.target.value / 100);
      this.state.taxRate = e.target.value;
      this.render();  // Unendliche Schleife?
    });
  }
}
```

**Fix**: Separate Model, Controller, UI
```javascript
// ✅ RICHTIG: Klare Trennung
const model = new Economy();
const controller = new EconomyController({ economy: model });
const ui = new EconomyUI(container, { controller });
```

### ❌ 2. Global Window Pollution
```javascript
// FALSCH: Alles auf window
window.economyController = new EconomyController();
window.fleetController = new FleetController();
window.diplomacyController = new DiplomacyController();
// → 180+ window.GQRuntime* Namespace-Einträge!
// → Zirkkuläre Abhängigkeiten
// → Schwer zu debuggen
```

**Fix**: Dependency Injection
```javascript
// ✅ RICHTIG: Zentral initialisieren
const gameInstance = new GameEngine({
  economy: new EconomyController(),
  fleet: new FleetController(),
  diplomacy: new DiplomacyController()
});
// Zugriff nur über: gameInstance.systems.economy
```

### ❌ 3. Synchrone Rendering in Event-Listeners
```javascript
// FALSCH: Blocking render auf jedem Input
document.getElementById('taxRate').addEventListener('input', (e) => {
  this.controller.updateTaxRate(e.target.value);
  this.render();  // Kann zu jank führen
});
```

**Fix**: RequestAnimationFrame batching
```javascript
// ✅ RICHTIG: Render in nächstem Frame
let pendingRender = false;
document.getElementById('taxRate').addEventListener('input', (e) => {
  this.controller.updateTaxRate(e.target.value);
  
  if (!pendingRender) {
    pendingRender = true;
    requestAnimationFrame(() => {
      this.render();
      pendingRender = false;
    });
  }
});
```

### ❌ 4. Large Monolithic Controllers
```javascript
// FALSCH: 900-line RuntimeEconomyFleetDiplomacyController
class RuntimeEconomyFleetDiplomacyController {
  // Alles in einer Datei: Economy + Fleet + Diplomacy + UI Updates
  // → Unmöglich zu testen
  // → Circular dependencies
  // → Änderungen brechen andere Systeme
}
```

**Fix**: One Responsibility
```javascript
// ✅ RICHTIG: Eine Datei = Ein System
class EconomyController { /* nur Economy */ }
class FleetController { /* nur Fleet */ }
class DiplomacyController { /* nur Diplomacy */ }
// Jede Klasse ~100-200 Zeilen, leicht zu verstehen
```

---

## 🔄 STATE MANAGEMENT (Observable Pattern)

### Single Source of Truth:
```javascript
// ✅ GOOD: One state object, multiple observers
class GameState {
  constructor() {
    this.state = {
      economy: { taxRate: 5, gdp: 100000 },
      fleet: { ships: [], position: [0, 0] },
      selection: { type: null, objectId: null }
    };
    this.observers = [];
  }
  
  subscribe(observer) {
    this.observers.push(observer);
    return () => {
      this.observers = this.observers.filter(o => o !== observer);
    };
  }
  
  updateState(path, value) {
    // Update state at path (e.g., 'economy.taxRate')
    this._setNestedValue(this.state, path.split('.'), value);
    
    // Notify all observers
    this.observers.forEach(observer => {
      observer({ path, value, state: this.state });
    });
  }
  
  _setNestedValue(obj, keys, value) {
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  }
}

// Usage:
const gameState = new GameState();
gameState.subscribe(({ path, value }) => {
  if (path === 'economy.taxRate') {
    ui.updateTaxDisplay(value);
  }
});

gameState.updateState('economy.taxRate', 10);  // Notifies all observers
```

---

## 🧪 TESTING STRATEGY

### Unit Tests (Pure Logic):
```javascript
// tests/unit/EconomyController.test.js
import { describe, it, expect } from 'vitest';
import { Economy } from '../../js/engine/game/Economy';
import { EconomyController } from '../../js/engine/runtime/EconomyController';

describe('EconomyController', () => {
  it('should calculate revenue correctly', () => {
    const economy = new Economy({ taxRate: 10, gdp: 100000 });
    const controller = new EconomyController({ economy });
    
    expect(controller.economy.calculateRevenue()).toBe(10000);
  });
  
  it('should reject invalid tax rates', () => {
    const controller = new EconomyController();
    
    expect(() => controller.updateTaxRate(-5)).toThrow();
    expect(() => controller.updateTaxRate(150)).toThrow();
  });
});
```

### Integration Tests (UI + Logic):
```javascript
// tests/integration/economy-panel.test.js
describe('EconomyUI', () => {
  it('should render and respond to input', async () => {
    const container = document.createElement('div');
    const economy = new Economy({ taxRate: 5, gdp: 100000 });
    const controller = new EconomyController({ economy });
    const ui = new EconomyUI(container, { controller });
    
    const input = container.querySelector('#taxRateInput');
    input.value = '10';
    input.dispatchEvent(new Event('change'));
    
    expect(controller.economy.taxRate).toBe(10);
  });
});
```

### E2E Tests (Full Workflow):
```javascript
// tests/e2e/economy-workflow.spec.js
import { test, expect } from '@playwright/test';

test('Economy panel workflow', async ({ page }) => {
  await page.goto('http://localhost:8080');
  
  // Open economy panel
  await page.click('[data-panel="economy"]');
  
  // Change tax rate
  await page.fill('#taxRateInput', '15');
  await page.dispatchEvent('#taxRateInput', 'change');
  
  // Verify update
  const revenue = await page.locator('.revenue').textContent();
  expect(revenue).toContain('15000');  // 100000 * 0.15
});
```

---

## 🎨 RENDERING BEST PRACTICES

### 3D Rendering (Three.js):
```javascript
// ✅ GOOD: Decoupled renderer
class Galaxy3DRenderer {
  constructor(canvas, config = {}) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGPURenderer({ canvas });
    this.camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height);
    
    this.objects = new Map();  // Track scene objects
  }
  
  addObject(id, meshData) {
    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints(meshData.vertices);
    const material = new THREE.MeshStandardMaterial(meshData.material);
    const mesh = new THREE.Mesh(geometry, material);
    
    this.scene.add(mesh);
    this.objects.set(id, mesh);
  }
  
  updateObject(id, transform) {
    const obj = this.objects.get(id);
    if (obj) {
      obj.position.copy(transform.position);
      obj.rotation.copy(transform.rotation);
    }
  }
  
  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

// ✅ GOOD: Selection overlay (separate system)
class SelectionMarkerSystem {
  constructor(renderer, gameState) {
    this.renderer = renderer;
    this.gameState = gameState;
    this.selectedMarker = null;
    
    this.gameState.subscribe(({ path, value }) => {
      if (path === 'selection.objectId') {
        this._updateSelectionMarker(value);
      }
    });
  }
  
  _updateSelectionMarker(objectId) {
    if (this.selectedMarker) {
      this.renderer.scene.remove(this.selectedMarker);
    }
    
    if (objectId) {
      const targetObj = this.renderer.objects.get(objectId);
      if (targetObj) {
        this.selectedMarker = new THREE.BoxHelper(targetObj, 0x00ff00);
        this.renderer.scene.add(this.selectedMarker);
      }
    }
  }
}
```

---

## 📚 DESIGN PATTERNS

| Pattern | Use Case | Example |
|---------|----------|---------|
| **Observable** | State changes | GameState, EventBus |
| **Facade** | Simplify complex subsystems | GameEngine (hides Layer coordination) |
| **Factory** | Create objects variably | RendererFactory (WebGPU vs WebGL) |
| **Strategy** | Swap algorithms at runtime | Pathfinding algorithms |
| **Singleton** | Single shared instance | GameEngine, EventBus |
| **Dependency Injection** | Decouple components | Controllers receive deps in constructor |

---

## 📋 CODING STANDARDS

### JavaScript Best Practices:
- ✅ **Class-based** for Controllers, Models, UI
- ✅ **Type hints in JSDoc** for clarity
- ✅ **Pure functions** for calculations (no side effects)
- ✅ **Async/await** for I/O (network, storage)
- ✅ **const/let** only (no var)
- ✅ **Dependency Injection** in constructors
- ✅ **Error handling** with try/catch and logging
- ✅ **No console.log** in production (use logger)

### File Structure:
```
js/
├─ api/                    # Network communication
│  ├─ api.js               # Main facade
│  ├─ APITransport.js      # Low-level HTTP
│  └─ APICache.js          # Response caching
├─ engine/
│  ├─ GameEngine.js        # Main coordinator
│  ├─ EventBus.js          # Pub/Sub
│  ├─ SystemRegistry.js    # Update pipeline
│  ├─ game/                # Game simulations
│  │  ├─ Economy.js
│  │  ├─ Fleet.js
│  │  └─ ...
│  └─ runtime/             # Controllers
│     ├─ EconomyController.js
│     ├─ FleetController.js
│     └─ ...
├─ rendering/              # 3D rendering
│  ├─ Galaxy3DRenderer.js
│  ├─ SelectionMarkerSystem.js
│  └─ ...
├─ ui/                     # UI components
│  ├─ EconomyUI.js
│  ├─ FleetUI.js
│  └─ ...
└─ services/               # Utilities
   ├─ logger.js
   ├─ validator.js
   └─ ...
```

---

## 🔐 SECURITY CONSIDERATIONS

### Input Validation:
```javascript
// ✅ GOOD: Validate at every layer
class TaxValidator {
  static validate(value) {
    if (typeof value !== 'number') throw new TypeError('Must be number');
    if (value < 0 || value > 100) throw new RangeError('Must be 0-100');
    return value;
  }
}

// In Controller:
updateTaxRate(value) {
  const validated = TaxValidator.validate(value);
  // ... now safe to use
}

// In UI event listener:
input.addEventListener('change', (e) => {
  try {
    this.controller.updateTaxRate(parseInt(e.target.value));
  } catch (err) {
    this.showError(err.message);
  }
});
```

### XSS Prevention:
```javascript
// ❌ FALSCH: Direktes innerHTML mit user input
const userName = response.user_name;  // Potentially malicious
this.container.innerHTML = `<h1>${userName}</h1>`;  // XSS!

// ✅ RICHTIG: textContent für Text
const userName = response.user_name;
const heading = document.createElement('h1');
heading.textContent = userName;  // Safe!
this.container.appendChild(heading);
```

---

## 📊 PERFORMANCE TARGETS

| Metric | Target | Typical | Notes |
|--------|--------|---------|-------|
| Initial Load | <2s | 1.8s | No 3D rendering |
| 3D Renderer Init | <3s | 2.5s | WebGPU compilation |
| Frame Rate | 60 FPS | 58-60 FPS | Smooth gameplay |
| Memory Usage | <200MB | 150-180MB | IndexedDB + assets |
| Network Latency | <100ms | 50-80ms | API calls |

### Optimization Checklist:
- [ ] Minimize bundle size (tree-shake unused code)
- [ ] Lazy load non-critical assets
- [ ] Use IndexedDB for offline caching
- [ ] Implement virtual scrolling for long lists
- [ ] Batch DOM updates (use requestAnimationFrame)
- [ ] Debounce expensive operations (resize, scroll)
- [ ] Profile with DevTools before optimizing

---

## ✅ CHECKLIST FOR NEW FRONTEND FEATURE

- [ ] Is this a UI component, controller logic, or model data?
- [ ] Which layer does it belong in (UI/Controller/Model)?
- [ ] Are inputs validated at the boundary?
- [ ] Is business logic testable (pure functions)?
- [ ] Are there circular dependencies or global state pollution?
- [ ] Does it work asynchronously (no blocking)?
- [ ] Is error handling in place (try/catch)?
- [ ] Are event subscribers cleaned up (no memory leaks)?
- [ ] Is rendering decoupled from logic (testable)?
- [ ] Can it fail gracefully without breaking other systems?

---

**Rule**: Keep layers separate, dependencies explicit, testing simple.  
**Value**: Clear architecture, easy debugging, reusable components, testable code.

---

**See also**:
- [AI_CONTEXT_JAVASCRIPT.md](AI_CONTEXT_JAVASCRIPT.md) – JavaScript coding patterns
- [JAVASCRIPT_ARCHITECTURE_ANALYSIS.md](../../JAVASCRIPT_ARCHITECTURE_ANALYSIS.md) – Deep dive into current architecture
- [AI_CONTEXT_BACKEND_ARCHITECTURE.md](AI_CONTEXT_BACKEND_ARCHITECTURE.md) – Frontend ↔ Backend communication
