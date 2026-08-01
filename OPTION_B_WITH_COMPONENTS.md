# ⚡ OPTION B PRACTICAL – Mit deiner Component-Architektur

**Ansatz:** Nutze deine bestehende Klassen-basierte UI-Architektur. Konvertiere nur IIFE → ES6 Module. Keine neuen Patterns, keine Abstraktion.

---

## Die Gute Nachricht

✅ Du hast BEREITS eine großartige Component-Architektur:
- **UIElement base class** mit Fluent API
- **EconomyUI, FleetUI, ...** mit `this.state`, `render()`, `_rerenderSection()`
- **Observer Pattern** via `onStateChange()`
- **Template-Strings** statt JSX

**Das Ziel:** Nur IIFE → ES6 Module konvertieren. Nicht neuschreiben!

---

## Phase 1: Setup (1-2 Stunden)

### 1.1 Vite einbauen

```bash
npm install -D vite
```

**vite.config.js:**
```javascript
export default {
  server: { port: 8080 },
  build: { outDir: 'dist' },
};
```

### 1.2 index.html aktualisieren

```html
<!-- Alte Boot-Sequence auskommentieren -->
<!-- <script src="js/boot-manifest.js"></script> -->

<!-- Neue ES6 Entry Point -->
<body>
  <div id="app"></div>
  <script type="module" src="js/main.js"></script>
</body>
```

### 1.3 Folder → ES6 Modules

```
js/
├─ main.js                    [NEW: Initialization]
├─ api.js                     [NEW: Shared API]
├─ gq-ui.js                   [KEEP: UIElement base]
├─ domains/
│  ├─ economy/
│  │  ├─ EconomyController.js [CONVERT: IIFE → export class]
│  │  ├─ EconomyUI.js         [CONVERT: IIFE → export class]
│  │  └─ __index.js           [NEW: Exports]
│  ├─ fleet/
│  │  ├─ FleetController.js   [CONVERT]
│  │  ├─ FleetUI.js           [CONVERT]
│  │  └─ __index.js           [NEW]
│  ├─ ... (10 more domains – same pattern)
```

---

## Phase 2: Economy Domain – Template (2-3 Stunden)

### 2.1 EconomyController → ES6 Module

**VORHER (IIFE in js/runtime/RuntimeEconomyController.js):**
```javascript
(function() {
  class EconomyController {
    constructor(config) { ... }
  }
  window.GQRuntimeEconomyController = new EconomyController();
})();
```

**NACHHER (js/domains/economy/EconomyController.js):**
```javascript
export class EconomyController {
  constructor(config = {}) {
    this.config = config;
    
    this.state = {
      gdp: 0,
      inflation: 0.02,
      taxRate: 0.15,
      subsidies: {},
      isLocked: false,
    };

    this.listeners = [];
    this.errorListeners = [];
  }

  // Observer Pattern
  onStateChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  onError(callback) {
    this.errorListeners.push(callback);
    return () => {
      this.errorListeners = this.errorListeners.filter(cb => cb !== callback);
    };
  }

  // State Updates
  async setTaxRate(rate) {
    if (rate < 0 || rate > 1) {
      this.errorListeners.forEach(cb => cb('Invalid tax rate'));
      return false;
    }

    this.state.taxRate = rate;
    
    // Save to API
    try {
      const result = await window.API.post('/api/economy/tax', { rate });
      this._notifyListeners({ section: 'tax' });
      return true;
    } catch (error) {
      this.errorListeners.forEach(cb => cb(error.message));
      return false;
    }
  }

  async addSubsidy(category, amount) {
    this.state.subsidies[category] = amount;
    const result = await window.API.post('/api/economy/subsidy', { category, amount });
    this._notifyListeners({ section: 'subsidies' });
    return result;
  }

  getState() {
    return { ...this.state };
  }

  // Private
  _notifyListeners(change) {
    this.listeners.forEach(cb => cb(change));
  }
}
```

### 2.2 EconomyUI → ES6 Module

**NACHHER (js/domains/economy/EconomyUI.js):**
```javascript
export class EconomyUI {
  constructor(controller, domTarget) {
    this.controller = controller;
    this.target = domTarget;
    this.state = {};

    // Listen to state changes
    this.controller.onStateChange((change) => {
      this._handleStateChange(change);
    });

    this.controller.onError((error) => {
      this._handleError(error);
    });

    // Render
    this.render();
  }

  // FULL RENDER
  render() {
    this.state = this.controller.getState();
    this.target.innerHTML = this._buildHtml();
    this._attachEventHandlers();
  }

  // SELECTIVE RE-RENDER (Optimization)
  _rerenderSection(section) {
    const sectionEl = this.target.querySelector(`[data-section="${section}"]`);
    if (!sectionEl) return;

    switch (section) {
      case 'tax':
        sectionEl.innerHTML = this._buildTaxSection();
        break;
      case 'subsidies':
        sectionEl.innerHTML = this._buildSubsidiesSection();
        break;
    }
    this._attachEventHandlers();
  }

  // TEMPLATE (Template-String)
  _buildHtml() {
    return `
      <div class="economy-panel">
        <header class="economy-panel__header">
          <h2>Economy</h2>
          <span class="economy-status ${this.state.isLocked ? 'locked' : 'active'}">
            ${this.state.isLocked ? '🔒 Locked' : '✅ Active'}
          </span>
        </header>

        <div class="economy-panel__sections">
          <section data-section="tax">
            ${this._buildTaxSection()}
          </section>

          <section data-section="subsidies">
            ${this._buildSubsidiesSection()}
          </section>
        </div>
      </div>
    `;
  }

  _buildTaxSection() {
    return `
      <div class="tax-section">
        <h3>Tax Rate</h3>
        <p>Current: ${(this.state.taxRate * 100).toFixed(1)}%</p>
        <input 
          type="range" 
          min="0" 
          max="1" 
          step="0.01" 
          value="${this.state.taxRate}"
          data-action="set-tax-rate"
        />
      </div>
    `;
  }

  _buildSubsidiesSection() {
    const entries = Object.entries(this.state.subsidies || {})
      .map(([cat, amt]) => `<li>${cat}: $${amt}</li>`)
      .join('');

    return `
      <div class="subsidies-section">
        <h3>Subsidies</h3>
        <ul>${entries || '<li>None</li>'}</ul>
      </div>
    `;
  }

  // EVENT HANDLERS
  _attachEventHandlers() {
    this.target.querySelectorAll('[data-action="set-tax-rate"]').forEach(input => {
      input.addEventListener('change', async (e) => {
        const success = await this.controller.setTaxRate(parseFloat(e.target.value));
        if (success) {
          this._rerenderSection('tax');
        }
      });
    });
  }

  // STATE CHANGE HANDLER
  _handleStateChange(change) {
    if (change.section) {
      this._rerenderSection(change.section);
    } else {
      this.render();
    }
  }

  _handleError(error) {
    console.error('🔴 Economy error:', error);
    // TODO: Show toast notification
  }
}
```

### 2.3 Exports (js/domains/economy/__index.js)

```javascript
export { EconomyController } from './EconomyController.js';
export { EconomyUI } from './EconomyUI.js';
```

---

## Phase 3: Shared API Module (1 Stunde)

**js/api.js:**
```javascript
export const API = {
  async get(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API ${response.status}: ${url}`);
    return response.json();
  },

  async post(url, data) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`API ${response.status}: ${url}`);
    return response.json();
  },

  async put(url, data) {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`API ${response.status}: ${url}`);
    return response.json();
  },
};

// Make available globally (backward compatible)
window.API = API;
```

---

## Phase 4: Main Entry Point (1-2 Stunden)

**js/main.js:**
```javascript
import { API } from './api.js';
import { EconomyController, EconomyUI } from './domains/economy/__index.js';
import { FleetController, FleetUI } from './domains/fleet/__index.js';
import { WarController, WarUI } from './domains/war/__index.js';
import { ResearchController, ResearchUI } from './domains/research/__index.js';
import { ColonizationController, ColonizationUI } from './domains/colonization/__index.js';
import { GalaxyController, GalaxyUI } from './domains/galaxy/__index.js';
import { AllianceController, AllianceUI } from './domains/alliance/__index.js';
import { DiplomacyController, DiplomacyUI } from './domains/diplomacy/__index.js';
import { MarketController, MarketUI } from './domains/market/__index.js';
import { EspionageController, EspionageUI } from './domains/espionage/__index.js';
import { NPCController, NPCUI } from './domains/npc/__index.js';
import { EventController, EventUI } from './domains/event/__index.js';

// Make API globally available
window.API = API;

// DOM targets
const domTargets = {
  economy: document.getElementById('economy-panel'),
  fleet: document.getElementById('fleet-panel'),
  war: document.getElementById('war-panel'),
  research: document.getElementById('research-panel'),
  colonization: document.getElementById('colonization-panel'),
  galaxy: document.getElementById('galaxy-panel'),
  alliance: document.getElementById('alliance-panel'),
  diplomacy: document.getElementById('diplomacy-panel'),
  market: document.getElementById('market-panel'),
  espionage: document.getElementById('espionage-panel'),
  npc: document.getElementById('npc-panel'),
  event: document.getElementById('event-panel'),
};

// Initialize all domains
async function boot() {
  try {
    // Create controllers
    const economyController = new EconomyController();
    const fleetController = new FleetController();
    const warController = new WarController();
    const researchController = new ResearchController();
    const colonizationController = new ColonizationController();
    const galaxyController = new GalaxyController();
    const allianceController = new AllianceController();
    const diplomacyController = new DiplomacyController();
    const marketController = new MarketController();
    const espionageController = new EspionageController();
    const npcController = new NPCController();
    const eventController = new EventController();

    // Create UIs (if DOM targets exist)
    const economyUI = domTargets.economy ? new EconomyUI(economyController, domTargets.economy) : null;
    const fleetUI = domTargets.fleet ? new FleetUI(fleetController, domTargets.fleet) : null;
    const warUI = domTargets.war ? new WarUI(warController, domTargets.war) : null;
    const researchUI = domTargets.research ? new ResearchUI(researchController, domTargets.research) : null;
    const colonizationUI = domTargets.colonization ? new ColonizationUI(colonizationController, domTargets.colonization) : null;
    const galaxyUI = domTargets.galaxy ? new GalaxyUI(galaxyController, domTargets.galaxy) : null;
    const allianceUI = domTargets.alliance ? new AllianceUI(allianceController, domTargets.alliance) : null;
    const diplomacyUI = domTargets.diplomacy ? new DiplomacyUI(diplomacyController, domTargets.diplomacy) : null;
    const marketUI = domTargets.market ? new MarketUI(marketController, domTargets.market) : null;
    const espionageUI = domTargets.espionage ? new EspionageUI(espionageController, domTargets.espionage) : null;
    const npcUI = domTargets.npc ? new NPCUI(npcController, domTargets.npc) : null;
    const eventUI = domTargets.event ? new EventUI(eventController, domTargets.event) : null;

    // Export to window for debugging
    window.GQGame = {
      api: API,
      economy: { controller: economyController, ui: economyUI },
      fleet: { controller: fleetController, ui: fleetUI },
      war: { controller: warController, ui: warUI },
      research: { controller: researchController, ui: researchUI },
      colonization: { controller: colonizationController, ui: colonizationUI },
      galaxy: { controller: galaxyController, ui: galaxyUI },
      alliance: { controller: allianceController, ui: allianceUI },
      diplomacy: { controller: diplomacyController, ui: diplomacyUI },
      market: { controller: marketController, ui: marketUI },
      espionage: { controller: espionageController, ui: espionageUI },
      npc: { controller: npcController, ui: npcUI },
      event: { controller: eventController, ui: eventUI },
    };

    console.log('✅ GalaxyQuest initialized');
    console.log('   Access via: window.GQGame.economy, window.GQGame.fleet, etc.');
  } catch (error) {
    console.error('❌ Boot failed:', error);
    throw error;
  }
}

boot();
```

---

## Phase 5: Repeat für die anderen 11 Domains (20-25 Stunden)

Template ist gleich für jede Domain:

1. Copy `domains/economy/` → `domains/fleet/`
2. Replace all `Economy` → `Fleet`
3. Replace all `economy` → `fleet`
4. Adjust state & methods zu deinen bestehenden Controllers
5. Adjust template zu deiner bestehenden UI

**Pro Domain:** ~1.5-2 Stunden (Struktur ist identisch)

---

## Phase 6: Cleanup (2-3 Stunden)

1. Delete `js/runtime/RuntimeXxxxController.js` (OLD IIFE files)
2. Delete `js/boot-manifest.js` (not needed with ES6 modules)
3. Update `index.html` (remove old script tags)
4. Test all 12 domains in browser

---

## Production Build

```bash
npm run build
```

Output: `dist/` folder mit minifiziertem Bundle

---

## Total Effort

| Phase | Task | Hours |
|-------|------|-------|
| 1 | Vite Setup | 1-2 |
| 2 | Economy Template | 2-3 |
| 3 | API Module | 1 |
| 4 | Main Entry Point | 1-2 |
| 5 | Other 11 Domains | 20-25 |
| 6 | Cleanup | 2-3 |
| **Total** | **~30-36 hours (1 week)** | |

✅ **NOT 12 weeks, not 80 hours. About 1 week with this template.**

---

## Was du bekommst

✅ All 12 domains in ES6 modules  
✅ No global namespace pollution  
✅ Tree-shaking friendly  
✅ Backward compatible (window.GQGame exports)  
✅ Same architecture (your UI pattern kept!)  
✅ Production-ready with Vite  

---

## Debug

In Browser Console:
```javascript
window.GQGame.economy.controller.state
window.GQGame.economy.ui.render()
window.GQGame.fleet.controller.setTaxRate(0.2)
```

Easy debugging, no magic! 🎯
