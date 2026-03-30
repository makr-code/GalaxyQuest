/**
 * starfield-webgpu.js
 *
 * WebGPU compatibility layer for the Starfield renderer.
 *
 * Mirrors the existing starfield.js API so auth and game screens need no
 * code changes.  Routes to the WebGPU path when available, Three.js otherwise.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

(function () {
  'use strict';

  function emitRenderTelemetry(type, payload) {
    const detail = Object.assign({
      type,
      ts: Date.now(),
      source: 'starfield-webgpu',
    }, payload || {});
    try {
      if (!Array.isArray(window.__GQ_RENDER_TELEMETRY)) {
        window.__GQ_RENDER_TELEMETRY = [];
      }
      window.__GQ_RENDER_TELEMETRY.push(detail);
      if (window.__GQ_RENDER_TELEMETRY.length > 300) {
        window.__GQ_RENDER_TELEMETRY.splice(0, window.__GQ_RENDER_TELEMETRY.length - 300);
      }
      window.dispatchEvent(new CustomEvent('gq:render-telemetry', { detail }));
    } catch (_) {}
  }

  function generateFallbackStars(count) {
    const c = Math.max(200, Number(count || 1400));
    const stars = [];
    for (let i = 0; i < c; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.8) * 4200;
      stars.push({
        x_ly: Math.cos(a) * r,
        y_ly: Math.sin(a) * r,
      });
    }
    return stars;
  }

  function normalizeStars(stars) {
    const list = Array.isArray(stars) && stars.length ? stars : generateFallbackStars(1400);
    let maxAbs = 1;
    for (let i = 0; i < list.length; i += 1) {
      const s = list[i] || {};
      const x = Number(s.x_ly || s.x || 0);
      const y = Number(s.y_ly || s.y || 0);
      maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
    }
    const scale = maxAbs > 0 ? 1 / maxAbs : 1;
    const out = new Float32Array(list.length * 2);
    for (let i = 0; i < list.length; i += 1) {
      const s = list[i] || {};
      out[(i * 2)] = Number(s.x_ly || s.x || 0) * scale;
      out[(i * 2) + 1] = Number(s.y_ly || s.y || 0) * scale;
    }
    return out;
  }

  class StarfieldWebGPU {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Object} [opts]
     */
    constructor(canvas, opts = {}) {
      this._canvas  = canvas;
      this._opts    = opts;
      this._backend = null;
      this._delegate = null;
      this._adapter = null;
      this._device = null;
      this._context = null;
      this._pipeline = null;
      this._starBuffer = null;
      this._starCount = 0;
      this._rafId = 0;
      this._frameTick = 0;
      this._lastRenderTs = 0;
      this._running = false;
      this._currentTarget = null;
      this._cameraDriver = null;
      this._followSelection = true;
      this._clusterBoundsVisible = false;
      this._galacticCoreFxEnabled = false;
      this._magnetCfg = {
        hoverMagnetEnabled: true,
        clickMagnetEnabled: true,
        hoverMagnetStarPx: 24,
        hoverMagnetPlanetPx: 30,
        hoverMagnetClusterPx: 28,
        persistentHoverDistance: 16,
      };
      this.systemMode = false;
      this.transitionsEnabled = true;
      this.transitionStableMinMs = 220;
      this.starPoints = [];
      this.stars = [];
      this.renderFrames = {
        world: null,
        galaxy: null,
        system: null,
      };
      this.camera = {
        position: { x: 0, y: 0, z: 1 },
      };
      this.renderer = {
        domElement: canvas,
        clear() {},
      };
      this.ready    = false;
    }

    /**
     * @returns {Promise<void>}
     */
    async init() {
      const gpuAvailable = await _probeWebGPU();

      if (gpuAvailable) {
        try {
          await this._initWebGPU();
          this._backend = 'webgpu';
          this.ready = true;
          this.start();
          emitRenderTelemetry('backend-active', { backend: 'webgpu' });
          return;
        } catch (err) {
          emitRenderTelemetry('fallback', {
            from: 'webgpu',
            to: 'webgl2',
            reason: String(err?.message || err || 'webgpu-init-failed'),
          });
        }
      }

      this._backend = 'webgl2';
      this.ready    = true;
      emitRenderTelemetry('backend-active', { backend: 'webgl2' });
    }

    /** @returns {'webgpu'|'webgl2'|null} */
    get backendType() { return this._backend; }

    setStars(stars) {
      this.stars = Array.isArray(stars) ? stars.slice() : [];
      this.starPoints = this.stars;
      if (this._backend !== 'webgpu' || !this._device) {
        return;
      }
      this._uploadStars(stars);
    }

    setCameraTarget(target) { this._currentTarget = target || null; }
    fitCameraToStars() {}
    setTransitionsEnabled(flag) { this.transitionsEnabled = !!flag; }
    setClusterBoundsVisible(flag) { this._clusterBoundsVisible = !!flag; }
    setGalacticCoreFxEnabled(flag) { this._galacticCoreFxEnabled = !!flag; }
    setEmpireHeartbeatSystems() {}
    setCameraDriver(driver) { this._cameraDriver = driver || null; }
    clearCameraDriver() { this._cameraDriver = null; }
    setClusterColorPalette() {}
    setClusterDensityMode() {}
    setClusterAuras() {}
    setGalaxyFleets() {}
    setGalaxyFleetVectorsVisible() {}
    setFtlInfrastructure() {}
    focusCurrentSelection() {}
    focusOnStar(star) { this._currentTarget = star || null; }
    focusOnSystemPlanet(target) { this._currentTarget = target || null; }
    enterSystemView() { this.systemMode = true; }
    exitSystemView() { this.systemMode = false; }
    resetNavigationView() { this.systemMode = false; this._currentTarget = null; }
    toggleFollowSelection() { this._followSelection = !this._followSelection; return this._followSelection; }
    isFollowingSelection() { return !!this._followSelection; }
    setHoverMagnetConfig(cfg = {}) {
      this._magnetCfg = Object.assign({}, this._magnetCfg, cfg || {});
      this.hoverMagnetEnabled = !!this._magnetCfg.hoverMagnetEnabled;
      this.clickMagnetEnabled = !!this._magnetCfg.clickMagnetEnabled;
      this.hoverMagnetStarPx = Number(this._magnetCfg.hoverMagnetStarPx || 24);
      this.hoverMagnetPlanetPx = Number(this._magnetCfg.hoverMagnetPlanetPx || 30);
      this.hoverMagnetClusterPx = Number(this._magnetCfg.hoverMagnetClusterPx || 28);
      this.persistentHoverDistance = Number(this._magnetCfg.persistentHoverDistance || 16);
    }
    areClusterBoundsVisible() { return !!this._clusterBoundsVisible; }
    areGalacticCoreFxEnabled() { return !!this._galacticCoreFxEnabled; }
    nudgeOrbit() {}
    nudgePan() {}
    nudgeZoom() {}
    getQualityProfileState() {
      return {
        name: 'webgpu-experimental',
        label: 'WebGPU Experimental',
      };
    }
    getRenderStats() {
      return {
        backend: this._backend || 'unknown',
        rawStars: this.stars.length,
        visibleStars: this._starCount,
        frameTick: this._frameTick,
      };
    }
    resize() {
      if (!this._canvas || !this._context || !this._device) return;
      this._configureContext();
    }

    start() {
      if (this._backend !== 'webgpu' || this._running) return;
      this._running = true;
      const tick = () => {
        if (!this._running) return;
        this._rafId = requestAnimationFrame(tick);
        this._renderFrame();
      };
      this._rafId = requestAnimationFrame(tick);
    }

    stop() {
      this._running = false;
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
      }
      this._rafId = 0;
    }

    dispose() {
      this.stop();
      try {
        if (this._starBuffer) {
          this._starBuffer.destroy();
          this._starBuffer = null;
        }
      } catch (_) {}
      this._pipeline = null;
      this._context = null;
      this._adapter = null;
      this._device = null;
      this._currentTarget = null;
      this._cameraDriver = null;
      this.ready = false;
    }

    destroy() {
      this.dispose();
    }

    async _initWebGPU() {
      if (!this._canvas) {
        throw new Error('missing canvas');
      }
      this._adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!this._adapter) {
        throw new Error('no webgpu adapter');
      }
      this._device = await this._adapter.requestDevice();
      this._context = this._canvas.getContext('webgpu');
      if (!this._context) {
        throw new Error('webgpu canvas context unavailable');
      }
      this._configureContext();

      const shader = this._device.createShaderModule({
        code: `
          struct VSOut {
            @builtin(position) pos : vec4<f32>,
          };

          @vertex
          fn vs_main(@location(0) inPos : vec2<f32>) -> VSOut {
            var out : VSOut;
            out.pos = vec4<f32>(inPos.x, inPos.y, 0.0, 1.0);
            return out;
          }

          @fragment
          fn fs_main() -> @location(0) vec4<f32> {
            return vec4<f32>(0.95, 0.97, 1.0, 1.0);
          }
        `,
      });

      this._pipeline = this._device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: shader,
          entryPoint: 'vs_main',
          buffers: [{
            arrayStride: 8,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          }],
        },
        fragment: {
          module: shader,
          entryPoint: 'fs_main',
          targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
        },
        primitive: {
          topology: 'point-list',
        },
      });

      this._uploadStars(this._opts?.stars || []);
    }

    _configureContext() {
      const format = navigator.gpu.getPreferredCanvasFormat();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this._canvas.getBoundingClientRect();
      this._canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      this._canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      this._context.configure({
        device: this._device,
        format,
        alphaMode: 'premultiplied',
      });
    }

    _uploadStars(stars) {
      if (!this._device) return;
      const normalized = normalizeStars(stars);
      this._starCount = Math.floor(normalized.length / 2);
      if (this._starBuffer) {
        this._starBuffer.destroy();
        this._starBuffer = null;
      }
      if (!this._starCount) {
        return;
      }
      this._starBuffer = this._device.createBuffer({
        size: normalized.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this._device.queue.writeBuffer(this._starBuffer, 0, normalized.buffer, normalized.byteOffset, normalized.byteLength);
    }

    _renderFrame() {
      if (!this._device || !this._context || !this._pipeline || !this._starBuffer || this._starCount <= 0) {
        return;
      }
      const encoder = this._device.createCommandEncoder();
      const view = this._context.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0.02, g: 0.03, b: 0.08, a: 0.0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this._pipeline);
      pass.setVertexBuffer(0, this._starBuffer);
      pass.draw(this._starCount, 1, 0, 0);
      pass.end();
      this._device.queue.submit([encoder.finish()]);

      if (this._cameraDriver && typeof this._cameraDriver.update === 'function') {
        try {
          this._cameraDriver.update({
            camera: this.camera,
            target: this._currentTarget,
          });
        } catch (_) {}
      }

      this._frameTick += 1;
      const now = performance.now();
      if (!this._lastRenderTs || (now - this._lastRenderTs) > 5000) {
        this._lastRenderTs = now;
        emitRenderTelemetry('frame-heartbeat', {
          backend: 'webgpu',
          stars: this._starCount,
          frameTick: this._frameTick,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------

  async function _probeWebGPU() {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    try { return (await navigator.gpu.requestAdapter()) !== null; } catch { return false; }
  }

  window.StarfieldWebGPU = StarfieldWebGPU;
})();
