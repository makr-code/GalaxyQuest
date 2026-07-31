/**
 * Rendering System — Reusable Validation Functions
 * 
 * This module provides consistent validation patterns for the Galaxy rendering system.
 * Used by both galaxy-renderer-core.js and as a template reference for legacy renderer.
 * 
 * All validators throw appropriate RenderingError subclasses on failure.
 * 
 * **Usage Pattern:**
 * ```javascript
 * const { validators } = window.GQRenderingValidation || {};
 * validators?.validateContainer(container);
 * const three = validators?.validateThreeRuntime();
 * ```
 */

(function () {
  // Import error types if available
  const {
    RenderingError,
    ValidationError,
    RuntimeRenderError,
    ResourceError,
    formatErrorMessage,
  } = window.GQRenderingErrors || {};

  if (!ValidationError) {
    console.warn('[GQ:render:validation] GQRenderingErrors not loaded. Validation may not work properly.');
  }

  // ========== CONTAINER & DOM VALIDATORS ==========

  const validators = {
    /**
     * Validate that container exists and is a valid DOM element
     */
    validateContainer(container, contextName = 'Galaxy3DRenderer') {
      if (!container) {
        throw new ValidationError?.(`${contextName}: missing container`, 'container', container)
          || new Error(`${contextName}: missing container`);
      }

      if (!(container instanceof HTMLElement)) {
        throw new ValidationError?.(`${contextName}: container must be an HTMLElement`, 'container', container)
          || new Error(`${contextName}: container must be an HTMLElement`);
      }

      if (container.clientWidth === 0 || container.clientHeight === 0) {
        throw new ValidationError?.(`${contextName}: container has zero dimensions (${container.clientWidth}x${container.clientHeight})`, 'container', container)
          || new Error(`${contextName}: container has zero dimensions`);
      }

      return container;
    },

    /**
     * Validate canvas element
     */
    validateCanvas(canvas, contextName = 'Galaxy3DRenderer') {
      if (canvas === null || canvas === undefined) {
        return null; // Canvas is optional
      }

      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new ValidationError?.(`${contextName}: canvas must be an HTMLCanvasElement`, 'canvas', canvas)
          || new Error(`${contextName}: canvas must be an HTMLCanvasElement`);
      }

      return canvas;
    },

    /**
     * Validate that a window object is accessible
     */
    validateWindow(win = window, contextName = 'Galaxy3DRenderer') {
      if (!win || typeof win !== 'object') {
        throw new ValidationError?.(`${contextName}: window object is invalid`, 'window', win)
          || new Error(`${contextName}: window object is invalid`);
      }

      return win;
    },

    // ========== THREE.JS RUNTIME VALIDATORS ==========

    /**
     * Validate THREE.js runtime availability
     */
    validateThreeRuntime(win = window, contextName = 'Galaxy3DRenderer') {
      const three = validators.resolveThreeRuntime(win);

      if (!three) {
        throw new ResourceError?.(
          `${contextName}: THREE runtime not found. Ensure three.js is loaded before renderer.`,
          'three',
          'THREE',
        )
          || new Error(`${contextName}: THREE runtime not found`);
      }

      return three;
    },

    /**
     * Resolve THREE.js runtime from various possible locations
     */
    resolveThreeRuntime(win = window) {
      const candidates = [];

      const push = (value) => {
        if (!value) return;
        if (candidates.includes(value)) return;
        candidates.push(value);
      };

      const three = win?.THREE || null;
      const hasCoreCtors = (obj) => !!obj
        && (typeof obj === 'object' || typeof obj === 'function')
        && typeof obj.Vector3 === 'function'
        && typeof obj.Scene === 'function';

      push(three);
      if (three && (typeof three === 'object' || typeof three === 'function')) {
        push(three.THREE);
        push(three.default);
        push(three.module);
        push(three.namespace);
      }
      push(win?.__GQ_THREE_RUNTIME || null);
      push(win?.__THREE__ || null);
      push(win?.THREE_NS || null);

      try {
        const names = Object.getOwnPropertyNames(win || {});
        for (const name of names) {
          if (!/three/i.test(String(name || ''))) continue;
          push(win[name]);
        }
      } catch (_) {}

      for (const candidate of candidates) {
        if (!hasCoreCtors(candidate)) continue;
        try {
          win.THREE = candidate;
          win.__GQ_THREE_RUNTIME = candidate;
        } catch (_) {}
        return candidate;
      }

      return null;
    },

    /**
     * Validate THREE.MathUtils availability
     */
    validateThreeMathUtils(win = window, contextName = 'Galaxy3DRenderer') {
      const three = validators.validateThreeRuntime(win, contextName);

      if (!validators.ensureThreeMathUtils(win, three)) {
        throw new ResourceError?.(
          `${contextName}: THREE.MathUtils is unavailable. Math operations may fail.`,
          'three.MathUtils',
          'MathUtils',
        )
          || new Error(`${contextName}: THREE.MathUtils unavailable`);
      }

      return three.MathUtils;
    },

    /**
     * Ensure THREE.MathUtils exists with fallback implementations
     */
    ensureThreeMathUtils(win = window, three = null) {
      const runtime = three || validators.resolveThreeRuntime(win);
      if (!runtime || (typeof runtime !== 'object' && typeof runtime !== 'function')) {
        return false;
      }

      const existing = (runtime.MathUtils && typeof runtime.MathUtils === 'object') ? runtime.MathUtils : {};
      const fallback = {
        clamp(value, min, max) {
          const v = Number(value);
          const lo = Number(min);
          const hi = Number(max);
          if (!Number.isFinite(v) || !Number.isFinite(lo) || !Number.isFinite(hi)) return lo;
          return Math.min(hi, Math.max(lo, v));
        },
        lerp(a, b, t) {
          const ta = Number(a);
          const tb = Number(b);
          const tt = Number(t);
          if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
          const k = Number.isFinite(tt) ? Math.min(1, Math.max(0, tt)) : 0;
          return ta + (tb - ta) * k;
        },
        degToRad(deg) {
          const d = Number(deg);
          if (!Number.isFinite(d)) return 0;
          return d * (Math.PI / 180);
        },
      };

      try {
        runtime.MathUtils = Object.assign({}, fallback, existing);
      } catch (_) {
        return false;
      }
      return typeof runtime.MathUtils?.clamp === 'function';
    },

    /**
     * Get THREE.MathUtils with guaranteed fallback
     */
    getThreeMathUtils(win = window) {
      const math = win?.THREE?.MathUtils;
      if (math && typeof math.clamp === 'function') return math;

      if (validators.ensureThreeMathUtils(win) && win?.THREE?.MathUtils && typeof win.THREE.MathUtils.clamp === 'function') {
        return win.THREE.MathUtils;
      }

      // Return absolute fallback
      return {
        clamp(value, min, max) {
          const v = Number(value);
          const lo = Number(min);
          const hi = Number(max);
          if (!Number.isFinite(v) || !Number.isFinite(lo) || !Number.isFinite(hi)) return lo;
          return Math.min(hi, Math.max(lo, v));
        },
        lerp(a, b, t) {
          const ta = Number(a);
          const tb = Number(b);
          const tt = Number(t);
          if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
          const k = Number.isFinite(tt) ? Math.min(1, Math.max(0, tt)) : 0;
          return ta + (tb - ta) * k;
        },
        degToRad(deg) {
          const d = Number(deg);
          if (!Number.isFinite(d)) return 0;
          return d * (Math.PI / 180);
        },
      };
    },

    // ========== RENDERER & SHADER VALIDATORS ==========

    /**
     * Validate WebGL capabilities
     */
    validateWebGLCapabilities(contextName = 'Galaxy3DRenderer') {
      if (!window.WebGLRenderingContext) {
        throw new ResourceError?.(
          `${contextName}: WebGL not supported by browser`,
          'webgl',
          'WebGLRenderingContext',
        )
          || new Error(`${contextName}: WebGL not supported`);
      }

      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('webgl') || canvas.getContext('webgl2');
        if (!ctx) {
          throw new ResourceError?.(
            `${contextName}: WebGL context could not be created`,
            'webgl',
            'WebGLContext',
          )
            || new Error(`${contextName}: WebGL context creation failed`);
        }
        return ctx;
      } catch (err) {
        throw new ResourceError?.(
          `${contextName}: WebGL test failed: ${err?.message || String(err)}`,
          'webgl',
          'WebGLContext',
        )
          || new Error(`${contextName}: WebGL test failed`);
      }
    },

    /**
     * Validate shader string is non-empty and reasonable
     */
    validateShaderCode(shaderCode, shaderType = 'vertex', contextName = 'Galaxy3DRenderer') {
      if (!shaderCode || typeof shaderCode !== 'string') {
        throw new ValidationError?.(
          `${contextName}: shader code must be a non-empty string`,
          `${shaderType}_shader`,
          shaderCode,
        )
          || new Error(`${contextName}: invalid shader code`);
      }

      if (shaderCode.trim().length === 0) {
        throw new ValidationError?.(
          `${contextName}: shader code is empty`,
          `${shaderType}_shader`,
          shaderCode,
        )
          || new Error(`${contextName}: shader code is empty`);
      }

      return shaderCode;
    },

    // ========== GENERIC VALIDATORS ==========

    /**
     * Validate a numeric value is within bounds
     */
    validateNumericRange(value, min, max, fieldName = 'value', contextName = 'Galaxy3DRenderer') {
      const num = Number(value);

      if (!Number.isFinite(num)) {
        throw new ValidationError?.(
          `${contextName}: '${fieldName}' must be a finite number, got ${typeof value}`,
          fieldName,
          value,
        )
          || new Error(`${contextName}: invalid numeric value for ${fieldName}`);
      }

      if (num < min || num > max) {
        throw new ValidationError?.(
          `${contextName}: '${fieldName}' must be between ${min} and ${max}, got ${num}`,
          fieldName,
          num,
        )
          || new Error(`${contextName}: ${fieldName} out of range`);
      }

      return num;
    },

    /**
     * Validate object has required properties
     */
    validateObjectSchema(obj, schema, contextName = 'Galaxy3DRenderer') {
      if (!obj || typeof obj !== 'object') {
        throw new ValidationError?.(
          `${contextName}: expected object, got ${typeof obj}`,
          'object',
          obj,
        )
          || new Error(`${contextName}: invalid object`);
      }

      const errors = [];
      for (const [propName, propType] of Object.entries(schema)) {
        const value = obj[propName];
        const actualType = typeof value;
        const isValid = propType === actualType
          || (propType === 'array' && Array.isArray(value))
          || (propType === 'nullable' && (value === null || value === undefined));

        if (!isValid) {
          errors.push(`${propName}: expected ${propType}, got ${actualType}`);
        }
      }

      if (errors.length > 0) {
        throw new ValidationError?.(
          `${contextName}: object validation failed: ${errors.join('; ')}`,
          'schema',
          obj,
        )
          || new Error(`${contextName}: schema validation failed`);
      }

      return obj;
    },
  };

  // ========== GLOBAL REGISTRY & EXPORT ==========

  const registry = {
    validators,
  };

  window.GQRenderingValidation = registry;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = registry;
  }

  // Emit initialization telemetry
  try {
    window.dispatchEvent(new CustomEvent('gq:rendering-validation-initialized', {
      detail: { timestamp: Date.now() },
    }));
  } catch (_) {}
})();
