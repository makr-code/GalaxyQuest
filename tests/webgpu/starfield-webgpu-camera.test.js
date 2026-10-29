import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function loadStarfield() {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'js/rendering/starfield-webgpu.js'),
    'utf8',
  );
  window.eval(source);
  return window.StarfieldWebGPU;
}

describe('StarfieldWebGPU camera driver', () => {
  it('zooms onto the real faction coordinates in the rotated menu and restores the full galaxy', () => {
    const StarfieldWebGPU = loadStarfield();
    const starfield = new StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
    starfield._starScale = 0.01;
    starfield._galaxyRotation = Math.PI / 2;
    starfield._reducedMotion = true;
    starfield.setRegionPreview({ x_ly: 20, y_ly: 10 });
    expect(starfield._viewState.targetPanX).toBeCloseTo(0.1);
    expect(starfield._viewState.targetPanY).toBeCloseTo(-0.2);
    expect(starfield._viewState.zoom).toBe(4.5);
    expect(starfield._regionPreviewTarget).toEqual({ x_ly: 20, y_ly: 10 });
    starfield.setRegionPreview(null);
    expect(starfield._regionPreviewTarget).toBeNull();
    expect(starfield._viewState.targetPanX).toBe(0);
    expect(starfield._viewState.targetPanY).toBe(0);
    expect(starfield._viewState.targetZoom).toBe(1);
    starfield.dispose();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    delete document.body.dataset.startReducedMotion;
    delete window.StarfieldWebGPU;
  });

  it('updates the animated galaxy view from a camera-driver flight pose', () => {
    const canvas = document.createElement('canvas');
    const StarfieldWebGPU = loadStarfield();
    const starfield = new StarfieldWebGPU(canvas);
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setVertexBuffer: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    };
    const encoder = {
      beginRenderPass: vi.fn(() => pass),
      finish: vi.fn(() => ({})),
    };
    starfield._device = {
      queue: { writeBuffer: vi.fn(), submit: vi.fn() },
      createCommandEncoder: vi.fn(() => encoder),
    };
    starfield._context = {
      getCurrentTexture: () => ({ createView: () => ({}) }),
    };
    starfield._pipeline = {};
    starfield._starBuffer = {};
    starfield._starCount = 1;
    starfield._starScale = 0.01;
    starfield._viewUniformBuffer = {};
    starfield._viewBindGroup = {};
    starfield._cameraDriver = {
      update: vi.fn(({ renderer, dt, now }) => {
        expect(renderer).toBe(starfield);
        expect(dt).toBeGreaterThan(0);
        expect(now).toBe(1000);
        return { position: { x: 25, y: -50, z: 12 } };
      }),
    };

    starfield._renderFrame(1000);

    expect(starfield._cameraDriver.update).toHaveBeenCalledOnce();
    expect(starfield.camera.position).toEqual({ x: 25, y: -50, z: 12 });
    expect(starfield._viewState.targetPanX).toBeCloseTo(-0.25);
    expect(starfield._viewState.targetPanY).toBeCloseTo(0.5);
    starfield.dispose();
  });

  it('renders stars as WebGPU-supported instanced quads', async () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
    });
    const context = {
      configure: vi.fn(),
      getCurrentTexture: () => ({ createView: () => ({}) }),
    };
    vi.spyOn(canvas, 'getContext').mockReturnValue(context);
    const buffers = [];
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setVertexBuffer: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    };
    const encoder = {
      beginRenderPass: vi.fn(() => pass),
      finish: vi.fn(() => ({})),
    };
    const pipeline = { getBindGroupLayout: vi.fn(() => ({})) };
    const device = {
      queue: { writeBuffer: vi.fn(), submit: vi.fn() },
      createShaderModule: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => pipeline),
      createBuffer: vi.fn((descriptor) => {
        const buffer = { descriptor, destroy: vi.fn() };
        buffers.push(buffer);
        return buffer;
      }),
      createBindGroup: vi.fn(() => ({})),
      createCommandEncoder: vi.fn(() => encoder),
    };
    const adapter = { requestDevice: vi.fn().mockResolvedValue(device) };
    const nav = Object.create(navigator);
    nav.gpu = {
      requestAdapter: vi.fn().mockResolvedValue(adapter),
      getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
    };
    vi.stubGlobal('navigator', nav);
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, VERTEX: 4 });

    const StarfieldWebGPU = loadStarfield();
    document.body.dataset.startReducedMotion = 'false';
    const starfield = new StarfieldWebGPU(canvas, {
      stars: [
        { x_ly: 20, y_ly: -10, display_color: [1, 0.8, 0.6], display_size: 5, display_opacity: 0.3 },
        { x_ly: -20, y_ly: 10 },
      ],
      menuGalaxy: true,
    });
    await starfield._initWebGPU();
    starfield._backend = 'webgpu';
    starfield._renderFrame(1000);

    const descriptor = device.createRenderPipeline.mock.calls[0][0];
    expect(descriptor.primitive.topology).toBe('triangle-strip');
    expect(descriptor.vertex.buffers[0].stepMode).toBe('instance');
    expect(descriptor.vertex.buffers[0].arrayStride).toBe(28);
    expect(descriptor.vertex.buffers[0].attributes).toEqual([
      { shaderLocation: 0, offset: 0, format: 'float32x2' },
      { shaderLocation: 1, offset: 8, format: 'float32x4' },
      { shaderLocation: 2, offset: 24, format: 'float32' },
    ]);
    expect(descriptor.fragment.targets[0].blend.color.dstFactor).toBe('one');
    const instances = new Float32Array(device.queue.writeBuffer.mock.calls[0][2]);
    expect(Array.from(instances.slice(0, 7))).toEqual([
      1, -0.5, 1, expect.closeTo(0.8), expect.closeTo(0.6), expect.closeTo(0.3), 5,
    ]);
    expect(starfield._starCount).toBe(2);
    expect(pass.draw).toHaveBeenCalledWith(4, 2, 0, 0);
    expect(buffers[0].descriptor.size).toBe(32);
    expect(device.queue.submit).toHaveBeenCalledOnce();
    const rotation = starfield._galaxyRotation;
    expect(rotation).toBeLessThan(0);
    expect(encoder.beginRenderPass.mock.calls[0][0].colorAttachments[0].clearValue).toEqual({
      r: 0, g: 0, b: 0, a: 1,
    });
    const view = new Float32Array(device.queue.writeBuffer.mock.calls.at(-1)[2]);
    expect(view[3]).toBeCloseTo(rotation);
    expect(view[6]).toBeCloseTo(canvas.width / canvas.height);
    expect(view[7]).toBe(1);
    starfield.setStars([{ x_ly: 10, y_ly: 5 }], { preserveScale: true });
    expect(starfield._starScale).toBe(0.05);
    const regionalInstances = new Float32Array(device.queue.writeBuffer.mock.calls.at(-1)[2]);
    expect(regionalInstances[0]).toBeCloseTo(0.5);
    starfield.setStars([{ x_ly: 20, y_ly: 10 }, { x_ly: -20, y_ly: -10 }]);
    expect(starfield._starScale).toBe(0.05);

    window.dispatchEvent(new CustomEvent('gq:start-motion', { detail: { reduced: true } }));
    starfield._renderFrame(1032);
    expect(starfield._galaxyRotation).toBe(rotation);
    window.dispatchEvent(new CustomEvent('gq:start-motion', { detail: { reduced: false } }));
    starfield._renderFrame(1064);
    expect(starfield._galaxyRotation).toBeLessThan(rotation);

    const flight = {
      stage: 'surface',
      draft: {
        position: { galaxy: 1, system: 23, position: 2 },
        star: { temperature_k: 6000, radius_solar: 1.2 },
        planets: [
          { position: 1, semi_major_axis_au: 0.6, diameter_km: 8000, class: 'rocky' },
          { position: 2, semi_major_axis_au: 1.5, diameter_km: 12500, class: 'ocean' },
        ],
      },
    };
    expect(starfield.setRegistrationScene({ stage: 'invalid' })).toBe(false);
    expect(starfield.setRegistrationScene({ stage: 'surface', draft: { planets: [{ position: 1 }] } })).toBe(false);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    expect(starfield.setRegistrationScene(flight)).toBe(true);
    starfield._renderFrame(1112);
    expect(starfield._sceneStage).toBeGreaterThan(0);
    expect(starfield._sceneStage).toBeLessThan(0.03);
    const scenePipeline = device.createRenderPipeline.mock.calls[1][0];
    expect(scenePipeline.primitive.topology).toBe('triangle-list');
    expect(buffers.find((buffer) => buffer === starfield._sceneBuffer).descriptor.size).toBe(304);
    const sceneUniform = device.queue.writeBuffer.mock.calls.at(-1)[2];
    expect(sceneUniform).toBeInstanceOf(Float32Array);
    expect(sceneUniform).toHaveLength(76);
    expect(sceneUniform[4]).toBe(2);
    expect(sceneUniform[8]).toBeCloseTo(0.16);
    expect(sceneUniform[15]).toBe(0);
    expect(sceneUniform[19]).toBe(1);
    expect(pass.draw).toHaveBeenLastCalledWith(3);
    let time = 1112;
    for (let frame = 0; frame < 120; frame++) {
      time += 48;
      starfield._renderFrame(time);
    }
    expect(starfield._sceneStage).toBe(3);
    expect(starfield.setRegistrationScene(null)).toBe(true);
    time += 48;
    starfield._renderFrame(time);
    expect(starfield._sceneStage).toBeLessThan(3);
    expect(starfield._sceneStage).toBeGreaterThan(2.97);
    expect(device.queue.writeBuffer.mock.calls.at(-1)[2][19]).toBe(1);
    window.dispatchEvent(new CustomEvent('gq:start-motion', { detail: { reduced: true } }));
    starfield._renderFrame(time + 48);
    expect(starfield._sceneStage).toBe(0);
    starfield.setRegistrationScene(flight);
    expect(starfield._sceneStage).toBe(3);
    expect(starfield._viewState.zoom).toBe(6);
    starfield.setRegionPreview(null);
    starfield.setRegistrationScene(null);
    expect(starfield._viewState.zoom).toBe(1);
    expect(starfield._viewState.panX).toBe(0);
    expect(raf).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent('gq:start-motion', { detail: { reduced: false } }));
    const sceneBuffer = starfield._sceneBuffer;
    starfield.dispose();
    expect(sceneBuffer.destroy).toHaveBeenCalledOnce();
    window.dispatchEvent(new CustomEvent('gq:start-motion', { detail: { reduced: true } }));
    expect(starfield._reducedMotion).toBe(false);

    const regular = new StarfieldWebGPU(canvas, {
      stars: [{ x_ly: 20, y_ly: -10, display_size: 7, display_opacity: 0.1, display_color: [1, 0, 0] }],
    });
    await regular._initWebGPU();
    const regularPipeline = device.createRenderPipeline.mock.calls.at(-1)[0];
    expect(regularPipeline.fragment.targets[0].blend.color.dstFactor).toBe('one-minus-src-alpha');
    const regularInstance = new Float32Array(device.queue.writeBuffer.mock.calls.at(-1)[2]);
    expect(Array.from(regularInstance.slice(2))).toEqual([
      expect.closeTo(0.82), expect.closeTo(0.9), 1, 1, 1.5,
    ]);
    regular._renderFrame(1096);
    expect(regular._galaxyRotation).toBe(0);
    regular.dispose();
  });

  it('honors an explicit saved animation choice even if the system prefers reduced motion', () => {
    document.body.dataset.startReducedMotion = 'false';
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const StarfieldWebGPU = loadStarfield();
    const starfield = new StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
    expect(starfield._reducedMotion).toBe(false);
    starfield.dispose();
  });

  it('does not report a working legacy backend for a menu without WebGPU', async () => {
    vi.stubGlobal('__GQ_WEBGPU_ADAPTER_AVAILABLE', { value: false });
    const StarfieldWebGPU = loadStarfield();
    const starfield = new StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
    await expect(starfield.init()).rejects.toThrow('WebGPU is unavailable');
    expect(starfield.ready).toBe(false);
    expect(starfield.backendType).toBeNull();
    starfield.dispose();
  });
});
