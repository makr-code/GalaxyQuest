# WebGPU Engine API Reference — GalaxyQuest

---

## RendererFactory

```typescript
class RendererFactory {
  static create(
    canvas: HTMLCanvasElement,
    opts?: { hint?: 'webgpu'|'webgl2'|'auto', onFallback?: (reason: string, err: Error|null) => void }
  ): Promise<IGraphicsRenderer>

  static isWebGPUAvailable(): Promise<boolean>
}
```

---

## IGraphicsRenderer

```typescript
interface IGraphicsRenderer {
  initialize(canvas: HTMLCanvasElement): Promise<void>
  getCapabilities(): RendererCapabilities
  createBuffer(type: BufferType, data: BufferSource, usage?: BufferUsage): GPUBuffer|Object
  createTexture(spec: TextureSpec): WebGPUTexture|THREE.Texture
  createShader(vertexSrc: string, fragmentSrc: string): ShaderHandle
  createRenderPass(config: Object): RenderPassHandle
  render(scene: Object, camera: Object): void
  resize(width: number, height: number): void
  dispose(): void
}
```

---

## WebGPUBuffer

```typescript
class WebGPUBuffer {
  constructor(device: GPUDevice, type: BufferType, dataOrSize: BufferSource|number, usage?: BufferUsage)
  get gpuBuffer(): GPUBuffer
  get size(): number
  update(data: BufferSource, byteOffset?: number): void
  destroy(): void
}

const BufferType  = { VERTEX, INDEX, UNIFORM, STORAGE }
const BufferUsage = { STATIC, DYNAMIC, STREAM }
```

---

## WebGPUTexture

```typescript
class WebGPUTexture {
  constructor(device: GPUDevice, spec: {
    width: number, height: number, depth?: number,
    format?: GPUTextureFormat, mipMaps?: boolean,
    renderTarget?: boolean, cubemap?: boolean, label?: string
  })
  get gpuTexture(): GPUTexture
  get sampler(): GPUSampler
  createView(opts?: GPUTextureViewDescriptor): GPUTextureView
  uploadImage(source: ImageBitmap|HTMLCanvasElement, layer?: number): void
  uploadData(data: TypedArray, layer?: number): void
  destroy(): void
}
```

---

## WebGPUShader

```typescript
class WebGPUShader {
  constructor(device: GPUDevice)
  compileRenderPipeline(spec: {
    vertexSrc: string, fragmentSrc: string,
    bufferLayouts?: GPUVertexBufferLayout[],
    targetFormat?: GPUTextureFormat,
    depthTest?: boolean, blend?: GPUBlendState, cacheKey?: string
  }): GPURenderPipeline
  compileComputePipeline(computeSrc: string, cacheKey?: string): GPUComputePipeline
  dispose(): void
}
```

---

## WebGPUPhysics

```typescript
class WebGPUPhysics {
  constructor(device: GPUDevice, engineOpts?: {
    gravitationalConstant?: number,  // default: 9.5e-4
    softening?: number,              // default: 180
    maxAcceleration?: number,        // default: 420
  })

  init(): void
  // Must be called once before step()

  uploadBodies(bodies: Map<number, SpaceBody>): void
  // Pack JS body states into GPU storage buffers
  // SpaceBody: { position, velocity, mass, drag, thrust, maxSpeed, staticBody }

  step(dtSeconds: number): void
  // Dispatch compute shader (non-blocking)

  readback(bodies: Map<number, SpaceBody>): Promise<void>
  // Async copy GPU results back into JS body objects

  dispose(): void
}

// Body layout in GPU buffer (64 bytes, BODY_STRIDE=16 floats):
// [0..2]  position.xyz  [3]   mass
// [4..6]  velocity.xyz  [7]   drag
// [8..10] thrust.xyz    [11]  maxSpeed
// [12]    isStatic      [13..15] padding
```

---

## Math

```typescript
class Vector2 { x: number; y: number; add(v); sub(v); multiplyScalar(s); length(); normalize(); dot(v); angle(); toArray(arr?, offset?); }
class Vector3 { x; y; z; add; sub; multiplyScalar; cross; dot; length; normalize; lerp; distanceTo; negate; toArray; }
class Vector4 { x; y; z; w; add; multiplyScalar; length; normalize; dot; toArray; }
class Matrix4 { elements: Float32Array; identity(); multiply(m); multiplyMatrices(a,b); compose(pos,quat,scale); makePerspective(fovY,aspect,near,far); makeOrthographic(...); toArray(); }
class Quaternion { x; y; z; w; identity(); setFromAxisAngle(axis,angle); multiply(q); slerp(q,t); conjugate(); rotateVector3(v); }

const MathUtils = {
  clamp, lerp, smoothstep, degToRad, radToDeg,
  isPow2, nextPow2, seededRandom
}
```

---

## PerformanceMonitor

```typescript
class PerformanceMonitor {
  constructor(opts?: { sampleWindow?: number, warnThresholdFps?: number })
  tick(ts?: number): void
  sampleGpuMemory(device?: GPUDevice): void
  stats(): { fps: number, frameTimeMs: number, gpuMemoryMb: number }
  reset(): void
  fps: number
  frameTimeMs: number
}
```

---

## ResourceTracker

```typescript
class ResourceTracker {
  track<T>(resource: T): T
  dispose(resource: Object): void
  disposeAll(): void
  report(): number   // returns count of live resources
  size: number
}
```

---

## ShaderCompiler

```typescript
function preprocessWGSL(src: string, defines: Record<string,any>): string
function glslToWgslStub(glsl: string): string
function injectHeader(src: string, label?: string): string
```

---

## GQEngineCompat (global)

```typescript
window.GQEngineCompat = {
  getRenderer(canvas: HTMLCanvasElement): Promise<IGraphicsRenderer>
  activeRenderer: IGraphicsRenderer | null
  isWebGPU: boolean
  setHint(hint: 'webgpu'|'webgl2'|'auto'): void
}

// Event: 'gq:rendererReady'
window.addEventListener('gq:rendererReady', ({ detail }) => {
  detail.renderer  // IGraphicsRenderer
  detail.backend   // 'webgpu' | 'webgl2'
})
```

---

## Constants

```typescript
const RendererType   = { WEBGPU, WEBGL2, AUTO }
const BufferType     = { VERTEX, INDEX, UNIFORM, STORAGE }
const BufferUsage    = { STATIC, DYNAMIC, STREAM }
const TextureFormat  = { RGBA8, RGBA16F, RGBA32F, R32F, DEPTH24, DEPTH32, BGRA8 }
const LightType      = { AMBIENT, DIRECTIONAL, POINT, SPOT }
const CameraType     = { PERSPECTIVE, ORTHOGRAPHIC }
const QualityTier    = { LOW, MEDIUM, HIGH }
const PhysicsBackend = { CPU, GPU, AUTO }
```
