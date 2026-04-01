# WebGPU Engine Attribution — GalaxyQuest

> Dieses Dokument listet alle Quellen, Inspirationen und übernommenen Code-Teile  
> für die GalaxyQuest Engine (`js/engine/`).

---

## Lizenz-Übersicht

| Komponente | Quelle | Lizenz | Adaptionstyp |
|---|---|---|---|
| Math (Vector2/3/4, Matrix4, Quaternion) | Three.js | MIT | Inspiriert / duck-type-kompatibel |
| MathUtils | Three.js | MIT | Inspiriert |
| IGraphicsRenderer Interface | Babylon.js | Apache 2.0 | Konzept / eigene Implementierung |
| WebGPURenderer Device Init | WebGPU Samples | Apache 2.0 | Muster adaptiert |
| WebGLRenderer Wrapper | Three.js | MIT | Eigener Wrapper |
| RendererFactory | Babylon.js | Apache 2.0 | Konzept / eigene Implementierung |
| WebGPUBuffer | WebGPU Samples + Babylon.js | Apache 2.0 | Muster adaptiert |
| WebGPUTexture | Three.js + Babylon.js | MIT + Apache 2.0 | Muster adaptiert |
| WebGPUShader Pipeline Cache | Babylon.js | Apache 2.0 | Konzept adaptiert |
| WebGPURenderPass | WebGPU Samples | Apache 2.0 | Muster adaptiert |
| WebGPUCompute | WebGPU Samples + Babylon.js | Apache 2.0 | Muster adaptiert |
| WebGPUResourcePool | Three.js + Babylon.js | MIT + Apache 2.0 | Konzept adaptiert |
| **WebGPUPhysics (WGSL N-body)** | WebGPU Samples (Compute Boids) | Apache 2.0 | WGSL Muster adaptiert |
| SceneGraph | OSG.JS | MIT | Konzept adaptiert |
| Camera System | Three.js | MIT | Inspiriert / eigene Matrix-Implementierung |
| Transform Hierarchies | Three.js | MIT | Inspiriert |
| EffectComposer | Three.js | MIT | Konzept adaptiert |
| Bloom Pass | Three.js + Babylon.js | MIT + Apache 2.0 | WGSL Neuimplementierung |
| Vignette Pass | Three.js (VignetteShader) | MIT | WGSL Neuimplementierung |
| Chromatic Aberration | Three.js (RGBShiftShader) | MIT | WGSL Neuimplementierung |
| ShaderCompiler (Preprocessor) | Babylon.js | Apache 2.0 | Konzept / eigene Implementierung |
| WebGPUCapabilities | Three.js + Babylon.js | MIT + Apache 2.0 | Konzept adaptiert |
| SpacePhysicsEngine | GalaxyQuest (Original) | MIT | Kein Fremdcode |
| Post-Effects Pipeline | GalaxyQuest (Original) | MIT | Kein Fremdcode |

---

## Detaillierte Quellen

### Three.js (MIT License)

```
Copyright © 2010-2024 three.js authors
https://github.com/mrdoob/three.js
License: https://github.com/mrdoob/three.js/blob/dev/LICENSE
```

**Verwendung in GalaxyQuest Engine:**
- `js/engine/math/Vector2.js` — Inspiriert durch `three/src/math/Vector2.js`
- `js/engine/math/Vector3.js` — Inspiriert durch `three/src/math/Vector3.js`
- `js/engine/math/Vector4.js` — Inspiriert durch `three/src/math/Vector4.js`
- `js/engine/math/Matrix4.js` — Inspiriert durch `three/src/math/Matrix4.js` + glMatrix
- `js/engine/math/Quaternion.js` — Inspiriert durch `three/src/math/Quaternion.js`
- `js/engine/math/MathUtils.js` — Inspiriert durch `three/src/math/MathUtils.js`
- `js/engine/core/WebGLRenderer.js` — Wrapper um THREE.WebGLRenderer
- `js/engine/scene/Camera.js` — Inspiriert durch THREE.PerspectiveCamera / OrthographicCamera
- `js/engine/scene/SceneGraph.js` — Inspiriert durch THREE.Scene / Object3D
- `js/engine/scene/Transform.js` — Inspiriert durch THREE.Object3D
- `js/engine/post-effects/EffectComposer.js` — Konzept: three/examples/jsm/postprocessing/EffectComposer.js
- `js/engine/post-effects/shaders/vignette.wgsl` — WGSL-Port von THREE.VignetteShader
- `js/engine/post-effects/shaders/chromatic.wgsl` — WGSL-Port von THREE.RGBShiftShader
- `js/engine/webgpu/WebGPUResourcePool.js` — Konzept: Three.js RenderTarget Pooling

**Wichtig:** Duck-Type-Kompatibilität (.x/.y/.z, .elements[16]) ist bewusst gewählt,  
damit bestehender GalaxyQuest-Code weiter funktioniert ohne Anpassungen.

---

### Babylon.js (Apache License 2.0)

```
Copyright © 2013-present Babylon.js contributors
https://github.com/BabylonJS/Babylon.js
License: https://github.com/BabylonJS/Babylon.js/blob/master/license.md
```

**Verwendung in GalaxyQuest Engine:**
- `js/engine/core/GraphicsContext.js` — Konzept: `ThinEngine` Abstraction Layer
- `js/engine/core/RendererFactory.js` — Konzept: `EngineFactory.CreateAsync`
- `js/engine/core/WebGPURenderer.js` — Device-Init Pattern aus `WebGPUEngine`
- `js/engine/webgpu/WebGPUBuffer.js` — Pattern aus `WebGPUDataBuffer`
- `js/engine/webgpu/WebGPUShader.js` — Pipeline-Cache-Konzept aus `WebGPUPipelineContext`
- `js/engine/webgpu/WebGPUCompute.js` — Konzept: `ComputeShader` Klasse
- `js/engine/utils/ShaderCompiler.js` — Konzept: `WebGPUShaderProcessor`
- `js/engine/utils/WebGPUCapabilities.js` — Konzept: `WebGPUEngine.initializeLimits`
- `js/engine/post-effects/shaders/bloom.wgsl` — WGSL-Neuimplementierung inspiriert durch `BloomEffect`

**Gemäß Apache 2.0:** Attribution-Header in jedem adaptierten File vorhanden.

---

### WebGPU Samples (Apache License 2.0)

```
Copyright © 2019-2024 Google LLC and WebGPU contributors
https://github.com/webgpu/webgpu-samples
License: https://github.com/webgpu/webgpu-samples/blob/main/LICENSE.txt
```

**Verwendung in GalaxyQuest Engine:**
- `js/engine/core/WebGPURenderer.js` — Device-Init + Swap-Chain-Setup aus `sample/helloTriangle`
- `js/engine/webgpu/WebGPUBuffer.js` — `createBuffer` Helper-Muster
- `js/engine/webgpu/WebGPURenderPass.js` — Render-Pass-Encoder-Muster
- `js/engine/webgpu/WebGPUCompute.js` — Compute-Dispatch + Async-Readback aus `sample/bitonicSort`
- **`js/engine/webgpu/WebGPUPhysics.js` — N-body WGSL Muster aus `sample/computeBoids`** ⭐
- `js/engine/post-effects/shaders/bloom.wgsl` — Screen-Quad Vertex-Shader-Muster

**Gemäß Apache 2.0:** Attribution-Header in jedem adaptierten File vorhanden.

---

### PlayCanvas Engine (MIT License)

```
Copyright © 2011-2024 PlayCanvas Ltd.
https://github.com/playcanvas/engine
License: https://github.com/playcanvas/engine/blob/main/LICENSE
```

**Verwendung in GalaxyQuest Engine:**
- `js/engine/core/GraphicsContext.js` — Konzept: `GraphicsDevice` Base Class
- `js/engine/core/WebGLRenderer.js` — Konzept: `WebglGraphicsDevice`

---

### OSG.JS (MIT License)

```
Copyright © 2010-2020 Cedric Pinson and contributors
https://github.com/cedricpinson/osgjs
License: MIT
```

**Verwendung in GalaxyQuest Engine:**
- `js/engine/scene/SceneGraph.js` — Scene-Graph-Konzepte (Node, Visitor Pattern)

---

### glMatrix (MIT License)

```
Copyright © 2015-2021 Brandon Jones, Colin MacKenzie IV
https://github.com/toji/gl-matrix
License: MIT
```

**Verwendung in GalaxyQuest Engine:**
- `js/engine/math/Matrix4.js` — Column-major Layout, Multiply-Algorithmus

---

## Wikipedia: List of WebGL Frameworks — Bewertung für GalaxyQuest

Quelle: https://en.wikipedia.org/wiki/List_of_WebGL_frameworks

### Alle evaluierten Frameworks

| Framework | Lizenz | WebGPU | Für GQ relevant | Begründung |
|---|---|---|---|---|
| **Three.js** | MIT | ✅ (r156+) | ✅ **Primär genutzt** | Bestehende Implementierung, Math-Layer, Fallback-Renderer |
| **Babylon.js** | Apache 2.0 | ✅ Vollständig | ✅ **Inspiration Engine-Design** | Beste WebGPU-Implementierung als Vorbild, Shader-System |
| **PlayCanvas** | MIT (Engine) | 🔬 Experimentell | ✅ **Inspiration Architektur** | GraphicsDevice-Abstraktion adaptiert |
| **OSG.JS** | MIT | ❌ | ✅ **Inspiration Scene Graph** | SceneGraph-Konzepte übernommen |
| **A-Frame** | MIT | ❌ | ⭐ ECS-Konzept | Entity-Component-System als Inspiration für zukünftige Architektur |
| **Away3D** | Apache 2.0 | ❌ | ⭐ Animations-Konzepte | TypeScript-First Design als Referenz |
| **CopperLicht** | zlib | ❌ | ⭐ Game-Loop-Muster | Schlanke WebGL Game-Engine als Vergleich |
| **JanusWeb** | MIT | ❌ | ➖ VR-fokussiert | Nicht relevant für GQ |
| **LayaAir** | Open Source | ❌ | ➖ Mobile-fokussiert | Nicht relevant für GQ |
| **Sketchfab** | Proprietär | Proprietär | ❌ | Proprietär, nicht adaptierbar |
| **Verge3D** | Proprietär | Proprietär | ❌ | Proprietär, nicht adaptierbar |
| **Clara.io** | Freemium | Freemium | ❌ | Cloud-abhängig, nicht adaptierbar |
| **Unity (WebGL)** | Proprietär | Proprietär | ❌ | C#/WASM Stack, nicht adaptierbar |
| **Kubity** | Proprietär | Proprietär | ❌ | Proprietär, nicht adaptierbar |

### Entscheidung: Eigene Engine

Kein bestehendes Framework erfüllt alle Anforderungen:
- Spezifische Space-Game-Physik (N-body Gravity)
- Tief integriertes WebGPU Compute für NPC-AI
- Direkter Zugriff auf Storage Buffers für Spielzustand
- **Deshalb:** Eigene Engine mit selektivem Code-Borrowing aus Open-Source-Projekten

---

## Apache 2.0 Volltext

Gemäß Apache License 2.0 (für Babylon.js + WebGPU Samples Komponenten):

```
Apache License, Version 2.0
https://www.apache.org/licenses/LICENSE-2.0

NOTICE: This product includes software developed at
- The Babylon.js project (https://www.babylonjs.com)
- The WebGPU Samples project (https://webgpu.github.io/webgpu-samples)

These components are used under the terms of the Apache License 2.0.
See individual file headers for specific attribution.
```

---

## MIT Volltext (GalaxyQuest Engine)

```
MIT License

Copyright (c) 2024-2026 makr-code/GalaxyQuest contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```
