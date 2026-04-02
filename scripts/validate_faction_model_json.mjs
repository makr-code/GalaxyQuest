#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MODELS_DIR = path.join(ROOT, 'models');
const SCHEMA_PATH = path.join(ROOT, 'models', 'schema', 'gq-faction-object.schema.json');
const FRACTIONS_DIR = path.join(ROOT, 'fractions');

const ALLOWED_GEOMETRIES = new Set([
  'BoxGeometry',
  'SphereGeometry',
  'CylinderGeometry',
  'TorusGeometry',
  'RingGeometry',
  'OctahedronGeometry'
]);

const ALLOWED_OBJECT_CLASSES = new Set([
  'ship',
  'station',
  'base',
  'building',
  'defense_platform',
  'relay_or_sensor'
]);

const ALLOWED_MATERIAL_TYPES = new Set([
  'MeshStandardMaterial',
  'MeshPhongMaterial'
]);

const MATERIAL_MAP_KEYS = [
  'map',
  'emissiveMap',
  'normalMap',
  'bumpMap',
  'specularMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'alphaMap'
];

const ALLOWED_LIGHT_TYPES = new Set([
  'AmbientLight',
  'DirectionalLight',
  'HemisphereLight',
  'PointLight',
  'SpotLight',
  'RectAreaLight'
]);

const ALLOWED_VFX_KINDS = new Set(['thruster', 'muzzle', 'impact', 'trail', 'debris']);
const ALLOWED_VFX_MODES = new Set(['continuous', 'burst']);
const ALLOWED_WEAPON_FX_KINDS = new Set(['beam', 'plasma', 'rail', 'missile']);

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getFactionCodes() {
  const codes = new Set();
  for (const entry of fs.readdirSync(FRACTIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const specPath = path.join(FRACTIONS_DIR, entry.name, 'spec.json');
    if (!fs.existsSync(specPath)) continue;
    try {
      const spec = readJson(specPath);
      const code = typeof spec.species_code === 'string' ? spec.species_code : spec.faction_code;
      if (typeof code === 'string' && code.length > 0) {
        codes.add(code);
      }
    } catch {
      // Ignore broken spec files for now; CI should fail where appropriate.
    }
  }
  return codes;
}

function collectModelFiles() {
  const direct = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(MODELS_DIR, full);

      if (entry.isDirectory()) {
        if (rel === 'schema') continue;
        walk(full);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.json')) {
        direct.push(full);
      }
    }
  }

  walk(MODELS_DIR);

  const userArgs = process.argv
    .slice(2)
    .filter((a) => a.endsWith('.json'));
  if (userArgs.length > 0) {
    return userArgs.map((p) => path.resolve(ROOT, p));
  }
  return direct;
}

function validateModel(model, filePath, factionCodes, options = {}) {
  const errors = [];
  const warnings = [];
  const push = (msg) => errors.push(`${path.relative(ROOT, filePath)}: ${msg}`);
  const warn = (msg) => warnings.push(`${path.relative(ROOT, filePath)}: ${msg}`);

  if (!isObject(model)) {
    push('root must be an object');
    return { errors, warnings };
  }

  if (!isObject(model.metadata)) push('metadata missing or invalid');
  else {
    if (model.metadata.type !== 'Object') push('metadata.type must be Object');
    if (model.metadata.version !== 4.6) push('metadata.version must be 4.6');
  }

  if (typeof model.modelId !== 'string' || model.modelId.length < 3) push('modelId missing or too short');
  if (typeof model.label !== 'string' || model.label.length < 1) push('label missing');

  if (!isObject(model.lod)) push('lod missing or invalid');
  else {
    const full = model.lod.segments_full;
    const low = model.lod.segments_low;
    if (!Number.isInteger(full) || full < 3) push('lod.segments_full must be integer >= 3');
    if (!Number.isInteger(low) || low < 3) push('lod.segments_low must be integer >= 3');
    if (Number.isInteger(full) && Number.isInteger(low) && low > full) {
      push('lod.segments_low should be <= lod.segments_full');
    }
  }

  if (!Array.isArray(model.geometries) || model.geometries.length === 0) {
    push('geometries must be a non-empty array');
  }

  const geoUuids = new Set();
  for (const g of Array.isArray(model.geometries) ? model.geometries : []) {
    if (!isObject(g)) {
      push('geometry entry must be an object');
      continue;
    }
    if (typeof g.uuid !== 'string' || !g.uuid.startsWith('geo_')) {
      push('geometry.uuid must start with geo_');
    } else {
      geoUuids.add(g.uuid);
    }
    if (!ALLOWED_GEOMETRIES.has(g.type)) {
      push(`geometry.type not allowed: ${String(g.type)}`);
    }
  }

  if (!Array.isArray(model.materials) || model.materials.length === 0) {
    push('materials must be a non-empty array');
  }

  const textureUuids = new Set();
  for (const t of Array.isArray(model.textures) ? model.textures : []) {
    if (isObject(t) && typeof t.uuid === 'string') {
      textureUuids.add(t.uuid);
    }
  }

  const matUuids = new Set();
  for (const m of Array.isArray(model.materials) ? model.materials : []) {
    if (!isObject(m)) {
      push('material entry must be an object');
      continue;
    }
    if (typeof m.uuid !== 'string' || !m.uuid.startsWith('mat_')) {
      push('material.uuid must start with mat_');
    } else {
      matUuids.add(m.uuid);
    }

    if (!ALLOWED_MATERIAL_TYPES.has(m.type)) {
      push(`material.type not allowed: ${String(m.type)}`);
    }

    for (const mapKey of MATERIAL_MAP_KEYS) {
      if (Object.prototype.hasOwnProperty.call(m, mapKey)) {
        const ref = m[mapKey];
        if (typeof ref !== 'string' || ref.length < 1) {
          push(`material.${mapKey} must reference a texture uuid`);
        } else if (!textureUuids.has(ref)) {
          push(`material.${mapKey} references missing texture: ${ref}`);
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(m, 'bumpScale')) {
      if (typeof m.bumpScale !== 'number' || m.bumpScale < 0 || m.bumpScale > 8) {
        push('material.bumpScale must be between 0 and 8');
      }
    }

    if (Object.prototype.hasOwnProperty.call(m, 'normalScale')) {
      const ns = m.normalScale;
      if (!Array.isArray(ns) || ns.length !== 2 || typeof ns[0] !== 'number' || typeof ns[1] !== 'number') {
        push('material.normalScale must be [x, y]');
      }
    }

    if (m.type === 'MeshPhongMaterial') {
      if (Object.prototype.hasOwnProperty.call(m, 'shininess')) {
        if (typeof m.shininess !== 'number' || m.shininess < 0 || m.shininess > 256) {
          push('material.shininess must be between 0 and 256');
        }
      }
    }
  }

  if (!isObject(model.object)) {
    push('object missing or invalid');
    return { errors, warnings };
  }

  if (model.object.type !== 'Group') push('object.type must be Group');
  if (!Array.isArray(model.object.children) || model.object.children.length === 0) {
    push('object.children must be a non-empty array');
  }

  const semantics = model.object?.userData?.gqModelSemantics;
  if (!isObject(semantics)) {
    if (options.strict) push('object.userData.gqModelSemantics missing');
    else warn('object.userData.gqModelSemantics missing (legacy model; allowed in non-strict mode)');
  } else {
    if (!factionCodes.has(semantics.factionCode)) {
      push(`invalid factionCode: ${String(semantics.factionCode)}`);
    }
    if (!ALLOWED_OBJECT_CLASSES.has(semantics.objectClass)) {
      push(`invalid objectClass: ${String(semantics.objectClass)}`);
    }
    if (semantics.designLanguageVersion !== 'egl-1.0') {
      push('designLanguageVersion must be egl-1.0');
    }
    if (!Array.isArray(semantics.silhouetteTags) || semantics.silhouetteTags.length < 2) {
      push('silhouetteTags must contain at least 2 entries');
    }
    if (!Array.isArray(semantics.signatureParts) || semantics.signatureParts.length < 2) {
      push('signatureParts must contain at least 2 entries');
    }
  }

  const vfxEmitters = model.object?.userData?.gqVfxEmitters;
  if (typeof vfxEmitters !== 'undefined') {
    if (!Array.isArray(vfxEmitters)) {
      push('object.userData.gqVfxEmitters must be an array');
    } else {
      for (const e of vfxEmitters) {
        if (!isObject(e)) {
          push('gqVfxEmitters entries must be objects');
          continue;
        }
        if (!ALLOWED_VFX_KINDS.has(e.kind)) push(`gqVfxEmitter.kind invalid: ${String(e.kind)}`);
        if (!ALLOWED_VFX_MODES.has(e.mode)) push(`gqVfxEmitter.mode invalid: ${String(e.mode)}`);
        if (typeof e.id !== 'string' || e.id.length < 3) push('gqVfxEmitter.id missing/invalid');
        if (typeof e.attachTo !== 'string' || e.attachTo.length < 2) push('gqVfxEmitter.attachTo missing/invalid');
        if (!Array.isArray(e.position) || e.position.length !== 3) push('gqVfxEmitter.position must be [x,y,z]');
        if (!Array.isArray(e.direction) || e.direction.length !== 3) push('gqVfxEmitter.direction must be [x,y,z]');
        if (typeof e.count !== 'number' || e.count <= 0 || e.count > 500) push('gqVfxEmitter.count must be in range 1..500');
        if (typeof e.lifetime !== 'number' || e.lifetime <= 0 || e.lifetime > 30) push('gqVfxEmitter.lifetime must be in range >0..30');
        if (typeof e.speed !== 'number' || e.speed < 0 || e.speed > 200) push('gqVfxEmitter.speed must be in range 0..200');
        if (Object.prototype.hasOwnProperty.call(e, 'spread')) {
          if (typeof e.spread !== 'number' || e.spread < 0 || e.spread > Math.PI) {
            push('gqVfxEmitter.spread must be in range 0..PI');
          }
        }
        if (Object.prototype.hasOwnProperty.call(e, 'colorStart')) {
          if (!Number.isInteger(e.colorStart) || e.colorStart < 0 || e.colorStart > 16777215) {
            push('gqVfxEmitter.colorStart must be RGB int 0..16777215');
          }
        }
        if (Object.prototype.hasOwnProperty.call(e, 'colorEnd')) {
          if (!Number.isInteger(e.colorEnd) || e.colorEnd < 0 || e.colorEnd > 16777215) {
            push('gqVfxEmitter.colorEnd must be RGB int 0..16777215');
          }
        }
      }
    }
  }

  const weaponFx = model.object?.userData?.gqWeaponFx;
  if (typeof weaponFx !== 'undefined') {
    if (!Array.isArray(weaponFx)) {
      push('object.userData.gqWeaponFx must be an array');
    } else {
      for (const w of weaponFx) {
        if (!isObject(w)) {
          push('gqWeaponFx entries must be objects');
          continue;
        }
        if (!ALLOWED_WEAPON_FX_KINDS.has(w.kind)) push(`gqWeaponFx.kind invalid: ${String(w.kind)}`);
        if (typeof w.id !== 'string' || w.id.length < 3) push('gqWeaponFx.id missing/invalid');
        if (typeof w.from !== 'string' || w.from.length < 2) push('gqWeaponFx.from missing/invalid');
        if (typeof w.to !== 'string' || w.to.length < 2) push('gqWeaponFx.to missing/invalid');
        if (!Number.isInteger(w.coreColor) || w.coreColor < 0 || w.coreColor > 16777215) push('gqWeaponFx.coreColor must be RGB int 0..16777215');
        if (!Number.isInteger(w.glowColor) || w.glowColor < 0 || w.glowColor > 16777215) push('gqWeaponFx.glowColor must be RGB int 0..16777215');
        if (typeof w.glowRadius !== 'number' || w.glowRadius <= 0 || w.glowRadius > 10) push('gqWeaponFx.glowRadius must be in range >0..10');
        if (typeof w.alpha !== 'number' || w.alpha < 0 || w.alpha > 1) push('gqWeaponFx.alpha must be in range 0..1');
      }
    }
  }

  function validateNode(node) {
    if (!isObject(node)) {
      push('child entry must be an object');
      return;
    }

    if (typeof node.type !== 'string' || node.type.length < 1) {
      push('child.type is required');
      return;
    }

    if (node.type === 'Mesh') {
      if (typeof node.geometry !== 'string' || !geoUuids.has(node.geometry)) {
        push(`child geometry missing reference: ${String(node.geometry)}`);
      }
      if (typeof node.material !== 'string' || !matUuids.has(node.material)) {
        push(`child material missing reference: ${String(node.material)}`);
      }
      if (!isObject(node.userData) || typeof node.userData.role !== 'string' || node.userData.role.length < 2) {
        push('child.userData.role is required for Mesh');
      }
    } else if (node.type === 'Group') {
      if (!Array.isArray(node.children)) {
        push('Group child must contain children array');
      }
    } else if (ALLOWED_LIGHT_TYPES.has(node.type)) {
      if (typeof node.intensity !== 'number' || node.intensity < 0) {
        push(`light intensity invalid on ${String(node.name || node.uuid || 'light')}`);
      }
      if (typeof node.color !== 'number' || node.color < 0 || node.color > 16777215) {
        push(`light color invalid on ${String(node.name || node.uuid || 'light')}`);
      }
    } else {
      push(`child.type not supported: ${node.type}`);
    }

    if (Array.isArray(node.children)) {
      for (const nested of node.children) validateNode(nested);
    }
  }

  for (const c of Array.isArray(model.object.children) ? model.object.children : []) {
    validateNode(c);
  }

  const clipNames = (Array.isArray(model.animations) ? model.animations : [])
    .map((a) => (isObject(a) ? a.name : ''))
    .filter((n) => typeof n === 'string');

  const hasIdle = clipNames.some((n) => n.startsWith('idle_'));
  const hasActive = clipNames.some((n) => n.startsWith('active_'));
  const hasAlert = clipNames.some((n) => n.startsWith('alert_'));
  const hasGqAnimations = Array.isArray(model.object?.userData?.gqAnimations) && model.object.userData.gqAnimations.length > 0;

  if (!(hasIdle && hasActive && hasAlert) && !hasGqAnimations) {
    push('require idle_/active_/alert_ clips OR non-empty object.userData.gqAnimations');
  }

  return { errors, warnings };
}

function main() {
  const strict = process.argv.includes('--strict');

  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(`Missing schema: ${path.relative(ROOT, SCHEMA_PATH)}`);
    process.exit(2);
  }

  // Parse schema file to ensure JSON integrity even when not using a full JSON-schema engine.
  try {
    readJson(SCHEMA_PATH);
  } catch (e) {
    console.error(`Invalid schema JSON at ${path.relative(ROOT, SCHEMA_PATH)}: ${e.message}`);
    process.exit(2);
  }

  const factionCodes = getFactionCodes();
  if (factionCodes.size === 0) {
    console.error('No faction codes found in fractions/*/spec.json');
    process.exit(2);
  }

  const files = collectModelFiles();
  if (files.length === 0) {
    console.log('No model JSON files found.');
    process.exit(0);
  }

  let allErrors = [];
  let allWarnings = [];
  let checked = 0;

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      allErrors.push(`${path.relative(ROOT, filePath)}: file not found`);
      continue;
    }

    let model;
    try {
      model = readJson(filePath);
    } catch (e) {
      allErrors.push(`${path.relative(ROOT, filePath)}: invalid JSON (${e.message})`);
      continue;
    }

    checked += 1;
    const result = validateModel(model, filePath, factionCodes, { strict });
    allErrors = allErrors.concat(result.errors);
    allWarnings = allWarnings.concat(result.warnings);
  }

  if (allWarnings.length > 0) {
    console.warn(`Validation warnings: ${allWarnings.length} warning(s).`);
    for (const warning of allWarnings) console.warn(`- ${warning}`);
  }

  if (allErrors.length > 0) {
    console.error(`Validation failed: ${allErrors.length} issue(s) across ${checked} file(s).`);
    for (const err of allErrors) console.error(`- ${err}`);
    process.exit(1);
  }

  console.log(`Validation passed: ${checked} file(s) checked.${strict ? ' (strict mode)' : ''}`);
}

main();
