# AI Coding Context: JavaScript/ES6+

**Für:** GitHub Copilot, Claude, Code Generation  
**Projekt:** GalaxyQuest  
**Datum:** 2026-08-01  
**SOC Score:** 3.6/10 → Target: 8/10

---

## 🎯 Overarching Principles

### Separation of Concerns (SOC) Mandate
- ✅ **One module = One responsibility**
- ✅ **Business logic ≠ UI rendering**
- ✅ **API calls ≠ State management**
- ✅ **No circular dependencies**
- ❌ Never mix layers (e.g., Rendering + Network + Logic in one class)

### Module Architecture
```
✅ GOOD:
js/engine/runtime/domains/economy/
├─ EconomyController.js         # Pure logic, no DOM
├─ EconomyCalculations.js       # Math, state transformations
├─ EconomyUI.js                 # Only rendering, callbacks
└─ __exports.js                 # Export to window.GQGame.domains.economy

❌ BAD:
RuntimeEconomyController.js      # 900-line monolith with everything
```

---

## 📐 Object-Oriented Design Patterns

### 1. **Facade Pattern** (Preferred for Controllers)
```javascript
// ✅ GOOD: Facade hides complexity
class EconomyController {
  constructor(state = {}, config = {}) {
    this.state = state;
    this.config = config;
    this.callbacks = {};
  }
  
  // Public API - high level
  setTaxRate(value) {
    this._validateTaxRate(value);
    this.state.taxRate = value;
    this._notifyListeners('taxRate');
  }
  
  // Private internals - hidden
  _validateTaxRate(value) {
    if (value < 0 || value > 100) throw new Error('Invalid tax rate');
  }
  
  _notifyListeners(field) {
    this.callbacks.onChange?.({ field, value: this.state[field] });
  }
}
```

### 2. **Observer Pattern** (For State Changes)
```javascript
// ✅ GOOD: Listeners notified of changes
class Observable {
  constructor() {
    this.observers = [];
  }
  
  subscribe(observer) {
    this.observers.push(observer);
    return () => {
      this.observers = this.observers.filter(o => o !== observer);
    };
  }
  
  notify(data) {
    this.observers.forEach(observer => observer(data));
  }
}

// Usage:
const economy$ = new Observable();
economy$.subscribe((state) => {
  console.log('Economy changed:', state);
});
```

### 3. **Dependency Injection** (Always preferred)
```javascript
// ✅ GOOD: Dependencies injected
class Galaxy3DRenderer {
  constructor(config) {
    this.gameInstance = config.gameInstance;  // Injected!
    this.eventBus = config.eventBus;
    this.canvas = config.canvas;
  }
  
  render() {
    const selection = this.gameInstance.getSelection?.();  // Through facade
  }
}

// Usage:
const renderer = new Galaxy3DRenderer({
  gameInstance: window.GQGame,
  eventBus: window.GQGame.events,
  canvas: document.querySelector('canvas')
});

// ❌ BAD: Direct global access
class BadRenderer {
  render() {
    const selection = window.GQRuntimeSelectionState.selectedIds;  // 🔴 Hard-coded
  }
}
```

### 4. **Strategy Pattern** (For Algorithms)
```javascript
// ✅ GOOD: Algorithm injected, not hard-coded
class EconomyCalculator {
  constructor(strategy) {
    this.strategy = strategy;  // Can be swapped!
  }
  
  calculateTax(income) {
    return this.strategy.compute(income);  // Delegate
  }
}

// Different strategies:
const progressiveTax = {
  compute: (income) => {
    if (income < 1000) return income * 0.1;
    if (income < 5000) return income * 0.2;
    return income * 0.3;
  }
};

const flatTax = {
  compute: (income) => income * 0.15
};

// Easy to test/swap:
const calc1 = new EconomyCalculator(progressiveTax);
const calc2 = new EconomyCalculator(flatTax);
```

### 5. **Factory Pattern** (For Complex Object Creation)
```javascript
// ✅ GOOD: Factory encapsulates creation logic
class RendererFactory {
  static create(type, config) {
    switch(type) {
      case 'webgpu':
        return new Galaxy3DRendererWebGPU(config);
      case 'webgl':
        return new Galaxy3DRendererWebGL(config);
      default:
        throw new Error(`Unknown renderer type: ${type}`);
    }
  }
}

// Usage:
const renderer = RendererFactory.create('webgpu', { canvas });
```

---

## 🏗️ Module Organization

### File Structure (Per Domain)
```
js/engine/runtime/domains/{domain}/
├─ {Domain}Controller.js           # Facade, main API
├─ {Domain}State.js                # State object, validators
├─ {Domain}Calculations.js         # Pure functions, math
├─ {Domain}UI.js                   # Rendering only
├─ {Domain}Events.js               # Event definitions
├─ types.js                        # TypeScript-like JSDoc types
└─ __exports.js                    # Exports to window.GQGame.domains
```

### Example: EconomyController
```javascript
// File: js/engine/runtime/domains/economy/EconomyController.js
/**
 * @typedef {Object} EconomyConfig
 * @property {Object} callbacks
 * @property {Function} [callbacks.onChange]
 */

class EconomyController {
  /**
   * @param {Object} state - Initial state
   * @param {EconomyConfig} config - Configuration
   */
  constructor(state = {}, config = {}) {
    this.state = {
      taxRate: 0,
      subsidyRate: 0,
      ...state
    };
    this.config = config;
  }
  
  /**
   * Set tax rate with validation
   * @param {number} value - Tax rate 0-100
   * @throws {Error} If invalid value
   */
  setTaxRate(value) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`Invalid tax rate: ${value}`);
    }
    
    const oldValue = this.state.taxRate;
    this.state.taxRate = value;
    
    this.config.callbacks?.onChange?.({
      field: 'taxRate',
      oldValue,
      newValue: value
    });
  }
  
  /**
   * Calculate demand for colony
   * @param {Object} colony - Colony object
   * @returns {Object} Demand object
   */
  calculateDemand(colony) {
    // Pure function, testable
    return {
      food: colony.population * 0.5,
      minerals: colony.buildings.length * 10,
      credit: this.state.taxRate * colony.population
    };
  }
}
```

---

## 🔗 Dependency Management

### Import Rules
```javascript
// ✅ GOOD: Import from modules
import { Galaxy3DRenderer } from './Galaxy3DRenderer.js';
import { EconomyController } from './domains/economy/EconomyController.js';

// ✅ GOOD: Use window.GQGame facade
window.GQGame.domains.economy.setTaxRate(15);
window.GQGame.events.emit('economy:changed', data);

// ❌ BAD: Direct window.GQRuntime* access
const tax = window.GQRuntimeEconomyController.state.tax;

// ❌ BAD: Circular imports
// File A imports File B, File B imports File A

// ❌ BAD: Import from other domains
import { FleetState } from '../fleet/FleetState.js';  // Should go through facade
```

### Initialization Order (Mandatory)
```javascript
// 1. Boot manifest with versions
// 2. Core infrastructure (WM, EventBus, StateManager)
// 3. Network/API layer
// 4. Game Framework (GameLoop, SystemRegistry)
// 5. Runtime Domains (Economy, Fleet, War, etc.)
// 6. Rendering (Galaxy3DRenderer, ParticleSystem)
// 7. Game Systems (NPC, Guide)
// 8. Main coordinator (game.js)

// If order violated → silent errors → hard to debug!
```

---

## 🛡️ Error Handling

### Exception Strategy
```javascript
// ✅ GOOD: Custom error types
class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

class NetworkError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
  }
}

// Usage:
try {
  controller.setTaxRate(value);
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation error
    showToast(`Invalid ${error.field}: ${error.message}`);
  } else if (error instanceof NetworkError) {
    // Handle network error
    retryRequest();
  } else {
    // Unknown error
    console.error('[ERROR]', error);
    reportToSentry(error);
  }
}

// ❌ BAD: Generic catch
try {
  something();
} catch (e) {
  console.log(e);  // Silent failure
}
```

### Async/Await Error Handling
```javascript
// ✅ GOOD: Try/catch for async
async function loadGalaxy() {
  try {
    const data = await window.API.galaxy.getStars();
    this.state.stars = data;
  } catch (error) {
    if (error.statusCode === 401) {
      window.GQGame.events.emit('auth:unauthorized');
    } else {
      throw error;  // Re-throw unknown errors
    }
  }
}

// ✅ GOOD: Promise error handling
window.API.galaxy.getStars()
  .then(data => { this.state.stars = data; })
  .catch(error => {
    if (error.retry) {
      return this.loadGalaxy();  // Retry
    }
    throw error;
  });

// ❌ BAD: Unhandled promise rejection
window.API.galaxy.getStars().then(data => {
  this.state.stars = data;
});  // No catch!
```

---

## 📝 Naming Conventions

### Files & Directories
```
✅ GOOD:
- js/engine/runtime/domains/economy/EconomyController.js
- js/rendering/Galaxy3DRendererWebGPU.js
- js/network/api-transport.js
- js/components/economy-panel.js

❌ BAD:
- js/runtime/RuntimeEconomyController.js (Too much "Runtime")
- js/engine/core/RC.js (Abbreviations)
- js/network/api-trans.js (Incomplete words)
- js/components/ep.js (Non-descriptive)
```

### Variables & Constants
```javascript
// ✅ GOOD: Descriptive, type hinting
const MAX_TAX_RATE = 100;  // Constant
const economyState = { taxRate: 15 };  // Object
const selectedSystemIds = [];  // Array
const isLoading = false;  // Boolean
const getColonyDemand = (colony) => { ... };  // Function

// ✅ GOOD: Private convention (prefix with _)
class Controller {
  _state = {};  // Private
  _validate() {}  // Private method
  
  publicMethod() {}  // Public
}

// ❌ BAD: Non-descriptive
const s = state;
const r = request;
const x = 100;
const fn = () => {};

// ❌ BAD: Ambiguous booleans
const canUpdate = true;  // Does it mean user can? Or update is possible?
const isValidated = true;  // Who validated? By what?

// Better:
const isUserAuthorizedToUpdate = true;
const isFormValidated = true;
```

### Classes & Functions
```javascript
// ✅ GOOD: PascalCase for classes
class EconomyController {
  // ...
}

// ✅ GOOD: camelCase for functions/methods
function calculateTaxRevenue(rate, income) { }
const getTaxRate = () => { };

// ✅ GOOD: SCREAMING_SNAKE_CASE for constants
const MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 5000;

// ❌ BAD: SCREAMING_SNAKE_CASE for non-constants
const CALCULATE_TAX = () => { };  // Should be camelCase
```

---

## 🧪 Testing Expectations

### Unit Testing Pattern
```javascript
// ✅ GOOD: Testable, isolated
class EconomyCalculations {
  static calculateTax(income, rate) {
    if (!Number.isFinite(income) || !Number.isFinite(rate)) {
      throw new Error('Invalid input');
    }
    return income * (rate / 100);
  }
}

// Test:
describe('EconomyCalculations', () => {
  it('should calculate tax correctly', () => {
    const result = EconomyCalculations.calculateTax(1000, 15);
    expect(result).toBe(150);
  });
  
  it('should throw on invalid input', () => {
    expect(() => EconomyCalculations.calculateTax(null, 15)).toThrow();
  });
});

// ❌ BAD: Hard to test
class EconomyController {
  calculateTax() {
    const response = await window.API.economy.getTax();  // API call!
    const rendered = this.render(response);  // Rendering!
    document.body.appendChild(rendered);  // DOM mutation!
    return rendered;
  }
}
```

### Integration Testing Pattern
```javascript
// ✅ GOOD: Test module boundaries
describe('EconomyController', () => {
  let controller;
  
  beforeEach(() => {
    controller = new EconomyController({}, {
      callbacks: {
        onChange: jest.fn()
      }
    });
  });
  
  it('should notify listeners on state change', () => {
    controller.setTaxRate(20);
    expect(controller.config.callbacks.onChange).toHaveBeenCalledWith({
      field: 'taxRate',
      oldValue: 0,
      newValue: 20
    });
  });
});
```

---

## 📊 Event System Pattern

### Event Registry
```javascript
// ✅ GOOD: Centralized event definitions
const EVENTS = {
  ECONOMY_TAX_CHANGED: {
    name: 'economy:tax-changed',
    payload: { taxRate: 'number' }
  },
  ECONOMY_DEMAND_CALCULATED: {
    name: 'economy:demand-calculated',
    payload: { demands: 'Object' }
  },
  SELECTION_CHANGED: {
    name: 'selection:changed',
    payload: { selectedIds: 'Array<string>' }
  }
};

// Emit with validation:
window.GQGame.events.emit(EVENTS.ECONOMY_TAX_CHANGED.name, {
  taxRate: 20
});

// Listen with type-safety:
window.GQGame.events.on(EVENTS.ECONOMY_TAX_CHANGED.name, (payload) => {
  console.log(`Tax changed to ${payload.taxRate}%`);
});

// ❌ BAD: Magic string events
window.GQGame.events.on('economy:tax-changed', (payload) => { });  // Where defined?
window.GQGame.events.on('something-changed', (data) => { });  // Typo friendly!
```

---

## 🚀 Code Generation Guidelines for AI

When generating code, **always**:

1. **Check for SOC violations**
   ```javascript
   // ❌ Don't generate monolithic classes
   class EconomyPanel {
     async render() {
       const data = await fetch('/api/economy');  // API call
       const html = this.buildHTML(data);  // Rendering
       const validation = this.validate(data);  // Logic
     }
   }
   
   // ✅ Split into separate concerns
   // - EconomyController (logic)
   // - EconomyUI (rendering)
   // - EconomyAPI (network)
   ```

2. **Use Dependency Injection**
   ```javascript
   // ✅ DO inject dependencies
   class MyController {
     constructor(config) {
       this.eventBus = config.eventBus;
       this.api = config.api;
     }
   }
   
   // ❌ DON'T hardcode globals
   class BadController {
     constructor() {
       this.eventBus = window.GQEventBus;  // No!
     }
   }
   ```

3. **Add JSDoc types**
   ```javascript
   // ✅ DO document types
   /**
    * Calculate tax amount
    * @param {number} income - Base income
    * @param {number} rate - Tax rate 0-100
    * @returns {number} Tax amount
    * @throws {ValidationError} If inputs invalid
    */
   function calculateTax(income, rate) { }
   
   // ❌ DON'T skip documentation
   function calculate(x, y) { }
   ```

4. **Handle errors explicitly**
   ```javascript
   // ✅ DO catch and handle
   try {
     await window.API.galaxy.load();
   } catch (error) {
     window.GQGame.events.emit('error:api-failed', error);
   }
   
   // ❌ DON'T ignore errors
   await window.API.galaxy.load();  // What if fails?
   ```

5. **No circular dependencies**
   ```javascript
   // ✅ DO one-way dependencies
   Economy → GameLoop
   GameLoop → All Domains
   
   // ❌ DON'T create circles
   Economy ← → GameLoop  // Circular!
   ```

---

## 🎓 Anti-Patterns to Avoid

| Anti-Pattern | Why Bad | Fix |
|---|---|---|
| Global mutable state | Debugging nightmare | Use StateManager or facade |
| Mixing concerns | Can't test in isolation | Separate into modules |
| Direct DOM queries | Brittle selectors | Use container refs |
| Silent errors | Users confused | Throw/log/report |
| Hard-coded strings | Typo-prone, unmaintainable | Use constants/enums |
| Deep nesting | Hard to read | Extract methods |
| Callback hell | Unreadable | Use async/await or Promises |
| Magic numbers | No context | Use named constants |

---

## 📋 Checklist for New Code

Before submitting JavaScript code:

- [ ] Single responsibility (does one thing)
- [ ] No circular dependencies
- [ ] Dependencies injected, not hardcoded
- [ ] Errors caught and handled
- [ ] JSDoc types documented
- [ ] Follows naming conventions
- [ ] Testable (pure functions where possible)
- [ ] No direct window.GQRuntime* access (use facade)
- [ ] Events emitted to eventBus, not scattered
- [ ] No DOM mutations outside rendering layer
- [ ] Constants extracted, no magic strings/numbers

---

**Last Updated:** 2026-08-01  
**Maintained by:** Architecture Team  
**Questions?** See JAVASCRIPT_ARCHITECTURE_ANALYSIS.md for deep dive.
