// Only the opt-in evaluation adapter imports this chunk.
import '@babylonjs/core/Culling/ray.js'; // Registers Scene.pick for the modular build.
export { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine.js';
export { Engine } from '@babylonjs/core/Engines/engine.js';
export { Scene } from '@babylonjs/core/scene.js';
export { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
export { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
export { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
export { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
export { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
export { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
export const MeshBuilder = { CreateBox, CreateGround };
import glslangJs from '@babylonjs/core/assets/glslang/glslang.js?url';
import glslangWasm from '@babylonjs/core/assets/glslang/glslang.wasm?url';
import twgslJs from '@babylonjs/core/assets/twgsl/twgsl.js?url';
import twgslWasm from '@babylonjs/core/assets/twgsl/twgsl.wasm?url';

export const compilerOptions = [
  { jsPath: glslangJs, wasmPath: glslangWasm },
  { jsPath: twgslJs, wasmPath: twgslWasm },
];
