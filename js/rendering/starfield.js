/*
 * Auth Starfield Adapter
 * Uses the shared GPU canvas and Galaxy3DRenderer so auth + game never
 * compete across 2D/WebGL contexts.
 */
import { loadRuntimeModule } from '../runtime/runtime-module-loader.js';
import { loadAuthGalaxySamples } from './auth-galaxy-loader.js';
import { generateLoadingGalaxy } from './loading-galaxy.js';

(async function () {
  let canvas = document.getElementById('starfield');
  const host = document.getElementById('galaxy-host-wrapper') || document.getElementById('galaxy-3d-host') || canvas?.parentElement;
  if (!canvas || !host) return;
  const isStartMenu = !!document.getElementById('start-menu');

  function ensureRendererCanvas() {
    if (!canvas) return null;
    if (canvas.__gq_context_type === '2d') {
      const replacement = document.createElement('canvas');
      replacement.id = 'starfield';
      replacement.className = 'gq-auth-starfield-canvas';
      replacement.__gq_context_type = 'webgl';
      replacement.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;';
      if (canvas.parentElement) {
        canvas.parentElement.insertBefore(replacement, canvas.nextSibling || null);
      }
      canvas.remove();
      canvas = replacement;
      return canvas;
    }

    canvas.__gq_context_type = 'webgl';
    return canvas;
  }

  canvas = ensureRendererCanvas();

  // Immediately resize canvas to match host
  function resizeCanvas() {
    const rect = host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Try computed style first (for fixed/absolute elements)
    const computedStyle = window.getComputedStyle(host);
    let width = parseInt(computedStyle.width, 10) || rect.width || window.innerWidth;
    let height = parseInt(computedStyle.height, 10) || rect.height || window.innerHeight;
    
    // Fallback: if dimensions are still 0, use window dimensions
    if (width < 10) width = window.innerWidth;
    if (height < 10) height = window.innerHeight;
    
    canvas.width = Math.max(256, Math.floor(width * dpr));
    canvas.height = Math.max(256, Math.floor(height * dpr));
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    
    // Do not acquire a 2D context on the shared starfield canvas.
    // The renderer needs an uncontested WebGL context.
  }
  
  // Try to resize immediately
  if (document.readyState === 'loading') {
    // Page still loading, wait for DOMContentLoaded
    document.addEventListener('DOMContentLoaded', resizeCanvas);
  } else {
    // Page already loaded, resize immediately
    setTimeout(resizeCanvas, 50);
  }
  
  // Also resize on window resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resizeCanvas, 250);
  });

  const runtime = window.__GQ_AUTH_GALAXY_BG_RUNTIME = Object.assign(
    window.__GQ_AUTH_GALAXY_BG_RUNTIME || {},
    {
      releaseRequested: false,
      released: false,
      renderer: null,
      error: null,
      starSource: 'procedural',
      destroy: null,
      animationEngine: null,
      hudRoot: null,
      pendingTarget: null,
      cameraDriver: null,
      navBounds: null,
      speedOverlayCanvas: null,
      speedOverlayCtx: null,
      speedOverlayRafId: 0,
      speedOverlayParticles: null,
      speedOverlayPrevCamPos: null,
      speedOverlayPrevCamQuat: null,
      speedOverlayPrevTs: 0,
      authStarsAbortController: null,
    }
  );

  function starfieldDebug(payload, level = 'info') {
    try {
      const fn = window.GQLog && typeof window.GQLog[level] === 'function' ? window.GQLog[level] : null;
      const line = JSON.stringify(payload || {});
      if (fn) {
        fn('[starfielddbg]', line);
      } else {
        console[level]('[GQ][Starfield]', payload);
      }
    } catch (_) {}
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function getThreeRuntime() {
    return (typeof window !== 'undefined' && (window.THREE || window.__GQ_THREE_RUNTIME)) || null;
  }

  class Vec3Compat {
    constructor(x = 0, y = 0, z = 0) {
      this.x = Number(x || 0);
      this.y = Number(y || 0);
      this.z = Number(z || 0);
    }

    set(x, y, z) {
      this.x = Number(x || 0);
      this.y = Number(y || 0);
      this.z = Number(z || 0);
      return this;
    }

    clone() {
      return new Vec3Compat(this.x, this.y, this.z);
    }

    copy(v) {
      this.x = Number(v?.x || 0);
      this.y = Number(v?.y || 0);
      this.z = Number(v?.z || 0);
      return this;
    }

    add(v) {
      this.x += Number(v?.x || 0);
      this.y += Number(v?.y || 0);
      this.z += Number(v?.z || 0);
      return this;
    }

    sub(v) {
      this.x -= Number(v?.x || 0);
      this.y -= Number(v?.y || 0);
      this.z -= Number(v?.z || 0);
      return this;
    }

    multiplyScalar(s) {
      const n = Number(s || 0);
      this.x *= n;
      this.y *= n;
      this.z *= n;
      return this;
    }

    distanceTo(v) {
      const dx = this.x - Number(v?.x || 0);
      const dy = this.y - Number(v?.y || 0);
      const dz = this.z - Number(v?.z || 0);
      return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
    }

    normalize() {
      const len = Math.sqrt((this.x * this.x) + (this.y * this.y) + (this.z * this.z)) || 1;
      this.x /= len;
      this.y /= len;
      this.z /= len;
      return this;
    }

    crossVectors(a, b) {
      const ax = Number(a?.x || 0), ay = Number(a?.y || 0), az = Number(a?.z || 0);
      const bx = Number(b?.x || 0), by = Number(b?.y || 0), bz = Number(b?.z || 0);
      this.x = ay * bz - az * by;
      this.y = az * bx - ax * bz;
      this.z = ax * by - ay * bx;
      return this;
    }
  }

  function makeVec3(x = 0, y = 0, z = 0) {
    const three = getThreeRuntime();
    if (three && typeof three.Vector3 === 'function') {
      return new three.Vector3(x, y, z);
    }
    return new Vec3Compat(x, y, z);
  }

  function lerp(a, b, t) {
    const ta = Number(a || 0);
    const tb = Number(b || 0);
    const tt = Number(t || 0);
    return ta + ((tb - ta) * tt);
  }

  const withAssetVersion = typeof window.GQResolveAssetVersion === 'function'
    ? window.GQResolveAssetVersion.bind(window)
    : function fallbackAssetVersion(path, versionKey, fallbackVersion) {
        const assetVersions = window.__GQ_ASSET_VERSIONS || {};
        const version = String(assetVersions?.[versionKey] || fallbackVersion || '').trim();
        return version ? `${path}?v=${version}` : path;
      };

  function scriptLoaded(src) {
    return !!document.querySelector(`script[src="${src}"]`);
  }

  function loadScript(src) {
    const key = String(src || '').trim();
    if (!key) return Promise.reject(new Error('missing script src'));
    if (scriptLoaded(key)) return Promise.resolve();
    const moduleLoad = loadRuntimeModule(key);
    if (moduleLoad) return moduleLoad;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = key;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`script load failed: ${key}`));
      document.head.appendChild(s);
    });
  }

  async function ensureWebGpuRenderers() {
    if (window.Galaxy3DView || window.GQGalaxy3DRendererWebGPU || window.Galaxy3DRendererWebGPU) {
      return;
    }
    await loadScript(withAssetVersion('js/rendering/starfield-webgpu.js', 'starfieldWebGpu', '20260330p2'));
    await loadScript(withAssetVersion('js/rendering/Galaxy3DRendererWebGPU.js', 'galaxyRendererWebGpu', '20260404p4'));
    await loadScript(withAssetVersion('js/legacy/galaxy3d-webgpu.js', 'legacyWebGpu', '20260404p2'));
  }

  async function canUseWebGpuAdapter() {
    if (window.__GQ_WEBGPU_ADAPTER_AVAILABLE && typeof window.__GQ_WEBGPU_ADAPTER_AVAILABLE.value === 'boolean') {
      return window.__GQ_WEBGPU_ADAPTER_AVAILABLE.value;
    }

    if (typeof navigator === 'undefined' || !navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') {
      window.__GQ_WEBGPU_ADAPTER_AVAILABLE = { value: false };
      return false;
    }
    try {
      const adapter = await navigator.gpu.requestAdapter();
      const value = !!adapter;
      window.__GQ_WEBGPU_ADAPTER_AVAILABLE = { value };
      return value;
    } catch (_) {
      window.__GQ_WEBGPU_ADAPTER_AVAILABLE = { value: false };
      return false;
    }
  }

  async function ensureDeps() {
    if (isStartMenu) {
      await ensureWebGpuRenderers();
      if (!await canUseWebGpuAdapter()) {
        throw new Error('WebGPU is unavailable. Use a WebGPU-capable browser to display the galaxy.');
      }
      return;
    }
    const forceWebGlFallback = window.__GQ_AUTH_FORCE_WEBGL === true;
    if (!forceWebGlFallback) {
      try {
        await ensureWebGpuRenderers();
      } catch (_) {
        // Continue with legacy chain when WebGPU files are unavailable.
      }
    }

    const hasWebGpuView = !forceWebGlFallback
      && !!(window.Galaxy3DView || window.GQGalaxy3DRendererWebGPU || window.Galaxy3DRendererWebGPU);
    const hasUsableWebGpu = forceWebGlFallback ? false : await canUseWebGpuAdapter();
    if (!hasWebGpuView || !hasUsableWebGpu) {
      if (!window.THREE) {
        await loadScript('js/vendor/three.min.js');
      }
      if (window.THREE && typeof window.THREE.Scene === 'function' && typeof window.THREE.Vector3 === 'function') {
        window.__GQ_THREE_RUNTIME = window.THREE;
      }
      if (!window.GalaxyCameraController) {
        await loadScript(withAssetVersion('js/rendering/galaxy-camera-controller.js', 'galaxyCameraController', '20260329p85'));
      }
      if (!window.GQTextureManager) {
        await loadScript(withAssetVersion('js/rendering/texture-manager.js', 'textureManager', '20260404p50'));
      }
      if (!window.GQGeometryManager) {
        await loadScript(withAssetVersion('js/rendering/geometry-manager.js', 'geometryManager', '20260404p50'));
      }
      if (!window.GQMaterialFactory) {
        await loadScript(withAssetVersion('js/rendering/material-factory.js', 'materialFactory', '20260404p50'));
      }
      if (!window.GQLightRigManager) {
        await loadScript(withAssetVersion('js/rendering/light-rig-manager.js', 'lightRigManager', '20260404p50'));
      }
      if (!window.Galaxy3DRenderer) {
        await loadScript(withAssetVersion('js/rendering/galaxy-renderer-core.js', 'galaxyRendererCore', '20260404p118'));
      }
    }

    if (!window.Galaxy3DView && !window.GQGalaxy3DRendererWebGPU && !window.Galaxy3DRendererWebGPU && !window.Galaxy3DRenderer) {
      throw new Error('Galaxy renderer unavailable');
    }
  }

  function cubicBezier1D(a, b, c, d, t) {
    const mt = 1 - t;
    return (mt * mt * mt * a)
      + (3 * mt * mt * t * b)
      + (3 * mt * t * t * c)
      + (t * t * t * d);
  }

  function ensureSpeedOverlayCanvas() {
    if (runtime.speedOverlayCanvas && runtime.speedOverlayCanvas.parentElement) return;
    const overlay = document.createElement('canvas');
    overlay.className = 'gq-starfield-speed-overlay';
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.display = 'block';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2';

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = host.getBoundingClientRect();
    overlay.width = Math.max(1, Math.floor(rect.width * dpr));
    overlay.height = Math.max(1, Math.floor(rect.height * dpr));

    const ctx = overlay.getContext('2d', { alpha: true });
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    host.appendChild(overlay);

    runtime.speedOverlayCanvas = overlay;
    runtime.speedOverlayCtx = ctx;
    runtime.speedOverlayParticles = Array.from({ length: 260 }, () => ({
      angle: Math.random() * Math.PI * 2,
      radiusNorm: Math.random() * Math.random(),
      depth: Math.pow(Math.random(), 0.72),
      tw: Math.random(),
      drift: (Math.random() - 0.5) * 0.14,
    }));
    runtime.speedOverlayPrevCamPos = null;
    runtime.speedOverlayPrevCamQuat = null;
    runtime.speedOverlayPrevTs = performance.now();
  }

  function resizeSpeedOverlayCanvas() {
    const overlay = runtime.speedOverlayCanvas;
    const ctx = runtime.speedOverlayCtx;
    if (!overlay || !ctx) return;
    const rect = host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (overlay.width === width && overlay.height === height) return;

    overlay.width = width;
    overlay.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Variabilitaet des Warp-Effekts wird bewusst ueber diskrete Speed-Thresholds gesteuert.
  function resolveSpeedBand(speed, phase) {
    const phaseKey = String(phase || 'idle').toLowerCase();
    const phaseFactor = phaseKey === 'cruise' ? 1.0 : (phaseKey === 'approach' || phaseKey === 'acquire') ? 0.84 : 0.52;
    const effectiveSpeed = Math.max(0, Number(speed || 0) * phaseFactor);

    if (effectiveSpeed < 0.08) {
      return {
        activeRatio: 0.28,
        radialGain: 0.42,
        lengthGain: 0.4,
        alphaGain: 0.28,
        widthGain: 0.84,
        driftGain: 0.44,
        motionGain: 0.78,
      };
    }
    if (effectiveSpeed < 0.2) {
      return {
        activeRatio: 0.42,
        radialGain: 0.64,
        lengthGain: 0.66,
        alphaGain: 0.52,
        widthGain: 0.9,
        driftGain: 0.62,
        motionGain: 0.92,
      };
    }
    if (effectiveSpeed < 0.45) {
      return {
        activeRatio: 0.62,
        radialGain: 1.02,
        lengthGain: 1.04,
        alphaGain: 0.88,
        widthGain: 1.06,
        driftGain: 0.84,
        motionGain: 1.08,
      };
    }
    if (effectiveSpeed < 0.75) {
      return {
        activeRatio: 0.84,
        radialGain: 1.28,
        lengthGain: 1.46,
        alphaGain: 1.14,
        widthGain: 1.18,
        driftGain: 1.05,
        motionGain: 1.28,
      };
    }
    return {
      activeRatio: 1.0,
      radialGain: 1.72,
      lengthGain: 1.92,
      alphaGain: 1.35,
      widthGain: 1.3,
      driftGain: 1.28,
      motionGain: 1.58,
    };
  }

  function renderSpeedOverlay(now) {
    const overlay = runtime.speedOverlayCanvas;
    const ctx = runtime.speedOverlayCtx;
    const renderer = runtime.renderer;
    if (!overlay || !ctx || !renderer || !renderer.camera || !window.THREE) return;

    resizeSpeedOverlayCanvas();
    const rect = host.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const cx = w * 0.5;
    const cy = h * 0.5;

    const telemetry = runtime.cameraDriver && typeof runtime.cameraDriver.getTelemetry === 'function'
      ? runtime.cameraDriver.getTelemetry()
      : null;
    const speed = Number(telemetry?.speed ?? runtime.flight?.lastSpeed ?? 0);
    const phase = String(telemetry?.phase || 'idle').toLowerCase();
    const speedBand = resolveSpeedBand(speed, phase);
    const speedNorm = clamp((speed / 1), 0, 1);

    ctx.clearRect(0, 0, w, h);
    if (speedNorm < 0.01) return;

    const camPos = renderer.camera.position;
    const camQuat = renderer.camera.quaternion;
    const prevPos = runtime.speedOverlayPrevCamPos || camPos.clone();
    const prevQuat = runtime.speedOverlayPrevCamQuat || camQuat.clone();
    const dtSec = Math.max(0.001, (now - Number(runtime.speedOverlayPrevTs || now)) * 0.001);
    runtime.speedOverlayPrevCamPos = camPos.clone();
    runtime.speedOverlayPrevCamQuat = camQuat.clone();
    runtime.speedOverlayPrevTs = now;

    const worldDelta = camPos.clone().sub(prevPos);
    const motionMag = worldDelta.length() / dtSec;
    const invQuat = renderer.camera.quaternion.clone().invert();
    const localDelta = worldDelta.applyQuaternion(invQuat);

    const deltaQuat = prevQuat.clone().invert().multiply(camQuat.clone()).normalize();
    const dqW = clamp(deltaQuat.w, -1, 1);
    const rotAngle = 2 * Math.acos(dqW);
    const rotS = Math.sqrt(Math.max(1 - dqW * dqW, 0));
    const rotAxis = rotS < 1e-4
      ? { x: 0, y: 0, z: 0 }
      : {
          x: deltaQuat.x / rotS,
          y: deltaQuat.y / rotS,
          z: deltaQuat.z / rotS,
        };

    const yawRate = rotAxis.y * rotAngle / dtSec;
    const pitchRate = rotAxis.x * rotAngle / dtSec;
    const rollRate = rotAxis.z * rotAngle / dtSec;

    const lateralX = clamp(localDelta.x * 0.12, -42, 42);
    const lateralY = clamp(-localDelta.y * 0.12, -32, 32);
    const rotShiftX = clamp((yawRate * 24) + (rollRate * 10), -78, 78);
    const rotShiftY = clamp((-pitchRate * 24) + (rollRate * 6), -62, 62);
    const driftX = (lateralX + rotShiftX) * speedBand.driftGain;
    const driftY = (lateralY + rotShiftY) * speedBand.driftGain;

    const centerShiftX = clamp(driftX * 0.08, -16, 16);
    const centerShiftY = clamp(driftY * 0.08, -14, 14);
    const centerX = cx + centerShiftX;
    const centerY = cy + centerShiftY;

    const motionBoost = clamp((motionMag / 250) * speedBand.motionGain, 0.45, 2.9);
    const coreClearRadius = Math.min(w, h) * 0.14;
    const maxR = Math.hypot(w, h) * 0.78;
    const usableRadius = Math.max(24, maxR - coreClearRadius);
    const radialStep = (0.18 + speedBand.radialGain * 1.35 + speedNorm * 0.55) * dtSec;
    const particles = Array.isArray(runtime.speedOverlayParticles) ? runtime.speedOverlayParticles : [];
    const activeCount = Math.max(10, Math.floor(particles.length * speedBand.activeRatio));

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < activeCount; i += 1) {
      const p = particles[i];
      p.angle += (p.drift * dtSec * (0.7 + speedNorm * 0.8));
      p.radiusNorm += radialStep * (0.28 + p.depth * 1.15);
      if (p.radiusNorm > 1.2) {
        p.radiusNorm = Math.random() * 0.08;
        p.angle = Math.random() * Math.PI * 2;
      }

      const radius = coreClearRadius + (p.radiusNorm * usableRadius);
      const rx = Math.cos(p.angle);
      const ry = Math.sin(p.angle) * 0.7;
      const px = centerX + (rx * radius);
      const py = centerY + (ry * radius);

      const vecLen = Math.hypot(rx, ry) || 1;
      const radialX = rx / vecLen;
      const radialY = ry / vecLen;
      const driftNormX = driftX / Math.max(1, w * 0.33);
      const driftNormY = driftY / Math.max(1, h * 0.33);
      const dirX = radialX + driftNormX * (0.3 + p.depth * 0.9);
      const dirY = radialY + driftNormY * (0.3 + p.depth * 0.9);
      const dirLen = Math.hypot(dirX, dirY) || 1;
      const ux = dirX / dirLen;
      const uy = dirY / dirLen;

      const len = (3 + p.depth * 20) * (0.2 + speedBand.lengthGain * 1.45 + speedNorm * 0.95) * motionBoost;
      const tailRadius = Math.max(coreClearRadius + 2, radius - len);
      const x0 = centerX + (radialX * tailRadius);
      const y0 = centerY + (radialY * tailRadius);

      const alpha = clamp((0.022 + p.depth * 0.13) * (0.12 + speedBand.alphaGain * 0.88), 0.01, 0.32);
      const width = (0.45 + p.depth * 1.5) * speedBand.widthGain;
      ctx.strokeStyle = `rgba(159, 208, 255, ${alpha.toFixed(3)})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(px, py);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  function startSpeedOverlayLoop() {
    if (runtime.speedOverlayRafId) return;
    const tick = (now) => {
      if (runtime.releaseRequested || runtime.released || !runtime.renderer || !runtime.speedOverlayCtx) {
        runtime.speedOverlayRafId = 0;
        return;
      }
      renderSpeedOverlay(now);
      runtime.speedOverlayRafId = requestAnimationFrame(tick);
    };
    runtime.speedOverlayRafId = requestAnimationFrame(tick);
  }

  function ensureHud() {
    if (runtime.hudRoot && runtime.hudRoot.parentElement) return;
    const root = document.createElement('div');
    root.className = 'gq-spaceflight-hud';
    root.style.setProperty('--gq-spaceflight-hud-color', '#9fd0ff');

    const topLeft = document.createElement('div');
    topLeft.className = 'gq-spaceflight-hud-label';
    topLeft.textContent = `GALAXY NAV HUD - ${String(window.__GQ_ACTIVE_RENDERER_BACKEND || 'GPU').toUpperCase()}`;

    const readout = document.createElement('div');
    readout.className = 'gq-spaceflight-hud-readout';
    readout.textContent = 'SPD 0000.0 | STARS 0000 | TGT ----';

    const crosshair = document.createElement('div');
    crosshair.className = 'gq-spaceflight-hud-crosshair';
    const h = document.createElement('div');
    h.className = 'gq-spaceflight-hud-crosshair-h';
    const v = document.createElement('div');
    v.className = 'gq-spaceflight-hud-crosshair-v';
    crosshair.appendChild(h);
    crosshair.appendChild(v);

    root.appendChild(topLeft);
    root.appendChild(readout);
    root.appendChild(crosshair);
    host.appendChild(root);

    runtime.hudRoot = root;
    runtime.hudReadout = readout;
  }

  function applyNavigationTarget(target) {
    if (!target) return false;
    const boundedTarget = snapTargetToInnerStar(target);
    const durationSec = resolveAuthFlightDurationSec(boundedTarget, { hero: true });
    if (runtime.cameraDriver && typeof runtime.cameraDriver.setTarget === 'function') {
      return runtime.cameraDriver.setTarget(boundedTarget, { durationSec });
    }
    return false;
  }

  function planRandomTarget() {
    const target = pickRandomCruiseTarget();
    if (!target) {
      if (runtime.cameraDriver && typeof runtime.cameraDriver.setRandomTarget === 'function') {
        runtime.cameraDriver.setRandomTarget();
      }
      return;
    }
    if (runtime.cameraDriver && typeof runtime.cameraDriver.setTarget === 'function') {
      const durationSec = resolveAuthFlightDurationSec(target, { hero: false });
      runtime.cameraDriver.setTarget(target, { durationSec });
    }
  }

  function readAuthFlightProfile() {
    const fromWindow = String(window.__GQ_AUTH_FLIGHT_PROFILE || '').trim().toLowerCase();
    if (fromWindow === 'balanced' || fromWindow === 'slow' || fromWindow === 'cinematic') {
      return fromWindow;
    }
    try {
      const fromStorage = String(localStorage.getItem('gq_auth_flight_profile') || '').trim().toLowerCase();
      if (fromStorage === 'balanced' || fromStorage === 'slow' || fromStorage === 'cinematic') {
        return fromStorage;
      }
    } catch (_) {}
    return 'cinematic';
  }

  function getAuthFlightProfileConfig() {
    const profile = readAuthFlightProfile();
    if (profile === 'slow') {
      return {
        heroMinSec: 45,
        heroMaxSec: 180,
        cruiseMinSec: 36,
        cruiseMaxSec: 150,
        heroScaleLyPerSec: 1,
        cruiseScaleLyPerSec: 1,
        heroTargetLyPerSec: 0.72,
        cruiseTargetLyPerSec: 0.86,
        minCruiseDistance: 32,
        maxCruiseDistance: 96,
      };
    }
    if (profile === 'balanced') {
      return {
        heroMinSec: 34,
        heroMaxSec: 140,
        cruiseMinSec: 26,
        cruiseMaxSec: 120,
        heroScaleLyPerSec: 1,
        cruiseScaleLyPerSec: 1,
        heroTargetLyPerSec: 0.8,
        cruiseTargetLyPerSec: 0.92,
        minCruiseDistance: 28,
        maxCruiseDistance: 84,
      };
    }
    return {
      heroMinSec: 40,
      heroMaxSec: 160,
      cruiseMinSec: 30,
      cruiseMaxSec: 130,
      heroScaleLyPerSec: 1,
      cruiseScaleLyPerSec: 1,
      heroTargetLyPerSec: 0.76,
      cruiseTargetLyPerSec: 0.9,
      minCruiseDistance: 30,
      maxCruiseDistance: 90,
    };
  }

  function resolveNavBounds() {
    if (runtime.navBounds) return runtime.navBounds;
    const stars = Array.isArray(runtime.stars) ? runtime.stars : [];
    if (!stars.length) {
      runtime.navBounds = {
        centerX: 0,
        centerZ: 0,
        innerMin: 320,
        innerMax: 2600,
      };
      return runtime.navBounds;
    }

    let sumX = 0;
    let sumZ = 0;
    let count = 0;
    for (let i = 0; i < stars.length; i += 1) {
      const s = stars[i];
      const sx = Number(s?.x_ly);
      const sz = Number(s?.z_ly);
      if (!Number.isFinite(sx) || !Number.isFinite(sz)) continue;
      sumX += sx;
      sumZ += sz;
      count += 1;
    }
    const centerX = count > 0 ? (sumX / count) : 0;
    const centerZ = count > 0 ? (sumZ / count) : 0;

    let maxR = 0;
    for (let i = 0; i < stars.length; i += 1) {
      const s = stars[i];
      const sx = Number(s?.x_ly || 0);
      const sz = Number(s?.z_ly || 0);
      const r = Math.hypot(sx - centerX, sz - centerZ);
      if (Number.isFinite(r) && r > maxR) maxR = r;
    }

    const resolvedMax = Math.max(1200, maxR * 0.74);
    runtime.navBounds = {
      centerX,
      centerZ,
      innerMin: Math.max(120, resolvedMax * 0.08),
      innerMax: resolvedMax,
    };
    return runtime.navBounds;
  }

  function snapTargetToInnerStar(target) {
    const tx = Number(target?.x_ly);
    const ty = Number(target?.y_ly || 0);
    const tz = Number(target?.z_ly);
    if (!Number.isFinite(tx) || !Number.isFinite(tz)) return target;

    const bounds = resolveNavBounds();
    const stars = Array.isArray(runtime.stars) ? runtime.stars : [];
    if (!stars.length) return target;

    let best = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < stars.length; i += 1) {
      const s = stars[i];
      const sx = Number(s?.x_ly);
      const sy = Number(s?.y_ly || 0);
      const sz = Number(s?.z_ly);
      if (!Number.isFinite(sx) || !Number.isFinite(sz)) continue;

      const sr = Math.hypot(sx - bounds.centerX, sz - bounds.centerZ);
      if (!Number.isFinite(sr) || sr < bounds.innerMin || sr > bounds.innerMax) continue;

      const dx = sx - tx;
      const dy = sy - ty;
      const dz = sz - tz;
      const d2 = (dx * dx) + (dy * dy) + (dz * dz);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = s;
      }
    }

    if (!best) return target;
    return {
      id: best.id,
      x_ly: best.x_ly,
      y_ly: best.y_ly,
      z_ly: best.z_ly,
      label: `SYS-${String(best.system_index || best.id || '').padStart(4, '0')}`,
    };
  }

  function resolveAuthFlightDurationSec(target, opts = {}) {
    const cameraPos = runtime?.renderer?.camera?.position;
    const cfg = getAuthFlightProfileConfig();
    const tx = Number(target?.x_ly);
    const ty = Number(target?.y_ly || 0);
    const tz = Number(target?.z_ly);
    if (!cameraPos || !Number.isFinite(tx) || !Number.isFinite(tz)) {
      return opts.hero ? cfg.heroMinSec : cfg.cruiseMinSec;
    }

    const dx = tx - Number(cameraPos.x || 0);
    const dy = ty - Number(cameraPos.y || 0);
    const dz = tz - Number(cameraPos.z || 0);
    const distance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
    const minSec = opts.hero ? cfg.heroMinSec : cfg.cruiseMinSec;
    const maxSec = opts.hero ? cfg.heroMaxSec : cfg.cruiseMaxSec;
    const nominalSpeed = opts.hero ? cfg.heroTargetLyPerSec : cfg.cruiseTargetLyPerSec;
    const hardSpeedCap = opts.hero ? cfg.heroScaleLyPerSec : cfg.cruiseScaleLyPerSec;
    const targetSpeed = Math.max(0.1, Math.min(hardSpeedCap, nominalSpeed));
    const scaled = distance / targetSpeed;
    return Math.max(minSec, Math.min(maxSec, scaled));
  }

  function pickRandomCruiseTarget() {
    const stars = Array.isArray(runtime.stars) ? runtime.stars : [];
    const camera = runtime?.renderer?.camera;
    const cameraPos = camera?.position;
    const cfg = getAuthFlightProfileConfig();
    if (!stars.length || !cameraPos) return null;

    const cameraForward = makeVec3(0, 0, -1);
    if (camera && typeof camera.getWorldDirection === 'function') {
      camera.getWorldDirection(cameraForward);
    }

    const minDist = cfg.minCruiseDistance;
    const maxDist = cfg.maxCruiseDistance;
    const bounds = resolveNavBounds();
    let fallback = null;
    let bestScore = -Infinity;

    for (let i = 0; i < 80; i += 1) {
      const star = stars[Math.floor(Math.random() * stars.length)];
      if (!star) continue;
      const sr = Math.hypot(
        Number(star.x_ly || 0) - bounds.centerX,
        Number(star.z_ly || 0) - bounds.centerZ
      );
      if (!Number.isFinite(sr) || sr < bounds.innerMin || sr > bounds.innerMax) continue;

      const dx = Number(star.x_ly || 0) - Number(cameraPos.x || 0);
      const dy = Number(star.y_ly || 0) - Number(cameraPos.y || 0);
      const dz = Number(star.z_ly || 0) - Number(cameraPos.z || 0);
      const dist = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
      if (!Number.isFinite(dist)) continue;
      const invDist = 1 / Math.max(1e-6, dist);
      const alignment = clamp(((dx * cameraForward.x) + (dy * cameraForward.y) + (dz * cameraForward.z)) * invDist, -1, 1);
      const target = {
        id: star.id,
        x_ly: star.x_ly,
        y_ly: star.y_ly,
        z_ly: star.z_ly,
        label: `SYS-${String(star.system_index || star.id || '').padStart(4, '0')}`,
      };
      const bandCenter = (minDist + maxDist) * 0.5;
      const distPenalty = Math.abs(dist - bandCenter) / Math.max(1, bandCenter);
      const radialCenter = (bounds.innerMin + bounds.innerMax) * 0.5;
      const radialPenalty = Math.abs(sr - radialCenter) / Math.max(1, radialCenter);
      const forwardBonus = Math.max(0, alignment) * 0.34;
      const rearPenalty = Math.max(0, -alignment) * 0.42;
      const score = 1 - (distPenalty * 0.62 + radialPenalty * 0.22 + rearPenalty) + forwardBonus;

      if (dist >= minDist && dist <= maxDist && score > bestScore) {
        bestScore = score;
        fallback = target;
      } else if (!fallback || score > bestScore) {
        bestScore = score;
        fallback = target;
      }
    }

    return fallback || null;
  }

  function alignRendererToGalaxyCenter() {
    const renderer = runtime.renderer;
    if (!renderer || !renderer.camera) return;

    const bounds = resolveNavBounds();
    const center = makeVec3(bounds.centerX, 0, bounds.centerZ);

    if (renderer.controls && renderer.camera) {
      const currentTarget = renderer.controls.target ? renderer.controls.target.clone() : makeVec3();
      const offset = renderer.camera.position.clone().sub(currentTarget);
      renderer.controls.target.copy(center);
      renderer.camera.position.copy(center.clone().add(offset));
      if (typeof renderer.controls.update === 'function') {
        renderer.controls.update();
      }
    }

    if (runtime.cameraDriver && typeof runtime.cameraDriver.setGalaxyCenter === 'function') {
      runtime.cameraDriver.setGalaxyCenter(center);
    }
  }

  function restartCruiseFromFreshCenter() {
    if (runtime.cameraDriver && runtime.cameraDriver.flight) {
      runtime.cameraDriver.flight.target = null;
      runtime.cameraDriver.flight.start = null;
      runtime.cameraDriver.flight.c1 = null;
      runtime.cameraDriver.flight.c2 = null;
      runtime.cameraDriver.flight.end = null;
    }
    planRandomTarget();
  }

  function updateHud() {
    if (!runtime.hudReadout || !runtime.renderer) return;
    const telemetry = runtime.cameraDriver && typeof runtime.cameraDriver.getTelemetry === 'function'
      ? runtime.cameraDriver.getTelemetry()
      : null;
    const speed = Number(telemetry?.speed || 0);
    const targetLabel = String(telemetry?.targetLabel || '----');
    runtime.hudReadout.textContent = `SPD ${speed.toFixed(1).padStart(6, '0')} | STARS ${String((runtime.stars || []).length).padStart(4, '0')} | TGT ${targetLabel}`;
  }

  function createCameraDriver() {
    const sharedDriverFactory = window.GQSpaceCameraFlightDriver;
    const threeRuntime = getThreeRuntime();
    const cameraPosition = runtime.renderer?.camera?.position;
    const supportsSharedCameraDriver = typeof cameraPosition?.clone === 'function';
    if (sharedDriverFactory
      && typeof sharedDriverFactory.create === 'function'
      && threeRuntime
      && supportsSharedCameraDriver) {
      const sharedDriver = sharedDriverFactory.create({
        three: threeRuntime,
        physicsTuning: {
          gravitationalConstant: 1.4e-5,
          softening: 320,
          maxAcceleration: 0.42,
          defaultDrag: 0.032,
        },
        motionConstraints: {
          maxSpeedLyPerSec: 1,
          maxLinearAccel: 0.14,
          maxBrakeAccel: 0.22,
          maxThrustAccel: 0.24,
          headingSmoothing: 2.4,
          rollResponsiveness: 1.8,
          maneuverStrength: 0.085,
          maneuverFrequency: 0.22,
        },
        onTelemetry: () => updateHud(),
      });
      if (typeof sharedDriver.setRandomStars === 'function') {
        sharedDriver.setRandomStars(runtime.stars || []);
      }
      if (typeof sharedDriver.setGalaxyCenter === 'function') {
        const bounds = resolveNavBounds();
        sharedDriver.setGalaxyCenter({ x: bounds.centerX, y: 0, z: bounds.centerZ });
      }
      return sharedDriver;
    }

    return {
      setTarget(target, options = {}) {
        const x = Number(target?.x_ly);
        const y = Number(target?.y_ly || 0);
        const z = Number(target?.z_ly);
        if (!Number.isFinite(x) || !Number.isFinite(z)) return false;

        const cameraPosition = runtime.renderer?.camera?.position || {};
        const start = makeVec3(cameraPosition.x || 0, cameraPosition.y || 0, cameraPosition.z || 0);
        const end = makeVec3(x, y, z);
        const delta = end.clone().sub(start);
        const direction = delta.clone().normalize();
        const side = makeVec3().crossVectors(direction, makeVec3(0, 1, 0)).normalize();
        const lift = clamp(start.distanceTo(end) * 0.18, 18, 900);
        const flight = runtime.flight;

        flight.target = target;
        flight.t = 0;
        flight.duration = Math.max(1.5, Number(options.durationSec || 8));
        flight.start = start;
        flight.c1 = start.clone().add(delta.clone().multiplyScalar(0.28)).add(side.clone().multiplyScalar(lift));
        flight.c2 = start.clone().add(delta.clone().multiplyScalar(0.72)).sub(side.clone().multiplyScalar(lift * 0.6));
        flight.end = end;
        flight.prevTs = performance.now();
        flight.prevPos = start.clone();
        flight.lastSpeed = 0;
        return true;
      },
      update({ renderer, dt, now }) {
        if (!renderer) return false;
        if (runtime.releaseRequested || document.body.classList.contains('game-page')) {
          controlApi.releaseCanvasForGame();
          return true;
        }

        const flight = runtime.flight;
        const dtMs = Math.min(48, Math.max(8, Number(dt || 0) * 1000));
        flight.prevTs = now;

        if (!flight.target) {
          if (runtime.pendingTarget) {
            applyNavigationTarget(runtime.pendingTarget);
            runtime.pendingTarget = null;
          } else {
            planRandomTarget();
          }
        }

        if (!(flight.target && flight.start && flight.c1 && flight.c2 && flight.end)) {
          updateHud();
          return true;
        }

        const dtSec = dtMs * 0.001;
        flight.t = Math.min(1, flight.t + (dtSec / Math.max(1.5, flight.duration)));

        const p = makeVec3(
          cubicBezier1D(flight.start.x, flight.c1.x, flight.c2.x, flight.end.x, flight.t),
          cubicBezier1D(flight.start.y, flight.c1.y, flight.c2.y, flight.end.y, flight.t),
          cubicBezier1D(flight.start.z, flight.c1.z, flight.c2.z, flight.end.z, flight.t)
        );
        const t2 = Math.min(1, flight.t + 0.015);
        const q = makeVec3(
          cubicBezier1D(flight.start.x, flight.c1.x, flight.c2.x, flight.end.x, t2),
          cubicBezier1D(flight.start.y, flight.c1.y, flight.c2.y, flight.end.y, t2),
          cubicBezier1D(flight.start.z, flight.c1.z, flight.c2.z, flight.end.z, t2)
        );

        const manYaw = Math.sin(now * 0.00075) * 0.013 + Math.sin(now * 0.0019) * 0.008;
        const manPitch = Math.cos(now * 0.00063) * 0.010;
        const manRoll = Math.sin(now * 0.0012) * 0.015;

        const d = q.clone().sub(p).normalize();
        const up = makeVec3(0, 1, 0);
        const right = makeVec3().crossVectors(d, up).normalize();
        const lifted = p.clone()
          .add(right.multiplyScalar(manYaw * 280))
          .add(makeVec3(0, manPitch * 210, 0));
        const lookAt = q.clone().add(makeVec3(manYaw * 120, manPitch * 70, 0));

        const moved = lifted.distanceTo(flight.prevPos || lifted);
        flight.lastSpeed = lerp(flight.lastSpeed || 0, moved / Math.max(0.0001, dtSec), 0.22);
        flight.prevPos = lifted.clone();

        if (flight.t >= 1) {
          flight.target = null;
          flight.start = null;
          flight.c1 = null;
          flight.c2 = null;
          flight.end = null;
        }

        updateHud();
        return {
          position: lifted,
          target: lookAt,
          roll: manRoll,
        };
      },
    };
  }

  function destroy(options = {}) {
    const keepCanvasVisible = options.keepCanvasVisible === true;
    runtime.authStarsAbortController?.abort();
    runtime.authStarsAbortController = null;
    if (runtime.released && !runtime.renderer && !runtime.animationEngine) {
      if (canvas) {
        if (keepCanvasVisible) {
          canvas.style.opacity = '1';
          canvas.style.visibility = 'visible';
          canvas.style.display = 'block';
        } else {
          canvas.style.opacity = '0';
          canvas.style.visibility = 'hidden';
        }
      }
      return;
    }
    try {
      const expectedHandoffDestroy = keepCanvasVisible && !!runtime.releaseRequested;
      starfieldDebug({
        stage: 'destroy',
        ts: Date.now(),
        keepCanvasVisible,
        releaseRequested: !!runtime.releaseRequested,
        released: !!runtime.released,
        bodyClass: String(document.body?.className || ''),
        stack: expectedHandoffDestroy ? '' : String(new Error().stack || '').split('\n').slice(0, 6).join(' | '),
      }, expectedHandoffDestroy ? 'info' : 'warn');
    } catch (_) {}
    if (canvas) {
      if (keepCanvasVisible) {
        canvas.style.opacity = '1';
        canvas.style.visibility = 'visible';
        canvas.style.display = 'block';
      } else {
        canvas.style.opacity = '0';
        canvas.style.visibility = 'hidden';
      }
    }
    if (runtime.speedOverlayRafId) {
      cancelAnimationFrame(runtime.speedOverlayRafId);
    }
    runtime.speedOverlayRafId = 0;
    if (runtime.speedOverlayCanvas && runtime.speedOverlayCanvas.parentElement) {
      runtime.speedOverlayCanvas.parentElement.removeChild(runtime.speedOverlayCanvas);
    }
    runtime.speedOverlayCanvas = null;
    runtime.speedOverlayCtx = null;
    runtime.speedOverlayParticles = null;
    runtime.speedOverlayPrevCamPos = null;
    runtime.speedOverlayPrevCamQuat = null;

    if (runtime.hudRoot && runtime.hudRoot.parentElement) {
      runtime.hudRoot.parentElement.removeChild(runtime.hudRoot);
    }
    runtime.hudRoot = null;
    runtime.hudReadout = null;
    if (runtime.renderer && typeof runtime.renderer.clearCameraDriver === 'function') {
      runtime.renderer.clearCameraDriver();
    }
    if (runtime.renderer?.renderer && typeof runtime.renderer.renderer.clear === 'function') {
      try {
        runtime.renderer.renderer.clear(true, true, true);
      } catch (_) {}
    }
    if (runtime.renderer && typeof runtime.renderer.destroy === 'function') {
      runtime.renderer.destroy();
    }
    runtime.released = true;
    runtime.renderer = null;
    runtime.animationEngine = null;
  }

  const controlApi = {
    setRegistrationPreview(preview) {
      const stars = preview?.stars;
      if (preview && (!Array.isArray(stars) || !stars.length)) return false;
      const previous = runtime.registrationPreview;
      runtime.registrationPreview = preview;
      if (!runtime.renderer) return !runtime.released;
      if (typeof runtime.renderer.setRegionPreview !== 'function') return false;
      if (!preview || previous?.stars !== stars) {
        const visible = preview && runtime.starSource === 'database'
          ? [...new Map([...runtime.stars, ...stars].map((star) => [`${star.galaxy_index}:${star.system_index}`, star])).values()]
          : preview ? stars : runtime.stars;
        runtime.renderer.setStars?.(visible, { preserveScale: !!preview && runtime.starSource === 'database' });
      }
      if (runtime.renderer.setRegionPreview(preview?.target || null) !== true) return false;
      if (typeof runtime.renderer.setRegistrationScene === 'function') {
        if (runtime.renderer.setRegistrationScene(preview) !== true) return false;
      } else if (preview?.stage && preview.stage !== 'region') return false;
      const label = document.getElementById('start-galaxy-source');
      if (label) {
        label.textContent = preview
          ? `Database registration region: ${stars.length} real star systems.`
          : runtime.starSource === 'database'
            ? `Database galaxy sample: ${runtime.stars.length.toLocaleString()} star systems.`
            : 'Procedural loading galaxy - not DB data.';
      }
      return true;
    },
    releaseCanvasForGame() {
      runtime.releaseRequested = true;
      if (runtime.released && !runtime.renderer) {
        return;
      }
      try {
        starfieldDebug({
          stage: 'releaseCanvasForGame',
          ts: Date.now(),
          bodyClass: String(document.body?.className || ''),
        });
      } catch (_) {}
      destroy({ keepCanvasVisible: true });
    },
    setNavigationTarget(target) {
      if (runtime.renderer) {
        return applyNavigationTarget(target);
      }
      runtime.pendingTarget = target || null;
      return true;
    },
    destroy,
    isActive() {
      return !!runtime.renderer && !runtime.released;
    },
  };

  window.GQStarfieldControl = Object.assign(window.GQStarfieldControl || {}, controlApi);
  window.GQAuthGalaxyBackgroundControl = Object.assign(window.GQAuthGalaxyBackgroundControl || {}, controlApi);
  if (window.GQGalaxyEngineBridge && typeof window.GQGalaxyEngineBridge.registerAdapter === 'function') {
    window.GQGalaxyEngineBridge.registerAdapter('starfield', window.GQStarfieldControl);
    window.GQGalaxyEngineBridge.registerAdapter('auth-background', window.GQAuthGalaxyBackgroundControl);
  }

  try {
    await ensureDeps();
    if (runtime.releaseRequested || document.body.classList.contains('game-page')) {
      if (!(runtime.released && !runtime.renderer)) {
        destroy({ keepCanvasVisible: true });
      }
      return;
    }
    runtime.releaseRequested = false;
    runtime.released = false;
    runtime.stars = generateLoadingGalaxy(isStartMenu ? 9000 : 1200, 5800);
    runtime.navBounds = null;
    runtime.occupiedSystems = [];

    const GalaxyViewCtor = window.Galaxy3DView || window.Galaxy3DRendererWebGPU || window.Galaxy3DRenderer;
    
    if (!GalaxyViewCtor) {
      if (isStartMenu) throw new Error('The WebGPU galaxy renderer is unavailable');
      // Fallback: simple 2D starfield
      resizeCanvas();
      const ctx = canvas.getContext('2d');
      if (ctx && runtime.stars && runtime.stars.length > 0) {
        // Simple 2D rendering of starfield
        ctx.fillStyle = 'rgba(15, 22, 36, 1)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw stars
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.8;
        for (let i = 0; i < Math.min(runtime.stars.length, 2000); i++) {
          const star = runtime.stars[i];
          const x = ((star.x || 0) % canvas.width);
          const y = ((star.y || 0) % canvas.height);
          const size = Math.max(0.5, (star.lum || 1) * 1.5);
          ctx.fillRect(x, y, size, size);
        }
        ctx.globalAlpha = 1;
      }
      canvas.style.opacity = '1';
      canvas.style.visibility = 'visible';
      canvas.style.display = 'block';
      return;
    }
    
    runtime.renderer = new GalaxyViewCtor(host, {
      externalCanvas: canvas,
      alpha: true,
      interactive: false,
      initialStars: runtime.stars,
      menuGalaxy: isStartMenu,
      onHover: null,
      onClick: null,
      onDoubleClick: null,
      transitionMs: 0,
    });

    if (runtime.renderer && typeof runtime.renderer.init === 'function') {
      await runtime.renderer.init();
    }
    
    // Re-resize canvas after renderer init to ensure proper dimensions
    resizeCanvas();
    
    if (runtime.renderer && runtime.renderer.backendType) {
      window.__GQ_ACTIVE_RENDERER_BACKEND = runtime.renderer.backendType;
    }

    canvas.style.opacity = '1';
    canvas.style.visibility = 'visible';
    canvas.style.display = 'block';

    if (typeof runtime.renderer.setTransitionsEnabled === 'function') runtime.renderer.setTransitionsEnabled(false);
    if (typeof runtime.renderer.setClusterBoundsVisible === 'function') runtime.renderer.setClusterBoundsVisible(false);
    if (typeof runtime.renderer.setGalacticCoreFxEnabled === 'function') runtime.renderer.setGalacticCoreFxEnabled(false);
    if (typeof runtime.renderer.setStars === 'function') runtime.renderer.setStars(runtime.stars, { preserveView: false });
    if (typeof runtime.renderer.setEmpireHeartbeatSystems === 'function') {
      runtime.renderer.setEmpireHeartbeatSystems(runtime.occupiedSystems || []);
    }
    if (typeof runtime.renderer.fitCameraToStars === 'function') runtime.renderer.fitCameraToStars(false, true);

    if (!isStartMenu) {
      ensureSpeedOverlayCanvas();
      startSpeedOverlayLoop();
      ensureHud();
    }
    runtime.flight = {
      target: null,
      t: 0,
      duration: 8,
      start: null,
      c1: null,
      c2: null,
      end: null,
      prevTs: performance.now(),
      prevPos: null,
      lastSpeed: 0,
    };
    runtime.destroy = destroy;
    runtime.cameraDriver = isStartMenu ? null : createCameraDriver();
    if (!isStartMenu) alignRendererToGalaxyCenter();
    if (!isStartMenu && typeof runtime.renderer.setCameraDriver === 'function') {
      runtime.renderer.setCameraDriver(runtime.cameraDriver, {
        consumeAutoNav: true,
        updateControls: true,
      });
    }
    runtime.animationEngine = {
      isActive: () => !!runtime.renderer,
      setNavigationTarget: (target) => controlApi.setNavigationTarget(target),
    };
    if (runtime.registrationPreview) controlApi.setRegistrationPreview(runtime.registrationPreview);

    if (runtime.pendingTarget) {
      applyNavigationTarget(runtime.pendingTarget);
      runtime.pendingTarget = null;
    } else if (!isStartMenu) {
      restartCruiseFromFreshCenter();
    }

    const starsBySystem = new Map();
    const occupiedSystems = new Set();
    const authStarsAbortController = new AbortController();
    runtime.authStarsAbortController = authStarsAbortController;
    loadAuthGalaxySamples({
      signal: authStarsAbortController.signal,
      onSample: ({ stars, occupiedSystems: sampleOccupiedSystems }) => {
        if (runtime.releaseRequested || runtime.released || !runtime.renderer || !stars.length) return;
        const isFirstSample = starsBySystem.size === 0;

        for (const star of stars) {
          const systemIndex = Number(star.system_index || star.id);
          if (!Number.isFinite(systemIndex) || systemIndex < 1) continue;
          const galaxyIndex = Number(star.galaxy_index || 1);
          starsBySystem.set(`${galaxyIndex}:${systemIndex}`, star);
        }
        if (!starsBySystem.size) {
          throw new Error('Auth galaxy sample contains no usable star systems');
        }
        for (const systemIndex of sampleOccupiedSystems) {
          const value = Number(systemIndex);
          if (Number.isFinite(value) && value > 0) occupiedSystems.add(value);
        }

        runtime.stars = Array.from(starsBySystem.values());
        runtime.starSource = 'database';
        const sourceLabel = document.getElementById('start-galaxy-source');
        if (sourceLabel && !runtime.registrationPreview) sourceLabel.textContent = `Database galaxy sample: ${runtime.stars.length.toLocaleString()} star systems. Loading points replaced.`;
        runtime.occupiedSystems = Array.from(occupiedSystems);
        runtime.navBounds = null;
        if (!runtime.registrationPreview) runtime.renderer.setStars?.(runtime.stars, { preserveView: true });
        runtime.renderer.setEmpireHeartbeatSystems?.(runtime.occupiedSystems);
        runtime.cameraDriver?.setRandomStars?.(runtime.stars);
        if (isFirstSample && !isStartMenu) {
          const bounds = resolveNavBounds();
          runtime.cameraDriver?.setGalaxyCenter?.({ x: bounds.centerX, y: 0, z: bounds.centerZ });
          restartCruiseFromFreshCenter();
        }
        updateHud();
      },
    }).then(() => {
      if (!authStarsAbortController.signal.aborted && !starsBySystem.size && !runtime.registrationPreview) {
        const sourceLabel = document.getElementById('start-galaxy-source');
        if (sourceLabel) sourceLabel.textContent = 'No database stars returned. Showing procedural loading galaxy - not DB data.';
        starfieldDebug({
          stage: 'auth-galaxy-data-load',
          message: 'No galaxy star systems were returned; continuing with the procedural background',
        }, 'warn');
      }
    }, (error) => {
      if (error?.name !== 'AbortError') {
        const sourceLabel = document.getElementById('start-galaxy-source');
        if (sourceLabel && !runtime.registrationPreview) {
          sourceLabel.textContent = starsBySystem.size
            ? `Database sample: ${runtime.stars.length.toLocaleString()} star systems. Further loading failed.`
            : 'Database loading failed. Showing procedural loading galaxy - not DB data.';
        }
        starfieldDebug({
          stage: 'auth-galaxy-data-load',
          message: String(error?.message || error),
          loadedStars: runtime.stars?.length || 0,
        }, 'warn');
      }
    });
  } catch (error) {
    runtime.error = `Galaxy background unavailable: ${String(error?.message || error)}`;
    const sourceLabel = document.getElementById('start-galaxy-source');
    if (sourceLabel) sourceLabel.textContent = runtime.error;
    starfieldDebug({
      stage: 'auth-galaxy-background-start',
      message: String(error?.message || error),
    }, 'error');
    destroy();
  }
})();
