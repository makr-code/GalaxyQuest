# 🚀 OPTION B: Radikal – Full ES6 Module Transformation

**Entscheidungsdatum:** 2026-08-01  
**Strategie:** Kompletter Rewrite zu modernem ES6+ mit Dependency Injection  
**Timeline:** 8-12 Wochen | **Effort:** ~265 Stunden

---

## Überblick

**Kernidee:** 
```
Von:  window.GQRuntimeXxx (180+ global objects)
  ↓
Zu:   Importable ES6 modules mit explizitem dependency injection
```

**Result:** Saubere, testbare, moderne Architektur mit Bundler-Optimierung.

---

## Phase 1: Infrastructure Setup (Week 1-2, ~40 hours)

### 1.1 Wähle Bundler

**Optionen:**
- **Vite** (empfohlen) – Schnell, ES6-native, dev server mit HMR
- **Webpack 5** – Mature, aber komplexer
- **Esbuild** – Ultra-schnell, aber weniger features

**Für GalaxyQuest: Vite** (TypeScript optional, aber es geht auch ohne)

### 1.2 Vite-Setup

```bash
# Initialisierung
npm install -D vite @vitejs/plugin-legacy

# vite.config.js
export default {
  server: {
    port: 8080,
    strictPort: false,
    cors: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['three', 'tone'],
          'core': ['./js/engine/core/index.js'],
          'domains': ['./js/engine/runtime/index.js'],
        },
      },
    },
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV === 'development'),
  },
};
```

### 1.3 Entry Point (HTML)

```html
<!-- index.html (NEW) -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GalaxyQuest</title>
  <link rel="stylesheet" href="css/index.css">
</head>
<body>
  <div id="app"></div>
  
  <!-- Single entry point (Vite handles bundling) -->
  <script type="module" src="js/index.js"></script>
</body>
</html>
```

### 1.4 New Folder Structure

```
js/
├─ index.js                          [Main entry point]
├─ core/
│  ├─ index.js                       [Core exports]
│  ├─ EventBus.js
│  ├─ SystemRegistry.js
│  ├─ GameLoop.js
│  ├─ Logger.js
│  └─ State.js
├─ network/
│  ├─ index.js
│  ├─ APIClient.js
│  ├─ APITransport.js
│  ├─ APICache.js
│  └─ APIQueue.js
├─ rendering/
│  ├─ index.js
│  ├─ RendererFactory.js
│  ├─ WebGPURenderer.js
│  ├─ WebGLRenderer.js
│  └─ GraphicsContext.js
├─ ui/
│  ├─ index.js
│  ├─ WindowManager.js
│  ├─ ThemeManager.js
│  └─ components/
│      ├─ Button.js
│      ├─ Panel.js
│      └─ ...
├─ engine/
│  ├─ index.js                       [Main game engine export]
│  └─ runtime/
│      ├─ index.js                   [Domain exports]
│      └─ domains/
│          ├─ economy/
│          │  ├─ index.js
│          │  ├─ controller.js
│          │  ├─ calculations.js
│          │  ├─ events.js
│          │  └─ ui/
│          ├─ fleet/
│          ├─ war/
│          ├─ research/
│          ├─ colonization/
│          ├─ galaxy/
│          ├─ alliances/
│          ├─ diplomacy/
│          ├─ market/
│          ├─ espionage/
│          ├─ npc/
│          └─ events/
└─ bootstrap/
   ├─ auth.js
   ├─ prolog.js
   └─ initialize.js
```

### 1.5 Configuration Files

```javascript
// js/core/Config.js
export const CONFIG = {
  api: {
    baseURL: process.env.VITE_API_URL || 'http://localhost:8080/api',
    timeout: 30000,
    retries: 3,
  },
  rendering: {
    enableWebGPU: true,
    fallbackToWebGL: true,
    quality: 'high',
  },
  logging: {
    level: __DEV__ ? 'debug' : 'info',
  },
};

export const ENV = {
  isDev: __DEV__,
  isProduction: !__DEV__,
  version: process.env.VITE_APP_VERSION || '0.0.1',
};
```

### 1.6 Logger Abstraction

```javascript
// js/core/Logger.js
export class Logger {
  constructor(namespace) {
    this.namespace = namespace;
  }
  
  info(message, data) {
    console.log(`[${this.namespace}]`, message, data);
  }
  
  warn(message, data) {
    console.warn(`[${this.namespace}]`, message, data);
  }
  
  error(message, error) {
    console.error(`[${this.namespace}]`, message, error);
  }
  
  debug(message, data) {
    if (__DEV__) {
      console.debug(`[${this.namespace}]`, message, data);
    }
  }
}

export const createLogger = (namespace) => new Logger(namespace);
```

### 1.7 Event Bus

```javascript
// js/core/EventBus.js
export class EventBus {
  constructor() {
    this.listeners = new Map();
    this.eventHistory = [];
  }
  
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(callback);
    
    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(eventName);
      const index = callbacks.indexOf(callback);
      if (index > -1) callbacks.splice(index, 1);
    };
  }
  
  once(eventName, callback) {
    const unsubscribe = this.on(eventName, (data) => {
      callback(data);
      unsubscribe();
    });
    return unsubscribe;
  }
  
  emit(eventName, data) {
    // Store in history for debugging
    this.eventHistory.push({ event: eventName, data, timestamp: Date.now() });
    
    const callbacks = this.listeners.get(eventName);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(data);
        } catch (error) {
          console.error(`Error in event listener for ${eventName}:`, error);
        }
      });
    }
  }
  
  getHistory(limit = 100) {
    return this.eventHistory.slice(-limit);
  }
}
```

---

## Phase 2: Core Infrastructure (Week 2-3, ~30 hours)

### 2.1 Main Engine Entry Point

```javascript
// js/engine/index.js
import { EventBus } from '../core/EventBus.js';
import { Logger, createLogger } from '../core/Logger.js';
import { SystemRegistry } from '../core/SystemRegistry.js';
import { GameLoop } from '../core/GameLoop.js';
import { APIClient } from '../network/index.js';
import { RendererFactory } from '../rendering/index.js';
import { WindowManager } from '../ui/WindowManager.js';
import { CONFIG } from '../core/Config.js';

export class GQGameEngine {
  constructor(options = {}) {
    this.logger = createLogger('GQGameEngine');
    
    // Core systems
    this.eventBus = options.eventBus || new EventBus();
    this.apiClient = options.apiClient || new APIClient(CONFIG.api, this.eventBus);
    this.systemRegistry = new SystemRegistry(this.eventBus);
    this.gameLoop = new GameLoop(this.systemRegistry, this.eventBus);
    
    // UI & Rendering
    this.windowManager = new WindowManager(this.eventBus);
    this.renderer = options.renderer || RendererFactory.create(CONFIG.rendering);
    
    // Domains (will be loaded)
    this.domains = {};
    
    this.logger.info('Engine initialized');
  }
  
  async initialize() {
    this.logger.info('Initializing engine...');
    
    // Setup core systems
    await this.setupCoreEvents();
    
    // Load all domains
    await this.loadDomains();
    
    // Setup inter-domain bindings
    this.setupInterDomainBindings();
    
    this.logger.info('Engine ready');
    this.eventBus.emit('engine:ready', {});
  }
  
  async setupCoreEvents() {
    this.eventBus.on('engine:start', () => {
      this.gameLoop.start();
    });
    
    this.eventBus.on('engine:stop', () => {
      this.gameLoop.stop();
    });
  }
  
  async loadDomains() {
    // Dynamic imports for all domains
    const domains = [
      'economy',
      'fleet',
      'war',
      'research',
      'colonization',
      'galaxy',
      'alliances',
      'diplomacy',
      'market',
      'espionage',
      'npc',
      'events',
    ];
    
    for (const domainName of domains) {
      try {
        const { initializeDomain } = await import(
          `./runtime/domains/${domainName}/index.js`
        );
        
        this.domains[domainName] = await initializeDomain({
          eventBus: this.eventBus,
          apiClient: this.apiClient,
          logger: createLogger(domainName),
          systemRegistry: this.systemRegistry,
        });
        
        this.logger.info(`Loaded domain: ${domainName}`);
      } catch (error) {
        this.logger.error(`Failed to load domain: ${domainName}`, error);
      }
    }
  }
  
  setupInterDomainBindings() {
    // Example: Economy → Fleet coupling
    this.eventBus.on('economy:policy-changed', ({ policyId, value }) => {
      if (policyId === 'maintenance_budget') {
        const fleetDomain = this.domains.fleet;
        if (fleetDomain) {
          fleetDomain.controller.setMaintenanceBudget(value);
        }
      }
    });
  }
  
  // Public API
  getDomain(name) {
    return this.domains[name];
  }
  
  getController(domainName) {
    return this.domains[domainName]?.controller;
  }
}

export default GQGameEngine;
```

### 2.2 Main Index Entry Point

```javascript
// js/index.js
import GQGameEngine from './engine/index.js';
import { createLogger } from './core/Logger.js';

const logger = createLogger('Bootstrap');

async function main() {
  try {
    // Create and initialize engine
    const engine = new GQGameEngine();
    window.GQGame = engine;  // Single global
    
    await engine.initialize();
    
    // Start game loop
    window.GQGame.eventBus.emit('engine:start');
    
    logger.info('Game started');
  } catch (error) {
    logger.error('Failed to start game', error);
    throw error;
  }
}

// Wait for DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
```

**Effort:** ~15 hours (infrastructure, bundler config, logger/eventbus)  
**Risk:** 🟢 Low (foundational, no game logic yet)

---

## Phase 3: Domain Migration (Week 3-8, ~150 hours)

### 3.1 Domain Template

Each domain follows this structure:

```javascript
// js/engine/runtime/domains/economy/index.js
export async function initializeDomain({
  eventBus,
  apiClient,
  logger,
  systemRegistry,
}) {
  // Import sub-modules
  import { EconomyController } from './controller.js';
  import { EconomyCalculations } from './calculations.js';
  import { setupEvents } from './events.js';
  import { EconomyUI } from './ui/EconomyWindow.js';
  
  // Create domain controller
  const controller = new EconomyController({
    apiClient,
    logger,
  });
  
  // Create UI
  const ui = new EconomyUI(controller);
  
  // Setup event bindings
  setupEvents(controller, eventBus);
  
  // Register update system (optional)
  if (systemRegistry) {
    systemRegistry.register('economy-updates', async (dt) => {
      await controller.update(dt);
    });
  }
  
  return {
    name: 'economy',
    controller,
    ui,
    calculations: new EconomyCalculations(),
    lifecycle: {
      async onGameStart() {
        await controller.initialize();
        ui.show();
      },
      async onGameStop() {
        ui.hide();
        await controller.shutdown();
      },
    },
  };
}
```

### 3.2 Economy Domain (First to Migrate)

```javascript
// js/engine/runtime/domains/economy/controller.js
export class EconomyController {
  constructor({ apiClient, logger }) {
    this.apiClient = apiClient;
    this.logger = logger;
    this.state = {
      economy: null,
      policies: {},
      colonies: [],
      loading: false,
    };
  }
  
  async initialize() {
    this.logger.info('Economy controller initializing...');
    await this.loadEconomyData();
  }
  
  async loadEconomyData() {
    try {
      this.state.loading = true;
      const data = await this.apiClient.get('/api/economy');
      this.state.economy = data;
      return data;
    } catch (error) {
      this.logger.error('Failed to load economy data', error);
      throw error;
    } finally {
      this.state.loading = false;
    }
  }
  
  async updatePolicies(policies) {
    try {
      const response = await this.apiClient.post('/api/economy/policies', {
        policies,
      });
      this.state.policies = response.policies;
      return response;
    } catch (error) {
      this.logger.error('Failed to update policies', error);
      throw error;
    }
  }
  
  // Pure calculations (no side effects)
  calculateTaxRevenue(population, taxRate) {
    return population * taxRate * 0.1;  // Simplified
  }
  
  // Cleanup
  async shutdown() {
    this.logger.info('Economy controller shutting down');
    this.state = null;
  }
}

// js/engine/runtime/domains/economy/calculations.js
export class EconomyCalculations {
  // Pure functions, no state
  
  static calculateProductionOutput(workforce, tech, bonuses = {}) {
    const baseProd = workforce * tech;
    const bonus = Object.values(bonuses).reduce((a, b) => a + b, 0);
    return baseProd * (1 + bonus);
  }
  
  static calculateConsumption(population, tech) {
    return population * (1 + tech * 0.05);
  }
  
  static calculateBalance(income, expenses) {
    return income - expenses;
  }
}

// js/engine/runtime/domains/economy/events.js
export function setupEvents(controller, eventBus) {
  // Listen for policy changes
  eventBus.on('ui:policy-changed', async ({ policyId, value }) => {
    try {
      await controller.updatePolicies({ [policyId]: value });
      eventBus.emit('economy:policy-changed', {
        policyId,
        value,
        timestamp: Date.now(),
      });
    } catch (error) {
      eventBus.emit('error:economy-update', { error });
    }
  });
  
  // Listen for game start
  eventBus.on('engine:start', () => {
    eventBus.emit('economy:ready', {});
  });
}

// js/engine/runtime/domains/economy/ui/EconomyWindow.js
export class EconomyUI {
  constructor(controller) {
    this.controller = controller;
    this.visible = false;
  }
  
  show() {
    // Render economy window
    const html = this.render();
    document.body.insertAdjacentHTML('beforeend', html);
    this.visible = true;
  }
  
  hide() {
    const el = document.querySelector('.economy-window');
    if (el) el.remove();
    this.visible = false;
  }
  
  render() {
    const { economy } = this.controller.state;
    return `
      <section class="economy-window">
        <h2>Economy</h2>
        <div class="economy-stats">
          <p>Income: ${economy?.income || 0}</p>
          <p>Expenses: ${economy?.expenses || 0}</p>
        </div>
      </section>
    `;
  }
}
```

### 3.3 Migration Path per Domain

**Timeline per domain:**
- Extract from old codebase: ~3-4 hours
- Create new ES6 modules: ~5-7 hours
- Write tests: ~4-6 hours
- Debug/integrate: ~2-4 hours
- **Total per domain: ~15-20 hours**

**Order (complexity ascending):**
1. **Events** (simple, 5 files) → 15h
2. **Market** (simple, 5 files) → 15h
3. **Research** (medium, 8 files) → 20h
4. **Colonization** (medium, 12 files) → 25h
5. **Fleet** (medium, 8 files) → 20h
6. **Espionage** (medium, 9 files) → 20h
7. **Alliances** (medium, 6 files) → 18h
8. **Diplomacy** (medium, 9 files) → 20h
9. **NPC** (complex, 10 files) → 25h
10. **War** (complex, 12 files) → 30h
11. **Economy** (complex, 12 files) → 30h
12. **Galaxy** (most complex, 50+ files) → 50h

**Total domain migration: ~150 hours (spread over 5-6 weeks)**

---

## Phase 4: Testing Infrastructure (Week 3-8, ~40 hours)

### 4.1 Vitest Setup

```javascript
// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80,
    },
  },
});
```

### 4.2 Test Example

```javascript
// tests/engine/domains/economy/controller.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EconomyController } from '~/engine/runtime/domains/economy/controller.js';

describe('EconomyController', () => {
  let controller;
  let mockApiClient;
  let mockLogger;
  
  beforeEach(() => {
    mockApiClient = {
      get: vi.fn().mockResolvedValue({
        income: 1000,
        expenses: 500,
      }),
      post: vi.fn().mockResolvedValue({
        policies: { tax_rate: 0.2 },
      }),
    };
    
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    
    controller = new EconomyController({
      apiClient: mockApiClient,
      logger: mockLogger,
    });
  });
  
  it('should load economy data', async () => {
    await controller.loadEconomyData();
    
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/economy');
    expect(controller.state.economy.income).toBe(1000);
  });
  
  it('should handle API errors gracefully', async () => {
    mockApiClient.get.mockRejectedValueOnce(new Error('Network error'));
    
    await expect(() => controller.loadEconomyData()).rejects.toThrow('Network error');
    expect(mockLogger.error).toHaveBeenCalled();
  });
  
  it('should update policies', async () => {
    await controller.updatePolicies({ tax_rate: 0.2 });
    
    expect(mockApiClient.post).toHaveBeenCalledWith(
      '/api/economy/policies',
      { policies: { tax_rate: 0.2 } }
    );
  });
});

// tests/engine/domains/economy/calculations.test.js
import { describe, it, expect } from 'vitest';
import { EconomyCalculations } from '~/engine/runtime/domains/economy/calculations.js';

describe('EconomyCalculations', () => {
  it('should calculate production output correctly', () => {
    const output = EconomyCalculations.calculateProductionOutput(100, 1.5, {});
    expect(output).toBe(150);
  });
  
  it('should apply bonuses', () => {
    const output = EconomyCalculations.calculateProductionOutput(100, 1.5, {
      tech: 0.1,
      building: 0.05,
    });
    expect(output).toBe(150 * 1.15);  // 15% bonus
  });
});
```

---

## Phase 5: UI Component Hierarchy (Week 7-9, ~50 hours)

### 5.1 Component Architecture

```javascript
// js/ui/components/Button.js
export class Button {
  constructor(options = {}) {
    this.label = options.label || '';
    this.onClick = options.onClick || (() => {});
    this.disabled = options.disabled || false;
  }
  
  render() {
    return `
      <button class="btn" ${this.disabled ? 'disabled' : ''}>
        ${this.label}
      </button>
    `;
  }
  
  attach(container) {
    container.innerHTML = this.render();
    const btn = container.querySelector('.btn');
    btn.addEventListener('click', () => {
      if (!this.disabled) this.onClick();
    });
  }
}

// js/ui/components/Panel.js
export class Panel {
  constructor(options = {}) {
    this.title = options.title || 'Panel';
    this.children = options.children || [];
    this.onClose = options.onClose || (() => {});
  }
  
  render() {
    return `
      <section class="panel">
        <header class="panel-header">
          <h2>${this.title}</h2>
          <button class="close-btn">×</button>
        </header>
        <main class="panel-content">
          ${this.children.map(child => child.render()).join('')}
        </main>
      </section>
    `;
  }
  
  attach(container) {
    container.innerHTML = this.render();
    container.querySelector('.close-btn').addEventListener('click', () => {
      this.onClose();
      container.innerHTML = '';
    });
    
    this.children.forEach((child, i) => {
      const slot = container.querySelectorAll('.panel-content > *')[i];
      if (child.attach) child.attach(slot);
    });
  }
}

// js/ui/windows/economy/EconomyWindow.js
import { Panel } from '../../components/Panel.js';
import { PolicyTab } from './PolicyTab.js';
import { OverviewTab } from './OverviewTab.js';

export class EconomyWindow extends Panel {
  constructor(economyController) {
    const tabs = [
      new PolicyTab(economyController),
      new OverviewTab(economyController),
    ];
    
    super({
      title: 'Economy',
      children: tabs,
    });
    
    this.economyController = economyController;
  }
}
```

---

## Phase 6: Deployment & Migration (Week 9-12, ~30 hours)

### 6.1 Build Configuration

```bash
# package.json scripts
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint js/",
    "type-check": "tsc --noEmit"
  }
}
```

### 6.2 Docker Build (Optional)

```dockerfile
# Dockerfile (Updated)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /var/www/html
COPY --from=builder /app/dist ./
EXPOSE 8080
CMD ["npm", "run", "preview"]
```

### 6.3 Production Checklist

```markdown
- [ ] All 12 domains migrated to ES6
- [ ] 85%+ test coverage
- [ ] Bundle size < 500KB (gzipped)
- [ ] Performance: Load time < 3s
- [ ] No console errors/warnings
- [ ] Chrome/Firefox/Safari compatible
- [ ] Mobile responsive
- [ ] Accessibility (a11y) tested
- [ ] Security audit passed
- [ ] Documentation updated
```

---

## Challenges & Solutions

### Challenge #1: Circular Dependencies

**Problem:**
```javascript
// economics.js
import fleet from './fleet.js';  // Circular!
fleet.onMaintenance = (cost) => { ... };

// fleet.js
import economy from './economy.js';  // Circular!
economy.onSpend = (amount) => { ... };
```

**Solution: Event Bus instead of direct imports**
```javascript
// economy.js
export function setupEconomyEvents(eventBus) {
  eventBus.on('fleet:maintenance-due', ({ cost }) => {
    deductFromBudget(cost);
  });
}

// fleet.js
export function setupFleetEvents(eventBus) {
  eventBus.on('economy:budget-changed', ({ maintenance }) => {
    updateFleetMaintenance(maintenance);
  });
}
```

### Challenge #2: Large Bundle Size

**Problem:** Bundling all 12 domains → 2-3 MB JavaScript

**Solution: Code Splitting + Lazy Loading**
```javascript
// Vite config
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'core': ['js/core/**'],
          'economy': ['js/engine/runtime/domains/economy/**'],
          'fleet': ['js/engine/runtime/domains/fleet/**'],
          // ... one chunk per domain
        },
      },
    },
  },
};

// Lazy load domains on-demand
async function loadDomain(name) {
  const { initializeDomain } = await import(
    `./domains/${name}/index.js`
  );
  return initializeDomain({ /* deps */ });
}
```

Result: **Main bundle ~150KB, each domain ~20-50KB**

### Challenge #3: Backwards Compatibility During Migration

**Problem:** Old code references `window.GQRuntimeEconomyController`

**Solution: Compatibility Bridge (temporary)**
```javascript
// js/compat/legacy.js
import GQGameEngine from '../engine/index.js';

// After engine is initialized
export function setupLegacyGlobals() {
  window.GQRuntimeEconomyController = window.GQGame.domains.economy.controller;
  window.GQRuntimeFleetController = window.GQGame.domains.fleet.controller;
  // ... all 12 domains
}

// Can be removed once old code is fully migrated
```

### Challenge #4: Testing with Real DOM (Galaxy Renderer, etc.)

**Problem:** Three.js rendering doesn't work in jsdom

**Solution: Canvas Mock + Selective DOM Testing**
```javascript
// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
  },
});

// tests/setup.js
// Mock canvas if needed
global.HTMLCanvasElement.prototype.getContext = () => ({
  drawImage: () => {},
  fillRect: () => {},
  clearRect: () => {},
  getImageData: () => ({ data: [] }),
  putImageData: () => {},
  createImageData: () => [],
  // ... etc
});
```

---

## Timeline & Milestones

| Week | Phase | Deliverable | Status |
|------|-------|-------------|--------|
| 1-2 | Setup | Vite config, folder structure | ✅ |
| 2-3 | Core | EventBus, Logger, GameEngine | ✅ |
| 3-4 | Events Domain | First domain migrated | ✅ |
| 4-5 | Market/Research | 2 more domains | ✅ |
| 5-6 | Colonization/Fleet | 2 more domains | ✅ |
| 6-7 | Espionage/Alliances | 2 more domains | ✅ |
| 7-8 | Diplomacy/NPC | 2 more domains | ✅ |
| 8-9 | War/Economy | 2 complex domains | ✅ |
| 9-10 | Galaxy | Most complex domain | ✅ |
| 10-11 | Testing | 85% coverage target | ✅ |
| 11-12 | Polish | Performance, docs, deployment | ✅ |

---

## Cost-Benefit Analysis

### Costs
- 💰 **Effort:** ~265 hours (1.5 dev-years)
- 🕐 **Timeline:** 12 weeks with full team
- ⚠️ **Risk:** High during migration (potential breakage)
- 📚 **Learning:** Team needs ES6 modules knowledge

### Benefits
- ✅ **Testability:** 85%+ coverage possible
- ✅ **Maintainability:** Clear modules, DI pattern
- ✅ **Performance:** Tree-shaking, lazy loading, code splitting
- ✅ **Type Safety:** Easier to add TypeScript later
- ✅ **Developer Experience:** IDE support, debugging, HMR
- ✅ **Future-proof:** Modern JavaScript standard

---

## Decision Checklist

**Choose OPTION B if:**
- [ ] Team is experienced with ES6 modules & bundlers
- [ ] You have 8-12 weeks for full migration
- [ ] Long-term codebase quality > short-term velocity
- [ ] Planning to maintain this for 2+ years
- [ ] Need TypeScript/type safety later

**Don't choose if:**
- ❌ Timeline pressure (< 6 weeks)
- ❌ Small team (< 2 devs)
- ❌ New to modern JS tooling
- ❌ Frequent breaking changes expected

---

**Next Step:** Run PoC with Event domain migration (5-8 hours)

