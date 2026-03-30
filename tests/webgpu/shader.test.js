/**
 * tests/webgpu/shader.test.js
 *
 * Tests for ShaderCompiler utility (preprocessWGSL, glslToWgslStub).
 * These are pure-JS, no GPU required.
 */

import { describe, it, expect } from 'vitest';
import { preprocessWGSL, glslToWgslStub, injectHeader } from '../../js/engine/utils/ShaderCompiler.js';

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

describe('glslToWgslStub', () => {
  it('replaces gl_FragColor with fragColor', () => {
    const result = glslToWgslStub('gl_FragColor = vec4(1.0);');
    expect(result).toContain('fragColor');
    expect(result).not.toContain('gl_FragColor');
  });

  it('replaces gl_Position', () => {
    const result = glslToWgslStub('gl_Position = vec4(0.0);');
    expect(result).toContain('output.position');
  });

  it('replaces texture2D with textureSample', () => {
    const result = glslToWgslStub('color = texture2D(tex, uv);');
    expect(result).toContain('textureSample');
  });

  it('removes precision declarations', () => {
    const result = glslToWgslStub('precision highp float;\nvoid main() {}');
    expect(result).not.toContain('precision');
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
