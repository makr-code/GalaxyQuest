import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PerspectiveSpaceFlight } from '../../js/rendering/perspective-space-flight.js';
import { generateGalaxyNebulae } from '../../js/rendering/loading-galaxy.js';
import { GalaxyNebulaField } from '../../js/rendering/galaxy-nebula-field.js';
import { createSpatialStarIndex, formatSpatialObjectDetails, querySpatialStarIndex, resolveSpatialLabels } from '../../js/rendering/spatial-label-layout.js';
import { SpatialLabelRenderer } from '../../js/rendering/spatial-label-renderer.js';

function loadStarfield() {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'js/rendering/starfield-webgpu.js'),
    'utf8',
  );
  window.eval(source);
  return window.StarfieldWebGPU;
}

describe('StarfieldWebGPU camera driver', () => {
  it('caps per-frame flight stars and preserves streamed catalog targets', () => {
    const StarfieldWebGPU = loadStarfield();
    const renderer = new StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
    const visualStars = Array.from({ length: 12000 }, (_, index) => ({
      visual_only: true, galaxy_index: 1, system_index: index + 1, x_ly: index, y_ly: 0, z_ly: 0,
    }));
    const catalogStars = Array.from({ length: 5000 }, (_, index) => ({
      galaxy_index: 1, system_index: 20000 + index, x_ly: index, y_ly: 1, z_ly: 0,
    }));
    const target = catalogStars[2377];
    renderer._currentTarget = target;
    expect(renderer._prepareFlightStars([...visualStars, ...catalogStars])).toBeLessThanOrEqual(6000);
    expect(renderer._flightStars.filter((star) => star.visual_only).length).toBe(4500);
    expect(renderer._flightStars.filter((star) => !star.visual_only).length).toBe(1500);
    expect(renderer._flightStars).toContain(target);
    renderer.dispose();
  });
  it('queries a bounded nearest-system set from the prebuilt spatial index', () => {
    const stars = Array.from({ length: 120000 }, (_, index) => ({
      galaxy_index: 1,
      system_index: index + 1,
      x_ly: index,
      y_ly: (index % 97) * 3,
      z_ly: (index % 31) * -7,
    }));
    const index = createSpatialStarIndex(stars);
    const center = { x: 60000.2, y: 120, z: -140 };
    const nearest = querySpatialStarIndex(index, center, 48);
    const expectedNearest = stars.slice().sort((left, right) => {
      const leftDistance = (left.x_ly - center.x) ** 2 + (left.y_ly - center.y) ** 2 + (left.z_ly - center.z) ** 2;
      const rightDistance = (right.x_ly - center.x) ** 2 + (right.y_ly - center.y) ** 2 + (right.z_ly - center.z) ** 2;
      return leftDistance - rightDistance;
    })[0];
    expect(index.size).toBe(120000);
    expect(nearest).toHaveLength(48);
    expect(nearest[0].system_index).toBe(expectedNearest.system_index);
    expect(new Set(nearest.map((star) => star.system_index)).size).toBe(48);
    expect(querySpatialStarIndex(index, center, 4000)).toHaveLength(4000);
  });
  it('formats concise property lines for celestial and artificial objects', () => {
    expect(formatSpatialObjectDetails({ spectral_class: 'G', subtype: 2,
      temperature_k: 5778, mass_solar: 1 }, 'star')).toContain('G2 | 5,778 K | 1 M_sun');
    expect(formatSpatialObjectDetails({ planet_class: 'gas_giant', diameter_km: 88000,
      semi_major_axis_au: 5.2 }, 'planet')).toBe('Gas giant | 88,000 km | 5.2 AU');
    expect(formatSpatialObjectDetails({ planet_class: 'ice_dwarf', diameter_km: 2200,
      semi_major_axis_parent_r: 8 }, 'moon')).toBe('Ice dwarf moon | 2,200 km | 8 Rp');
    expect(formatSpatialObjectDetails({ diameter_km: 12, orbital_eccentricity: 0.86 }, 'comet'))
      .toBe('Comet | 12 km | e 0.86');
    expect(formatSpatialObjectDetails({ type: 'stargate', level: 2 }, 'star-installation'))
      .toBe('Stargate | Level 2');
    expect(formatSpatialObjectDetails({ type: 'starbase', level: 4 }, 'star-installation'))
      .toBe('Starbase | Level 4');
    expect(formatSpatialObjectDetails({ type: 'shipyard', level: 3 }, 'facility'))
      .toBe('Orbital shipyard | Level 3');
    expect(formatSpatialObjectDetails({ type: 'hydroponic_farm', level: 2 }, 'facility'))
      .toBe('Orbital farm | Level 2');
  });
  it('selects a few projected system labels without overlap at galactic scale', () => {
    const flight = new PerspectiveSpaceFlight({ radius: 100 });
    const direction = flight.camera.getWorldDirection(new (flight.camera.position.constructor)());
    const center = flight.camera.position.clone().addScaledVector(direction, 80);
    const stars = Array.from({ length: 20 }, (_, index) => ({
      galaxy_index: 1,
      system_index: index + 1,
      name: `System ${index + 1}`,
      spectral_class: 'G',
      subtype: 2,
      temperature_k: 5778,
      mass_solar: 1,
      x_ly: center.x + (index % 2) * 0.05,
      y_ly: center.y,
      z_ly: center.z,
    }));
    const layout = resolveSpatialLabels(flight, stars, { width: 1280, height: 720 });
    expect(layout.level).toBe('galaxy');
    expect(layout.labels.length).toBeLessThanOrEqual(5);
    expect(layout.labels.length).toBeGreaterThan(0);
    expect(layout.labels[0].detail).toContain('G2');
    expect(layout.labels[0].detail).toContain('5,778 K');
    expect(layout.labels[0].detail).toContain('M_sun');
    for (let first = 0; first < layout.labels.length; first++) {
      for (let second = first + 1; second < layout.labels.length; second++) {
        const left = layout.labels[first];
        const right = layout.labels[second];
        expect(Math.abs(left.x - right.x)).toBeGreaterThanOrEqual((left.width + right.width) / 2);
      }
    }
    flight.dispose();
  });

  it('switches from system names to planet names as the camera scale closes in', () => {
    const flight = new PerspectiveSpaceFlight({ radius: 50000 });
    const scene = { sceneGraph: { type: 'galaxy', children: [{ type: 'system',
      data: { x_ly: 0, y_ly: 0, z_ly: 0, name: 'Solis', radius_solar: 1,
        spectral_class: 'G', subtype: 2, temperature_k: 5778, mass_solar: 1 },
      children: [{ type: 'planet', data: { position: 1, name: 'Neris', planet_class: 'gas_giant',
        semi_major_axis_au: 1, diameter_km: 12000 },
        children: [{ type: 'moon', data: { position: 1, name: 'Iona', planet_class: 'ice_dwarf',
          diameter_km: 2200, semi_major_axis_parent_r: 5 } }] }],
    }] } };
    expect(flight.setSystem(scene)).toBe(true);
    const planet = flight.bodies.find((body) => body.userData.type === 'planet');
    const systemDistance = planet.position.length() * 3;
    flight.camera.position.set(0, -systemDistance, systemDistance * 0.35);
    flight.camera.lookAt(0, 0, 0);
    let layout = resolveSpatialLabels(flight, [], { width: 1280, height: 720 });
    expect(layout.level).toBe('system');
    expect(layout.labels.map((label) => label.text)).toContain('Solis');
    expect(layout.labels.find((label) => label.text === 'Solis').detail).toContain('5,778 K');

    const planetCenter = planet.getWorldPosition(new (flight.camera.position.constructor)());
    flight.camera.position.copy(planetCenter).add({ x: 0, y: -planet.userData.radius * 5, z: planet.userData.radius * 2 });
    flight.camera.lookAt(planetCenter);
    layout = resolveSpatialLabels(flight, [], { width: 1280, height: 720 });
    expect(layout.level).toBe('planet');
    expect(layout.labels.map((label) => label.text)).toContain('Neris');
    expect(layout.labels.find((label) => label.text === 'Neris').detail).toContain('Gas giant');
    expect(layout.labels.find((label) => label.text === 'Neris').detail).toContain('AU');
    expect(layout.labels.find((label) => label.text === 'Iona').detail).toContain('Ice dwarf moon');
    flight.dispose();
  });

  it('keeps badge typography at least 14 CSS pixels across canvas pixel ratios', () => {
    const flight = new PerspectiveSpaceFlight({ radius: 100 });
    const direction = flight.camera.getWorldDirection(new (flight.camera.position.constructor)());
    const center = flight.camera.position.clone().addScaledVector(direction, 80);
    const stars = [{ galaxy_index: 1, system_index: 42, name: 'Solis',
      x_ly: center.x, y_ly: center.y, z_ly: center.z }];
    const standard = resolveSpatialLabels(flight, stars, { width: 1280, height: 720, pixelRatio: 1 }).labels[0];
    const highDpi = resolveSpatialLabels(flight, stars, { width: 2560, height: 1440, pixelRatio: 2 }).labels[0];
    expect(standard.fontSize).toBeGreaterThanOrEqual(18);
    expect(highDpi.fontSize).toBeGreaterThanOrEqual(36);
    expect(highDpi.fontSize / 2).toBeGreaterThanOrEqual(18);
    flight.dispose();
  });

  it('renders spatial names as cached GPU billboard instances', async () => {
    vi.stubGlobal('GPUBufferUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, VERTEX: 4 });
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
    const context = {
      clearRect: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
      measureText: vi.fn((text) => ({ width: text.length * 8 })), fillText: vi.fn(),
    };
    const labelRenderer = new SpatialLabelRenderer({ canvasFactory: () => ({
      width: 0, height: 0, getContext: () => context,
    }) });
    const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
    const instanceBuffer = { destroy: vi.fn() };
    const device = {
      createShaderModule: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
      createSampler: vi.fn(() => ({})),
      createTexture: vi.fn((descriptor) => { texture.descriptor = descriptor; return texture; }),
      createBindGroup: vi.fn(() => ({})),
      createBuffer: vi.fn(() => instanceBuffer),
      queue: { copyExternalImageToTexture: vi.fn(), writeBuffer: vi.fn() },
    };
    await labelRenderer.initialize(device, 'bgra8unorm');
    expect(texture.descriptor.usage).toBe(7);
    const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), draw: vi.fn() };
    const labels = [{ id: 'planet:1', kind: 'planet', text: 'Neris', x: 320, y: 180,
      width: 84, height: 28, fontSize: 14, worldPosition: [1, 2, 3] }];
    labelRenderer.render(pass, device, labels, { width: 640, height: 360 });
    expect(pass.draw).toHaveBeenCalledWith(6, 1, 0, 0);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledOnce();
    expect(device.queue.writeBuffer.mock.calls[0][2]).toEqual(new Float32Array([
      0, 0, 0.2625, 56 / 360, 0, 0, 0.25, 0.25,
    ]));
    labelRenderer.render(pass, device, labels.map((label) => ({ ...label })), { width: 640, height: 360 });
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledOnce();
    expect(device.queue.writeBuffer).toHaveBeenCalledTimes(2);
    expect(pass.draw).toHaveBeenCalledTimes(2);
    labelRenderer.dispose();
    expect(instanceBuffer.destroy).toHaveBeenCalledOnce();
    expect(texture.destroy).toHaveBeenCalledOnce();
  });
  it('projects solar flare sources and suppresses them for eclipses, rear bodies and offscreen suns', () => {
    const flight = new PerspectiveSpaceFlight({ radius: 100 });
    flight.setSystem({ sceneGraph: { type: 'galaxy', children: [{ type: 'system',
      data: { x_ly: 0, y_ly: 0, z_ly: 0, radius_solar: 1, spectral_class: 'G' },
      children: [{ type: 'planet', data: { position: 1, semi_major_axis_au: 1, diameter_km: 12000 }, children: [] }],
    }] } });
    const star = flight.bodies[0];
    const planet = flight.bodies[1];
    star.userData.radius = 1;
    planet.userData.radius = 0.8;
    flight.camera.position.set(0, -10, 0);
    flight.camera.lookAt(0, 0, 0);
    planet.position.set(4, -5, 0);
    flight.root.updateMatrixWorld(true);
    const unobscured = flight.getLensFlareSources();
    expect(unobscured).toHaveLength(1);
    expect(unobscured[0].x).toBeCloseTo(0);
    expect(unobscured[0].y).toBeCloseTo(0);
    planet.position.set(0, -5, 0);
    flight.root.updateMatrixWorld(true);
    expect(flight.getLensFlareSources()).toEqual([]);
    planet.userData.radius = 0.2;
    const partial = flight.getLensFlareSources();
    expect(partial[0].intensity).toBeGreaterThan(0);
    expect(partial[0].intensity).toBeLessThan(unobscured[0].intensity);
    planet.position.set(0, 5, 0);
    flight.root.updateMatrixWorld(true);
    expect(flight.getLensFlareSources()[0].intensity).toBeCloseTo(unobscured[0].intensity);
    flight.camera.lookAt(-5, 0, 0);
    expect(flight.getLensFlareSources()[0].intensity).toBeGreaterThan(0);
    expect(flight.getLensFlareSources()[0].intensity).toBeLessThan(unobscured[0].intensity);
    flight.camera.lookAt(-10, 0, 0);
    expect(flight.getLensFlareSources()).toEqual([]);
    flight.camera.lookAt(0, -20, 0);
    expect(flight.getLensFlareSources()).toEqual([]);
    flight.dispose();
  });
  it('renders bounded nebula volumes and preserves their projection across camera rebasing', async () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const field = new GalaxyNebulaField({ radiusLy: 50000 });
    const device = { createShaderModule: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })), createBindGroup: vi.fn(() => ({})),
      queue: { writeBuffer: vi.fn() } };
    const source = fs.readFileSync(path.resolve(process.cwd(), 'js/engine/fx/shaders/nebula.wgsl'), 'utf8');
    await field.init(device, 'bgra8unorm', source);
    const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn() };
    const projection = field.overviewProjection({ scale: 1 / 50000, zoom: 1,
      rotation: 0, panX: 0, panY: 0, aspect: 16 / 9 });
    field.render(pass, device, projection, { width: 1280, height: 720 });
    expect(field.visibleVolumes).toBeGreaterThan(0);
    expect(pass.draw).toHaveBeenCalledWith(6);
    expect(device.queue.writeBuffer.mock.calls[0][2]).toHaveLength(36);
    expect(device.queue.writeBuffer.mock.calls[0][2][34]).toBe(16);
    field.render(pass, device, projection, { width: 390, height: 844 });
    expect(device.queue.writeBuffer.mock.calls.at(-1)[2][34]).toBe(10);
    const flight = new PerspectiveSpaceFlight({ radius: 50000 });
    const before = field.perspectiveProjection(flight.camera, flight.origin).elements;
    const gpuInverse = new Float32Array(field.perspectiveProjection(flight.camera, flight.origin).invert().elements);
    expect(Math.abs(gpuInverse[11] + gpuInverse[15])).toBeGreaterThan(0.001);
    flight.setSystem({ sceneGraph: { type: 'galaxy', children: [{ type: 'system',
      data: { x_ly: 40000, y_ly: 20, z_ly: -50, radius_solar: 1 }, children: [],
    }] } });
    const after = field.perspectiveProjection(flight.camera, flight.origin).elements;
    before.forEach((value, index) => expect(after[index]).toBeCloseTo(value, 9));
    field.configure({ radiusLy: 50000, armCount: 8 });
    expect(field.volumes).toHaveLength(32);
    field.dispose();
    for (const result of device.createBuffer.mock.results) expect(result.value.destroy).toHaveBeenCalledOnce();
  });
  it('keeps visual nebula volumes deterministic and aligned with the configured galaxy arms', () => {
    const volumes = generateGalaxyNebulae({ radiusLy: 50000, armCount: 6, pitchAngleDeg: 14 });
    expect(volumes).toEqual(generateGalaxyNebulae({ radiusLy: 50000, armCount: 6, pitchAngleDeg: 14 }));
    expect(volumes).toHaveLength(24);
    expect(generateGalaxyNebulae({ armCount: 8 })).toHaveLength(32);
    expect(new Set(volumes.map((volume) => volume.colorInner.join(','))).size).toBe(3);
    for (const volume of volumes) {
      expect(volume.center.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...volume.center)).toBeLessThan(50000);
      expect(volume.radius).toBeGreaterThan(0);
      expect(volume.visual_only).toBe(true);
    }
  });
  it('flies in all three dimensions with bounded quaternion rotation and arrival-based braking', async () => {
    const flight = new PerspectiveSpaceFlight({ radius: 100 });
    const before = flight.camera.position.clone();
    const orientation = flight.camera.quaternion.clone();
    const arrived = flight.navigate({ x_ly: -20, y_ly: 15, z_ly: 30 }, { durationSec: 8 });
    flight.update(0.016);
    expect(flight.camera.quaternion.angleTo(orientation)).toBeLessThanOrEqual(0.8 * 0.016 + 1e-8);
    expect(flight.turnSpeed).toBeLessThanOrEqual(1.2 * 0.016);
    expect(flight.camera.position.distanceTo(before)).toBeGreaterThan(0);
    const speeds = [];
    for (let frame = 0; frame < 3000 && flight.flight; frame++) {
      flight.update(1 / 60);
      speeds.push(flight.telemetry.speed);
    }
    expect(await arrived).toBe(true);
    expect(Math.max(...speeds)).toBeGreaterThan(speeds[0]);
    expect(speeds.at(-1)).toBe(0);
    expect(flight.camera.position.x).toBeCloseTo(-20, 8);
    expect(flight.camera.position.y).toBeCloseTo(15, 8);
    expect(flight.camera.position.z).toBeCloseTo(30, 8);
    expect(flight.camera.quaternion.angleTo(orientation)).toBeGreaterThan(0.01);
  });

  it('cancels a spatial flight without moving or resetting its perspective', async () => {
    const flight = new PerspectiveSpaceFlight({ radius: 100 });
    const controller = new AbortController();
    const arrived = flight.navigate({ x_ly: 0, y_ly: 0, z_ly: 0 }, { signal: controller.signal });
    flight.update(0.02);
    const position = flight.camera.position.clone();
    controller.abort();
    flight.update(0.05);
    expect(await arrived).toBe(false);
    expect(flight.camera.position.equals(position)).toBe(true);
    expect(flight.camera.isPerspectiveCamera).toBe(true);
  });

  it('exports and restores only absolute start and destination coordinates across rebasing', () => {
    const flight = new PerspectiveSpaceFlight({ radius: 100 });
    flight.setSystem({ sceneGraph: { type: 'galaxy', children: [{ type: 'system',
      data: { x_ly: 40000, y_ly: 20, z_ly: -50, radius_solar: 1 }, children: [],
    }] } });
    const absoluteStart = flight.camera.position.clone().add(flight.origin);
    const destination = absoluteStart.clone().add({ x: 12, y: -7, z: 3 });
    flight.navigate({ x_ly: destination.x, y_ly: destination.y, z_ly: destination.z });
    const persisted = flight.getFlightCoordinates();
    expect(Object.keys(persisted).sort()).toEqual(['destination', 'start']);
    expect(persisted.start).toEqual(absoluteStart.toArray());
    expect(persisted.destination).toEqual(destination.toArray());

    const resumed = new PerspectiveSpaceFlight({ radius: 100 });
    expect(resumed.restoreFlightCoordinates(persisted)).toBe(true);
    expect(resumed.camera.position.toArray()).toEqual(persisted.start);
    expect(resumed.camera.isPerspectiveCamera).toBe(true);
    expect(resumed.restoreFlightCoordinates({ start: [1, 2], destination: [3, 4, 5] })).toBe(false);
    flight.dispose();
    resumed.dispose();
  });

  it('keeps physical bodies in one tree while rebasing the camera without a world-space jump', () => {
    const flight = new PerspectiveSpaceFlight({ radius: 50000 });
    const absolute = flight.camera.position.clone().add(flight.origin);
    expect(flight.setSystem({ sceneGraph: { type: 'galaxy', children: [{ type: 'system',
      data: { x_ly: 40000, y_ly: 20, z_ly: -50, radius_solar: 1 },
      children: [{ type: 'planet', data: { position: 1, semi_major_axis_au: 1, diameter_km: 12000 },
        children: [{ type: 'moon', data: { position: 2, diameter_km: 2500, semi_major_axis_parent_r: 6 } }] }],
    }] } })).toBe(true);
    expect(flight.camera.position.clone().add(flight.origin).distanceTo(absolute)).toBeLessThan(1e-9);
    expect(flight.bodies.map((body) => body.userData.type)).toEqual(['star', 'planet', 'moon']);
    expect(flight.bodies[2].parent).toBe(flight.bodies[1]);
    const planet = flight.resolveTarget({ kind: 'planet', position: 1 });
    expect(planet.destination.distanceTo(planet.focus)).toBeCloseTo(flight.bodies[1].userData.radius * 3.2, 15);
  });

  it('projects stars into visible GPU instances using the actual perspective camera', () => {
    vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, COPY_DST: 2, UNIFORM: 4 });
    const nav = Object.create(navigator);
    nav.gpu = { getPreferredCanvasFormat: () => 'bgra8unorm' };
    vi.stubGlobal('navigator', nav);
    const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), draw: vi.fn(), end: vi.fn() };
    const device = { createShaderModule: vi.fn(() => ({})), createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
      createBindGroup: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })), queue: { writeBuffer: vi.fn(), submit: vi.fn() },
      createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }) };
    const context = { getCurrentTexture: () => ({ createView: () => ({}) }) };
    const flight = new PerspectiveSpaceFlight({ radius: 100 });
    flight.renderFrame(device, context, [{ x_ly: 0, y_ly: 0, z_ly: 0, display_opacity: 0.02 }], 1280, 720);
    expect(pass.draw).toHaveBeenCalledWith(4, 1, 0, 0);
    expect(flight.instances[7]).toBeGreaterThan(0.3);
    expect(flight.instances[3] * 720).toBeGreaterThan(2);
    expect(Array.from(flight.instances.slice(0, 20)).every(Number.isFinite)).toBe(true);
    flight.setSystem({ sceneGraph: { type: 'galaxy', children: [{ type: 'system',
      data: { x_ly: 0, y_ly: 0, z_ly: 0, radius_solar: 1, spectral_class: 'M' }, children: [],
    }] } });
    const solarRadius = flight.bodies[0].userData.radius;
    flight.camera.position.set(0, -solarRadius * 5, 0);
    flight.camera.lookAt(0, 0, 0);
    flight.update(0.02);
    flight.renderFrame(device, context, [], 1280, 720);
    expect(pass.draw).toHaveBeenLastCalledWith(4, 2, 0, 0);
    expect(flight.instances[8]).toBe(4);
    expect(flight.instances[28]).toBe(1);
    expect(flight.instances[3] / flight.instances[23]).toBeCloseTo(2.6);
    expect(flight.instances[24]).toBeGreaterThan(flight.instances[26]);
    const nearRadius = flight.instances[23];
    flight.camera.position.multiplyScalar(2);
    flight.renderFrame(device, context, [], 1280, 720);
    expect(flight.instances[23]).toBeLessThan(nearRadius);
    expect(flight.instances[3] / flight.instances[23]).toBeCloseTo(2.6);
    expect(device.queue.writeBuffer.mock.calls.at(-2)[2][12]).toBeCloseTo(0.02);
    flight.setSystem({ sceneGraph: { type: 'galaxy', children: [{ type: 'system',
      data: { x_ly: 0, y_ly: 0, z_ly: 0, radius_solar: 1, spectral_class: 'B' },
      children: [{ type: 'planet', data: { position: 1, planet_class: 'ocean', inhabited: true,
        texture: { seed: 711, variant: 'ocean', palette: { base: '#166a88' }, clouds: 0.73, atmosphere: 0.64 },
        semi_major_axis_au: 1, diameter_km: 12000 }, children: [] }],
    }] } });
    expect(flight.bodies[1].userData.surfaceSeed).toBe(711);
    expect(flight.bodies[1].userData.surfaceProfile).toBe(2);
    expect(flight.bodies[1].userData.atmosphere).toBe(0.64);
    expect(flight.bodies[1].userData.cloudiness).toBe(0.73);
    flight.bodies[1].position.set(0, -solarRadius * 2, 0);
    flight.root.updateMatrixWorld(true);
    flight.renderFrame(device, context, [], 1280, 720);
    expect(pass.draw).toHaveBeenLastCalledWith(4, 4, 0, 0);
    expect([flight.instances[8], flight.instances[28], flight.instances[48], flight.instances[68]]).toEqual([4, 1, 5, 2]);
    expect(flight.instances[26]).toBeGreaterThan(flight.instances[24]);
    expect(flight.instances[54]).toBeGreaterThan(0);
    expect(flight.instances[70]).toBe(2);
    expect(flight.instances[71]).toBe(1);
    expect(flight.instances[74]).toBeCloseTo(0.64);
    expect(flight.instances[75]).toBeCloseTo(0.73);

    flight.setGalaxyLabelStars(Array.from({ length: 120 }, (_, index) => ({
      galaxy_index: 1, system_index: index + 1, name: `Nearby ${index + 1}`,
      x_ly: index * 0.001, y_ly: 0, z_ly: 0,
    })));
    flight.camera.position.set(0, -100, 0);
    flight.camera.lookAt(0, 0, 0);
    flight.renderFrame(device, context, [{ x_ly: 0, y_ly: 0, z_ly: 0 }], 1280, 720);
    const benchmark = flight.getRenderBenchmark();
    expect(benchmark.databaseIndexStars).toBe(120);
    expect(benchmark.inputStars).toBe(1);
    expect(benchmark.queriedLabelStars).toBeLessThanOrEqual(48);
    expect(benchmark.labelsDrawn).toBeLessThanOrEqual(5);
    expect(benchmark.averageStarProjectionMs).toBeGreaterThanOrEqual(0);
    expect(benchmark.averageLabelLayoutMs).toBeGreaterThanOrEqual(0);
    flight.dispose();
  });

  it('releases spatial flight when the separate registration workflow takes ownership', () => {
    const StarfieldWebGPU = loadStarfield();
    const renderer = new StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
    expect(renderer.setFlightScene({ stage: 'region', flightTour: true })).toBe(true);
    expect(renderer.camera.isPerspectiveCamera).toBe(true);
    const rig = renderer._perspectiveFlight;
    const dispose = vi.spyOn(rig, 'dispose');
    expect(renderer.setRegistrationScene({ stage: 'region', stars: [] })).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
    expect(renderer._perspectiveFlight).toBeNull();
    renderer.dispose();
  });
  it('releases spatial flight when registration preview is cleared', () => {
    const StarfieldWebGPU = loadStarfield();
    const renderer = new StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
    renderer.setFlightScene({ stage: 'region', flightTour: true });
    const rig = renderer._perspectiveFlight;
    const dispose = vi.spyOn(rig, 'dispose');
    expect(renderer.setFlightScene(null)).toBe(true);
    expect(renderer.setRegistrationScene(null)).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
    expect(renderer._perspectiveFlight).toBeNull();
    renderer.dispose();
  });
  it('builds a spatial mentor-system scene and navigates to its reserved planet', async () => {
    const StarfieldWebGPU = loadStarfield();
    const renderer = new StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
    const scene = {
      flightTour: true,
      stage: 'planet',
      target: { galaxy_index: 1, system_index: 25, position: 3, x_ly: 400, y_ly: -120, z_ly: 30 },
      sceneGraph: { type: 'galaxy', children: [{ type: 'system',
        data: { galaxy_index: 1, system_index: 25, name: 'Mentor System', x_ly: 400, y_ly: -120, z_ly: 30,
          temperature_k: 5778, radius_solar: 1 },
        children: [{ type: 'planet', data: { position: 3, planet_class: 'rocky', can_colonize: true,
          diameter_km: 12000, semi_major_axis_au: 1.4 }, children: [] }],
      }] },
    };

    expect(renderer.setFlightScene(scene)).toBe(true);
    expect(renderer._perspectiveFlight.camera.isPerspectiveCamera).toBe(true);
    expect(renderer._perspectiveFlight.bodies.some((body) => body.userData.type === 'planet'
      && body.userData.data.position === 3)).toBe(true);
    const arrival = renderer.navigateTo({ kind: 'planet', position: 3 }, { durationMs: 2600 });
    expect(arrival).toBeInstanceOf(Promise);
    expect(renderer.getFlightTelemetry().arrived).toBe(false);
    renderer.setRegistrationScene(null);
    await expect(arrival).resolves.toBe(false);
    renderer.dispose();
  });
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

  it('accelerates, cruises and brakes toward a native WebGPU flight target', () => {
    const StarfieldWebGPU = loadStarfield();
    const starfield = new StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
    starfield._starScale = 0.01;
    starfield._galaxyRotation = 0;
    expect(starfield.flyToStar({ x_ly: 80, y_ly: 0 }, 6000)).toBe(true);
    expect(starfield.getFlightTelemetry().phase).toBe('acquire');

    const pass = { setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, draw() {}, end() {} };
    starfield._device = {
      queue: { writeBuffer() {}, submit() {} },
      createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }),
    };
    starfield._context = { getCurrentTexture: () => ({ createView: () => ({}) }) };
    starfield._pipeline = {};
    starfield._starBuffer = {};
    starfield._starCount = 1;
    starfield._viewUniformBuffer = {};
    starfield._viewBindGroup = {};

    starfield._renderFrame(1000);
    expect(starfield._viewState.panX).toBeGreaterThan(-0.02);
    starfield._renderFrame(1032);
    expect(starfield._viewState.panX).toBeLessThan(0);
    expect(starfield.getFlightTelemetry().speedNorm).toBeGreaterThan(0);
    for (let frame = 2; frame < 220; frame++) starfield._renderFrame(1000 + frame * 32);
    expect(starfield._viewState.panX).toBeCloseTo(-0.8, 2);
    expect(starfield.getFlightTelemetry().speedNorm).toBe(0);
    starfield.dispose();
  });

  it('renders stars as WebGPU-supported instanced quads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true,
      text: async () => fs.readFileSync(path.resolve(process.cwd(), 'js/engine/post-effects/shaders/lensflare.wgsl'), 'utf8') });
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
    expect(descriptor.fragment.targets[0].blend.color.dstFactor).toBe('one-minus-src-alpha');
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
    expect(starfield.setRegistrationScene({ ...flight, stage: 'moon', sceneGraph: {
      type: 'galaxy',
      children: [{ type: 'system', children: [
        { type: 'planet', data: { position: 1, class: 'gas_giant' }, children: [] },
        {
          type: 'planet', data: { position: 2, class: 'rocky' },
          children: [{ type: 'moon', data: { position: 101, class: 'ice_dwarf' } }],
        },
      ] }],
    }, draft: {
      ...flight.draft,
      planets: [{ position: 2, class: 'rocky', moons: [{ position: 101, class: 'ice_dwarf' }] }],
    } })).toBe(true);
    expect(starfield._sceneTarget).toBe(2.5);
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
