import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EARTH_REFERENCE, ZONE_COLORS, createEarthGeography, geographicVector,
  earthReferenceBasis, triangulateGeography, paintEarthTexture } from './earth-reference-geography.js';
import { createProductionEarth } from './earth-reference-production.js';
import { createEarthRelief, inspectReliefMesh, RELIEF_GRID } from './earth-reference-relief.js';
import { MINE_REFERENCE } from './earth-reference-mine.js';

function polygonGeometry(polygons, radius) {
  const triangles = triangulateGeography(polygons);
  const positions = [], uvs = [], normals = [];
  for (const triangle of triangles) {
    const points = triangle.map(([lon, lat]) => new THREE.Vector3(...geographicVector(lon, lat)));
    const outward = new THREE.Vector3().subVectors(points[1], points[0])
      .cross(new THREE.Vector3().subVectors(points[2], points[0])).dot(points[0]);
    const order = outward < 0 ? [0, 2, 1] : [0, 1, 2];
    for (const index of order) {
      const [lon, lat] = triangle[index];
      positions.push(...points[index].clone().multiplyScalar(radius).toArray());
      normals.push(...points[index].toArray());
      uvs.push((lon + 180) / 360, (lat + 90) / 180);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

function coastlineGeometry(polygons, radius) {
  const positions = [];
  for (const rings of polygons) for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1])));
      for (let j = 0; j < steps; j++) for (const t of [j / steps, (j + 1) / steps]) {
        positions.push(...geographicVector(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, radius));
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function gridGeometry() {
  const rings = [];
  for (const lat of [-66.56072, -23.43928, 0, 23.43928, 66.56072]) {
    rings.push([Array.from({ length: 361 }, (_, i) => [i - 180, lat])]);
  }
  return coastlineGeometry(rings, 1.008);
}

async function loadCollection(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Earth reference data: HTTP ${response.status}`);
  return response.json();
}

export async function createEarthReference(viewport, controls) {
  const [landData, lakeData, relief] = await Promise.all([
    loadCollection(new URL('../../tools/data/earth/ne_110m_land.geojson', import.meta.url)),
    loadCollection(new URL('../../tools/data/earth/ne_110m_lakes.geojson', import.meta.url)),
    (async () => {
      const response = await fetch(new URL('../../tools/data/earth/etopo1-ice-30arcmin.i16', import.meta.url),
        { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`ETOPO reference data: HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
        .map(n => n.toString(16).padStart(2, '0')).join('');
      if (hash !== RELIEF_GRID.sha256) throw new Error('ETOPO reference checksum mismatch');
      return createEarthRelief(buffer);
    })(),
  ]);
  const geography = createEarthGeography(landData, lakeData);
  const adapter = await navigator.gpu?.requestAdapter({ forceFallbackAdapter: true })
    || await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable; no silent WebGL fallback');
  const device = await adapter.requestDevice();
  const renderer = new THREE.WebGPURenderer({ antialias: true, device });
  try {
    await renderer.init();
  } catch (error) {
    renderer.dispose();
    device.destroy();
    throw error;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  viewport.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#070e18');
  const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 50);
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
  const navigation = new OrbitControls(camera, viewport);
  navigation.minDistance = 1.15;
  navigation.maxDistance = 8;
  navigation.enablePan = false;
  const body = new THREE.Group();
  scene.add(body);
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  paintEarthTexture(canvas.getContext('2d'), geography, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  const landMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 });
  const flatMaterial = new THREE.MeshBasicMaterial({ map: texture });
  const geometryMaterial = new THREE.MeshBasicMaterial({ color: '#b7c3ac' });
  const waterMaterial = new THREE.MeshStandardMaterial({ color: ZONE_COLORS.water, roughness: 0.3 });
  const waterFlat = new THREE.MeshBasicMaterial({ color: ZONE_COLORS.water });
  const waterSphere = new THREE.SphereGeometry(1, 256, 128);
  // Match +X=Greenwich, -Z=90E, with the texture seam at the dateline.
  const uv = waterSphere.getAttribute('uv'), position = waterSphere.getAttribute('position');
  for (let i = 0; i < uv.count; i++) {
    const vector = geographicVector(uv.getX(i) * 360 - 180, uv.getY(i) * 180 - 90);
    position.setXYZ(i, ...vector);
    waterSphere.getAttribute('normal').setXYZ(i, ...vector);
  }
  const ocean = new THREE.Mesh(waterSphere, waterMaterial);
  const land = new THREE.Mesh(polygonGeometry(geography.land, 1.004), landMaterial);
  const lakes = new THREE.Mesh(polygonGeometry(geography.lakes, 1.0045), waterMaterial);
  const textureSphere = new THREE.Mesh(waterSphere, landMaterial);
  textureSphere.scale.setScalar(1.004);
  const wireMaterial = new THREE.MeshBasicMaterial({ color: '#f5daa3', wireframe: true, transparent: true, opacity: 0.5 });
  const wire = new THREE.Mesh(land.geometry, wireMaterial);
  wire.scale.setScalar(1.0003);
  const coasts = new THREE.LineSegments(coastlineGeometry([...geography.land, ...geography.lakes], 1.006),
    new THREE.LineBasicMaterial({ color: '#afe2e5' }));
  const grid = new THREE.LineSegments(gridGeometry(), new THREE.LineBasicMaterial({ color: '#dca578' }));
  const atmosphereGeometry = new THREE.SphereGeometry(1.025, 128, 64);
  const atmosphereMaterial = new THREE.MeshBasicMaterial({
    color: '#4b98e8', side: THREE.BackSide, transparent: true, opacity: 0.22, depthWrite: false,
  });
  const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
  body.add(ocean, land, lakes, textureSphere, wire, coasts, grid, atmosphere);
  const releaseReference = () => {
    navigation.dispose();
    for (const geometry of new Set([waterSphere, land.geometry, lakes.geometry, coasts.geometry, grid.geometry, atmosphereGeometry])) geometry.dispose();
    for (const material of [landMaterial, flatMaterial, geometryMaterial, waterMaterial, waterFlat, wireMaterial, coasts.material, grid.material, atmosphereMaterial]) material.dispose();
    texture.dispose();
    renderer.dispose();
    device.destroy();
    renderer.domElement.remove();
  };
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(1, 0.5, 1.4);
  scene.add(sun, new THREE.AmbientLight('#ffffff', 0.28));
  let disposed = false, rotationEnabled = false, time = EARTH_REFERENCE.rotation_epoch_unix_seconds;
  let baseTime = time, startedAt = performance.now(), representation = 'combined';
  let activeBackend = 'production', lastFrame = performance.now();
  let production;
  try {
    production = await createProductionEarth(viewport, device, geography, canvas, relief, () => time);
  } catch (error) {
    releaseReference();
    throw error;
  }
  const rotationData = { ...EARTH_REFERENCE, star_direction: sun.position.toArray() };
  const applyOrientation = () => {
    const frame = window.GQPlanetLivingWorld.bodyOrientation(rotationData, null, time);
    body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      ...earthReferenceBasis(frame.basis).map(vector => new THREE.Vector3(...vector))));
    body.updateMatrixWorld(true);
  };
  const views = { africa: [20, 15], americas: [-85, 15], asia: [120, 10],
    pacific: [180, 0], north: [0, 89.9], south: [0, -89.9],
    himalaya: [87, 30], andes: [-68.5, -22], mariana: [142.5, 11.5] };
  const setView = name => {
    const coordinate = views[name];
    if (!coordinate) throw new Error(`Unknown Earth reference view: ${name}`);
    applyOrientation();
    navigation.target.set(0, 0, 0);
    navigation.minDistance = 1.15;
    camera.near = 0.01;
    camera.updateProjectionMatrix();
    camera.position.copy(body.localToWorld(new THREE.Vector3(...geographicVector(...coordinate, 3.8))));
    navigation.update();
  };
  const inspectionOutput = document.getElementById('point-inspection');
  let pointerStart = null, inspection = null;
  const clearInspection = () => {
    inspection = null;
    inspectionOutput.hidden = true;
    inspectionOutput.textContent = '';
  };
  const inspectPoint = (clientX, clientY) => {
    if (disposed || activeBackend !== 'production' || production.source !== 'relief') {
      throw new Error('Point inspection requires the production ETOPO relief view');
    }
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) throw new TypeError('Invalid inspection screen coordinate');
    render();
    const rect = production.canvas.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1,
      1 - (clientY - rect.top) / rect.height * 2), camera);
    const basis = production.orbit._orientation.basis;
    const canonical = vector => basis.map(column => column.reduce((sum, n, i) => sum + n * vector.getComponent(i), 0));
    inspection = inspectReliefMesh(production.orbit._markerVertices,
      canonical(raycaster.ray.origin), canonical(raycaster.ray.direction),
      relief, production.reliefOptions, representation === 'texture');
    if (inspection) inspection.rows = production.rows;
    inspectionOutput.hidden = false;
    inspectionOutput.textContent = inspection
      ? `Punkt: ${inspection.longitude.toFixed(4)} E / ${inspection.latitude.toFixed(4)} N. `
        + `ETOPO: ${inspection.elevation.toFixed(0)} m; sichtbares Soll: ${inspection.expectedElevation.toFixed(0)} m. `
        + (inspection.textureOnly ? 'Texturvergleich: Kugel ohne Relief, kein Mesh-Hoehenvergleich.'
          : `Mesh: ${inspection.meshElevation.toFixed(0)} m; Abweichung: ${Math.round(inspection.meshError)} m (inklusive Dreieckssehne).`)
        + ` ${inspection.water ? 'Wasser nach ETOPO-Schwellwert.' : 'Kein Wasser nach ETOPO-Schwellwert.'} Mesh ${inspection.rows} Zeilen; Messung zum Klickzeitpunkt.`
      : 'Kein Oberflaechentreffer: Bitte auf den Globus klicken.';
    return inspection;
  };
  const pointerDown = event => {
    if (event.isPrimary && event.button === 0) pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
    else pointerStart = null;
  };
  const pointerMove = event => {
    if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) pointerStart.moved = true;
  };
  const pointerCancel = () => { pointerStart = null; };
  const pointerUp = event => {
    const start = pointerStart;
    pointerStart = null;
    if (!start || start.id !== event.pointerId || start.moved
      || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
      || activeBackend !== 'production' || production.source !== 'relief') return;
    inspectPoint(event.clientX, event.clientY);
  };
  const update = () => {
    clearInspection();
    const checked = name => controls.querySelector(`[name="${name}"]`).checked;
    activeBackend = controls.querySelector('[name="backend"]').value;
    const native = activeBackend === 'production';
    renderer.domElement.style.display = native ? 'none' : 'block';
    production.canvas.style.display = native ? 'block' : 'none';
    for (const name of ['coasts', 'wireframe', 'grid']) controls.querySelector(`[name="${name}"]`).disabled = native;
    for (const name of ['clouds', 'water', 'motion', 'gloss', 'sky', 'materialView', 'phase',
      'cloudMode', 'sunAzimuth', 'sunElevation', 'solarAtmosphere']) controls.querySelector(`[name="${name}"]`).disabled = !native;
    controls.querySelector('[name="cloudAltitude"]').disabled = !native || controls.querySelector('[name="cloudMode"]').value !== 'shell';
    controls.querySelector('[name="cloudShadows"]').disabled = !native || controls.querySelector('[name="cloudMode"]').value !== 'shell';
    const source = controls.querySelector('[name="source"]').value;
    const palette = controls.querySelector('[name="palette"]').value;
    controls.querySelector('[data-climate-legend]').hidden = native && source === 'relief' && palette !== 'surface';
    controls.querySelector('[data-elevation-legend]').hidden = !native || source !== 'relief' || palette !== 'height';
    controls.querySelector('[name="source"]').disabled = !native;
    for (const name of ['detail', 'exaggeration', 'seaLevel', 'ocean', 'palette', 'bump']) controls.querySelector(`[name="${name}"]`).disabled = !native || source !== 'relief';
    controls.querySelector('[name="cityLights"]').disabled = !native || source !== 'relief';
    for (const name of ['cityGeometry', 'visitCity', 'mineGeometry', 'visitMine',
      'facilityGeometry', 'facilityClass', 'facilityLevel', 'visitFacilities',
      'orbitalGeometry', 'orbitalClass', 'visitOrbital']) controls.querySelector(`[name="${name}"]`).disabled =
      !native || source !== 'relief' || controls.querySelector('[name="representation"]').value !== 'combined'
      || controls.querySelector('[name="materialView"]').value !== 'shaded';
    controls.querySelector('[name="cityMaterials"]').disabled = !native || source !== 'relief'
      || controls.querySelector('[name="representation"]').value === 'geometry'
      || controls.querySelector('[name="materialView"]').value === 'shaded';
    for (const name of ['developmentYear', 'developmentPlaying', 'economyProfile']) {
      controls.querySelector(`[name="${name}"]`).disabled = !native || source !== 'relief'
        || controls.querySelector('[name="representation"]').value === 'geometry'
        || controls.querySelector('[name="materialView"]').value !== 'shaded';
    }
    representation = controls.querySelector('[name="representation"]').value;
    textureSphere.visible = representation === 'texture';
    land.visible = lakes.visible = representation !== 'texture';
    ocean.visible = representation !== 'texture';
    land.material = representation === 'geometry' ? geometryMaterial : checked('lighting') ? landMaterial : flatMaterial;
    textureSphere.material = checked('lighting') ? landMaterial : flatMaterial;
    ocean.material = lakes.material = checked('lighting') && representation !== 'geometry' ? waterMaterial : waterFlat;
    wire.visible = checked('wireframe') && representation !== 'texture';
    coasts.visible = checked('coasts');
    grid.visible = checked('grid');
    atmosphere.visible = checked('atmosphere');
    baseTime = time;
    startedAt = performance.now();
    rotationEnabled = checked('rotation');
    production.update({
      representation, atmosphere: checked('atmosphere'), lighting: checked('lighting'),
      clouds: checked('clouds'), water: checked('water'), motion: checked('motion'),
      source, exaggeration: controls.querySelector('[name="exaggeration"]').value,
      detail: controls.querySelector('[name="detail"]').value,
      palette, bump: controls.querySelector('[name="bump"]').value,
      materialView: controls.querySelector('[name="materialView"]').value, gloss: checked('gloss'), sky: checked('sky'),
      cityMaterials: checked('cityMaterials'),
      cityGeometry: checked('cityGeometry'),
      mineGeometry: checked('mineGeometry'),
      facilityGeometry: checked('facilityGeometry'),
      facilityClass: controls.querySelector('[name="facilityClass"]').value,
      facilityLevel: controls.querySelector('[name="facilityLevel"]').value,
      orbitalGeometry: checked('orbitalGeometry'),
      phase: controls.querySelector('[name="phase"]').value,
      cloudMode: controls.querySelector('[name="cloudMode"]').value,
      cloudAltitude: controls.querySelector('[name="cloudAltitude"]').value,
      cloudShadows: checked('cloudShadows'),
      solarAtmosphere: checked('solarAtmosphere'),
      cityLights: checked('cityLights'),
      developmentYear: controls.querySelector('[name="developmentYear"]').value,
      developmentPlaying: checked('developmentPlaying'),
      economyProfile: controls.querySelector('[name="economyProfile"]').value,
      sunAzimuth: controls.querySelector('[name="sunAzimuth"]').value,
      sunElevation: controls.querySelector('[name="sunElevation"]').value,
      seaLevel: controls.querySelector('[name="seaLevel"]').value, ocean: checked('ocean'),
    });
  };
  const onChange = event => {
    update();
    if (event.target.name === 'view') setView(event.target.value);
  };
  const onInput = event => {
    if (event.target.name === 'developmentYear') update();
  };
  const reset = () => {
    clearInspection();
    time = baseTime = EARTH_REFERENCE.rotation_epoch_unix_seconds;
    startedAt = performance.now();
    setView(controls.querySelector('[name="view"]').value);
  };
  const visitCity = () => {
    controls.querySelector('[name="cityGeometry"]').checked = true;
    controls.querySelector('[name="motion"]').checked = false;
    controls.querySelector('[name="rotation"]').checked = false;
    controls.querySelector('[name="clouds"]').checked = false;
    controls.querySelector('[name="atmosphere"]').checked = false;
    controls.querySelector('[name="sky"]').checked = false;
    controls.querySelector('[name="exaggeration"]').value = '1';
    controls.querySelector('[name="detail"]').value = '180';
    controls.querySelector('[name="palette"]').value = 'surface';
    update();
    render();
    const geometry = production.cityGeometry;
    if (!geometry?.buildings.length) throw new Error('No dry-land buildings available for the city inspection');
    const radius = geometry.buildings.reduce((sum, b) => sum + b.foundationRadius, 0) / geometry.buildings.length;
    navigation.target.copy(body.localToWorld(new THREE.Vector3(...geographicVector(13.405, 52.52, radius))));
    camera.position.copy(body.localToWorld(new THREE.Vector3(...geographicVector(13.405, 52.52,
      radius + 2000 / (EARTH_REFERENCE.radiusKm * 1000)))));
    navigation.minDistance = 150 / (EARTH_REFERENCE.radiusKm * 1000);
    camera.near = 1 / (EARTH_REFERENCE.radiusKm * 1000);
    camera.updateProjectionMatrix();
    navigation.update();
  };
  const visitMine = () => {
    controls.querySelector('[name="mineGeometry"]').checked = true;
    for (const name of ['motion', 'rotation', 'clouds', 'atmosphere', 'sky']) {
      controls.querySelector(`[name="${name}"]`).checked = false;
    }
    controls.querySelector('[name="exaggeration"]').value = '1';
    controls.querySelector('[name="detail"]').value = '180';
    controls.querySelector('[name="palette"]').value = 'surface';
    controls.querySelector('[name="bump"]').value = '0';
    update();
    render();
    const mine = production.mineGeometry;
    if (!mine?.available) {
      const status = document.getElementById('reference-status');
      status.dataset.error = 'true';
      status.textContent = 'Tagebau nicht verfuegbar: Der Referenzstandort ist vom Meer bedeckt.';
      return;
    }
    const status = document.getElementById('reference-status');
    status.dataset.error = 'false';
    status.textContent = 'WebGPU bereit. Terrassierter Referenztagebau: ca. 4 x 3 km, 240 m tief.';
    clearInspection();
    const { longitude, latitude } = MINE_REFERENCE;
    navigation.target.copy(body.localToWorld(new THREE.Vector3(...geographicVector(longitude, latitude, mine.centreRadius))));
    camera.position.copy(body.localToWorld(new THREE.Vector3(...geographicVector(longitude, latitude,
      mine.centreRadius + 5000 / (EARTH_REFERENCE.radiusKm * 1000)))));
    navigation.minDistance = 400 / (EARTH_REFERENCE.radiusKm * 1000);
    camera.near = 1 / (EARTH_REFERENCE.radiusKm * 1000);
    camera.updateProjectionMatrix();
    navigation.update();
  };
  const visitFacilities = () => {
    controls.querySelector('[name="facilityGeometry"]').checked = true;
    for (const name of ['motion', 'rotation', 'clouds', 'atmosphere', 'sky']) {
      controls.querySelector(`[name="${name}"]`).checked = false;
    }
    controls.querySelector('[name="exaggeration"]').value = '1';
    controls.querySelector('[name="detail"]').value = '180';
    controls.querySelector('[name="palette"]').value = 'surface';
    controls.querySelector('[name="bump"]').value = '0';
    update();
    render();
    const facilities = production.facilityPlan;
    const status = document.getElementById('reference-status');
    if (!facilities.length) {
      status.dataset.error = 'true';
      status.textContent = 'Keine Referenzanlagen verfuegbar: Bestand ist null oder der Standort ist vom Meer bedeckt.';
      return;
    }
    const direction = facilities.reduce((sum, facility) => sum.map((n, i) => n + facility.direction[i]), [0, 0, 0]);
    const length = Math.hypot(...direction), up = direction.map(n => n / length);
    const mesh = production.surface.mesh(1000);
    const hit = inspectReliefMesh(mesh.vertices, up.map(n => n * 2), up.map(n => -n), relief, production.reliefOptions);
    if (!hit || hit.water) throw new Error('No dry rendered terrain beneath the facility inspection target');
    const r = EARTH_REFERENCE.radiusKm * 1000;
    const radius = 1 + hit.meshElevation * production.reliefOptions.exaggeration / r;
    const height = facilities.length > 1 ? 8000 : 1000;
    navigation.target.copy(body.localToWorld(new THREE.Vector3(...up.map(n => n * radius))));
    camera.position.copy(body.localToWorld(new THREE.Vector3(...up.map(n => n * (radius + height / r)))));
    navigation.minDistance = 100 / r;
    camera.near = 1 / r;
    camera.updateProjectionMatrix();
    navigation.update();
    render();
    if (!document.hidden && !production.facilityGeometry?.parts.length) {
      status.dataset.error = 'true';
      status.textContent = 'Keine trockenen, ausreichend flachen Anlagenfundamente am Referenzstandort.';
      return;
    }
    status.dataset.error = 'false';
    status.textContent = document.hidden
      ? 'Anlagenansicht vorbereitet. Die Darstellung wird bei sichtbarem Fenster fortgesetzt.'
      : `WebGPU bereit. ${facilities.length} synthetische Anlagenfamilien; massstaebliche Geometrie und gemeinsame Flaechenmaterialien.`;
  };
  const visitOrbital = () => {
    controls.querySelector('[name="orbitalGeometry"]').checked = true;
    for (const name of ['rotation', 'clouds', 'atmosphere', 'sky']) controls.querySelector(`[name="${name}"]`).checked = false;
    update();
    render();
    const object = production.orbitalPlan.objects.find(entry => entry.type === controls.querySelector('[name="orbitalClass"]').value);
    if (!object) throw new Error(`Orbital inspection unavailable: ${production.orbitalPlan.orbit.reason}`);
    const local = window.GQColonyOrbitals.position(production.orbitalPlan, object, time);
    const basis = production.orbit._orientation.basis;
    const rotate = p => [0, 1, 2].map(i => basis.reduce((sum, axis, j) => sum + axis[i] * p[j], 0));
    const radius = production.orbitalPlan.radiusMeters;
    navigation.target.set(...rotate(local.center));
    camera.position.set(...rotate(local.center.map((v, i) => v + (local.up[i] * 1200 + local.north[i] * 700) / radius)));
    navigation.minDistance = 30 / radius;
    camera.near = 1 / radius;
    camera.updateProjectionMatrix();
    navigation.update();
    render();
    const status = document.getElementById('reference-status');
    status.dataset.error = 'false';
    status.textContent = `${object.label}: ${Math.round(production.orbitalPlan.orbit.altitudeMeters / 1000)} km `
      + 'ueber der Erde, geostationaer. Echte Meterabmessungen; Shuttles sind kosmetischer Serviceverkehr.';
  };
  const resize = () => {
    clearInspection();
    const width = Math.max(1, viewport.clientWidth), height = Math.max(1, viewport.clientHeight);
    renderer.setSize(width, height, false);
    production.resize(renderer.domElement.width, renderer.domElement.height);
    const panelRight = width > 900 ? controls.getBoundingClientRect().right + 12 : 0;
    const radiusPixels = Math.min(height * 0.43, (width - panelRight) * 0.46);
    camera.aspect = width / height;
    camera.fov = 2 * Math.atan(height / (2 * radiusPixels) * 1.025 / Math.sqrt(3.8 ** 2 - 1.025 ** 2)) * 180 / Math.PI;
    camera.updateProjectionMatrix();
    if (panelRight) camera.setViewOffset(width, height, -panelRight / 2, 0, width, height);
    else camera.clearViewOffset();
  };
  const onGPUError = event => {
    renderer.setAnimationLoop(null);
    const status = document.getElementById('reference-status');
    status.dataset.error = 'true';
    status.textContent = `WebGPU error: ${event.error.message}`;
    document.documentElement.dataset.referenceReady = 'error';
  };
  const render = () => {
    if (disposed) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (rotationEnabled) time = baseTime + (now - startedAt) / 1000;
    applyOrientation();
    // A metre near plane at orbital distance collapses front/back terrain depth.
    const near = Math.max(1 / (EARTH_REFERENCE.radiusKm * 1000),
      Math.min(0.01, camera.position.distanceTo(navigation.target) * 0.01));
    if (camera.near !== near) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    if (activeBackend === 'production') production.render(dt, camera);
    else renderer.render(scene, camera);
    const development = production.development;
    if (development) {
      controls.querySelector('[name="developmentYear"]').value = String(development.year);
      controls.querySelector('[data-development-status]').textContent =
        `Jahr ${development.year.toFixed(1)}: ${(development.population / 1000000).toFixed(1)} Mio.; `
        + `${development.cities} Stadtkerne, ${(development.ruralPopulation / 1000000).toFixed(1)} Mio. laendlich (synthetisch)`;
    }
    const diagnostics = document.getElementById('render-diagnostics');
    const coordinate = views[controls.querySelector('[name="view"]').value];
    const height = relief.sample(...coordinate);
    const message = activeBackend === 'production'
      ? `Produktionspfad: PersistentBodyPlanetApproachRenderer. ${production.source === 'relief'
        ? `ETOPO1 0,5 Grad; Relief ${production.reliefOptions.exaggeration}x; Meer ${production.reliefOptions.seaLevel} m. Kontrollpunkt der Ansicht (${coordinate.join(', ')}): ${height.toFixed(0)} m, rasterinterpoliert.`
        : 'Natural-Earth-Kuesten.'} LOD ${production.rows} (${production.detail === 'auto' ? 'automatisch' : 'fest'}); ${production.orbit._solidVertexCount / 3} Dreiecke; Mesh-Cache ${(production.cacheBytes / 1048576).toFixed(1)} / 32 MiB.`
      : 'Basisvergleich: Natural-Earth-Polygone ohne DEM; separates Three.js-WebGPU-Material.';
    if (diagnostics && diagnostics.textContent !== message) diagnostics.textContent = message;
  };
  const resetButton = controls.querySelector('[name="reset"]');
  const visitCityButton = controls.querySelector('[name="visitCity"]');
  const visitMineButton = controls.querySelector('[name="visitMine"]');
  const visitFacilitiesButton = controls.querySelector('[name="visitFacilities"]');
  const visitOrbitalButton = controls.querySelector('[name="visitOrbital"]');
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    controls.removeEventListener('change', onChange);
    controls.removeEventListener('input', onInput);
    resetButton.removeEventListener('click', reset);
    visitCityButton.removeEventListener('click', visitCity);
    visitMineButton.removeEventListener('click', visitMine);
    visitFacilitiesButton.removeEventListener('click', visitFacilities);
    visitOrbitalButton.removeEventListener('click', visitOrbital);
    viewport.removeEventListener('pointerdown', pointerDown);
    viewport.removeEventListener('pointermove', pointerMove);
    viewport.removeEventListener('pointerup', pointerUp);
    viewport.removeEventListener('pointercancel', pointerCancel);
    window.removeEventListener('resize', resize);
    device.removeEventListener('uncapturederror', onGPUError);
    production.dispose();
    releaseReference();
  };
  controls.addEventListener('change', onChange);
  controls.addEventListener('input', onInput);
  resetButton.addEventListener('click', reset);
  visitCityButton.addEventListener('click', visitCity);
  visitMineButton.addEventListener('click', visitMine);
  visitFacilitiesButton.addEventListener('click', visitFacilities);
  visitOrbitalButton.addEventListener('click', visitOrbital);
  viewport.addEventListener('pointerdown', pointerDown);
  viewport.addEventListener('pointermove', pointerMove);
  viewport.addEventListener('pointerup', pointerUp);
  viewport.addEventListener('pointercancel', pointerCancel);
  window.addEventListener('resize', resize);
  device.addEventListener('uncapturederror', onGPUError);
  try {
    update();
    setView('africa');
    resize();
    render();
    renderer.setAnimationLoop(render);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    renderer, device, scene, camera, body, geography, relief, textureCanvas: canvas, production,
    land, lakes, ocean, textureSphere, wire, coasts, grid, atmosphere, render, setView,
    get time() { return time; },
    get representation() { return representation; },
    get activeBackend() { return activeBackend; },
    get inspection() { return inspection; },
    inspectPoint,
    dispose,
  };
}

const viewport = document.getElementById('reference-viewport');
const controls = document.getElementById('reference-controls');
const status = document.getElementById('reference-status');
if (viewport && controls && status) {
  try {
    const reference = await createEarthReference(viewport, controls);
    window.GQEarthReference = reference;
    window.addEventListener('pagehide', () => reference.dispose(), { once: true });
    status.textContent = `WebGPU bereit. Produktionsrenderer + Basisvergleich. ${reference.geography.land.length} Landpolygone, ${reference.geography.lakes.length} Seen. Textur 2048 x 1024.`;
    document.documentElement.dataset.referenceReady = 'true';
  } catch (error) {
    status.dataset.error = 'true';
    status.textContent = `Erd-Referenz nicht verfuegbar: ${error.message}`;
    document.documentElement.dataset.referenceReady = 'error';
  }
}
