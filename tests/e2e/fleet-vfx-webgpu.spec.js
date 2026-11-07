const { test, expect } = require('@playwright/test');

test('128-ship native VFX keeps replay fidelity and exact visual budgets', async ({ page }, testInfo) => {
  await page.goto('/');
  const available = await page.evaluate(async () => !!(navigator.gpu && await navigator.gpu.requestAdapter()));
  test.skip(!available, 'A real WebGPU adapter is required for the fleet workload');
  const result = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const [{ PerspectiveSpaceFlight }, { HeroBattleSession }, { SPACE_WEAPON_PROFILES }, { Vector3 }] = await Promise.all([
      import('/js/rendering/perspective-space-flight.js'),
      import('/js/rendering/hero-battle-session.js'),
      import('/js/rendering/space-weapon-render-pass.js'),
      import('/node_modules/.vite/deps/three.js'),
    ]);
    const device = await adapter.requestDevice({
      requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
    });

    const reports = [];
    const logs = [];
    try {
      for (const [fleetLod, distance] of [[false, 300], [true, 300], [true, 45]]) {
        device.pushErrorScope('validation');
        const space = new PerspectiveSpaceFlight();
        const center = new Vector3(0, 0, -200);
        const texture = device.createTexture({ size: [1920, 1080], format: 'rgba16float',
          usage: GPUTextureUsage.RENDER_ATTACHMENT });
        const session = new HeroBattleSession(space, {
          seed: 42, audio: false, view: 'system', fleetLod, primitiveBudget: 32,
        });
        try {
          space.vesselRenderPass.initialize(device, 'rgba16float');
          for (let index = 0; index < 128; index++) {
            await space.registerSpaceVessel({
              id: `gpu-qa-${index}`,
              model_url: `procedural:hero-${index % 2 ? 'cruiser' : 'frigate'}`,
              route: [[0, 0, 0], [0, 0, 0]], visual_scale_ly: 1.2,
              reduced_motion: true, engine_effects: false,
            });
          }
          await session.initialize([...space.spaceEntities.values()], center, 1);
          space.camera.near = 0.1;
          space.camera.far = 10000;
          space.camera.aspect = 1920 / 1080;
          space.camera.position.copy(center).add(new Vector3(0, -distance, distance * 0.45));
          space.camera.lookAt(center);
          space.camera.updateProjectionMatrix();
          space.camera.updateMatrixWorld(true);
          const effects = new Set();
          for (let frame = 0; frame <= 80; frame++) {
            session.update(frame / 10, true, effects, Object.keys(SPACE_WEAPON_PROFILES));
            const encoder = device.createCommandEncoder();
            const timestampWrites = session.metrics.begin(device);
            const pass = encoder.beginRenderPass({
              colorAttachments: [{ view: texture.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear', storeOp: 'store' }],
              depthStencilAttachment: {
                view: session.depth.prepare(device, 'rgba16float', 1920, 1080),
                depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
              },
              ...(timestampWrites ? { timestampWrites } : {}),
            });
            space.vesselRenderPass.render(pass, [...space.spaceVessels.values()],
              space.camera, space.origin, session.time, true, fleetLod ? 1080 : null);
            space.weaponRenderPass.render(pass, device, 'rgba16float', space.camera, space.origin,
              100, 1920, 1080, true, session.time, fleetLod ? 32 : null);
            session.recordRenderStats();
            pass.end();
            session.metrics.encode(encoder);
            device.queue.submit([encoder.finish()]);
            session.metrics.submitted();
            if (session.metrics.pending) await session.metrics.pending;
          }
          await device.queue.onSubmittedWorkDone();
          const snapshot = session.snapshot();
          logs.push(snapshot.log);
          reports.push({ fleetLod, distance, time: snapshot.replayTime, shots: snapshot.shots,
            outcomes: snapshot.outcomes, fleet: snapshot.fleet, metrics: snapshot.metrics });
        } finally {
          try { await session.dispose(); } finally { space.dispose(); texture.destroy(); }
        }
        reports.at(-1).validation = (await device.popErrorScope())?.message || null;
        reports.at(-1).cleaned = space.vesselRenderPass.resources.size === 0
          && space.vesselRenderPass.assets.size === 0 && session.depth.texture === null;
      }
      return { reports, logs };
    } finally {
      device.destroy();
    }
  });
  await testInfo.attach('fleet-vfx-benchmark.json', {
    body: Buffer.from(JSON.stringify(result.reports, null, 2)), contentType: 'application/json',
  });
  for (const report of result.reports) {
    expect(report.validation).toBeNull();
    expect(report.cleaned).toBe(true);
    expect(report.time).toBe(8);
    expect(report.shots).toBe(642);
    expect(report.outcomes).toEqual({ miss: 214, shield: 214, hull: 214 });
    expect(report.fleet.peakRetainedEffects).toBeLessThanOrEqual(64);
  }
  expect(result.logs[0]).toEqual(result.logs[1]);
  expect(result.logs[1]).toEqual(result.logs[2]);
  expect(result.reports[0].fleet.peakPrimitives).toBeGreaterThan(32);
  for (const report of result.reports.slice(1)) expect(report.fleet.peakPrimitives).toBeLessThanOrEqual(32);
  expect(result.reports[1].fleet.vessels.far).toBe(128);
  expect(result.reports[1].fleet.vessels.vertices).toBe(128 * 36);
  expect(result.reports[1].fleet.vessels.drawCalls).toBe(128);
  expect(result.reports[1].fleet.weapons.budgetDropped).toBeGreaterThan(0);
  expect(result.reports[2].fleet.weapons.budgetReduced).toBeGreaterThan(0);
});

test('mesh debris has real pixel output and is hidden behind opaque celestial depth', async ({ page }) => {
  await page.goto('/');
  const available = await page.evaluate(async () => !!(navigator.gpu && await navigator.gpu.requestAdapter()));
  test.skip(!available, 'A real WebGPU adapter is required for mesh debris');
  const result = await page.evaluate(async () => {
    const [{ HeroDebrisRenderPass }, { HeroBattleDepth }, { PerspectiveCamera, Quaternion, Vector3, Object3D }] =
      await Promise.all([
        import('/js/rendering/hero-debris-render-pass.js'),
        import('/js/rendering/hero-battle-depth.js'),
        import('/node_modules/.vite/deps/three.js'),
      ]);
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    device.pushErrorScope('validation');
    const mesh = new HeroDebrisRenderPass();
    const depth = new HeroBattleDepth();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const source = { position: new Vector3(0, 0, -5), quaternion: new Quaternion(), scale: 1 };
    for (let seed = 0; seed < 16; seed++) {
      mesh.spawn(source, { time: 0, seed, shipClass: seed % 2 ? 'cruiser' : 'frigate' });
    }
    const body = new Object3D();
    body.position.z = -3;
    body.userData = { type: 'planet', radius: 1 };
    body.updateMatrixWorld(true);
    const texture = device.createTexture({ size: [256, 256], format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const buffer = device.createBuffer({ size: 256 * 1024, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const samples = [];
    try {
      for (const blocked of [false, true]) {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: texture.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear', storeOp: 'store' }],
          depthStencilAttachment: { view: depth.prepare(device, 'rgba8unorm', 256, 256),
            depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        });
        if (blocked) depth.render(pass, [body], camera);
        mesh.render(pass, device, 'rgba8unorm', camera, new Vector3(), 0.1, 1080);
        pass.end();
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 1024 }, [256, 256]);
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const bytes = new Uint8Array(buffer.getMappedRange());
        let pixels = 0;
        for (let index = 0; index < bytes.length; index += 4) {
          if (bytes[index] + bytes[index + 1] + bytes[index + 2] > 0) pixels++;
        }
        buffer.unmap();
        samples.push({ blocked, pixels, ...mesh.snapshot() });
      }
      return { samples, majorFragments: mesh.bursts.reduce((count, burst) =>
        count + burst.fragments.filter(fragment => fragment.major).length, 0),
      validation: (await device.popErrorScope())?.message || null };
    } finally {
      try { mesh.dispose(); } finally {
        depth.dispose();
        texture.destroy();
        buffer.destroy();
        device.destroy();
      }
    }
  });
  expect(result.validation).toBeNull();
  expect(result.majorFragments).toBe(24);
  expect(result.samples[0].pixels).toBeGreaterThan(0);
  expect(result.samples[1].pixels).toBe(0);
  for (const sample of result.samples) {
    expect(sample.instances).toBe(192);
    expect(sample.drawCalls).toBe(1);
    expect(sample.vertices).toBe(6912);
  }
});

test('active hero shields shimmer blue without a hit, fade with strength and obey celestial depth', async ({ page }) => {
  await page.goto('/');
  const available = await page.evaluate(async () => !!(navigator.gpu && await navigator.gpu.requestAdapter()));
  test.skip(!available, 'A real WebGPU adapter is required for shield pixels');
  const result = await page.evaluate(async () => {
    const [{ SpaceVesselRenderPass }, { HeroBattleDepth }, { PerspectiveCamera, Quaternion, Vector3, Object3D }] =
      await Promise.all([
        import('/js/rendering/space-vessel-render-pass.js'),
        import('/js/rendering/hero-battle-depth.js'),
        import('/node_modules/.vite/deps/three.js'),
      ]);
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    device.pushErrorScope('validation');
    const vessels = new SpaceVesselRenderPass();
    const depth = new HeroBattleDepth();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const ship = { id: 'pixel-shield', kind: 'vessel', modelUrl: 'procedural:hero-carrier',
      position: new Vector3(0, 0, -5), quaternion: new Quaternion(), scale: 1,
      color: [1, 1, 1, 1], engineEffects: false, heroStatus: { shield: 0 }, heroLight: { shield: 0 } };
    await vessels.load(ship);
    vessels.initialize(device, 'rgba8unorm');
    const body = new Object3D();
    body.position.z = -3;
    body.userData = { type: 'planet', radius: 1 };
    body.updateMatrixWorld(true);
    const texture = device.createTexture({ size: [256, 256], format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const buffer = device.createBuffer({ size: 256 * 1024, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const samples = [];
    try {
      for (const [strength, blocked] of [[0, false], [0.5, false], [1, false], [1, true]]) {
        ship.heroStatus.shield = strength;
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: texture.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear', storeOp: 'store' }],
          depthStencilAttachment: { view: depth.prepare(device, 'rgba8unorm', 256, 256),
            depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        });
        if (blocked) depth.render(pass, [body], camera);
        vessels.render(pass, [ship], camera, new Vector3(), 1, true);
        pass.end();
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 1024 }, [256, 256]);
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const bytes = new Uint8Array(buffer.getMappedRange());
        let red = 0, blue = 0;
        for (let index = 0; index < bytes.length; index += 4) {
          red += bytes[index];
          blue += bytes[index + 2];
        }
        buffer.unmap();
        samples.push({ strength, blocked, red, blue, shields: vessels.frameStats.shields });
      }
      return { samples, validation: (await device.popErrorScope())?.message || null };
    } finally {
      try { vessels.dispose(); } finally {
        depth.dispose();
        texture.destroy();
        buffer.destroy();
        device.destroy();
      }
    }
  });
  expect(result.validation).toBeNull();
  const [empty, half, full, blocked] = result.samples;
  expect(empty.shields).toBe(0);
  expect(half.shields).toBe(1);
  expect(full.blue).toBeGreaterThan(half.blue);
  expect(half.blue).toBeGreaterThan(empty.blue);
  expect(full.blue - empty.blue).toBeGreaterThan(full.red - empty.red);
  expect(blocked.blue).toBe(0);
  expect(blocked.red).toBe(0);
});
