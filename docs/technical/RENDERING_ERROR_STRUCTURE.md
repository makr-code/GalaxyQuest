# Galaxy Rendering System — Error & Validation Structure

## Overview

The Galaxy rendering system now has a **consistent, standardized structure** for error handling and validation. This document serves as the reference for:

- **rendering-errors.js** — Error types, logging, telemetry
- **rendering-validation.js** — Reusable validation functions
- **galaxy-renderer-core.js** — Modern production implementation
- **js/legacy/galaxy3d.js** — Template reference (deprecated but serves as documentation)

## File Structure

```
js/rendering/
├── rendering-errors.js              ← Error types & handlers
├── rendering-validation.js          ← Validators & helpers
├── galaxy-renderer-core.js          ← Production implementation (uses new patterns)
└── galaxy-camera-controller.js
```

```
js/legacy/
└── galaxy3d.js                      ← Template reference (deprecated, shows OLD patterns)
```

---

## 1. Error Type Hierarchy

All rendering errors inherit from a structured hierarchy:

```
RenderingError (base)
├── ValidationError
│   └── Used for: missing/invalid parameters, type mismatches
├── RuntimeRenderError
│   └── Used for: execution-time failures, frame rendering issues
├── ResourceError
│   └── Used for: missing THREE.js, WebGL, textures, shaders
└── ShaderCompilationError
    └── Used for: shader-specific compilation failures
```

### Error Classes

#### ValidationError
```javascript
throw new ValidationError(
  "Required property 'container' is missing",
  'container',      // fieldName
  container         // value
);
```

#### RuntimeRenderError
```javascript
throw new RuntimeRenderError(
  "Failed to render system",
  'system-load',    // stage
  { systemId: 42 }  // context
);
```

#### ResourceError
```javascript
throw new ResourceError(
  "THREE.js runtime not found",
  'three',          // resourceType
  'THREE'           // resourceName
);
```

#### ShaderCompilationError
```javascript
throw new ShaderCompilationError(
  "Fragment shader compilation failed",
  'fragment',       // shaderType
  shaderCode        // shaderCode (stored as snippet)
);
```

---

## 2. Error Message Formatting

All error messages use **consistent prefixes** for categorization:

| Prefix | Purpose | Usage |
|---|---|---|
| `[GQ:render:init]` | Initialization errors | Constructor, resource setup |
| `[GQ:render:frame]` | Frame rendering errors | Animation loop, draw calls |
| `[GQ:render:system]` | System-specific errors | System loading, body rendering |
| `[GQ:render:validation]` | Validation errors | Parameter checks |
| `[GQ:render:shader]` | Shader errors | Shader compilation, GL errors |
| `[GQ:render:resource]` | Resource errors | Missing THREE.js, textures |
| `[GQ:legacy:galaxy3d]` | Legacy renderer | Deprecated code reference |

### Format Function

```javascript
const { formatErrorMessage } = window.GQRenderingErrors || {};

// formatErrorMessage(errorType, message, stage)
const msg = formatErrorMessage('INIT', 'Container is missing', 'constructor');
// Output: "[GQ:render:init] (constructor) Container is missing"
```

---

## 3. Error Handlers & Logging

Centralized error handling with structured logging and telemetry:

```javascript
const { errorHandlers } = window.GQRenderingErrors || {};

// Log error with categorization
errorHandlers?.logError(error, 'INIT', 'constructor');

// Log warning
errorHandlers?.logWarning('Performance degradation detected', 'FRAME');

// Emit error telemetry
errorHandlers?.emitErrorTelemetry(error, { stage: 'system-load' });

// Create fallback handler for resilience
const fallback = errorHandlers?.createFallbackHandler();
const result = fallback(
  () => riskyOperation(),  // function to execute
  defaultValue,            // fallback return value
  { context: 'data' }      // error context
);
```

### Telemetry Events

The system emits custom events for error tracking:

```javascript
// Listen for errors
window.addEventListener('gq:render-error', (evt) => {
  const { errorClass, message, stage } = evt.detail;
  console.log(`Error: ${errorClass} at ${stage}`);
});

// Listen for telemetry
window.addEventListener('gq:render-telemetry-error', (evt) => {
  const { ts, error, context } = evt.detail;
  analytics.track('rendering_error', { timestamp: ts, ...error });
});

// Access error history
const recentErrors = window.__GQ_RENDER_ERRORS;  // Last 100 errors
```

---

## 4. Validation Patterns

### 4.1 Container Validation

```javascript
const { validators } = window.GQRenderingValidation || {};

// Validates: existence, is HTMLElement, has dimensions
try {
  validators?.validateContainer(container, 'MyRenderer');
} catch (err) {
  // err instanceof ValidationError
  console.error('Container validation failed:', err.fieldName, err.value);
}
```

### 4.2 THREE.js Runtime Validation

```javascript
const { validators } = window.GQRenderingValidation || {};

// Resolves THREE.js from multiple possible locations
const three = validators?.validateThreeRuntime(window, 'MyRenderer');

// Ensures THREE.MathUtils with fallback
validators?.ensureThreeMathUtils(window, three);
const math = validators?.getThreeMathUtils(window);
```

### 4.3 WebGL Capability Validation

```javascript
try {
  validators?.validateWebGLCapabilities('MyRenderer');
} catch (err) {
  // err instanceof ResourceError
  console.error('WebGL not available:', err.message);
}
```

### 4.4 Numeric Range Validation

```javascript
try {
  const quality = validators?.validateNumericRange(value, 0, 100, 'quality');
} catch (err) {
  console.error('Quality out of range:', err.message);
}
```

### 4.5 Schema Validation

```javascript
const schema = {
  x: 'number',
  y: 'number',
  z: 'number',
  color: 'string',
};

try {
  validators?.validateObjectSchema(position, schema);
} catch (err) {
  console.error('Schema mismatch:', err.details);
}
```

---

## 5. Production Implementation Pattern

### Example: Proper Constructor with Error Handling

```javascript
class Galaxy3DRenderer {
  constructor(container, opts = {}) {
    const { validators } = window.GQRenderingValidation || {};
    const { errorHandlers } = window.GQRenderingErrors || {};

    try {
      // Validate all prerequisites
      validators?.validateContainer(container, 'Galaxy3DRenderer');
      const three = validators?.validateThreeRuntime(window, 'Galaxy3DRenderer');
      validators?.ensureThreeMathUtils(window, three);
      validators?.validateWebGLCapabilities('Galaxy3DRenderer');

      // Now safe to proceed with initialization
      this.container = container;
      this.three = three;
      
      // ... rest of initialization
    } catch (err) {
      errorHandlers?.logError(err, 'INIT', 'constructor');
      errorHandlers?.emitErrorTelemetry(err, { renderer: 'Galaxy3DRenderer' });
      throw err;  // Re-throw for caller to handle
    }
  }

  renderFrame(delta) {
    const { errorHandlers } = window.GQRenderingErrors || {};

    try {
      // Frame rendering logic
      this._updateScene(delta);
      this._render();
    } catch (err) {
      errorHandlers?.logError(err, 'FRAME', `frame@${this.frameCount}`);
      // Don't re-throw frame errors - try to continue
    }
  }
}
```

---

## 6. Testing Error Scenarios

Example test structure using validators and error handlers:

```javascript
describe('Galaxy3DRenderer', () => {
  it('should throw ValidationError on missing container', () => {
    const { validators } = window.GQRenderingValidation || {};
    
    expect(() => {
      validators?.validateContainer(null);
    }).toThrow(/ValidationError|missing container/);
  });

  it('should throw ResourceError on missing THREE', () => {
    const { validators } = window.GQRenderingValidation || {};
    const oldTHREE = window.THREE;
    delete window.THREE;
    
    try {
      expect(() => {
        validators?.validateThreeRuntime(window);
      }).toThrow(/ResourceError|THREE runtime/);
    } finally {
      window.THREE = oldTHREE;
    }
  });

  it('should emit error telemetry on validation failure', (done) => {
    const { errorHandlers } = window.GQRenderingErrors || {};
    
    window.addEventListener('gq:render-telemetry-error', (evt) => {
      expect(evt.detail.error.message).toContain('validation');
      done();
    });

    try {
      throw new ValidationError('Test error');
    } catch (err) {
      errorHandlers?.emitErrorTelemetry(err, {});
    }
  });
});
```

---

## 7. Migration Guide (Legacy to Modern)

### Before (legacy/galaxy3d.js pattern):
```javascript
if (!container) throw new Error('Galaxy3DRenderer: missing container');
if (!window.THREE) throw new Error('Galaxy3DRenderer: THREE not loaded');

try {
  const persistedDebug = window.localStorage?.getItem('gq:debug:galaxy3d') === '1';
  this.debugEnabled = persistedDebug;
} catch (_) {
  // Silent catch
}

try {
  this.renderer.compile(this.starPoints, this.renderFrames.galaxy);
} catch (shaderErr) {
  console.error('[galaxy] shader compilation error:', shaderErr);
  // Fallback logic
}
```

### After (galaxy-renderer-core.js pattern):
```javascript
const { validators } = window.GQRenderingValidation || {};
const { errorHandlers } = window.GQRenderingErrors || {};

try {
  validators?.validateContainer(container, 'Galaxy3DRenderer');
  validators?.validateThreeRuntime(window, 'Galaxy3DRenderer');
  validators?.ensureThreeMathUtils(window);
} catch (err) {
  errorHandlers?.logError(err, 'INIT', 'constructor');
  throw err;
}

try {
  const persistedDebug = window.localStorage?.getItem('gq:debug:galaxy3d') === '1';
  this.debugEnabled = persistedDebug;
} catch (err) {
  // Log caught error instead of silent catch
  errorHandlers?.logWarning('localStorage access failed, debug disabled', 'INIT');
}

try {
  this.renderer.compile(this.starPoints, this.renderFrames.galaxy);
} catch (shaderErr) {
  errorHandlers?.logError(shaderErr, 'SHADER', 'starfield-compile');
  errorHandlers?.emitErrorTelemetry(shaderErr, { 
    shaderType: 'vertex',
    stage: 'initialization'
  });
  // Fallback logic
  this._createFallbackStarfield();
}
```

---

## 8. Summary Checklist

When implementing rendering code:

- [ ] Use `ValidationError` for parameter validation
- [ ] Use `RuntimeRenderError` for execution failures
- [ ] Use `ResourceError` for missing THREE.js, textures, WebGL
- [ ] Use `ShaderCompilationError` for shader issues
- [ ] Use `validators` from `rendering-validation.js` for common checks
- [ ] Use `errorHandlers.logError()` instead of generic `console.error()`
- [ ] Use error prefixes from `ERROR_PREFIXES` map
- [ ] Emit telemetry for debugging via `errorHandlers.emitErrorTelemetry()`
- [ ] Handle frame errors gracefully (log but continue)
- [ ] Handle initialization errors strictly (log and throw)
- [ ] Test error paths explicitly
- [ ] Document error scenarios in comments

---

## References

- **rendering-errors.js** — Error types and handlers
- **rendering-validation.js** — Validation functions
- **galaxy-renderer-core.js** — Production implementation
- **js/legacy/galaxy3d.js** — Template/reference (deprecated)
