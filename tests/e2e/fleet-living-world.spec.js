const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test.use({ launchOptions: {
  executablePath: process.env.GQ_CHROMIUM_EXECUTABLE_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
} });

test('active Three fleet hulls render all five PBR maps deterministically and reenter without GPU growth', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('http://localhost:8080/**', async route => {
    const relative = new URL(route.request().url()).pathname.slice(1);
    if (!relative) return route.fulfill({ contentType: 'text/html', body: '<canvas width="384" height="384"></canvas>' });
    if (!/^(js\/|node_modules\/three\/build\/)[\w/.-]+\.js$/.test(relative) || relative.includes('..')) return route.abort();
    return route.fulfill({ contentType: 'application/javascript',
      body: await fs.readFile(path.join(__dirname, '../..', relative), 'utf8') });
  });
  await page.goto('http://localhost:8080/');
  await page.evaluate(async () => {
    window.THREE = await import('/node_modules/three/build/three.module.js');
    for (const script of [
      'engine/assets/WorldAssetDescriptor', 'engine/assets/CoherentMaterialGenerator',
      'rendering/texture-manager', 'rendering/material-factory', 'rendering/galaxy-renderer-core',
    ]) await import(`/js/${script}.js`);
  });
  const result = await page.evaluate(() => {
    const THREE = window.THREE;
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), preserveDrawingBuffer: true });
    renderer.setSize(384, 384, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x202530);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x284463, 2));
    const key = new THREE.DirectionalLight(0xffffff, 4);
    key.position.set(1, 3, 5);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 30);
    camera.position.set(1.2, 1.4, 3);
    const core = Object.create(window.GalaxyRendererCore.prototype);
    Object.assign(core, {
      textureManager: new window.GQTextureManager({ three: THREE }),
      materialFactory: new window.GQMaterialFactory({ three: THREE }),
      vesselGeometryCache: new Map(), systemFleetGroup: new THREE.Group(),
      qualityProfile: { name: 'high' }, opts: {},
    });
    core.textureManager.getCoherentMaterialBundleAsync = async () => null;
    scene.add(core.systemFleetGroup);
    const fleet = { id: 'stable-fleet', mission: 'attack', color: 0x6da6cc,
      vessels: [{ id: 'stable-ship', ship_type: 'cruiser', sample_count: 1 }] };
    const first = core._buildFleetFormationEntry(fleet, 0);
    const hull = first.ships[0].mesh;
    const target = hull.position.clone();
    camera.lookAt(target);
    const capture = () => {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL();
    };
    const baseline = capture();
    const memoryBefore = renderer.info.memory.geometries;
    const changed = {};
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
      const map = hull.material[slot];
      hull.material[slot] = null;
      hull.material.needsUpdate = true;
      changed[slot] = capture() !== baseline;
      hull.material[slot] = map;
      hull.material.needsUpdate = true;
    }
    const restored = capture() === baseline;
    const lights = first.ships[0].lights;
    const idle = lights.engine.visible === false;
    fleet.state = { engine_power: 1, navigation_lights: true, trail: true };
    core._syncFleetShipVisuals(first);
    const active = capture() !== baseline && lights.engine.visible && lights.trail.visible;
    core._clearGroup(core.systemFleetGroup);
    core._buildFleetFormationEntry({ ...fleet, mission: 'transport', state: {} }, 99);
    const reentered = capture() === baseline;
    const memoryAfter = renderer.info.memory.geometries;
    core._clearGroup(core.systemFleetGroup);
    for (const geometry of core.vesselGeometryCache.values()) geometry.dispose();
    core.textureManager.dispose();
    core.materialFactory.dispose();
    renderer.dispose();
    return { changed, restored, idle, active, reentered, memoryBefore, memoryAfter };
  });
  expect(result.changed).toEqual({ map: true, normalMap: true, roughnessMap: true, metalnessMap: true, emissiveMap: true });
  expect(result).toMatchObject({ restored: true, idle: true, active: true, reentered: true });
  expect(result.memoryAfter).toBe(result.memoryBefore);
  expect(errors).toEqual([]);
});
