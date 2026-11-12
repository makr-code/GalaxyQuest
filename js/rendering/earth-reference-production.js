import { EARTH_REFERENCE, geographicVector, triangulateGeography, paintEarthTexture } from './earth-reference-geography.js';
import { reliefSettings, reliefMeshRows, paintReliefTexture, buildReliefMesh, reliefPoint } from './earth-reference-relief.js';
import { buildEarthMaterialMap, earthMaterialMipChain, earthSurfaceColor, earthAppearanceSettings } from './earth-reference-materials.js';
import { createEarthSky } from './earth-reference-sky.js';
import { createEarthClouds, cloudShellRadius } from './earth-reference-clouds.js';
import { DataUtils } from 'three';
import { EARTH_ECONOMY_PROFILES, EARTH_FACILITY_BUILDINGS, earthDevelopment, earthSettlementSites, earthSettlementPlan } from './earth-reference-settlements.js';
import { createMetricCity, metricCityLots, metricCityGeometry } from './earth-reference-city.js';
import { buildMineMesh } from './earth-reference-mine.js';

function packMesh(geography, rows, textureOnly) {
  const values = [];
  const addTriangle = (triangle, radius, material = 1) => {
    const points = triangle.map(([lon, lat]) => geographicVector(lon, lat, radius));
    const [a, b, c] = points;
    const ab = b.map((n, i) => n - a[i]), ac = c.map((n, i) => n - a[i]);
    const outward = a[0] * (ab[1] * ac[2] - ab[2] * ac[1])
      + a[1] * (ab[2] * ac[0] - ab[0] * ac[2]) + a[2] * (ab[0] * ac[1] - ab[1] * ac[0]);
    for (const index of outward < 0 ? [0, 2, 1] : [0, 1, 2]) {
      values.push(...points[index], 0, 0, 0, 0, material, 1, -1, 0, 0);
    }
  };
  for (let y = 0; y < rows; y++) for (let x = 0; x < rows * 2; x++) {
    const lon = -180 + x * 180 / rows, lat = -90 + y * 180 / rows, step = 180 / rows;
    addTriangle([[lon, lat], [lon + step, lat], [lon, lat + step]], 1);
    addTriangle([[lon + step, lat], [lon + step, lat + step], [lon, lat + step]], 1);
  }
  if (!textureOnly) {
    for (const triangle of triangulateGeography(geography.land, 192 / rows)) addTriangle(triangle, 1.004, 0);
    for (const triangle of triangulateGeography(geography.lakes, 192 / rows)) addTriangle(triangle, 1.0045);
  }
  return new Float32Array(values);
}

export async function createProductionEarth(viewport, device, geography, colorCanvas, relief, clock) {
  await import('../engine/zoom/IZoomLevelRenderer.js');
  await import('./body-material.js');
  await import('../engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
  await import('../engine/zoom/levels/PersistentBodyPlanetApproachRenderer.js');
  const canvas = document.createElement('canvas');
  canvas.dataset.earthProduction = '';
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const albedo = device.createTexture({
    label: 'earth_authored_albedo', size: [colorCanvas.width, colorCanvas.height],
    format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const optionsBuffer = device.createBuffer({
    label: 'earth_inspection_options', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const materialWidth = 1024, materialHeight = 512;
  const materialTexture = device.createTexture({
    label: 'earth_slope_roughness_specular', size: [materialWidth, materialHeight],
    format: 'rgba16float', mipLevelCount: 11,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const appearanceBuffer = device.createBuffer({
    label: 'earth_appearance_options', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = colorCanvas.width;
  maskCanvas.height = colorCanvas.height;
  paintEarthTexture(maskCanvas.getContext('2d'), geography, maskCanvas.width, maskCanvas.height, true);
  const mask = maskCanvas.getContext('2d').getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  const colors = colorCanvas.getContext('2d').getImageData(0, 0, colorCanvas.width, colorCanvas.height).data;
  const cache = new Map();
  let rows = null, representation = 'combined', disposed = false, settingsKey = '';
  let autoRows = null, detail = 'auto';
  let source = 'relief', reliefOptions = { exaggeration: 10, seaLevel: 0, ocean: true }, textureKey = '';
  let appearance = null, materialKey = '', atmosphereEnabled = true, sky = null;
  let clouds = null, cloudsEnabled = true, lightingEnabled = true;
  let settlementPlan = null;
  let settlementSites = null, settlementSeaLevel = null;
  let developmentYear = 50, developmentPlaying = false, economyProfile = 'residential';
  let metricCity = null, cityGeometry = null, cityMesh = null, cityKey = '', cityEnabled = false;
  let mineEnabled = false, mineGeometry = null;
  let facilityEnabled = false, facilityClass = 'all', facilityLevel = 1;
  const updateSettlements = () => {
    if (settlementSeaLevel !== reliefOptions.seaLevel) {
      settlementSites = earthSettlementSites(window.GQColonySurfacePlan, relief, reliefOptions.seaLevel);
      settlementSeaLevel = reliefOptions.seaLevel;
    }
    settlementPlan = earthSettlementPlan(window.GQColonySurfacePlan, relief, reliefOptions.seaLevel,
      appearance.cityLights && lightingEnabled, developmentYear, economyProfile, settlementSites);
    // The inspector's stock is explicit synthetic data, independent of the city profile.
    settlementPlan.facilities = facilityEnabled && settlementSites.some(site => site.id === 'earth-inspection:Berlin')
      ? window.GQColonySurfacePlan.facilityPlan(EARTH_FACILITY_BUILDINGS.map(type => ({ type, level: facilityLevel })),
        2026, settlementSites.find(site => site.id === 'earth-inspection:Berlin'), EARTH_REFERENCE.radiusKm, true,
        appearance.cityLights && lightingEnabled ? 1 : 0).filter(facility => facilityClass === 'all' || facility.kind === facilityClass)
      : [];
  };
  const reliefCanvas = document.createElement('canvas');
  reliefCanvas.width = colorCanvas.width;
  reliefCanvas.height = colorCanvas.height;
  const surface = {
    albedoView: albedo.createView(), optionsBuffer,
    appearance: { materialView: materialTexture.createView(), optionsBuffer: appearanceBuffer },
    surfacePlan() { return source === 'relief' && representation !== 'geometry' ? settlementPlan : null; },
    facilityGeometryEnabled() { return source === 'relief' && representation === 'combined' && appearance?.mode === 0; },
    facilityLightingEnabled() { return lightingEnabled; },
    facilitySurfaceAvailable(direction) {
      const longitude = Math.atan2(-direction[2], direction[0]) * 180 / Math.PI;
      const latitude = Math.asin(Math.max(-1, Math.min(1, direction[1]))) * 180 / Math.PI;
      return !reliefPoint(relief, longitude, latitude, reliefOptions).water;
    },
    drawBackground(pass) { sky.draw(pass); },
    drawForeground(pass, frame) {
      if (cityEnabled && source === 'relief' && representation === 'combined' && appearance?.mode === 0) {
        metricCity ??= createMetricCity(device, format);
        const key = `${cityMesh.key}:${settlementPlan.state.population}:${economyProfile}`;
        if (key !== cityKey) {
          const population = settlementPlan.urbanSettlements.find(city => city.id === 'earth-inspection:Berlin')?.population ?? 0;
          cityGeometry = metricCityGeometry(metricCityLots(2026, population, economyProfile),
            13.405, 52.52, cityMesh.vertices, relief, reliefOptions);
          metricCity.update(cityGeometry);
          cityKey = key;
        }
        metricCity.draw(pass, frame, canvas.height, lightingEnabled);
      }
      if (cloudsEnabled && appearance?.mode === 0 && appearance.cloudMode === 'shell') {
        clouds.draw(pass, frame, appearance.cloudAltitude, lightingEnabled);
      }
    },
    sampler: device.createSampler({ addressModeU: 'repeat', addressModeV: 'clamp-to-edge',
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' }),
    mesh(pixels) {
      if (source === 'relief' && detail !== 'auto') rows = reliefMeshRows(detail);
      else {
        autoRows = window.GQColonySurfaceLevelWebGPU.terrainSphereResolution(pixels, autoRows);
        rows = autoRows;
      }
      const key = `earth:${source}:${rows}:${representation === 'texture' ? 'sphere' : 'relief'}`
        + (source === 'relief' ? `:${JSON.stringify(reliefOptions)}:mine:${mineEnabled && representation !== 'texture'}` : '');
      if (!cache.has(key)) {
        const mesh = { key, rows, vertices: source === 'relief'
          ? buildReliefMesh(relief, rows, reliefOptions, representation === 'texture')
          : packMesh(geography, rows, representation === 'texture') };
        if (mineEnabled && source === 'relief' && representation !== 'texture') {
          mesh.mine = buildMineMesh(mesh.vertices, relief, reliefOptions);
          mesh.vertices = mesh.mine.vertices;
        }
        if (mesh.vertices.byteLength > 32 * 1024 * 1024) throw new RangeError('Earth mesh exceeds the 32 MiB reference budget');
        cache.set(key, mesh);
        while ([...cache.values()].reduce((sum, entry) => sum + entry.vertices.byteLength, 0) > 32 * 1024 * 1024) {
          cache.delete(cache.keys().next().value);
        }
      }
      const mesh = cache.get(key);
      cityMesh = mesh;
      mineGeometry = mesh.mine || null;
      cache.delete(key);
      cache.set(key, mesh);
      return mesh;
    },
  };
  const orbit = new window.GQPersistentBodyPlanetApproach.PersistentBodyPlanetApproachRenderer();
  device.pushErrorScope('validation');
  let scopeOpen = true;
  try {
    sky = createEarthSky(device, format, window.GQBodyMaterial.ATMOSPHERE_WGSL);
    clouds = createEarthClouds(device, format, window.GQBodyMaterial.CLOUD_WGSL);
    await orbit.initialize(canvas, { device, context, externalCameraControls: true,
      geographicSurface: surface, unixSeconds: clock });
    await orbit.enter(1);
    const validation = await device.popErrorScope();
    scopeOpen = false;
    if (validation) throw new Error(`Earth production pipeline: ${validation.message}`);
  } catch (error) {
    if (scopeOpen) await device.popErrorScope();
    orbit.dispose();
    albedo.destroy();
    optionsBuffer.destroy();
    materialTexture.destroy();
    appearanceBuffer.destroy();
    sky?.dispose();
    clouds?.dispose();
    metricCity?.dispose();
    context.unconfigure();
    canvas.remove();
    throw error;
  }
  viewport.appendChild(canvas);
  return {
    canvas, context, orbit, surface,
    get cityGeometry() { return cityGeometry; },
    get mineGeometry() { return mineGeometry; },
    get facilityPlan() { return settlementPlan?.facilities || []; },
    get facilityGeometry() { return orbit._facilityGeometry; },
    get orbitalPlan() { return orbit._orbitalPlan; },
    get orbitalGeometry() { return orbit._orbitalGeometry; },
    get rows() { return rows; },
    get source() { return source; },
    get detail() { return source === 'relief' ? detail : 'auto'; },
    get reliefOptions() { return { ...reliefOptions }; },
    get appearance() { return appearance && { ...appearance }; },
    get development() { return settlementPlan && { ...settlementPlan.development,
      cities: settlementPlan.urbanSettlements.filter(city => !city.ruined).length,
      ruralPopulation: settlementPlan.ruralPopulation }; },
    get cacheBytes() { return [...cache.values()].reduce((sum, mesh) => sum + mesh.vertices.byteLength, 0); },
    update(settings) {
      const key = JSON.stringify(settings);
      if (key === settingsKey && Number(settings.developmentYear) === developmentYear) return;
      if (!['coasts', 'relief'].includes(settings.source)) throw new TypeError('Unknown Earth geographic source');
      const validatedRelief = reliefSettings(settings);
      const validatedAppearance = earthAppearanceSettings(settings);
      if (settings.cityGeometry !== undefined && typeof settings.cityGeometry !== 'boolean') {
        throw new TypeError('Invalid Earth city geometry setting');
      }
      cityEnabled = settings.cityGeometry ?? false;
      if (settings.mineGeometry !== undefined && typeof settings.mineGeometry !== 'boolean') {
        throw new TypeError('Invalid Earth mine geometry setting');
      }
      mineEnabled = settings.mineGeometry ?? false;
      if (settings.facilityGeometry !== undefined && typeof settings.facilityGeometry !== 'boolean') {
        throw new TypeError('Invalid Earth facility geometry setting');
      }
      facilityEnabled = settings.facilityGeometry ?? false;
      if (settings.orbitalGeometry !== undefined && typeof settings.orbitalGeometry !== 'boolean') {
        throw new TypeError('Invalid Earth orbital geometry setting');
      }
      facilityClass = settings.facilityClass ?? 'all';
      if (facilityClass !== 'all' && !window.GQColonySurfacePlan.FACILITY_KINDS.includes(facilityClass)) {
        throw new RangeError('Invalid Earth facility class');
      }
      facilityLevel = Number(settings.facilityLevel ?? 1);
      if (!Number.isInteger(facilityLevel) || facilityLevel < 0 || facilityLevel > 16) {
        throw new RangeError('Invalid Earth synthetic facility level');
      }
      const development = earthDevelopment(settings.developmentYear);
      if (!Object.hasOwn(EARTH_ECONOMY_PROFILES, settings.economyProfile)) throw new RangeError('Invalid Earth economy profile');
      if (typeof settings.developmentPlaying !== 'boolean') throw new TypeError('Invalid Earth development playback');
      reliefMeshRows(settings.detail);
      detail = settings.detail;
      representation = settings.representation;
      source = settings.source;
      reliefOptions = validatedRelief;
      if (appearance?.phase !== validatedAppearance.phase) orbit._waterTime = validatedAppearance.phase % 120;
      appearance = validatedAppearance;
      atmosphereEnabled = settings.atmosphere;
      cloudsEnabled = settings.clouds;
      lightingEnabled = settings.lighting;
      developmentYear = development.year;
      economyProfile = settings.economyProfile;
      developmentPlaying = settings.developmentPlaying;
      updateSettlements();
      const nextTextureKey = source === 'relief'
        ? `${source}:${reliefOptions.seaLevel}:${reliefOptions.ocean}:${appearance.palette}` : source;
      if (textureKey !== nextTextureKey) {
        let bytes;
        if (source === 'relief') {
          bytes = paintReliefTexture(reliefCanvas.getContext('2d'), relief,
            reliefCanvas.width, reliefCanvas.height, reliefOptions,
            appearance.palette === 'surface' ? earthSurfaceColor : null);
        } else {
          bytes = colors.slice();
          for (let i = 0; i < bytes.length; i += 4) bytes[i + 3] = mask[i];
        }
        device.queue.writeTexture({ texture: albedo }, bytes,
          { bytesPerRow: colorCanvas.width * 4 }, [colorCanvas.width, colorCanvas.height]);
        textureKey = nextTextureKey;
      }
      const nextMaterialKey = source === 'relief' ? `${source}:${reliefOptions.seaLevel}:${reliefOptions.ocean}` : source;
      if (nextMaterialKey !== materialKey) {
        let data;
        if (source === 'relief') data = buildEarthMaterialMap(relief, materialWidth, materialHeight, reliefOptions);
        else {
          data = new Uint16Array(materialWidth * materialHeight * 4);
          for (let y = 0; y < materialHeight; y++) for (let x = 0; x < materialWidth; x++) {
            const alpha = mask[((y * 2) * colorCanvas.width + x * 2) * 4];
            data.set([0, 0, alpha < 64 ? 0.16 : alpha > 192 ? 0.38 : 0.88,
              alpha < 64 ? 0.02 : 0.04].map(DataUtils.toHalfFloat), (y * materialWidth + x) * 4);
          }
        }
        earthMaterialMipChain(data, materialWidth, materialHeight).forEach((level, mipLevel) => {
          device.queue.writeTexture({ texture: materialTexture, mipLevel }, level.data,
            { bytesPerRow: level.width * 8 }, [level.width, level.height]);
        });
        materialKey = nextMaterialKey;
      }
      device.queue.writeBuffer(appearanceBuffer, 0, new Float32Array([
        appearance.bump, appearance.gloss ? 1 : 0, appearance.mode, appearance.cloudMode === 'shell' ? 1 : 0,
        cloudShellRadius(appearance.cloudAltitude), appearance.cloudShadows ? 1 : 0,
        appearance.solarAtmosphere ? 1 : 0, appearance.cityMaterials ? 1 : 0,
      ]));
      device.queue.writeBuffer(optionsBuffer, 0, new Float32Array([
        settings.water ? 1 : 0, settings.lighting ? 1 : 0, representation === 'geometry' ? 1 : 0,
        source === 'relief' ? 1 : 0,
      ]));
      orbit.setSceneData({
        reduced_motion: !settings.motion, vfx_quality: 'high',
        orbital_facilities: settings.orbitalGeometry && representation !== 'geometry' && appearance.mode === 0
          ? [{ type: 'shipyard', level: 1 }, { type: 'missile_silo', level: 1 }, { type: 'solar_satellite', level: 3 }] : [],
        colony: {
          ...EARTH_REFERENCE,
          mass_earth: 1,
          // Authored Earth geometry uses -Z east; free spin and node signs follow
          // that frame (S * basis * S), not a physical retrograde Earth.
          rotation_period_hours: -EARTH_REFERENCE.rotation_period_hours,
          diameter_km: EARTH_REFERENCE.radiusKm * 2, name: 'Earth reference', planet_class: 'terran',
          seed: 'earth-reference', has_atmosphere: settings.atmosphere,
          cloud_coverage: settings.clouds ? 0.65 : 0, star_direction: appearance.sun,
        },
        bodyTerrainManifest: { radius_km: EARTH_REFERENCE.radiusKm, biome: 'terran' },
      });
      settingsKey = key;
    },
    render(dt, camera) {
      if (disposed) return;
      const policy = orbit._livingPolicy.policy(orbit._sceneData);
      if (developmentPlaying && developmentYear < 200 && source === 'relief'
        && representation !== 'geometry' && appearance.mode === 0 && policy.motion && policy.visible) {
        if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid Earth development frame time');
        developmentYear = Math.min(200, developmentYear + Math.min(dt, 0.1) * 200 / 60);
        updateSettlements();
      }
      camera.updateMatrixWorld(true);
      const matrix = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
      sky.update(matrix.clone().invert().elements, camera.position, appearance?.sky,
        atmosphereEnabled && appearance?.mode === 0, appearance.sun, appearance.solarAtmosphere);
      // Three's WebGPU camera already uses a 0..1 depth projection.
      orbit.render(dt, {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: 0, y: 0, z: 0 }, viewProjection: matrix.elements,
        projectedScale: camera.projectionMatrix.elements[5],
      });
    },
    resize(width, height) { canvas.width = width; canvas.height = height; },
    dispose() {
      if (disposed) return;
      disposed = true;
      orbit.dispose();
      albedo.destroy();
      optionsBuffer.destroy();
      materialTexture.destroy();
      appearanceBuffer.destroy();
      sky.dispose();
      clouds.dispose();
      metricCity?.dispose();
      context.unconfigure();
      canvas.remove();
      cache.clear();
    },
  };
}
