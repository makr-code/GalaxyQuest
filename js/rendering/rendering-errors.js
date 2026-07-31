/**
 * Rendering System — Standardized Error & Validation Framework
 * 
 * This module provides consistent error structures, types, and handling patterns
 * for the Galaxy rendering system (both legacy and modern renderers).
 * 
 * **Usage Pattern (as referenced by legacy renderer):**
 * ```javascript
 * const { RenderingError, ValidationError, errorHandlers } = window.GQRenderingErrors || {};
 * if (ValidationError) {
 *   try {
 *     validateContainer(container);
 *   } catch (err) {
 *     errorHandlers?.logError(err, 'initialization');
 *     throw err;
 *   }
 * }
 * ```
 */

(function () {
  // ========== ERROR TYPE HIERARCHY ==========
  
  /**
   * Base class for all rendering errors
   */
  class RenderingError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = 'RenderingError';
      this.details = details;
      this.timestamp = Date.now();
    }

    toJSON() {
      return {
        name: this.name,
        message: this.message,
        details: this.details,
        timestamp: this.timestamp,
      };
    }
  }

  /**
   * Validation errors — missing or invalid parameters/state
   */
  class ValidationError extends RenderingError {
    constructor(message, fieldName = null, value = null) {
      super(message, { fieldName, value });
      this.name = 'ValidationError';
      this.fieldName = fieldName;
      this.value = value;
    }
  }

  /**
   * Runtime errors — issues during execution
   */
  class RuntimeRenderError extends RenderingError {
    constructor(message, stage = null, context = {}) {
      super(message, { stage, context });
      this.name = 'RuntimeRenderError';
      this.stage = stage; // 'initialization', 'frame', 'system-load', etc.
    }
  }

  /**
   * Resource errors — missing THREE.js, WebGL, shaders, etc.
   */
  class ResourceError extends RenderingError {
    constructor(message, resourceType = 'unknown', resourceName = null) {
      super(message, { resourceType, resourceName });
      this.name = 'ResourceError';
      this.resourceType = resourceType; // 'three', 'shader', 'texture', 'canvas', etc.
      this.resourceName = resourceName;
    }
  }

  /**
   * Shader compilation errors
   */
  class ShaderCompilationError extends ResourceError {
    constructor(message, shaderType = null, shaderCode = null) {
      super(message, 'shader', shaderType);
      this.name = 'ShaderCompilationError';
      this.shaderType = shaderType; // 'vertex', 'fragment', 'compute'
      // Only store first 200 chars to avoid huge memory footprint
      this.shaderCodeSnippet = shaderCode ? String(shaderCode).slice(0, 200) : null;
    }
  }

  // ========== ERROR MESSAGE FORMATTING ==========

  const ERROR_PREFIXES = {
    INIT: '[GQ:render:init]',
    FRAME: '[GQ:render:frame]',
    SYSTEM: '[GQ:render:system]',
    VALIDATION: '[GQ:render:validation]',
    SHADER: '[GQ:render:shader]',
    RESOURCE: '[GQ:render:resource]',
    LEGACY: '[GQ:legacy:galaxy3d]',
  };

  function formatErrorMessage(errorType, message, stage = null) {
    const prefix = ERROR_PREFIXES[errorType] || ERROR_PREFIXES.FRAME;
    const stageStr = stage ? ` (${stage})` : '';
    return `${prefix}${stageStr} ${message}`;
  }

  // ========== ERROR HANDLERS & EMITTERS ==========

  const errorHandlers = {
    /**
     * Log error with appropriate prefix and severity
     */
    logError(error, errorType = 'FRAME', stage = null) {
      if (!error) return;

      const message = typeof error === 'string' ? error : error.message || String(error);
      const formatted = formatErrorMessage(errorType, message, stage);

      if (typeof console?.error === 'function') {
        console.error(formatted);
        if (error?.details) {
          console.error('  Details:', error.details);
        }
      }

      // Emit telemetry event
      try {
        const detail = {
          type: 'error',
          errorClass: error?.name || 'UnknownError',
          message: formatted,
          stage,
          timestamp: Date.now(),
        };
        window.dispatchEvent(new CustomEvent('gq:render-error', { detail }));
      } catch (_) {}
    },

    /**
     * Log warning with prefix
     */
    logWarning(message, warningType = 'FRAME', stage = null) {
      const formatted = formatErrorMessage(warningType, message, stage);
      if (typeof console?.warn === 'function') {
        console.warn(formatted);
      }
    },

    /**
     * Emit error telemetry (separate from logging)
     */
    emitErrorTelemetry(error, context = {}) {
      try {
        if (!Array.isArray(window.__GQ_RENDER_ERRORS)) {
          window.__GQ_RENDER_ERRORS = [];
        }

        const entry = {
          ts: Date.now(),
          error: error instanceof Error ? error.toJSON?.() || { message: error.message } : { message: String(error) },
          context,
        };

        window.__GQ_RENDER_ERRORS.push(entry);
        // Keep last 100 errors
        if (window.__GQ_RENDER_ERRORS.length > 100) {
          window.__GQ_RENDER_ERRORS.splice(0, window.__GQ_RENDER_ERRORS.length - 100);
        }

        window.dispatchEvent(new CustomEvent('gq:render-telemetry-error', { detail: entry }));
      } catch (_) {}
    },

    /**
     * Create a fallback handler that returns a default value instead of throwing
     */
    createFallbackHandler(onError = null) {
      return (fn, fallback, errorContext = {}) => {
        try {
          return fn();
        } catch (err) {
          this.logError(err, 'FRAME');
          this.emitErrorTelemetry(err, errorContext);
          if (typeof onError === 'function') {
            onError(err);
          }
          return fallback;
        }
      };
    },
  };

  // ========== VALIDATION HELPER FACTORIES ==========

  const validationHelpers = {
    /**
     * Create a validator for object properties
     */
    createPropertyValidator(propertyName, typeName, isRequired = true) {
      return (obj, stage = 'validation') => {
        if (!obj) {
          if (isRequired) {
            throw new ValidationError(
              `Property '${propertyName}' is required`,
              propertyName,
              obj,
            );
          }
          return null;
        }

        const value = obj[propertyName];
        if (isRequired && (value === null || value === undefined)) {
          throw new ValidationError(
            `Required property '${propertyName}' is missing`,
            propertyName,
            value,
          );
        }

        if (value !== null && value !== undefined && typeName) {
          const actualType = typeof value;
          const typeMatch = actualType === typeName.toLowerCase()
            || (typeName === 'Array' && Array.isArray(value))
            || (typeName === 'HTMLElement' && value instanceof HTMLElement);

          if (!typeMatch) {
            throw new ValidationError(
              `Property '${propertyName}' must be ${typeName}, got ${actualType}`,
              propertyName,
              value,
            );
          }
        }

        return value;
      };
    },

    /**
     * Create a validator that checks if a function exists on an object
     */
    createFunctionValidator(objectName, functionName) {
      return (obj, stage = 'validation') => {
        if (!obj) {
          throw new ValidationError(
            `Object '${objectName}' is missing`,
            objectName,
            obj,
          );
        }

        if (typeof obj[functionName] !== 'function') {
          throw new ValidationError(
            `Method '${objectName}.${functionName}' is not a function`,
            `${objectName}.${functionName}`,
            obj[functionName],
          );
        }

        return obj[functionName];
      };
    },

    /**
     * Create a validator for enum-like values
     */
    createEnumValidator(propertyName, allowedValues) {
      return (value, stage = 'validation') => {
        if (!allowedValues.includes(value)) {
          throw new ValidationError(
            `Invalid value for '${propertyName}': '${value}'. Allowed: ${allowedValues.join(', ')}`,
            propertyName,
            value,
          );
        }
        return value;
      };
    },
  };

  // ========== GLOBAL REGISTRY & EXPORT ==========

  const registry = {
    RenderingError,
    ValidationError,
    RuntimeRenderError,
    ResourceError,
    ShaderCompilationError,
    ERROR_PREFIXES,
    formatErrorMessage,
    errorHandlers,
    validationHelpers,
  };

  // Register globally for access from galaxy-renderer-core.js and legacy renderer
  window.GQRenderingErrors = registry;

  // Also export as module if in modular context
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = registry;
  }

  // Emit initialization telemetry
  try {
    window.dispatchEvent(new CustomEvent('gq:rendering-errors-initialized', {
      detail: { timestamp: Date.now() },
    }));
  } catch (_) {}
})();
