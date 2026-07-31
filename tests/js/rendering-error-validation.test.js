/**
 * Tests for Rendering Error & Validation Structure
 * 
 * Tests validate:
 * - Error type hierarchy and properties
 * - Validation function behavior
 * - Error message formatting
 * - Telemetry emission
 */

describe('GQRenderingErrors', () => {
  let originalTHREE;

  beforeEach(() => {
    // Clean up error history
    window.__GQ_RENDER_ERRORS = [];
  });

  afterEach(() => {
    // Restore original THREE if modified
    if (originalTHREE !== undefined) {
      window.THREE = originalTHREE;
    }
  });

  // ========== ERROR TYPE TESTS ==========

  describe('RenderingError', () => {
    it('should create error with message and details', () => {
      const { RenderingError } = window.GQRenderingErrors || {};
      if (!RenderingError) { 
        console.warn('GQRenderingErrors not loaded');
        return; 
      }

      const err = new RenderingError('Test error', { code: 42 });
      expect(err.message).toBe('Test error');
      expect(err.details.code).toBe(42);
      expect(err.name).toBe('RenderingError');
      expect(err.timestamp).toBeDefined();
    });

    it('should serialize to JSON correctly', () => {
      const { RenderingError } = window.GQRenderingErrors || {};
      if (!RenderingError) return;

      const err = new RenderingError('Test', { code: 42 });
      const json = err.toJSON();
      expect(json.name).toBe('RenderingError');
      expect(json.message).toBe('Test');
      expect(json.details.code).toBe(42);
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('ValidationError', () => {
    it('should capture field name and value', () => {
      const { ValidationError } = window.GQRenderingErrors || {};
      if (!ValidationError) return;

      const err = new ValidationError('Invalid field', 'color', '#xyz');
      expect(err.fieldName).toBe('color');
      expect(err.value).toBe('#xyz');
      expect(err.name).toBe('ValidationError');
    });
  });

  describe('RuntimeRenderError', () => {
    it('should capture stage and context', () => {
      const { RuntimeRenderError } = window.GQRenderingErrors || {};
      if (!RuntimeRenderError) return;

      const err = new RuntimeRenderError('Render failed', 'frame-10', { fps: 60 });
      expect(err.stage).toBe('frame-10');
      expect(err.details.context.fps).toBe(60);
      expect(err.name).toBe('RuntimeRenderError');
    });
  });

  describe('ResourceError', () => {
    it('should capture resource type and name', () => {
      const { ResourceError } = window.GQRenderingErrors || {};
      if (!ResourceError) return;

      const err = new ResourceError('Texture missing', 'texture', 'star-map.png');
      expect(err.resourceType).toBe('texture');
      expect(err.resourceName).toBe('star-map.png');
      expect(err.name).toBe('ResourceError');
    });
  });

  describe('ShaderCompilationError', () => {
    it('should capture shader type and code snippet', () => {
      const { ShaderCompilationError } = window.GQRenderingErrors || {};
      if (!ShaderCompilationError) return;

      const code = 'void main() { gl_FragColor = vec4(1.0); }';
      const err = new ShaderCompilationError('Compilation failed', 'fragment', code);
      expect(err.shaderType).toBe('fragment');
      expect(err.shaderCodeSnippet).toBeDefined();
      expect(err.name).toBe('ShaderCompilationError');
    });
  });

  // ========== ERROR MESSAGE FORMATTING TESTS ==========

  describe('Error Message Formatting', () => {
    it('should format error with correct prefix', () => {
      const { formatErrorMessage } = window.GQRenderingErrors || {};
      if (!formatErrorMessage) return;

      const msg = formatErrorMessage('INIT', 'Container is missing', 'constructor');
      expect(msg).toContain('[GQ:render:init]');
      expect(msg).toContain('constructor');
      expect(msg).toContain('Container is missing');
    });

    it('should support all error prefixes', () => {
      const { ERROR_PREFIXES, formatErrorMessage } = window.GQRenderingErrors || {};
      if (!ERROR_PREFIXES || !formatErrorMessage) return;

      for (const [type] of Object.entries(ERROR_PREFIXES)) {
        const msg = formatErrorMessage(type, 'Test message');
        expect(msg).toBeDefined();
        expect(msg.length).toBeGreaterThan(0);
      }
    });
  });

  // ========== ERROR HANDLERS TESTS ==========

  describe('Error Handlers', () => {
    it('should log errors to console', () => {
      const { errorHandlers, ValidationError } = window.GQRenderingErrors || {};
      if (!errorHandlers || !ValidationError) return;

      const spy = spyOn(console, 'error');
      const err = new ValidationError('Test error', 'field', 'value');
      errorHandlers.logError(err, 'VALIDATION');

      expect(spy).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(jasmine.stringContaining('[GQ:render:validation]'));
    });

    it('should log warnings to console', () => {
      const { errorHandlers } = window.GQRenderingErrors || {};
      if (!errorHandlers) return;

      const spy = spyOn(console, 'warn');
      errorHandlers.logWarning('Test warning', 'FRAME');

      expect(spy).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(jasmine.stringContaining('[GQ:render:frame]'));
    });

    it('should emit error telemetry events', (done) => {
      const { errorHandlers, ValidationError } = window.GQRenderingErrors || {};
      if (!errorHandlers || !ValidationError) return;

      window.addEventListener('gq:render-telemetry-error', (evt) => {
        expect(evt.detail.ts).toBeDefined();
        expect(evt.detail.error).toBeDefined();
        done();
      });

      const err = new ValidationError('Test error');
      errorHandlers.emitErrorTelemetry(err, { context: 'test' });
    });

    it('should maintain error history', () => {
      const { errorHandlers, ValidationError } = window.GQRenderingErrors || {};
      if (!errorHandlers || !ValidationError) return;

      const err1 = new ValidationError('Error 1');
      const err2 = new ValidationError('Error 2');

      errorHandlers.emitErrorTelemetry(err1, {});
      errorHandlers.emitErrorTelemetry(err2, {});

      expect(window.__GQ_RENDER_ERRORS.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ========== VALIDATION HELPERS TESTS ==========

  describe('Validation Helpers', () => {
    it('should create property validators', () => {
      const { validationHelpers } = window.GQRenderingErrors || {};
      if (!validationHelpers) return;

      const validator = validationHelpers.createPropertyValidator('x', 'number', true);
      const obj = { x: 42 };
      
      expect(() => validator(obj)).not.toThrow();
    });

    it('should create function validators', () => {
      const { validationHelpers } = window.GQRenderingErrors || {};
      if (!validationHelpers) return;

      const validator = validationHelpers.createFunctionValidator('obj', 'update');
      const obj = { update: () => {} };
      
      expect(() => validator(obj)).not.toThrow();
    });

    it('should create enum validators', () => {
      const { validationHelpers } = window.GQRenderingErrors || {};
      if (!validationHelpers) return;

      const validator = validationHelpers.createEnumValidator('quality', ['low', 'medium', 'high']);
      
      expect(() => validator('medium')).not.toThrow();
      expect(() => validator('ultra')).toThrow();
    });
  });
});

// ========== RENDERING VALIDATION TESTS ==========

describe('GQRenderingValidation', () => {
  let originalTHREE;
  let testContainer;

  beforeEach(() => {
    originalTHREE = window.THREE;
    testContainer = document.createElement('div');
    testContainer.style.width = '800px';
    testContainer.style.height = '600px';
    document.body.appendChild(testContainer);
  });

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer);
    }
    if (originalTHREE !== undefined) {
      window.THREE = originalTHREE;
    }
  });

  describe('Container Validation', () => {
    it('should validate container existence', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) { 
        console.warn('GQRenderingValidation not loaded');
        return; 
      }

      expect(() => validators.validateContainer(null)).toThrow();
      expect(() => validators.validateContainer(undefined)).toThrow();
    });

    it('should validate container is HTMLElement', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      expect(() => validators.validateContainer('div')).toThrow();
      expect(() => validators.validateContainer({})).toThrow();
    });

    it('should validate container has dimensions', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      const emptyDiv = document.createElement('div');
      expect(() => validators.validateContainer(emptyDiv)).toThrow();
    });

    it('should accept valid container', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      expect(() => validators.validateContainer(testContainer)).not.toThrow();
    });
  });

  describe('THREE.js Runtime Validation', () => {
    it('should resolve THREE from window', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      // Only test if THREE is already loaded
      if (!window.THREE) {
        console.warn('THREE.js not loaded, skipping resolution test');
        return;
      }

      const three = validators.resolveThreeRuntime(window);
      expect(three).toBeDefined();
    });

    it('should throw error when THREE is missing', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      delete window.THREE;
      delete window.__GQ_THREE_RUNTIME;
      
      expect(() => validators.validateThreeRuntime(window)).toThrow();
    });
  });

  describe('Canvas Validation', () => {
    it('should allow null canvas', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      expect(validators.validateCanvas(null)).toBeNull();
    });

    it('should validate canvas is HTMLCanvasElement', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      expect(() => validators.validateCanvas('canvas')).toThrow();
    });

    it('should accept valid canvas', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      const canvas = document.createElement('canvas');
      expect(() => validators.validateCanvas(canvas)).not.toThrow();
    });
  });

  describe('Numeric Range Validation', () => {
    it('should validate numeric range', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      expect(() => validators.validateNumericRange(50, 0, 100, 'quality')).not.toThrow();
      expect(() => validators.validateNumericRange(150, 0, 100, 'quality')).toThrow();
      expect(() => validators.validateNumericRange(-1, 0, 100, 'quality')).toThrow();
    });

    it('should reject non-finite numbers', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      expect(() => validators.validateNumericRange(NaN, 0, 100, 'quality')).toThrow();
      expect(() => validators.validateNumericRange(Infinity, 0, 100, 'quality')).toThrow();
    });
  });

  describe('Shader Code Validation', () => {
    it('should validate shader code is non-empty string', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      const validShader = 'void main() { gl_FragColor = vec4(1.0); }';
      expect(() => validators.validateShaderCode(validShader, 'fragment')).not.toThrow();

      expect(() => validators.validateShaderCode('', 'fragment')).toThrow();
      expect(() => validators.validateShaderCode(null, 'fragment')).toThrow();
      expect(() => validators.validateShaderCode('   ', 'fragment')).toThrow();
    });
  });

  describe('Object Schema Validation', () => {
    it('should validate object schema', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      const schema = { x: 'number', y: 'number', color: 'string' };
      const validObj = { x: 10, y: 20, color: '#fff' };
      const invalidObj = { x: '10', y: 20, color: '#fff' };

      expect(() => validators.validateObjectSchema(validObj, schema)).not.toThrow();
      expect(() => validators.validateObjectSchema(invalidObj, schema)).toThrow();
    });
  });

  describe('Math Utils', () => {
    it('should ensure THREE.MathUtils exists', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      if (!window.THREE) {
        console.warn('THREE.js not loaded, skipping MathUtils test');
        return;
      }

      const result = validators.ensureThreeMathUtils(window);
      expect(result).toBe(true);
      expect(window.THREE.MathUtils).toBeDefined();
    });

    it('should provide fallback math functions', () => {
      const { validators } = window.GQRenderingValidation || {};
      if (!validators) return;

      const math = validators.getThreeMathUtils(window);
      
      expect(typeof math.clamp).toBe('function');
      expect(typeof math.lerp).toBe('function');
      expect(typeof math.degToRad).toBe('function');

      expect(math.clamp(50, 0, 100)).toBe(50);
      expect(math.lerp(0, 10, 0.5)).toBe(5);
      expect(Math.abs(math.degToRad(180) - Math.PI)).toBeLessThan(0.001);
    });
  });
});
