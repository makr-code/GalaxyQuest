/**
 * Galaxy3DRendererWebGPU.js
 *
 * Interactive WebGPU galaxy renderer — replaces the Three.js Galaxy3DRenderer
 * for the in-game galaxy and system views.
 *
 * Drop-in replacement for window.Galaxy3DRenderer.  Exposes the same public
 * API surface so game.js needs no modifications.  Falls back to the Three.js
 * renderer transparently when WebGPU is unavailable.
 *
 * Browser support:
 *   Chrome 113+ / Edge 113+ — WebGPU primary
 *   Firefox 119+ (dom.webgpu.enabled=true) — WebGPU primary
 *   Safari 17.4+ (experimental) — WebGPU primary
 *   All others — WebGL2 via Three.js fallback
 *
 * License: MIT — makr-code/GalaxyQuest
 */

(function () {
  'use strict';

  // ── WGSL shaders ───────────────────────────────────────────────────────────

  /** Star-point vertex + fragment shader. */
  const STAR_SHADER_WGSL = /* wgsl */`
    struct ViewUniforms {
      panX        : f32,
      panY        : f32,
      zoom        : f32,
      aspect      : f32,
      selectedIdx : i32,
      hoveredIdx  : i32,
      pxToNdcX    : f32,
      pxToNdcY    : f32,
    };

    @group(0) @binding(0) var<uniform> uView : ViewUniforms;

    struct StarAttribs {
      @location(0) pos   : vec2<f32>,   // normalised [−1,1]
      @location(1) color : vec4<f32>,   // rgba
      @location(2) index : u32,         // star index (for selection highlight)
    };

    struct VSOut {
      @builtin(position)   clipPos : vec4<f32>,
      @location(0)         color   : vec4<f32>,
      @location(1)         spriteUv : vec2<f32>,
    };

    struct FSIn {
      @location(0) color : vec4<f32>,
      @location(1) spriteUv : vec2<f32>,
    };

    @vertex
    fn vs_main(in : StarAttribs, @builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32) -> VSOut {
      var out : VSOut;

      let corners = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0)
      );
      let corner = corners[vertexIndex];

      let worldX = (in.pos.x + uView.panX) * uView.zoom;
      let worldY = (in.pos.y + uView.panY) * uView.zoom;
      let baseClip = vec2<f32>(worldX / uView.aspect, worldY);

      var brightness = 1.0;
      var sz = 2.5;

      let selected = i32(instanceIndex) == uView.selectedIdx;
      let hovered  = i32(instanceIndex) == uView.hoveredIdx;

      if (selected) {
        brightness = 2.2;
        sz = 5.0;
      } else if (hovered) {
        brightness = 1.7;
        sz = 4.0;
      }

      let clipOffset = vec2<f32>(corner.x * sz * uView.pxToNdcX, corner.y * sz * uView.pxToNdcY);
      out.clipPos = vec4<f32>(baseClip + clipOffset, 0.0, 1.0);
      out.color  = vec4<f32>(in.color.rgb * brightness, in.color.a);
      out.spriteUv = corner;
      return out;
    }

    @fragment
    fn fs_main(in : FSIn) -> @location(0) vec4<f32> {
      let dist = length(in.spriteUv);
      if (dist > 1.0) {
        discard;
      }
      let alpha = (1.0 - smoothstep(0.55, 1.0, dist)) * in.color.a;
      return vec4<f32>(in.color.rgb, alpha);
    }
  `;

  const HERO_STAR_SHADER_WGSL = /* wgsl */`
    struct HeroUniforms {
      centerX       : f32,
      centerY       : f32,
      radius        : f32,
      aspect        : f32,
      time          : f32,
      baseR         : f32,
      baseG         : f32,
      baseB         : f32,
      coronaR       : f32,
      coronaG       : f32,
      coronaB       : f32,
      coronaOpacity : f32,
      haloScale     : f32,
      zoom          : f32,
      pad0          : f32,
      pad1          : f32,
    };

    @group(0) @binding(0) var<uniform> uHero : HeroUniforms;

    struct HeroIn {
      @location(0) pos    : vec3<f32>,
      @location(1) normal : vec3<f32>,
      @location(2) uv     : vec2<f32>,
    };

    struct HeroOut {
      @builtin(position) clipPos : vec4<f32>,
      @location(0) normal : vec3<f32>,
      @location(1) uv     : vec2<f32>,
      @location(2) worldZ : f32,
    };

    fn rotateY(v : vec3<f32>, angle : f32) -> vec3<f32> {
      let c = cos(angle);
      let s = sin(angle);
      return vec3<f32>(v.x * c - v.z * s, v.y, v.x * s + v.z * c);
    }

    fn rotateX(v : vec3<f32>, angle : f32) -> vec3<f32> {
      let c = cos(angle);
      let s = sin(angle);
      return vec3<f32>(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
    }

    @vertex
    fn vs_main(in : HeroIn) -> HeroOut {
      var out : HeroOut;
      let spin = uHero.time * 0.24;
      let tilt = 0.2 + sin(uHero.time * 0.11) * 0.08;
      var pos = rotateX(rotateY(in.pos, spin), tilt);
      var normal = normalize(rotateX(rotateY(in.normal, spin), tilt));

      let plasma = sin(in.uv.x * 18.0 + uHero.time * 1.8)
                 * sin(in.uv.y * 12.0 - uHero.time * 1.25)
                 * sin((in.uv.x + in.uv.y) * 9.0 + uHero.time * 0.9);
      let displacement = 1.0 + plasma * 0.028;
      pos = pos * displacement * uHero.haloScale;

      out.clipPos = vec4<f32>(
        uHero.centerX + (pos.x * uHero.radius) / max(uHero.aspect, 0.0001),
        uHero.centerY + pos.y * uHero.radius,
        pos.z * uHero.radius * 0.5,
        1.0
      );
      out.normal = normal;
      out.uv = in.uv;
      out.worldZ = pos.z;
      return out;
    }

    @fragment
    fn fs_main(in : HeroOut) -> @location(0) vec4<f32> {
      let lightDir = normalize(vec3<f32>(-0.45, 0.35, 1.0));
      let ndl = max(dot(normalize(in.normal), lightDir), 0.0);
      let rim = pow(1.0 - max(in.normal.z, 0.0), 2.8);
      let plasma = (
        sin(in.uv.x * 22.0 + uHero.time * 1.7) +
        sin(in.uv.y * 17.0 - uHero.time * 1.4) +
        sin((in.uv.x + in.uv.y) * 11.0 + uHero.time * 0.8)
      ) / 3.0;
      let plasmaMask = 0.5 + 0.5 * plasma;
      let base = vec3<f32>(uHero.baseR, uHero.baseG, uHero.baseB);
      let corona = vec3<f32>(uHero.coronaR, uHero.coronaG, uHero.coronaB);
      let glow = rim * (0.32 + plasmaMask * 0.68);
      let color = base * (0.45 + ndl * 0.9)
                + corona * (glow * (0.65 + plasmaMask * 0.35))
                + base * plasmaMask * 0.22;
      let alpha = clamp(0.94 + rim * 0.06, 0.0, 1.0);
      return vec4<f32>(color, alpha);
    }
  `;

  const HERO_CORONA_SHADER_WGSL = /* wgsl */`
    struct HeroUniforms {
      centerX       : f32,
      centerY       : f32,
      radius        : f32,
      aspect        : f32,
      time          : f32,
      baseR         : f32,
      baseG         : f32,
      baseB         : f32,
      coronaR       : f32,
      coronaG       : f32,
      coronaB       : f32,
      coronaOpacity : f32,
      haloScale     : f32,
      zoom          : f32,
      pad0          : f32,
      pad1          : f32,
    };

    @group(0) @binding(0) var<uniform> uHero : HeroUniforms;

    struct HeroIn {
      @location(0) pos    : vec3<f32>,
      @location(1) normal : vec3<f32>,
      @location(2) uv     : vec2<f32>,
    };

    struct HeroOut {
      @builtin(position) clipPos : vec4<f32>,
      @location(0) normal : vec3<f32>,
      @location(1) uv     : vec2<f32>,
    };

    fn rotateY(v : vec3<f32>, angle : f32) -> vec3<f32> {
      let c = cos(angle);
      let s = sin(angle);
      return vec3<f32>(v.x * c - v.z * s, v.y, v.x * s + v.z * c);
    }

    @vertex
    fn vs_main(in : HeroIn) -> HeroOut {
      var out : HeroOut;
      let spin = uHero.time * 0.12;
      let pos = rotateY(in.pos, spin) * uHero.haloScale;
      out.clipPos = vec4<f32>(
        uHero.centerX + (pos.x * uHero.radius) / max(uHero.aspect, 0.0001),
        uHero.centerY + pos.y * uHero.radius,
        pos.z * uHero.radius * 0.35,
        1.0
      );
      out.normal = normalize(rotateY(in.normal, spin));
      out.uv = in.uv;
      return out;
    }

    @fragment
    fn fs_main(in : HeroOut) -> @location(0) vec4<f32> {
      let rim = pow(1.0 - max(in.normal.z, 0.0), 2.1);
      let plasma = 0.5 + 0.5 * sin((in.uv.x * 20.0) + (in.uv.y * 16.0) + uHero.time * 1.15);
      let corona = vec3<f32>(uHero.coronaR, uHero.coronaG, uHero.coronaB);
      let alpha = rim * (0.18 + plasma * uHero.coronaOpacity);
      return vec4<f32>(corona * (0.55 + plasma * 0.7), alpha);
    }
  `;

  const PLANET_SHADER_WGSL = /* wgsl */`
    struct PlanetUniforms {
      centerX    : f32,
      centerY    : f32,
      radius     : f32,
      aspect     : f32,
      time       : f32,
      seed       : f32,
      cloudiness : f32,
      emissive   : f32,
      baseR      : f32,
      baseG      : f32,
      baseB      : f32,
      water      : f32,
      accentR    : f32,
      accentG    : f32,
      accentB    : f32,
      pad0       : f32,
    };

    @group(0) @binding(0) var<uniform> uPlanet : PlanetUniforms;

    struct PlanetIn {
      @location(0) pos    : vec3<f32>,
      @location(1) normal : vec3<f32>,
      @location(2) uv     : vec2<f32>,
    };

    struct PlanetOut {
      @builtin(position) clipPos : vec4<f32>,
      @location(0) normal : vec3<f32>,
      @location(1) uv     : vec2<f32>,
    };

    fn rotateY(v : vec3<f32>, angle : f32) -> vec3<f32> {
      let c = cos(angle);
      let s = sin(angle);
      return vec3<f32>(v.x * c - v.z * s, v.y, v.x * s + v.z * c);
    }

    @vertex
    fn vs_main(in : PlanetIn) -> PlanetOut {
      var out : PlanetOut;
      let spin = uPlanet.time * (0.12 + uPlanet.seed * 0.04);
      let pos = rotateY(in.pos, spin);
      let normal = normalize(rotateY(in.normal, spin));
      out.clipPos = vec4<f32>(
        uPlanet.centerX + (pos.x * uPlanet.radius) / max(uPlanet.aspect, 0.0001),
        uPlanet.centerY + pos.y * uPlanet.radius,
        pos.z * uPlanet.radius * 0.25,
        1.0
      );
      out.normal = normal;
      out.uv = in.uv;
      return out;
    }

    @fragment
    fn fs_main(in : PlanetOut) -> @location(0) vec4<f32> {
      let lightDir = normalize(vec3<f32>(-0.3, 0.25, 1.0));
      let ndl = max(dot(normalize(in.normal), lightDir), 0.0);
      let latBands = 0.5 + 0.5 * sin((in.uv.y * 18.0 + uPlanet.seed * 5.3) + uPlanet.time * 0.18);
      let terrain = 0.5 + 0.5 * sin((in.uv.x * 15.0) + (in.uv.y * 11.0) + uPlanet.seed * 9.0);
      let waterMask = step(terrain, uPlanet.water);
      let base = vec3<f32>(uPlanet.baseR, uPlanet.baseG, uPlanet.baseB);
      let accent = vec3<f32>(uPlanet.accentR, uPlanet.accentG, uPlanet.accentB);
      let land = mix(base, accent, latBands * 0.5 + terrain * 0.5);
      let ocean = mix(vec3<f32>(0.05, 0.12, 0.2), base, 0.78);
      let surface = mix(land, ocean, waterMask * 0.82);
      let cloudMask = smoothstep(0.58, 0.88, 0.5 + 0.5 * sin((in.uv.x * 24.0) - (in.uv.y * 13.0) + uPlanet.time * 0.26 + uPlanet.seed * 3.0));
      surface = mix(surface, vec3<f32>(1.0, 1.0, 1.0), cloudMask * uPlanet.cloudiness * 0.45);
      let rim = pow(1.0 - max(in.normal.z, 0.0), 3.0);
      let color = surface * (0.24 + ndl * 0.92) + accent * (rim * 0.18 + uPlanet.emissive * 0.12);
      return vec4<f32>(color, 1.0);
    }
  `;

  const ORBIT_SHADER_WGSL = /* wgsl */`
    struct OrbitUniforms {
      centerX : f32,
      centerY : f32,
      radiusX : f32,
      radiusY : f32,
      aspect  : f32,
      colorR  : f32,
      colorG  : f32,
      colorB  : f32,
      alpha   : f32,
      pad0    : f32,
      pad1    : f32,
      pad2    : f32,
    };

    @group(0) @binding(0) var<uniform> uOrbit : OrbitUniforms;

    struct OrbitIn {
      @location(0) pos : vec2<f32>,
    };

    struct OrbitOut {
      @builtin(position) clipPos : vec4<f32>,
      @location(0) color : vec4<f32>,
    };

    @vertex
    fn vs_main(in : OrbitIn) -> OrbitOut {
      var out : OrbitOut;
      out.clipPos = vec4<f32>(
        uOrbit.centerX + (in.pos.x * uOrbit.radiusX) / max(uOrbit.aspect, 0.0001),
        uOrbit.centerY + in.pos.y * uOrbit.radiusY,
        0.0,
        1.0
      );
      out.color = vec4<f32>(uOrbit.colorR, uOrbit.colorG, uOrbit.colorB, uOrbit.alpha);
      return out;
    }

    @fragment
    fn fs_main(in : OrbitOut) -> @location(0) vec4<f32> {
      return in.color;
    }
  `;

  // ── Utilities ──────────────────────────────────────────────────────────────

  function emitRenderTelemetry(type, payload) {
    const detail = Object.assign({ type, ts: Date.now(), source: 'galaxy3d-webgpu-renderer' }, payload || {});
    try {
      if (!Array.isArray(window.__GQ_RENDER_TELEMETRY)) window.__GQ_RENDER_TELEMETRY = [];
      window.__GQ_RENDER_TELEMETRY.push(detail);
      if (window.__GQ_RENDER_TELEMETRY.length > 300) {
        window.__GQ_RENDER_TELEMETRY.splice(0, window.__GQ_RENDER_TELEMETRY.length - 300);
      }
      window.dispatchEvent(new CustomEvent('gq:render-telemetry', { detail }));
    } catch (_) {}
  }

  async function probeWebGPU() {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    try { return (await navigator.gpu.requestAdapter()) !== null; } catch { return false; }
  }

  /**
   * Normalise star array → packed Float32Array(n*6): x,y, r,g,b,a
   * Returns { attribs, scale, stars }
   */
  function buildStarAttribs(stars) {
    const list = Array.isArray(stars) && stars.length ? stars : [];
    let maxAbs = 1;
    for (const s of list) {
      maxAbs = Math.max(maxAbs,
        Math.abs(Number(s.x_ly || s.x || 0)),
        Math.abs(Number(s.y_ly || s.y || 0)));
    }
    const scale = maxAbs > 0 ? 1 / maxAbs : 1;
    // 6 floats per star: posX, posY, r, g, b, a
    const buf = new Float32Array(list.length * 6);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      buf[i * 6 + 0] = Number(s.x_ly || s.x || 0) * scale;
      buf[i * 6 + 1] = Number(s.y_ly || s.y || 0) * scale;
      // Star colour from empire or spectral type
      const c = _starColor(s);
      buf[i * 6 + 2] = c[0];
      buf[i * 6 + 3] = c[1];
      buf[i * 6 + 4] = c[2];
      buf[i * 6 + 5] = c[3];
    }
    return { attribs: buf, scale, stars: list };
  }

  /** Derive a soft RGB colour from a star object (spectral class or empire). */
  function _starColor(s) {
    if (s && s.__empireColor) {
      const r = parseInt(s.__empireColor.slice(1, 3), 16) / 255;
      const g = parseInt(s.__empireColor.slice(3, 5), 16) / 255;
      const b = parseInt(s.__empireColor.slice(5, 7), 16) / 255;
      return [r, g, b, 1.0];
    }
    const spectral = String(s?.spectral_class || s?.type || '').charAt(0).toUpperCase();
    switch (spectral) {
      case 'O': return [0.68, 0.81, 1.00, 1.0];
      case 'B': return [0.75, 0.88, 1.00, 1.0];
      case 'A': return [0.90, 0.93, 1.00, 1.0];
      case 'F': return [1.00, 1.00, 0.95, 1.0];
      case 'G': return [1.00, 0.96, 0.82, 1.0];
      case 'K': return [1.00, 0.85, 0.55, 1.0];
      case 'M': return [1.00, 0.60, 0.40, 1.0];
      default:  return [0.88, 0.90, 0.96, 1.0];
    }
  }

  function _starCoronaColor(star) {
    const base = _starColor(star);
    return [
      Math.min(1, base[0] * 1.15 + 0.12),
      Math.min(1, base[1] * 1.08 + 0.1),
      Math.min(1, base[2] * 1.05 + 0.08),
    ];
  }

  function buildSphereGeometry(latSegments, lonSegments) {
    const latCount = Math.max(8, Math.floor(latSegments || 16));
    const lonCount = Math.max(12, Math.floor(lonSegments || 24));
    const verts = [];
    const indices = [];

    for (let y = 0; y <= latCount; y++) {
      const v = y / latCount;
      const theta = v * Math.PI;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      for (let x = 0; x <= lonCount; x++) {
        const u = x / lonCount;
        const phi = u * Math.PI * 2;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);
        const px = sinTheta * cosPhi;
        const py = cosTheta;
        const pz = sinTheta * sinPhi;
        verts.push(px, py, pz, px, py, pz, u, v);
      }
    }

    const stride = lonCount + 1;
    for (let y = 0; y < latCount; y++) {
      for (let x = 0; x < lonCount; x++) {
        const a = y * stride + x;
        const b = a + stride;
        indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }

    const vertexData = new Float32Array(verts);
    const indexCount = indices.length;
    const useUint32 = vertexData.length / 8 > 65535;
    const indexData = useUint32 ? new Uint32Array(indices) : new Uint16Array(indices);
    return {
      vertexData,
      indexData,
      indexFormat: useUint32 ? 'uint32' : 'uint16',
      indexCount,
    };
  }

  function buildUnitCircleVertices(segments) {
    const count = Math.max(32, Math.floor(segments || 96));
    const data = new Float32Array((count + 1) * 2);
    for (let i = 0; i <= count; i++) {
      const t = (i / count) * Math.PI * 2;
      data[i * 2] = Math.cos(t);
      data[i * 2 + 1] = Math.sin(t);
    }
    return data;
  }

  function _planetColor(planetClass) {
    const cls = String(planetClass || '').toLowerCase();
    if (cls.includes('gas')) return [0.84, 0.65, 0.44];
    if (cls.includes('ice giant')) return [0.50, 0.78, 0.85];
    if (cls.includes('ice') || cls.includes('frozen')) return [0.61, 0.78, 0.91];
    if (cls.includes('lava') || cls.includes('volcan')) return [0.85, 0.43, 0.27];
    if (cls.includes('desert')) return [0.79, 0.68, 0.42];
    if (cls.includes('ocean')) return [0.29, 0.63, 0.85];
    if (cls.includes('toxic')) return [0.55, 0.70, 0.33];
    if (cls.includes('barren') || cls.includes('rocky')) return [0.56, 0.51, 0.45];
    if (cls.includes('terra') || cls.includes('hab')) return [0.43, 0.75, 0.45];
    return [0.60, 0.65, 0.72];
  }

  function _planetAccentColor(planetClass) {
    const cls = String(planetClass || '').toLowerCase();
    if (cls.includes('gas')) return [0.95, 0.83, 0.63];
    if (cls.includes('ice')) return [0.86, 0.95, 1.0];
    if (cls.includes('lava') || cls.includes('volcan')) return [1.0, 0.72, 0.38];
    if (cls.includes('ocean')) return [0.42, 0.88, 0.72];
    if (cls.includes('desert')) return [0.95, 0.82, 0.55];
    if (cls.includes('terra') || cls.includes('hab')) return [0.78, 0.92, 0.63];
    return [0.82, 0.84, 0.88];
  }

  function _planetVisualProfile(body, index) {
    const cls = String(body?.planet_class || '').toLowerCase();
    const base = _planetColor(cls);
    const accent = _planetAccentColor(cls);
    const water = cls.includes('ocean') ? 0.68 : cls.includes('terra') || cls.includes('hab') ? 0.42 : cls.includes('ice') ? 0.2 : 0.08;
    const cloudiness = cls.includes('gas') ? 0.72 : cls.includes('terra') || cls.includes('ocean') ? 0.45 : cls.includes('ice') ? 0.28 : 0.14;
    const emissive = cls.includes('lava') || cls.includes('volcan') ? 0.85 : cls.includes('toxic') ? 0.22 : 0.06;
    const seed = (((index + 1) * 92821) % 997) / 997;
    return { base, accent, water, cloudiness, emissive, seed };
  }

  function _planetSize(body, fallbackIndex, orbitRadius = 0) {
    const diameter = Number(body?.diameter || 0);
    const cls = String(body?.planet_class || '').toLowerCase();
    let baseSize = 0;
    if (diameter > 0) {
      const scale = cls.includes('gas') ? 7000 : 10500;
      const max = cls.includes('gas') ? 14.5 : 10.8;
      baseSize = Math.max(2.6, Math.min(max, 2.6 + diameter / scale));
    } else {
      if (cls.includes('gas')) baseSize = 8.6 + (fallbackIndex % 3) * 1.1;
      else if (cls.includes('ice')) baseSize = 5.4 + (fallbackIndex % 2) * 0.7;
      else baseSize = 3 + (fallbackIndex % 4) * 0.85;
    }
    if (orbitRadius > 0) {
      const orbitFactor = Math.max(0.3, Math.min(1.8, orbitRadius / 50));
      baseSize *= orbitFactor;
    }
    return baseSize;
  }

  /** Find the index of the star closest to the normalised canvas coordinate. */
  function _findNearestStar(stars, nx, ny, scale, viewState, aspectRatio, thresholdNdc) {
    let best = -1;
    let bestDist2 = thresholdNdc * thresholdNdc;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const sx = (Number(s.x_ly || s.x || 0) * scale + viewState.panX) * viewState.zoom / aspectRatio;
      const sy = (Number(s.y_ly || s.y || 0) * scale + viewState.panY) * viewState.zoom;
      const dx = sx - nx;
      const dy = sy - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        best = i;
      }
    }
    return best;
  }

  // ── Main renderer class ────────────────────────────────────────────────────

  class Galaxy3DRendererWebGPU {
    /**
     * @param {HTMLElement} container
     * @param {Object} [opts]
     */
    constructor(container, opts = {}) {
      if (!container) throw new Error('Galaxy3DRendererWebGPU: missing container');

      this.container = container;
      this._opts = opts;

      // State
      this._adapter    = null;
      this._device     = null;
      this._context    = null;
      this._pipeline   = null;
      this._heroPipeline = null;
      this._heroCoronaPipeline = null;
      this._planetPipeline = null;
      this._orbitPipeline = null;
      this._uniformBuf = null;
      this._heroUniformBuf = null;
      this._planetUniformBuf = null;
      this._orbitUniformBuf = null;
      this._bindGroup  = null;
      this._heroBindGroup = null;
      this._planetBindGroup = null;
      this._orbitBindGroup = null;
      this._starBuf    = null;
      this._indexBuf   = null;
      this._heroVertexBuf = null;
      this._heroIndexBuf = null;
      this._orbitVertexBuf = null;
      this._orbitVertexCount = 0;
      this._heroIndexCount = 0;
      this._heroIndexFormat = 'uint16';
      this._heroLodKey = '';
      this._starCount  = 0;
      this._starScale  = 1;
      this._backend    = null;  // 'webgpu' | 'webgl2'
      this._delegate   = null;  // Three.js delegate when in webgl2 mode
      this._rafId      = 0;
      this._running    = false;
      this._frameTick  = 0;
      this._timeOrigin = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      this._systemPayload = null;
      this._systemPlanetEntries = [];

      // Public properties game.js reads directly
      this.ready        = false;
      this.systemMode   = false;
      this.transitionsEnabled = true;
      this.transitionStableMinMs = 220;
      this.hoverMagnetEnabled  = true;
      this.clickMagnetEnabled  = true;
      this.hoverMagnetStarPx   = 24;
      this.hoverMagnetPlanetPx = 30;
      this.hoverMagnetClusterPx = 28;
      this.persistentHoverDistance = 220;

      // Stars
      this.stars         = [];
      this.starPoints    = [];
      this._rawStars     = [];

      // Camera / viewport
      this._view = {
        panX: 0, panY: 0, zoom: 1,
        targetPanX: 0, targetPanY: 0, targetZoom: 1,
      };
      this._aspect = 1;
      this._canvas = null;

      // Interaction state
      this._hoveredIdx  = -1;
      this._selectedIdx = -1;
      this._currentTarget = null;
      this._pinnedStar    = null;
      this._isDragging    = false;
      this._dragStartX    = 0;
      this._dragStartY    = 0;
      this._dragPanX      = 0;
      this._dragPanY      = 0;
      this._lastClickTs   = 0;
      this._followSelection = true;
      this._cameraDriver    = null;
      this._eventHandlers   = null;
      this._resizeHandler   = null;

      // Flags
      this._clusterBoundsVisible   = false;
      this._galacticCoreFxEnabled  = false;
      this._scientificScale        = false;

      // Three.js-compatible shape for legacy accessors
      this.renderFrames = { world: null, galaxy: null, system: null };
      this.camera       = { position: { x: 238, y: 240, z: 341 } };

      // The renderer property exposes the canvas for domElement access
      this.renderer = {
        domElement: null,
        clear() {},
        setPixelRatio() {},
        setSize() {},
        render() {},
      };
    }

    // ── Async init ─────────────────────────────────────────────────────────

    async init() {
      if (this.ready) return;

      const gpuOk = await probeWebGPU();

      if (gpuOk) {
        const canvas = this._ensureCanvas();
        if (canvas) {
          try {
            await this._initWebGPU(canvas);
            this._backend = 'webgpu';
            this.ready = true;
            this._attachInteraction(canvas);
            this._startRenderLoop();
            emitRenderTelemetry('backend-active', { backend: 'webgpu', interactive: true });
            return;
          } catch (err) {
            emitRenderTelemetry('fallback', {
              from: 'webgpu',
              to: 'webgl2',
              reason: String(err?.message || err || 'webgpu-init-failed'),
            });
          }
        }
      }

      this._initWebGL();
    }

    _initWebGL() {
      const GalaxyCtor = window.Galaxy3DRenderer;
      if (!GalaxyCtor) {
        this._backend = 'none';
        this.ready = true;
        emitRenderTelemetry('backend-active', { backend: 'none' });
        return;
      }
      this._delegate = new GalaxyCtor(this.container, this._opts);
      this._backend  = 'webgl2';
      this.ready     = true;
      emitRenderTelemetry('fallback', { from: 'webgpu', to: 'webgl2', reason: 'webgpu-unavailable' });
      emitRenderTelemetry('backend-active', { backend: 'webgl2', interactive: true });
    }

    // ── WebGPU initialisation ───────────────────────────────────────────────

    _ensureCanvas() {
      if (this._opts && this._opts.externalCanvas instanceof HTMLCanvasElement) {
        return this._opts.externalCanvas;
      }
      if (this.container && typeof this.container.querySelector === 'function') {
        const existing = this.container.querySelector('canvas#starfield, canvas');
        if (existing instanceof HTMLCanvasElement) return existing;
      }
      const c = document.createElement('canvas');
      c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;';
      this.container.appendChild(c);
      return c;
    }

    async _initWebGPU(canvas) {
      this._canvas = canvas;
      this.renderer.domElement = canvas;

      this._adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!this._adapter) throw new Error('No WebGPU adapter available');

      this._device = await this._adapter.requestDevice();
      this._device.lost.then((info) => {
        if (info.reason !== 'destroyed') {
          emitRenderTelemetry('device-lost', { reason: info.reason });
        }
      });

      this._context = canvas.getContext('webgpu');
      if (!this._context) throw new Error('WebGPU canvas context unavailable');

      this._configureContext();
      await this._buildPipeline();
    }

    _configureContext() {
      const format = navigator.gpu.getPreferredCanvasFormat();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this._canvas.getBoundingClientRect();
      this._canvas.width  = Math.max(1, Math.floor((rect.width  || this.container.clientWidth  || 800) * dpr));
      this._canvas.height = Math.max(1, Math.floor((rect.height || this.container.clientHeight || 600) * dpr));
      this._aspect = this._canvas.width / Math.max(1, this._canvas.height);
      this._context.configure({ device: this._device, format, alphaMode: 'opaque' });
    }

    async _buildPipeline() {
      const format = navigator.gpu.getPreferredCanvasFormat();

      const shaderMod = this._device.createShaderModule({ code: STAR_SHADER_WGSL });

      // 8 floats for ViewUniforms (32 bytes)
      this._uniformBuf = this._device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const bgl = this._device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        }],
      });
      this._bindGroup = this._device.createBindGroup({
        layout: bgl,
        entries: [{ binding: 0, resource: { buffer: this._uniformBuf } }],
      });

      this._pipeline = this._device.createRenderPipeline({
        layout: this._device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        vertex: {
          module: shaderMod,
          entryPoint: 'vs_main',
          buffers: [
            {
              // Position + colour per star (6 floats × 4 bytes = 24 bytes/vertex)
              arrayStride: 24,
              stepMode: 'vertex',
              attributes: [
                { shaderLocation: 0, offset: 0,  format: 'float32x2' }, // pos
                { shaderLocation: 1, offset: 8,  format: 'float32x4' }, // color
              ],
              stepMode: 'instance',
            },
          ],
        },
        fragment: {
          module: shaderMod,
          entryPoint: 'fs_main',
          targets: [{
            format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          }],
        },
        primitive: { topology: 'triangle-strip' },
      });

      const heroShader = this._device.createShaderModule({ code: HERO_STAR_SHADER_WGSL });
      const heroCoronaShader = this._device.createShaderModule({ code: HERO_CORONA_SHADER_WGSL });
      this._heroUniformBuf = this._device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const heroBgl = this._device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        }],
      });
      this._heroBindGroup = this._device.createBindGroup({
        layout: heroBgl,
        entries: [{ binding: 0, resource: { buffer: this._heroUniformBuf } }],
      });
      const heroVertexBuffers = [{
        arrayStride: 32,
        stepMode: 'vertex',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x2' },
        ],
      }];
      this._heroPipeline = this._device.createRenderPipeline({
        layout: this._device.createPipelineLayout({ bindGroupLayouts: [heroBgl] }),
        vertex: { module: heroShader, entryPoint: 'vs_main', buffers: heroVertexBuffers },
        fragment: {
          module: heroShader,
          entryPoint: 'fs_main',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
      });
      this._heroCoronaPipeline = this._device.createRenderPipeline({
        layout: this._device.createPipelineLayout({ bindGroupLayouts: [heroBgl] }),
        vertex: { module: heroCoronaShader, entryPoint: 'vs_main', buffers: heroVertexBuffers },
        fragment: {
          module: heroCoronaShader,
          entryPoint: 'fs_main',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'front' },
      });

      const planetShader = this._device.createShaderModule({ code: PLANET_SHADER_WGSL });
      this._planetUniformBuf = this._device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const planetBgl = this._device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        }],
      });
      this._planetBindGroup = this._device.createBindGroup({
        layout: planetBgl,
        entries: [{ binding: 0, resource: { buffer: this._planetUniformBuf } }],
      });
      this._planetPipeline = this._device.createRenderPipeline({
        layout: this._device.createPipelineLayout({ bindGroupLayouts: [planetBgl] }),
        vertex: { module: planetShader, entryPoint: 'vs_main', buffers: heroVertexBuffers },
        fragment: {
          module: planetShader,
          entryPoint: 'fs_main',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
      });

      const orbitShader = this._device.createShaderModule({ code: ORBIT_SHADER_WGSL });
      this._orbitUniformBuf = this._device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const orbitBgl = this._device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        }],
      });
      this._orbitBindGroup = this._device.createBindGroup({
        layout: orbitBgl,
        entries: [{ binding: 0, resource: { buffer: this._orbitUniformBuf } }],
      });
      this._orbitPipeline = this._device.createRenderPipeline({
        layout: this._device.createPipelineLayout({ bindGroupLayouts: [orbitBgl] }),
        vertex: {
          module: orbitShader,
          entryPoint: 'vs_main',
          buffers: [{
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          }],
        },
        fragment: {
          module: orbitShader,
          entryPoint: 'fs_main',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'line-strip' },
      });

      const orbitVerts = buildUnitCircleVertices(96);
      this._orbitVertexBuf = this._device.createBuffer({
        size: orbitVerts.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this._device.queue.writeBuffer(this._orbitVertexBuf, 0, orbitVerts.buffer, orbitVerts.byteOffset, orbitVerts.byteLength);
      this._orbitVertexCount = orbitVerts.length / 2;
    }

    _ensureHeroSphereGeometry() {
      if (!this._device || !this.systemMode || !this._currentTarget) return;
      const zoom = Number(this._view?.zoom || this._view?.targetZoom || 1);
      const segments = zoom >= 4.2 ? 56 : zoom >= 3.1 ? 40 : zoom >= 2.2 ? 28 : 20;
      const lodKey = String(segments);
      if (this._heroVertexBuf && this._heroIndexBuf && this._heroLodKey === lodKey) return;

      try { this._heroVertexBuf?.destroy(); } catch (_) {}
      try { this._heroIndexBuf?.destroy(); } catch (_) {}

      const geometry = buildSphereGeometry(segments, segments * 2);
      this._heroVertexBuf = this._device.createBuffer({
        size: geometry.vertexData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this._device.queue.writeBuffer(this._heroVertexBuf, 0, geometry.vertexData.buffer, geometry.vertexData.byteOffset, geometry.vertexData.byteLength);
      this._heroIndexBuf = this._device.createBuffer({
        size: geometry.indexData.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      this._device.queue.writeBuffer(this._heroIndexBuf, 0, geometry.indexData.buffer, geometry.indexData.byteOffset, geometry.indexData.byteLength);
      this._heroIndexCount = geometry.indexCount;
      this._heroIndexFormat = geometry.indexFormat;
      this._heroLodKey = lodKey;
    }

    _getHeroStarState() {
      if (!this.systemMode || !this._currentTarget) return null;
      const star = this._currentTarget;
      const clipX = (Number(star.x_ly || star.x || 0) * this._starScale + this._view.panX) * this._view.zoom / this._aspect;
      const clipY = (Number(star.y_ly || star.y || 0) * this._starScale + this._view.panY) * this._view.zoom;
      const baseColor = _starColor(star);
      const coronaColor = _starCoronaColor(star);
      const zoom = Number(this._view.zoom || 1);
      const radius = Math.max(0.14, Math.min(0.42, 0.12 + (zoom - 1.6) * 0.09));
      const coronaOpacity = Math.max(0.18, Math.min(0.52, 0.22 + (zoom - 2.0) * 0.08));
      return {
        clipX,
        clipY,
        radius,
        baseColor,
        coronaColor,
        coronaOpacity,
        zoom,
      };
    }

    _writeHeroUniforms(heroState, haloScale) {
      if (!this._heroUniformBuf || !heroState) return;
      const time = (((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - this._timeOrigin) / 1000;
      const uni = new DataView(new ArrayBuffer(64));
      uni.setFloat32(0, heroState.clipX, true);
      uni.setFloat32(4, heroState.clipY, true);
      uni.setFloat32(8, heroState.radius, true);
      uni.setFloat32(12, this._aspect, true);
      uni.setFloat32(16, time, true);
      uni.setFloat32(20, heroState.baseColor[0], true);
      uni.setFloat32(24, heroState.baseColor[1], true);
      uni.setFloat32(28, heroState.baseColor[2], true);
      uni.setFloat32(32, heroState.coronaColor[0], true);
      uni.setFloat32(36, heroState.coronaColor[1], true);
      uni.setFloat32(40, heroState.coronaColor[2], true);
      uni.setFloat32(44, heroState.coronaOpacity, true);
      uni.setFloat32(48, haloScale, true);
      uni.setFloat32(52, heroState.zoom, true);
      uni.setFloat32(56, 0, true);
      uni.setFloat32(60, 0, true);
      this._device.queue.writeBuffer(this._heroUniformBuf, 0, uni.buffer);
    }

    _drawHeroStar(pass) {
      if (!pass || !this._heroPipeline || !this._heroCoronaPipeline || !this._heroBindGroup) return;
      const heroState = this._getHeroStarState();
      if (!heroState) return;
      this._ensureHeroSphereGeometry();
      if (!this._heroVertexBuf || !this._heroIndexBuf || !this._heroIndexCount) return;

      this._writeHeroUniforms(heroState, 1.16);
      pass.setPipeline(this._heroCoronaPipeline);
      pass.setBindGroup(0, this._heroBindGroup);
      pass.setVertexBuffer(0, this._heroVertexBuf);
      pass.setIndexBuffer(this._heroIndexBuf, this._heroIndexFormat);
      pass.drawIndexed(this._heroIndexCount, 1, 0, 0, 0);

      this._writeHeroUniforms(heroState, 1.0);
      pass.setPipeline(this._heroPipeline);
      pass.setBindGroup(0, this._heroBindGroup);
      pass.setVertexBuffer(0, this._heroVertexBuf);
      pass.setIndexBuffer(this._heroIndexBuf, this._heroIndexFormat);
      pass.drawIndexed(this._heroIndexCount, 1, 0, 0, 0);
    }

    _rebuildSystemPlanetEntries() {
      const payload = this._systemPayload;
      if (!payload || !Array.isArray(payload.planets)) {
        this._systemPlanetEntries = [];
        return;
      }
      const bodies = payload.planets
        .map((slot) => ({ slot, body: slot?.player_planet || slot?.generated_planet || null }))
        .filter((entry) => entry.body);
      if (!bodies.length) {
        this._systemPlanetEntries = [];
        return;
      }

      const orbitBodies = bodies.slice().sort((a, b) => Number(a.body.semi_major_axis_au || 0) - Number(b.body.semi_major_axis_au || 0));
      const maxAu = Math.max(0.35, ...orbitBodies.map((entry, index) => Number(entry.body.semi_major_axis_au || (0.35 + index * 0.22))));
      const periodMetrics = orbitBodies.map((entry, index) => {
        const semiMajor = Number(entry.body.semi_major_axis_au || (0.35 + index * 0.22));
        const periodDays = Number(entry.body.orbital_period_days || 0);
        return periodDays > 0 ? periodDays : Math.pow(Math.max(0.12, semiMajor), 1.5);
      });
      const minPeriodMetric = Math.max(0.01, Math.min(...periodMetrics));

      this._systemPlanetEntries = orbitBodies.map((entry, index) => {
        const body = entry.body;
        const semiMajor = Number(body.semi_major_axis_au || (0.35 + index * 0.22));
        const orbitRadius = 0.34 + (semiMajor / maxAu) * 0.58;
        const eccentricity = Math.max(0, Math.min(0.92, Number(body.orbital_eccentricity ?? (0.03 + index * 0.012))));
        const orbitMinor = orbitRadius * Math.sqrt(1 - eccentricity * eccentricity);
        const phase = Number(body.polar_theta_rad);
        const periodMetric = Number(periodMetrics[index] || 1);
        const sizeGame = _planetSize(body, index, 34 + (semiMajor / maxAu) * 165);
        const radius = Math.max(0.025, Math.min(0.095, sizeGame / 120));
        return {
          slot: entry.slot,
          body,
          orbitIndex: index,
          orbitRadius,
          orbitMinor,
          eccentricity,
          angle: Number.isFinite(phase) ? phase : (index / Math.max(1, orbitBodies.length)) * Math.PI * 2,
          speed: 0.0035 / Math.max(0.3, periodMetric / minPeriodMetric),
          radius,
          profile: _planetVisualProfile(body, index),
        };
      });
    }

    _writeOrbitUniforms(entry, heroState) {
      if (!this._orbitUniformBuf || !entry || !heroState) return;
      const uni = new DataView(new ArrayBuffer(48));
      uni.setFloat32(0, heroState.clipX, true);
      uni.setFloat32(4, heroState.clipY, true);
      uni.setFloat32(8, entry.orbitRadius, true);
      uni.setFloat32(12, entry.orbitMinor, true);
      uni.setFloat32(16, this._aspect, true);
      uni.setFloat32(20, 0.25 + entry.profile.base[0] * 0.45, true);
      uni.setFloat32(24, 0.28 + entry.profile.base[1] * 0.45, true);
      uni.setFloat32(28, 0.35 + entry.profile.base[2] * 0.45, true);
      uni.setFloat32(32, 0.28, true);
      uni.setFloat32(36, 0, true);
      uni.setFloat32(40, 0, true);
      uni.setFloat32(44, 0, true);
      this._device.queue.writeBuffer(this._orbitUniformBuf, 0, uni.buffer);
    }

    _writePlanetUniforms(entry, centerX, centerY) {
      if (!this._planetUniformBuf || !entry) return;
      const time = (((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - this._timeOrigin) / 1000;
      const uni = new DataView(new ArrayBuffer(64));
      uni.setFloat32(0, centerX, true);
      uni.setFloat32(4, centerY, true);
      uni.setFloat32(8, entry.radius, true);
      uni.setFloat32(12, this._aspect, true);
      uni.setFloat32(16, time, true);
      uni.setFloat32(20, entry.profile.seed, true);
      uni.setFloat32(24, entry.profile.cloudiness, true);
      uni.setFloat32(28, entry.profile.emissive, true);
      uni.setFloat32(32, entry.profile.base[0], true);
      uni.setFloat32(36, entry.profile.base[1], true);
      uni.setFloat32(40, entry.profile.base[2], true);
      uni.setFloat32(44, entry.profile.water, true);
      uni.setFloat32(48, entry.profile.accent[0], true);
      uni.setFloat32(52, entry.profile.accent[1], true);
      uni.setFloat32(56, entry.profile.accent[2], true);
      uni.setFloat32(60, 0, true);
      this._device.queue.writeBuffer(this._planetUniformBuf, 0, uni.buffer);
    }

    _drawSystemPlanets(pass) {
      if (!this.systemMode || !pass || !this._planetPipeline || !this._orbitPipeline || !this._orbitVertexBuf) return;
      const heroState = this._getHeroStarState();
      if (!heroState || !this._systemPlanetEntries.length) return;
      this._ensureHeroSphereGeometry();
      if (!this._heroVertexBuf || !this._heroIndexBuf || !this._heroIndexCount) return;

      const now = (((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - this._timeOrigin) / 1000;
      for (const entry of this._systemPlanetEntries) {
        this._writeOrbitUniforms(entry, heroState);
        pass.setPipeline(this._orbitPipeline);
        pass.setBindGroup(0, this._orbitBindGroup);
        pass.setVertexBuffer(0, this._orbitVertexBuf);
        pass.draw(this._orbitVertexCount, 1, 0, 0);

        const angle = entry.angle + now * entry.speed;
        const px = heroState.clipX + (Math.cos(angle) * entry.orbitRadius) / Math.max(this._aspect, 0.0001);
        const py = heroState.clipY + Math.sin(angle) * entry.orbitMinor;
        this._writePlanetUniforms(entry, px, py);
        pass.setPipeline(this._planetPipeline);
        pass.setBindGroup(0, this._planetBindGroup);
        pass.setVertexBuffer(0, this._heroVertexBuf);
        pass.setIndexBuffer(this._heroIndexBuf, this._heroIndexFormat);
        pass.drawIndexed(this._heroIndexCount, 1, 0, 0, 0);
      }
    }

    // ── Star data upload ────────────────────────────────────────────────────

    _uploadStars(stars) {
      if (!this._device) return;

      const { attribs, scale } = buildStarAttribs(stars);
      this._starScale = scale;
      this._starCount = Math.floor(attribs.length / 6);

      // Destroy old buffers
      if (this._starBuf)  { this._starBuf.destroy();  this._starBuf  = null; }
      if (!this._starCount) return;

      // Vertex buffer (pos + color)
      this._starBuf = this._device.createBuffer({
        size: attribs.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this._device.queue.writeBuffer(this._starBuf, 0, attribs.buffer, attribs.byteOffset, attribs.byteLength);
    }

    // ── Render loop ─────────────────────────────────────────────────────────

    _startRenderLoop() {
      if (this._running) return;
      this._running = true;
      const tick = () => {
        if (!this._running) return;
        this._rafId = requestAnimationFrame(tick);
        this._renderFrame();
      };
      this._rafId = requestAnimationFrame(tick);
    }

    _renderFrame() {
      if (!this._device || !this._context || !this._pipeline || !this._uniformBuf) return;

      // Smooth camera
      const s = 0.12;
      this._view.panX  += (this._view.targetPanX  - this._view.panX)  * s;
      this._view.panY  += (this._view.targetPanY  - this._view.panY)  * s;
      this._view.zoom  += (this._view.targetZoom  - this._view.zoom)  * s;
      const PCLAMP = 1.8;
      this._view.panX = Math.max(-PCLAMP, Math.min(PCLAMP, this._view.panX));
      this._view.panY = Math.max(-PCLAMP, Math.min(PCLAMP, this._view.panY));
      this._view.zoom = Math.max(0.45,    Math.min(6,     this._view.zoom));

      // Upload uniforms (32 bytes = 8 × f32)
      const uni = new DataView(new ArrayBuffer(32));
      uni.setFloat32(0,  this._view.panX,  true);
      uni.setFloat32(4,  this._view.panY,  true);
      uni.setFloat32(8,  this._view.zoom,  true);
      uni.setFloat32(12, this._aspect,     true);
      uni.setInt32(16,   this._selectedIdx, true);
      uni.setInt32(20,   this._hoveredIdx,  true);
      uni.setFloat32(24, 2 / Math.max(1, this._canvas?.width || 1), true);
      uni.setFloat32(28, 2 / Math.max(1, this._canvas?.height || 1), true);
      this._device.queue.writeBuffer(this._uniformBuf, 0, uni.buffer);

      const encoder = this._device.createCommandEncoder();
      const view    = this._context.getCurrentTexture().createView();
      const pass    = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0.02, g: 0.03, b: 0.08, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });

      if (this._starBuf && this._starCount > 0 && this._bindGroup) {
        pass.setPipeline(this._pipeline);
        pass.setBindGroup(0, this._bindGroup);
        pass.setVertexBuffer(0, this._starBuf);
        pass.draw(4, this._starCount, 0, 0);
      }

      this._drawSystemPlanets(pass);
      this._drawHeroStar(pass);

      pass.end();
      this._device.queue.submit([encoder.finish()]);

      // Camera driver hook (e.g. SeamlessZoomOrchestrator)
      if (this._cameraDriver && typeof this._cameraDriver.update === 'function') {
        try {
          this._cameraDriver.update({ camera: this.camera, target: this._currentTarget });
        } catch (_) {}
      }

      this._frameTick++;
    }

    // ── Mouse / touch interaction ───────────────────────────────────────────

    _attachInteraction(canvas) {
      if (this._eventHandlers) return;
      const self = this;

      const onMouseMove = (e) => {
        if (!self._rawStars.length) return;
        const ndc = self._canvasToNdc(canvas, e.clientX, e.clientY);
        const magPx = self.hoverMagnetStarPx || 24;
        const thresh = (magPx / Math.max(1, canvas.clientWidth)) * 2;
        const idx = _findNearestStar(self._rawStars, ndc.x, ndc.y, self._starScale, self._view, self._aspect, thresh);
        if (idx !== self._hoveredIdx) {
          self._hoveredIdx = idx;
          const star = idx >= 0 ? self._rawStars[idx] : null;
          if (typeof self._opts.onHover === 'function') {
            self._opts.onHover(star, star ? self._starToScreenPos(canvas, star) : null);
          }
        }
        // Pan on right-drag
        if (self._isDragging) {
          const dx = (e.clientX - self._dragStartX) / canvas.clientWidth * 2;
          const dy = (e.clientY - self._dragStartY) / canvas.clientHeight * 2;
          self._view.targetPanX = self._dragPanX + dx / self._view.zoom;
          self._view.targetPanY = self._dragPanY - dy / self._view.zoom;
        }
      };

      const onMouseDown = (e) => {
        if (e.button === 1 || e.button === 2) {
          self._isDragging  = true;
          self._dragStartX  = e.clientX;
          self._dragStartY  = e.clientY;
          self._dragPanX    = self._view.targetPanX;
          self._dragPanY    = self._view.targetPanY;
          e.preventDefault();
        }
      };

      const onWindowMouseUp = () => { self._isDragging = false; };

      const onWheel = (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.15 : 0.15;
        const nextZ = Math.max(0.45, Math.min(6, self._view.targetZoom + delta * self._view.targetZoom));
        self._view.targetZoom = nextZ;
      };

      const onClick = (e) => {
        const ndc = self._canvasToNdc(canvas, e.clientX, e.clientY);
        const magPx = self.clickMagnetEnabled ? (self.hoverMagnetStarPx || 24) : 8;
        const thresh = (magPx / Math.max(1, canvas.clientWidth)) * 2;
        const idx = _findNearestStar(self._rawStars, ndc.x, ndc.y, self._starScale, self._view, self._aspect, thresh);
        const star = idx >= 0 ? self._rawStars[idx] : null;
        const now = Date.now();
        const dbl = (now - self._lastClickTs) < 280;
        self._lastClickTs = now;

        if (dbl) {
          if (star && typeof self._opts.onDoubleClick === 'function') {
            self._opts.onDoubleClick(star, self._starToScreenPos(canvas, star));
          }
          return;
        }

        self._selectedIdx = idx;
        self._pinnedStar  = star;
        if (star && typeof self._opts.onClick === 'function') {
          self._opts.onClick(star, self._starToScreenPos(canvas, star));
        }
      };

      const onDblClick = (e) => {
        const ndc = self._canvasToNdc(canvas, e.clientX, e.clientY);
        const thresh = ((self.hoverMagnetStarPx || 24) / Math.max(1, canvas.clientWidth)) * 2;
        const idx = _findNearestStar(self._rawStars, ndc.x, ndc.y, self._starScale, self._view, self._aspect, thresh);
        const star = idx >= 0 ? self._rawStars[idx] : null;
        if (star && typeof self._opts.onDoubleClick === 'function') {
          self._opts.onDoubleClick(star, self._starToScreenPos(canvas, star));
        }
      };

      canvas.addEventListener('mousemove', onMouseMove);
      canvas.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup', onWindowMouseUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('click', onClick);
      canvas.addEventListener('dblclick', onDblClick);

      this._eventHandlers = {
        onMouseMove,
        onMouseDown,
        onWindowMouseUp,
        onWheel,
        onClick,
        onDblClick,
      };

      // Resize observer
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => self.resize());
        ro.observe(self.container);
        self._resizeObserver = ro;
      } else {
        const onResize = () => self.resize();
        this._resizeHandler = onResize;
        window.addEventListener('resize', onResize);
      }
    }

    _detachInteraction() {
      if (this._canvas && this._eventHandlers) {
        this._canvas.removeEventListener('mousemove', this._eventHandlers.onMouseMove);
        this._canvas.removeEventListener('mousedown', this._eventHandlers.onMouseDown);
        this._canvas.removeEventListener('wheel', this._eventHandlers.onWheel);
        this._canvas.removeEventListener('click', this._eventHandlers.onClick);
        this._canvas.removeEventListener('dblclick', this._eventHandlers.onDblClick);
        window.removeEventListener('mouseup', this._eventHandlers.onWindowMouseUp);
      }
      this._eventHandlers = null;

      if (this._resizeHandler) {
        window.removeEventListener('resize', this._resizeHandler);
        this._resizeHandler = null;
      }
    }

    _canvasToNdc(canvas, clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return {
        x:  ((clientX - rect.left) / rect.width  * 2 - 1),
        y: -((clientY - rect.top)  / rect.height * 2 - 1),
      };
    }

    _starToScreenPos(canvas, star) {
      if (!star || !canvas) return null;
      const sx = (Number(star.x_ly || star.x || 0) * this._starScale + this._view.panX) * this._view.zoom / this._aspect;
      const sy = (Number(star.y_ly || star.y || 0) * this._starScale + this._view.panY) * this._view.zoom;
      const rect = canvas.getBoundingClientRect();
      return {
        x: (sx + 1) / 2 * rect.width  + rect.left,
        y: (1 - sy)  / 2 * rect.height + rect.top,
      };
    }

    // ── Public API — mirrors Galaxy3DRenderer ───────────────────────────────

    setStars(stars, _opts) {
      if (this._delegate) return this._delegate.setStars?.(stars, _opts);
      this._rawStars  = Array.isArray(stars) ? stars.slice() : [];
      this.stars      = this._rawStars;
      this.starPoints = this._rawStars;
      this._uploadStars(this._rawStars);
    }

    setEmpires(empires) {
      if (this._delegate) return this._delegate.setEmpires?.(empires);
    }

    setSelectedStar(star) {
      if (this._delegate) return this._delegate.setSelectedStar?.(star);
      const idx = star ? this._rawStars.indexOf(star) : -1;
      this._selectedIdx = idx;
    }

    setGalaxyMetadata(meta) {
      if (this._delegate) return this._delegate.setGalaxyMetadata?.(meta);
    }

    setGalaxyFleets(fleets) {
      if (this._delegate) return this._delegate.setGalaxyFleets?.(fleets);
    }

    setFtlInfrastructure(gates, nodes) {
      if (this._delegate) return this._delegate.setFtlInfrastructure?.(gates, nodes);
    }

    setClusterAuras(clusters) {
      if (this._delegate) return this._delegate.setClusterAuras?.(clusters);
    }

    setClusterColorPalette(palette) {
      if (this._delegate) return this._delegate.setClusterColorPalette?.(palette);
    }

    setCameraTarget(target) {
      if (this._delegate) return this._delegate.setCameraTarget?.(target);
      this._currentTarget = target || null;
      this.focusOnStar(target, false);
    }

    setCameraDriver(driver, opts) {
      if (this._delegate) return this._delegate.setCameraDriver?.(driver, opts);
      this._cameraDriver = driver || null;
    }

    clearCameraDriver() {
      if (this._delegate) return this._delegate.clearCameraDriver?.();
      this._cameraDriver = null;
    }

    setTransitionsEnabled(flag) {
      if (this._delegate) return this._delegate.setTransitionsEnabled?.(flag);
      this.transitionsEnabled = !!flag;
    }

    setHoverMagnetConfig(cfg = {}) {
      if (this._delegate) return this._delegate.setHoverMagnetConfig?.(cfg);
      const c = cfg || {};
      this.hoverMagnetEnabled      = c.hoverMagnetEnabled      !== undefined ? !!c.hoverMagnetEnabled : this.hoverMagnetEnabled;
      this.clickMagnetEnabled      = c.clickMagnetEnabled      !== undefined ? !!c.clickMagnetEnabled : this.clickMagnetEnabled;
      this.hoverMagnetStarPx       = Number(c.hoverMagnetStarPx   || this.hoverMagnetStarPx);
      this.hoverMagnetPlanetPx     = Number(c.hoverMagnetPlanetPx || this.hoverMagnetPlanetPx);
      this.hoverMagnetClusterPx    = Number(c.hoverMagnetClusterPx || this.hoverMagnetClusterPx);
      this.persistentHoverDistance = Number(c.persistentHoverDistance || this.persistentHoverDistance);
    }

    setClusterBoundsVisible(flag) {
      if (this._delegate) return this._delegate.setClusterBoundsVisible?.(flag);
      this._clusterBoundsVisible = !!flag;
    }

    areClusterBoundsVisible() {
      if (this._delegate) return this._delegate.areClusterBoundsVisible?.();
      return this._clusterBoundsVisible;
    }

    setGalacticCoreFxEnabled(flag) {
      if (this._delegate) return this._delegate.setGalacticCoreFxEnabled?.(flag);
      this._galacticCoreFxEnabled = !!flag;
    }

    areGalacticCoreFxEnabled() {
      if (this._delegate) return this._delegate.areGalacticCoreFxEnabled?.();
      return this._galacticCoreFxEnabled;
    }

    setGalaxyFleetVectorsVisible(enabled) {
      if (this._delegate) return this._delegate.setGalaxyFleetVectorsVisible?.(enabled);
    }

    setSystemOrbitPathsVisible(enabled) {
      if (this._delegate) return this._delegate.setSystemOrbitPathsVisible?.(enabled);
    }

    setSystemOrbitMarkersVisible(enabled) {
      if (this._delegate) return this._delegate.setSystemOrbitMarkersVisible?.(enabled);
    }

    setSystemOrbitFocusOnly(enabled) {
      if (this._delegate) return this._delegate.setSystemOrbitFocusOnly?.(enabled);
    }

    setClusterDensityMode(mode, opts) {
      if (this._delegate) return this._delegate.setClusterDensityMode?.(mode, opts);
    }

    setOrbitSimulationMode(mode) {
      if (this._delegate) return this._delegate.setOrbitSimulationMode?.(mode);
    }

    setEmpireHeartbeatSystems(list) {
      if (this._delegate) return this._delegate.setEmpireHeartbeatSystems?.(list);
    }

    focusOnStar(star, immediate = false) {
      if (this._delegate) return this._delegate.focusOnStar?.(star, immediate);
      this._currentTarget = star || null;
      if (!star) return;
      const tx = -Number(star.x_ly || star.x || 0) * this._starScale;
      const ty = -Number(star.y_ly || star.y || 0) * this._starScale;
      if (Number.isFinite(tx)) this._view.targetPanX = tx;
      if (Number.isFinite(ty)) this._view.targetPanY = ty;
      if (immediate) {
        this._view.panX = this._view.targetPanX;
        this._view.panY = this._view.targetPanY;
      }
    }

    focusOnSystemPlanet(planetLike, smooth) {
      if (this._delegate) return this._delegate.focusOnSystemPlanet?.(planetLike, smooth);
      this.focusOnStar(planetLike, !smooth);
      this.enterSystemView(planetLike);
    }

    fitCameraToStars(force, immediate) {
      if (this._delegate) return this._delegate.fitCameraToStars?.(force, immediate);
      this._view.targetPanX = 0;
      this._view.targetPanY = 0;
      this._view.targetZoom = this.systemMode ? 2.25 : 1;
      if (immediate) {
        this._view.panX = this._view.targetPanX;
        this._view.panY = this._view.targetPanY;
        this._view.zoom = this._view.targetZoom;
      }
    }

    focusCurrentSelection() {
      if (this._delegate) return this._delegate.focusCurrentSelection?.();
      if (this._pinnedStar) this.focusOnStar(this._pinnedStar, false);
    }

    resetNavigationView() {
      if (this._delegate) return this._delegate.resetNavigationView?.();
      this.systemMode = false;
      this._systemPayload = null;
      this._systemPlanetEntries = [];
      this._currentTarget = null;
      this._view.targetPanX = 0;
      this._view.targetPanY = 0;
      this._view.targetZoom = 1;
    }

    toggleFollowSelection() {
      if (this._delegate) return this._delegate.toggleFollowSelection?.();
      this._followSelection = !this._followSelection;
      return this._followSelection;
    }

    isFollowingSelection() {
      if (this._delegate) return this._delegate.isFollowingSelection?.();
      return !!this._followSelection;
    }

    enterSystemView(star, payload) {
      if (this._delegate) return this._delegate.enterSystemView?.(star, payload);
      this.systemMode = true;
      this._systemPayload = payload || null;
      this._rebuildSystemPlanetEntries();
      this._view.targetZoom = Math.max(this._view.targetZoom, 2.25);
      if (star) this.focusOnStar(star, false);
    }

    exitSystemView(restoreGalaxy) {
      if (this._delegate) return this._delegate.exitSystemView?.(restoreGalaxy);
      this.systemMode = false;
      this._systemPayload = null;
      this._systemPlanetEntries = [];
      this._view.targetZoom = Math.min(this._view.targetZoom, 1.2);
    }

    nudgeZoom(direction) {
      if (this._delegate) return this._delegate.nudgeZoom?.(direction);
      const delta = String(direction).startsWith('in') ? 0.18 : -0.18;
      this._view.targetZoom = Math.max(0.45, Math.min(6, this._view.targetZoom + delta * this._view.targetZoom));
    }

    nudgeOrbit(direction) {
      if (this._delegate) return this._delegate.nudgeOrbit?.(direction);
      const lr = String(direction).includes('left') ? -1 : 1;
      const ud = String(direction).includes('up')   ? -1 : 1;
      if (String(direction).startsWith('left') || String(direction).startsWith('right')) {
        this._view.targetPanX += 0.06 * lr / this._view.zoom;
      } else {
        this._view.targetPanY += 0.06 * ud / this._view.zoom;
      }
    }

    nudgePan(direction) {
      if (this._delegate) return this._delegate.nudgePan?.(direction);
      const d = String(direction);
      const step = 0.04 / this._view.zoom;
      if (d.includes('left'))  this._view.targetPanX -= step;
      if (d.includes('right')) this._view.targetPanX += step;
      if (d.includes('up'))    this._view.targetPanY += step;
      if (d.includes('down'))  this._view.targetPanY -= step;
    }

    nudgeRoll(direction, stepRad) {
      if (this._delegate) return this._delegate.nudgeRoll?.(direction, stepRad);
      // No roll in 2-D WebGPU view; no-op for API compatibility
    }

    toggleScientificScale() {
      if (this._delegate) return this._delegate.toggleScientificScale?.();
      this._scientificScale = !this._scientificScale;
      return this._scientificScale;
    }

    getQualityProfileState() {
      if (this._delegate) return this._delegate.getQualityProfileState?.();
      return {
        name: this._backend === 'webgpu' ? 'webgpu-native' : 'webgl2-fallback',
        label: this._backend === 'webgpu' ? 'WebGPU Native' : 'WebGL2 Fallback',
        backend: this._backend,
        features: {
          galacticCoreFx: this._backend === 'webgpu',
        },
      };
    }

    getRenderStats() {
      if (this._delegate) return this._delegate.getRenderStats?.();
      return {
        backend: this._backend || 'none',
        qualityProfile: this._backend === 'webgpu' ? 'webgpu-native' : 'webgl2-fallback',
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        rawStars: this._rawStars.length,
        visibleStars: this._starCount,
        frameTick: this._frameTick,
        instanceId: this._instanceId || '',
        systemMode: !!this.systemMode,
        systemPlanets: this._systemPlanetEntries.length,
      };
    }

    resize(w, h) {
      if (this._delegate) return this._delegate.resize?.(w, h);
      if (!this._canvas || !this._context || !this._device) return;
      this._configureContext();
    }

    destroy() {
      this.dispose();
    }

    dispose() {
      if (this._delegate) {
        // Call both destroy and dispose for maximum compatibility with Three.js renderers
        this._delegate.destroy?.();
        this._delegate.dispose?.();
        this._delegate = null;
        return;
      }
      this._running = false;
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = 0;
      }
      if (this._resizeObserver) {
        try { this._resizeObserver.disconnect(); } catch (_) {}
        this._resizeObserver = null;
      }
      this._detachInteraction();
      try { this._starBuf?.destroy();  } catch (_) {}
      try { this._indexBuf?.destroy(); } catch (_) {}
      try { this._heroVertexBuf?.destroy(); } catch (_) {}
      try { this._heroIndexBuf?.destroy(); } catch (_) {}
      try { this._orbitVertexBuf?.destroy(); } catch (_) {}
      try { this._uniformBuf?.destroy(); } catch (_) {}
      try { this._heroUniformBuf?.destroy(); } catch (_) {}
      try { this._planetUniformBuf?.destroy(); } catch (_) {}
      try { this._orbitUniformBuf?.destroy(); } catch (_) {}
      this._starBuf    = null;
      this._indexBuf   = null;
      this._heroVertexBuf = null;
      this._heroIndexBuf = null;
      this._orbitVertexBuf = null;
      this._uniformBuf = null;
      this._heroUniformBuf = null;
      this._planetUniformBuf = null;
      this._orbitUniformBuf = null;
      this._pipeline   = null;
      this._heroPipeline = null;
      this._heroCoronaPipeline = null;
      this._planetPipeline = null;
      this._orbitPipeline = null;
      this._bindGroup  = null;
      this._heroBindGroup = null;
      this._planetBindGroup = null;
      this._orbitBindGroup = null;
      this._context    = null;
      this._device?.destroy();
      this._device     = null;
      this._adapter    = null;
      this._cameraDriver = null;
      this._systemPayload = null;
      this._systemPlanetEntries = [];
      this.ready = false;
    }

    // Legacy accessors
    get backendType()  { return this._delegate?.rendererBackend ?? this._delegate?.backendType ?? this._backend; }
    get instanceId()   { return this._delegate?.instanceId ?? this._instanceId ?? ''; }
    get visibleStars() { return this._delegate?.visibleStars ?? this._rawStars ?? []; }
    get selectedIndex(){ return Number(this._delegate?.selectedIndex ?? this._selectedIdx ?? -1); }
    get scene()        { return this._delegate?.scene ?? null; }
  }

  // ── Feature detection + error UI ───────────────────────────────────────────

  /**
   * Inject a user-visible error banner when WebGPU is completely unavailable
   * and no Three.js fallback is present.  Called once on page load.
   */
  function _warnIfNoRenderer() {
    if (typeof navigator !== 'undefined' && navigator.gpu) return;      // WebGPU present
    if (typeof window !== 'undefined' && window.Galaxy3DRenderer) return; // Three.js present
    // Both unavailable — schedule a non-intrusive console warning
    setTimeout(() => {
      console.warn(
        '[GalaxyQuest] WebGPU is not supported in this browser, ' +
        'and the Three.js fallback (Galaxy3DRenderer) was not loaded.\n' +
        'Supported browsers: Chrome 113+, Edge 113+, Firefox (dom.webgpu.enabled=true), Safari 17.4+\n' +
        'Tip: localStorage.setItem("gq:rendererHint","webgl2") forces the WebGL2 path.',
      );
    }, 0);
  }

  _warnIfNoRenderer();

  // Expose
  window.Galaxy3DRendererWebGPU = Galaxy3DRendererWebGPU;
  window.GQGalaxy3DRendererWebGPU = Galaxy3DRendererWebGPU;

  // If no Three.js renderer is registered yet, promote this as the primary.
  if (!window.Galaxy3DView) {
    window.Galaxy3DView = Galaxy3DRendererWebGPU;
  }
})();
