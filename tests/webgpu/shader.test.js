/**
 * tests/webgpu/shader.test.js
 *
 * Tests for ShaderCompiler utility (preprocessWGSL, injectHeader).
 * These are pure-JS, no GPU required.
 */

import { describe, it, expect } from 'vitest';
import { preprocessWGSL, injectHeader } from '../../js/engine/utils/ShaderCompiler.js';

describe('preprocessWGSL', () => {
  it('substitutes #define constants', () => {
    const src    = 'let x = WORKGROUP_SIZE;';
    const result = preprocessWGSL(src, { WORKGROUP_SIZE: 64 });
    expect(result).toContain('let x = 64;');
    expect(result).not.toContain('WORKGROUP_SIZE');
  });

  it('removes bare #define lines', () => {
    const src    = '#define FOO 42\nlet y = 1;';
    const result = preprocessWGSL(src, {});
    expect(result).not.toContain('#define');
    expect(result).toContain('let y = 1;');
  });

  it('keeps #ifdef block when key is defined', () => {
    const src = '#ifdef USE_BLOOM\nbloom code\n#endif';
    const result = preprocessWGSL(src, { USE_BLOOM: 1 });
    expect(result).toContain('bloom code');
  });

  it('removes #ifdef block when key is NOT defined', () => {
    const src = '#ifdef USE_BLOOM\nbloom code\n#endif';
    const result = preprocessWGSL(src, {});
    expect(result).not.toContain('bloom code');
  });

  it('keeps #ifndef block when key is NOT defined', () => {
    const src = '#ifndef LEGACY\nmodern code\n#endif';
    const result = preprocessWGSL(src, {});
    expect(result).toContain('modern code');
  });

  it('removes #ifndef block when key IS defined', () => {
    const src = '#ifndef LEGACY\nmodern code\n#endif';
    const result = preprocessWGSL(src, { LEGACY: 1 });
    expect(result).not.toContain('modern code');
  });
});

describe('injectHeader', () => {
  it('prepends a header comment', () => {
    const result = injectHeader('let x = 1;', 'test-shader');
    expect(result.startsWith('// GalaxyQuest Engine')).toBe(true);
    expect(result).toContain('test-shader');
    expect(result).toContain('let x = 1;');
  });
});
