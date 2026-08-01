# ⚡ OPTION B PRACTICAL – Full ES6 Migration (Pragmatic)

**Ansatz:** Nutze deine eigene Component-Architektur (UIElement, getTemplate, _rerenderSection, this.state). Kein React, kein Abstraktion. Pure ES6 Module mit deinem bestehenden UI-Pattern.

**GalaxyQuest Style:**
- Klassen-basierte UI Components
- Template-Strings (kein JSX)
- Observer Pattern (`onStateChange()`)
- Selektive Rerender (`_rerenderSection()`)
- Fluent DOM API (`add()`, `addClass()`, etc.)

---

## Phase 1: Basic Setup (Week 1, ~10 hours)

### 1.1 Vite installieren & minimal konfigurieren

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

Fertig. Das ist genug.

### 1.2 HTML Entry Point

```html
<!-- index.html -->
<body>
  <div id="app"></div>
  <script type="module" src="js/main.js"></script>
</body>
```

### 1.3 Keep Current Structure + Convert to ES6 Modules

```
js/
├─ main.js                    [Initialization]
├─ gq-ui.js                   [UIElement base class – exists]
├─ api.js                     [API wrapper]
├─ domains/
│  ├─ economy/
│  │  ├─ EconomyController.js [Business logic]
│  │  ├─ EconomyUI.js         [Rendering – convert to ES6]
│  │  └─ __index.js           [Exports]
│  ├─ fleet/
│  │  ├─ FleetController.js
│  │  ├─ FleetUI.js
│  │  └─ __index.js
│  ├─ ... (10 more domains)
```

**Eure bestehende Architektur is bereits gut!** Das Ziel: In ES6 Module konvertieren (derzeit IIFE).

---

## Phase 2: Convert One Domain – Economy (Week 1, ~5 hours)

**OLD (IIFE):**
```javascript
// js/runtime/RuntimeEconomyController.js (OLD, 800+ lines)
(function () {
  const controller = { ... };
  window.GQRuntimeEconomyController = controller;
})();
```

**NEW (ES6 Module):**

```javascript
// js/domains/economy.js
import { api } from '../api.js';

let state = {
  economy: null,
  policies: {},
  loading: false,
};

export async function loadEconomy() {
  state.loading = true;
  state.economy = await api.get('/api/economy');
  state.loading = false;
  return state.economy;
}

export async function updatePolicies(policies) {
  const response = await api.post('/api/economy/policies', { policies });
  state.policies = response.policies;
  return response;
}

export function getState() {
  return { ...state };
}

export function createEconomyPanel() {
  const section = document.createElement('section');
  section.className = 'economy-window';
  
  const title = document.createElement('h2');
  title.textContent = 'Economy';
  section.appendChild(title);
  
  const income = document.createElement('p');
  income.textContent = `Income: ${state.economy?.income || 0}`;
  section.appendChild(income);
  
  const expenses = document.createElement('p');
  expenses.textContent = `Expenses: ${state.economy?.expenses || 0}`;
  section.appendChild(expenses);
  
  return section;
}
```

**That's it.** No class, no DI factory, no patterns. Just functions.

### 2.2 API Module (Shared)

```javascript
// js/api.js
export const api = {
  async get(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json();
  },
  
  async post(url, data) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json();
  },
};
```

### 2.3 Main Entry Point

```javascript
// js/main.js
import { loadEconomy, createEconomyPanel } from './domains/economy.js';
import { loadFleet, createFleetPanel } from './domains/fleet.js';
// ... import all 12 domains

// Simple init
async function boot() {
  await loadEconomy();
  await loadFleet();
  // ... load all domains
  
  // Render UI
  document.body.innerHTML += createEconomyPanel();
  document.body.innerHTML += createFleetPanel();
  // ... render all panels
}

boot().catch(console.error);

// Export for global access (if needed)
window.game = {
  economy: { loadEconomy, createEconomyPanel },
  fleet: { loadFleet, createFleetPanel },
};
```

**Total for economy domain: ~1-2 hours of actual refactoring.**

---

## Phase 3: Remaining 11 Domains (Week 2-6, ~60 hours)

Repeat same pattern for each:

```javascript
// js/domains/fleet.js
import { api } from '../api.js';

let state = { fleet: null };

export async function loadFleet() {
  state.fleet = await api.get('/api/fleet');
  return state.fleet;
}

export async function submitFleet(fleetData) {
  return api.post('/api/fleet/submit', fleetData);
}

export function createFleetPanel() {
  const section = document.createElement('section');
  section.className = 'fleet-window';
  
  const title = document.createElement('h2');
  title.textContent = 'Fleet';
  section.appendChild(title);
  
  // Add fleet items
  if (state.fleet) {
    state.fleet.forEach(ship => {
      const item = document.createElement('div');
      item.className = 'fleet-item';
      item.textContent = `${ship.name} (${ship.type})`;
      section.appendChild(item);
    });
  }
  
  return section;
}

// js/domains/war.js
import { api } from '../api.js';

let state = { wars: [] };

export async function loadWars() {
  state.wars = await api.get('/api/wars');
  return state.wars;
}

export async function declareWar(targetId) {
  return api.post('/api/wars/declare', { targetId });
}

export function createWarPanel() {
  const section = document.createElement('section');
  section.className = 'war-window';
  
  const title = document.createElement('h2');
  title.textContent = 'Wars';
  section.appendChild(title);
  
  state.wars.forEach(war => {
    const item = document.createElement('div');
    item.className = 'war-item';
    item.textContent = `War: ${war.name} (${war.status})`;
    section.appendChild(item);
  });
  
  return section;
}

// ... repeat for all 12 domains
```

**Each domain is basically:**
- Import api
- Declare state (simple object)
- Export async functions to load/update
- Export function to render HTML
- That's it.

**Timeline:**
- Economy: 2h (done)
- Fleet: 1.5h
- War: 1.5h
- Research: 1h
- Colonization: 2h
- Galaxy: 5h (most complex)
- Alliance: 1h
- Diplomacy: 1h
- Market: 1h
- Espionage: 1.5h
- NPC: 2h
- Events: 1h

**Total: ~20-25 hours** (not 150h from fancy OPTION B)

---

## Phase 4: Event Bus (Optional, ~5 hours)

If domains need to communicate:

```javascript
// js/events.js
const listeners = {};

export function on(event, callback) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(callback);
}

export function emit(event, data) {
  if (listeners[event]) {
    listeners[event].forEach(cb => cb(data));
  }
}
```

Usage:
```javascript
// js/domains/economy.js
import { emit } from '../events.js';

export async function updatePolicies(policies) {
  const response = await api.post('/api/economy/policies', { policies });
  emit('economy:policy-changed', { policies: response.policies });
  return response;
}

// js/domains/fleet.js
import { on } from '../events.js';

on('economy:policy-changed', ({ policies }) => {
  if (policies.maintenance_budget) {
    updateFleetBudget(policies.maintenance_budget);
  }
});
```

---

## Phase 5: Cleanup Old Code (Week 7, ~10 hours)

Delete all old `RuntimeXxxxController.js` files.  
Update index.html to use Vite entry point instead.

---

## Production Build

```bash
npm run build
```

Output: `dist/` folder with minified bundle.

---

## Total Effort: ~60-80 hours (3-4 weeks)

Not 12 weeks, not abstract patterns. Just plain ES6 modules + functions.

---

## What you get

✅ All 12 domains in ES6 modules  
✅ No global namespace pollution  
✅ Tree-shaking friendly (bundler removes unused code)  
✅ Easy to test (just import functions)  
✅ Easy to debug (real file structure)  
✅ No fancy DI or factory patterns  
✅ Just functions that work  

---

## Testing (Optional)

If you want tests, it's simple:

```javascript
// tests/domains/economy.test.js
import { loadEconomy, getState, createEconomyPanel } from '../../js/domains/economy.js';

// Mock fetch
global.fetch = async (url) => ({
  ok: true,
  json: async () => ({ income: 1000, expenses: 500 }),
});

// Mock DOM for Node.js tests
class MockElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.className = '';
    this.textContent = '';
  }
  appendChild(child) { this.children.push(child); }
  createElement(tag) { return new MockElement(tag); }
}

global.document = {
  createElement: (tag) => new MockElement(tag),
};

async function testEconomy() {
  const economy = await loadEconomy();
  console.assert(economy.income === 1000, 'Income should be 1000');
  
  const panel = createEconomyPanel();
  console.assert(panel.tagName === 'section', 'Panel should be section');
  console.assert(panel.children.length > 0, 'Panel should have children');
  
  console.log('✅ Economy test passed');
}

testEconomy();
```

Run with Node:
```bash
node tests/domains/economy.test.js
```

---

## Next Step

Pick ONE domain (e.g., Events – simplest), migrate it this week.

Then repeat for the others.

No frameworks, no abstractions. Just working code.

**Ready?**
