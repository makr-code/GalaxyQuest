const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test.use({ launchOptions: {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
} });

test('real asteroid PBR instancing replays pixels, changes at LOD, and releases GPU geometry', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('http://localhost:8080/**', async route => {
    const relative = new URL(route.request().url()).pathname.slice(1);
    if (!relative) return route.fulfill({ contentType: 'text/html',
      body: '<canvas width="384" height="384"></canvas>' });
    if (!/^(js\/|node_modules\/three\/build\/)[\w/.-]+\.js$/.test(relative) || relative.includes('..')) return route.abort();
    return route.fulfill({ contentType: 'application/javascript',
      body: await fs.readFile(path.join(__dirname, '../..', relative), 'utf8') });
  });
  await page.goto('http://localhost:8080/');
  await page.evaluate(async () => { window.THREE = await import('/node_modules/three/build/three.module.js'); });
  for (const script of [
    'engine/assets/WorldAssetDescriptor', 'engine/assets/CoherentMaterialGenerator',
    'engine/procedural/ProceduralMeshGenerator', 'rendering/texture-manager',
    'rendering/material-factory', 'rendering/SystemSpecialBodiesRenderer',
  ]) await page.addScriptTag({ url: `/js/${script}.js` });
  const result = await page.evaluate(() => {
    const THREE = window.THREE;
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), preserveDrawingBuffer: true });
    renderer.setSize(384, 384, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x332211, 3));
    const camera = new THREE.OrthographicCamera(-55, 55, 55, -55, 0.1, 2000);
    const manager = new window.GQTextureManager({ three: THREE });
    const factory = new window.GQMaterialFactory({ three: THREE });
    const params = { seed: 'public-belt', radius: 40, tube: 7, height: 2, rockSize: 2,
      textureManager: manager, materialFactory: factory };
    const build = () => window.GQSystemSpecialBodiesRenderer.buildAsteroidBeltMesh(THREE, params);
    const capture = () => {
      renderer.render(scene, camera);
      const pixels = new Uint8Array(384 * 384 * 4);
      const gl = renderer.getContext();
      gl.readPixels(0, 0, 384, 384, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const clear = group => {
      scene.remove(group);
      group.traverse(object => {
        object.geometry?.dispose();
        object.material?.dispose();
        if (object.isInstancedMesh) object.dispose();
      });
    };
    camera.position.set(0, 90, 50);
    camera.lookAt(0, 0, 0);
    const first = build();
    scene.add(first);
    let rocks;
    first.traverse(object => { if (object.isInstancedMesh) rocks = object; });
    const near = capture();
    camera.position.set(0, 900, 500);
    camera.lookAt(0, 0, 0);
    const far = capture();
    const farHidden = !rocks.visible;
    clear(first);
    manager.dispose();
    camera.position.set(0, 90, 50);
    camera.lookAt(0, 0, 0);
    const second = build();
    scene.add(second);
    const replay = capture();
    let litPixels = 0, lodChanges = 0, replayChanges = 0;
    for (let i = 0; i < near.length; i += 4) {
      if (near[i] + near[i + 1] + near[i + 2] > 0) litPixels++;
      if (near[i] !== far[i] || near[i + 1] !== far[i + 1] || near[i + 2] !== far[i + 2]) lodChanges++;
      if (near[i] !== replay[i] || near[i + 1] !== replay[i + 1] || near[i + 2] !== replay[i + 2]) replayChanges++;
    }
    clear(second);
    capture();
    const geometries = renderer.info.memory.geometries;
    manager.dispose();
    factory.dispose();
    renderer.dispose();
    return { count: rocks.count, farHidden, litPixels, lodChanges, replayChanges, geometries };
  });
  expect(result.count).toBe(96);
  expect(result.farHidden).toBe(true);
  expect(result.litPixels).toBeGreaterThan(100);
  expect(result.lodChanges).toBeGreaterThan(100);
  expect(result.replayChanges).toBe(0);
  expect(result.geometries).toBe(0);
  expect(errors).toEqual([]);
});
