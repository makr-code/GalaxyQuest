/**
 * constants.js
 *
 * API constants and enumerations for the GalaxyQuest Engine.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const RendererType = Object.freeze({
  WEBGPU: 'webgpu',
  WEBGL2: 'webgl2',
  AUTO:   'auto',
});

const BufferType = Object.freeze({
  VERTEX:  'vertex',
  INDEX:   'index',
  UNIFORM: 'uniform',
  STORAGE: 'storage',
});

const BufferUsage = Object.freeze({
  STATIC:  'static',
  DYNAMIC: 'dynamic',
  STREAM:  'stream',
});

const TextureFormat = Object.freeze({
  RGBA8:    'rgba8unorm',
  RGBA16F:  'rgba16float',
  RGBA32F:  'rgba32float',
  R32F:     'r32float',
  DEPTH24:  'depth24plus',
  DEPTH32:  'depth32float',
  BGRA8:    'bgra8unorm',
});

const LightType = Object.freeze({
  AMBIENT:     'ambient',
  DIRECTIONAL: 'directional',
  POINT:       'point',
  SPOT:        'spot',
});

const CameraType = Object.freeze({
  PERSPECTIVE:   'perspective',
  ORTHOGRAPHIC:  'orthographic',
});

const QualityTier = Object.freeze({
  LOW:    'low',
  MEDIUM: 'medium',
  HIGH:   'high',
});

const PhysicsBackend = Object.freeze({
  CPU:     'cpu',     // JS SpacePhysicsEngine (always available)
  GPU:     'gpu',     // WebGPUPhysics (requires WebGPU + compute shaders)
  AUTO:    'auto',    // Use GPU if available, else CPU
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RendererType, BufferType, BufferUsage, TextureFormat, LightType, CameraType, QualityTier, PhysicsBackend };
} else {
  window.GQEngineConstants = { RendererType, BufferType, BufferUsage, TextureFormat, LightType, CameraType, QualityTier, PhysicsBackend };
}
