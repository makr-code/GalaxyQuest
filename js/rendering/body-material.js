(function () {
  'use strict';

  const PRESETS = {
    terran: { base: [0.24, 0.42, 0.21], accent: [0.48, 0.46, 0.35], roughness: 0.85 },
    ocean: { base: [0.07, 0.28, 0.44], accent: [0.12, 0.38, 0.49], roughness: 0.18 },
    ice: { base: [0.58, 0.74, 0.82], accent: [0.85, 0.91, 0.94], roughness: 0.38 },
    desert: { base: [0.67, 0.46, 0.24], accent: [0.79, 0.64, 0.42], roughness: 0.92 },
    lava: { base: [0.24, 0.19, 0.18], accent: [0.39, 0.24, 0.16], roughness: 0.8 },
    rock: { base: [0.4, 0.39, 0.37], accent: [0.57, 0.52, 0.45], roughness: 0.9 },
    gas: { base: [0.48, 0.42, 0.58], accent: [0.68, 0.59, 0.73], roughness: 1 },
  };
  const BIOMES = Object.keys(PRESETS);
  const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const srgbToLinear = (value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const linearToSrgb = (value) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

  function materialLod(projectedDiameter) {
    if (!Number.isFinite(projectedDiameter) || projectedDiameter < 0) throw new RangeError('Invalid material pixel diameter');
    return {
      macro: smooth(2, 12, projectedDiameter),
      meso: smooth(24, 120, projectedDiameter),
      micro: smooth(160, 800, projectedDiameter),
    };
  }

  function resolveBodyMaterial(source = {}, manifest = null) {
    const kind = String(`${source.body_type || ''} ${source.biome || source.planet_class || source.planet_type || ''}`).toLowerCase();
    const biome = manifest?.biome || (/gas|jovian|giant/.test(kind) ? 'gas'
      : /ice|frost|tundra|comet/.test(kind) ? 'ice'
        : /lava|volcan|molten/.test(kind) ? 'lava'
          : /desert|arid/.test(kind) ? 'desert' : /ocean|water/.test(kind) ? 'ocean'
            : /rock|moon|asteroid|barren/.test(kind) ? 'rock' : 'terran');
    if (!PRESETS[biome]) throw new TypeError('Unsupported body material biome');
    const identity = manifest?.seed ?? source.terrain_seed ?? source.seed ?? source.body_id ?? source.planet_id ?? source.id ?? biome;
    let hash = 2166136261;
    for (const character of String(identity)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    const preset = PRESETS[biome];
    const base = preset.base.map(srgbToLinear), accent = preset.accent.map(srgbToLinear);
    const diameter = Number(source.diameter_km ?? source.diameter ?? 0);
    if (!Number.isFinite(diameter) || diameter < 0) throw new RangeError('Invalid body material diameter');
    const radiusKm = manifest?.radius_km ?? (diameter > 0 ? diameter / 2 : /comet|asteroid/.test(kind) ? 6 : /moon/.test(kind) ? 1737 : 1500);
    if (!Number.isFinite(radiusKm) || radiusKm < 0) throw new RangeError('Invalid body material radius');
    return {
      version: 1, biome, seed: hash / 4294967296 * 100,
      radiusMeters: radiusKm * 1000, base, accent,
      mean: base.map((n, axis) => (n + accent[axis]) / 2),
      roughness: preset.roughness, metallic: 0, normalStrength: biome === 'gas' ? 0 : 0.22,
      emission: biome === 'lava' ? [1, 0.08, 0.005] : [0, 0, 0],
    };
  }

  function materialUniforms(material, projectedDiameter, anchorMeters = [0, 0, 0], water = null) {
    materialLod(projectedDiameter);
    if (!Array.isArray(anchorMeters) || anchorMeters.length !== 3 || !anchorMeters.every(Number.isFinite)) {
      throw new TypeError('Invalid body material anchor');
    }
    if (water !== null && (!Number.isFinite(water.seconds) || water.seconds < 0 || typeof water.enabled !== 'boolean')) {
      throw new TypeError('Invalid water animation state');
    }
    const data = new Float32Array(28);
    data.set([...material.base, material.roughness], 0);
    data.set([...material.accent, material.metallic], 4);
    data.set([...material.emission, 1], 8);
    data.set([material.seed, material.radiusMeters, projectedDiameter, material.normalStrength], 12);
    data.set([...material.mean, BIOMES.indexOf(material.biome)], 16);
    const cells = anchorMeters.map((n) => Math.floor(n / 128));
    if (cells.some((n) => Math.abs(n) > 4000000)) throw new RangeError('Body material anchor exceeds supported coordinate range');
    data.set(anchorMeters.map((n, axis) => n - cells[axis] * 128), 20);
    data[23] = (water?.seconds ?? 0) % 120;
    new Int32Array(data.buffer).set(cells, 24);
    new Int32Array(data.buffer)[27] = water?.enabled ? 1 : 0;
    return data;
  }

  function terrainBoundaries(biome, elevation, amplitude, seaLevel = 0) {
    if (![elevation, amplitude, seaLevel].every(Number.isFinite) || amplitude < 0 || !PRESETS[biome]) {
      throw new TypeError('Invalid terrain material boundaries');
    }
    return [elevation - seaLevel, biome === 'ice' ? 1 : elevation - amplitude * 0.55,
      ['terran', 'ocean', 'lava'].includes(biome) ? biome === 'lava' ? 3 : 1 : 0,
      ['terran', 'ice'].includes(biome) ? 1 : 0];
  }

  const CLOUD_WGSL = `
fn gqCloudHash(cell: vec3<i32>, seed: u32) -> f32 {
  let c = bitcast<vec3<u32>>(cell);
  var h = (c.x * 1597334677u) ^ (c.y * 3812015801u) ^ (c.z * 2798796415u) ^ seed;
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return f32((h ^ (h >> 16u)) & 16777215u) / 16777215.0;
}
fn gqCloudField(point: vec3<f32>, seed: u32) -> f32 {
  let cell = vec3<i32>(floor(point));
  let f = fract(point);
  let t = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(gqCloudHash(cell,seed),gqCloudHash(cell + vec3<i32>(1,0,0),seed),t.x),
      mix(gqCloudHash(cell + vec3<i32>(0,1,0),seed),gqCloudHash(cell + vec3<i32>(1,1,0),seed),t.x),t.y),
    mix(mix(gqCloudHash(cell + vec3<i32>(0,0,1),seed),gqCloudHash(cell + vec3<i32>(1,0,1),seed),t.x),
      mix(gqCloudHash(cell + vec3<i32>(0,1,1),seed),gqCloudHash(cell + vec3<i32>(1,1,1),seed),t.x),t.y),t.z);
}
fn gqCloudNoise(point: vec3<f32>, seconds: f32, seed: f32, footprint: f32) -> f32 {
  let phase = seconds * (6.28318530718 / 120.0);
  let drift = vec3<f32>(cos(phase),sin(phase),sin(phase + 0.7)) * 0.8;
  let p = point + vec3<f32>(seed * 0.17,seed * 0.31,seed * 0.23) + drift;
  let warp = vec3<f32>(
    sin(p.y * 0.7 + phase * 2.0),
    sin(p.z * 0.8 - phase * 2.0 + 1.3),
    cos(p.x * 0.6 + phase * 3.0)) * 0.45;
  let q = p + warp;
  let identity = u32(seed);
  let weather = gqCloudField(q * 0.45,identity);
  let billows = gqCloudField(q * 1.8,identity + 101u);
  let erosion = gqCloudField(q * 5.4,identity + 239u);
  // Warped frontal ribbons coexist with rounded, broken convective fields.
  let front = 1.0 - abs(sin(q.x * 0.65 + q.z * 0.3 + weather * 5.0));
  let frontal = smoothstep(0.45,0.75,weather);
  let broad = (weather - 0.5) * 0.95 + (front - 0.5) * frontal * 0.35;
  let detail = (billows - 0.5) * 0.55;
  let broadWeight = 1.0 - smoothstep(0.5,1.5,footprint);
  let detailWeight = 1.0 - smoothstep(0.15,0.6,footprint);
  let erosionWeight = 1.0 - smoothstep(0.04,0.2,footprint);
  return clamp(0.5 + broad * broadWeight + detail * detailWeight
    + (erosion - 0.5) * 0.22 * erosionWeight,0.0,1.0);
}
fn gqCloudCoverage(density: f32, coverage: f32) -> f32 {
  return smoothstep(1.0 - coverage,1.02,density) * min(1.0,coverage * 4.0);
}
// Single-sheet optical relief, not a volumetric light integral.
fn gqCloudRelief(cloud: f32, sunward: f32, solarCosine: f32) -> f32 {
  let grazing = 1.0 - clamp(solarCosine,0.0,1.0);
  let occluder = max(0.0,sunward - cloud * 0.35);
  return 1.0 - 0.45 * (1.0 - exp(-occluder * 2.0)) * grazing
    * smoothstep(0.02,0.3,cloud);
}
`;

  const ATMOSPHERE_WGSL = `
// Illustrative orbital tint/weight, not an optical scattering solution.
fn gqOrbitalAtmosphere(normal: vec3<f32>, sun: vec3<f32>) -> vec4<f32> {
  let mu = dot(normal,sun);
  let daylight = smoothstep(0.0,0.35,mu);
  let twilight = (1.0 - smoothstep(0.0,0.22,abs(mu))) * smoothstep(-0.18,-0.02,mu);
  let tint = mix(vec3<f32>(0.08,0.3,0.62),vec3<f32>(0.92,0.24,0.055),twilight * (1.0 - daylight));
  return vec4<f32>(tint,max(daylight,twilight * 0.65));
}
`;
  const WGSL = `${CLOUD_WGSL}
${ATMOSPHERE_WGSL}
struct GQMaterialUniforms {
  base: vec4<f32>, accent: vec4<f32>, emission: vec4<f32>,
  scale: vec4<f32>, mean: vec4<f32>, anchor: vec4<f32>, origin: vec4<i32>,
};
@group(0) @binding(2) var<uniform> gqMaterial: GQMaterialUniforms;
struct GQSurface {
  albedo: vec3<f32>, normal: vec3<f32>, roughness: f32,
  metallic: f32, emission: vec3<f32>,
};
fn gqSrgb(value: vec3<f32>) -> vec3<f32> {
  let c = clamp(value,vec3<f32>(0),vec3<f32>(1));
  return select(1.055 * pow(c,vec3<f32>(1.0 / 2.4)) - 0.055,c * 12.92,c <= vec3<f32>(0.0031308));
}
fn gqLinear(c: vec3<f32>) -> vec3<f32> {
  return select(pow((c + 0.055) / 1.055,vec3<f32>(2.4)),c / 12.92,c <= vec3<f32>(0.04045));
}
fn gqTerrainMasks(boundaries: vec4<f32>) -> vec3<f32> {
  // Signed elevations interpolate; categorical material IDs must never interpolate.
  let gradient = fwidth(boundaries.xy);
  let pixel = max(gradient,vec2<f32>(0.000001)) * 0.5;
  let wet = select(1.0 - smoothstep(-pixel.x,pixel.x,boundaries.x),
    select(0.0,1.0,boundaries.x < 0.0),gradient.x == 0.0);
  let frozen = select(smoothstep(-pixel.y,pixel.y,boundaries.y),
    select(0.0,1.0,boundaries.y > 0.0),gradient.y == 0.0);
  let liquid = wet * select(0.0,1.0,boundaries.z > 0.5);
  let snow = frozen * boundaries.w * (1.0 - liquid);
  return vec3<f32>(liquid * select(0.0,1.0,boundaries.z < 1.5),snow,
    liquid * select(0.0,1.0,boundaries.z > 2.5));
}
fn gqTerrainSurface(input: GQSurface, masks: vec3<f32>, geometricNormal: vec3<f32>) -> GQSurface {
  var out = input;
  out.normal = normalize(mix(input.normal,geometricNormal,masks.x));
  out.albedo = mix(out.albedo,gqLinear(vec3<f32>(0.07,0.28,0.44)),masks.x);
  out.albedo = mix(out.albedo,gqLinear(vec3<f32>(0.72,0.85,0.91)),masks.y);
  out.albedo = mix(out.albedo,gqLinear(vec3<f32>(0.24,0.045,0.01)),masks.z);
  out.roughness = mix(out.roughness,0.16,masks.x);
  out.roughness = mix(out.roughness,0.38,masks.y);
  out.emission = mix(out.emission,vec3<f32>(1.0,0.08,0.005),masks.z);
  return out;
}
fn gqTerrainMaterial(masks: vec3<f32>) -> f32 {
  return select(select(select(0.0,2.0,masks.y >= 0.5),1.0,masks.x >= 0.5),3.0,masks.z >= 0.5);
}
fn gqLod(pixels: f32) -> vec3<f32> {
  return vec3<f32>(smoothstep(2.0,12.0,pixels),smoothstep(24.0,120.0,pixels),smoothstep(160.0,800.0,pixels));
}
fn gqMacro(point: vec3<f32>) -> f32 {
  let p = point * 6.0 + gqMaterial.scale.x;
  return sin(p.x + sin(p.z)) * cos(p.y * 1.3 - p.z * 0.7);
}
fn gqHash(cell: vec2<i32>, salt: u32) -> f32 {
  let coordinates = bitcast<vec2<u32>>(cell);
  var h = (coordinates.x * 1597334677u) ^ (coordinates.y * 3812015801u) ^ salt;
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return f32((h ^ (h >> 16u)) & 16777215u) / 8388607.5 - 1.0;
}
// Value and analytic gradient of quintic lattice noise, with no small tile period.
fn gqNoise(point: vec2<f32>, origin: vec2<i32>, salt: u32) -> vec3<f32> {
  let cell = vec2<i32>(floor(point)) + origin;
  let f = fract(point);
  let blend = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let derivative = 30.0 * f * f * (f - 1.0) * (f - 1.0);
  let a = gqHash(cell,salt);
  let b = gqHash(cell + vec2<i32>(1,0),salt);
  let c = gqHash(cell + vec2<i32>(0,1),salt);
  let d = gqHash(cell + vec2<i32>(1,1),salt);
  let value = mix(mix(a,b,blend.x),mix(c,d,blend.x),blend.y);
  return vec3<f32>(value,
    mix(b - a,d - c,blend.y) * derivative.x,
    mix(c - a,d - b,blend.x) * derivative.y);
}
fn gqWaterSurface(input: GQSurface, water: f32, meters: vec3<f32>, normal: vec3<f32>) -> GQSurface {
  let footprint = max(length(dpdx(meters)),length(dpdy(meters)));
  let lod = gqLod(gqMaterial.scale.z);
  if (water <= 0.0 || gqMaterial.origin.w != 1 || lod.z <= 0.0 || footprint >= 10.4) { return input; }
  let phase = gqMaterial.anchor.w * (6.28318530718 / 120.0);
  let drift = vec3<f32>(cos(phase),sin(phase),sin(phase + 1.2)) * 2.0;
  let weights = abs(normal) / max(dot(abs(normal),vec3<f32>(1)),0.00001);
  var gradient = vec3<f32>(0);
  for (var octave = 0u; octave < 2u; octave++) {
    let period = array<f32,2>(16.0,4.0)[octave];
    let weight = lod.z * (1.0 - smoothstep(0.2,0.65,footprint / period));
    let point = (meters + gqMaterial.anchor.xyz) / period + drift * f32(octave + 1u);
    let origin = gqMaterial.origin.xyz * i32(128.0 / period);
    let salt = u32(gqMaterial.scale.x * 65536.0) + 38197u + octave * 92821u;
    let x = gqNoise(point.yz,origin.yz,salt);
    let y = gqNoise(point.zx,origin.zx,salt + 719u);
    let z = gqNoise(point.xy,origin.xy,salt + 1877u);
    gradient += vec3<f32>(weights.y * y.z + weights.z * z.y,
      weights.x * x.y + weights.z * z.z,weights.x * x.z + weights.y * y.y) * weight * 0.045;
  }
  var out = input;
  let tangent = gradient - normal * dot(gradient,normal);
  let enabled = select(0.0,1.0,gqMaterial.origin.w == 1);
  out.normal = normalize(input.normal - tangent * water * enabled);
  return out;
}
fn gqLavaSurface(input: GQSurface, lava: f32, meters: vec3<f32>, normal: vec3<f32>) -> GQSurface {
  let footprint = max(length(dpdx(meters)),length(dpdy(meters)));
  let lod = gqLod(gqMaterial.scale.z);
  if (lava <= 0.0 || gqMaterial.origin.w != 1 || lod.y <= 0.0 || footprint >= 20.8) { return input; }
  let phase = gqMaterial.anchor.w * (6.28318530718 / 120.0);
  let drift = vec3<f32>(cos(phase),sin(phase),sin(phase + 0.7));
  let weights = abs(normal) / max(dot(abs(normal),vec3<f32>(1)),0.00001);
  var glow = 0.0;
  for (var octave = 0u; octave < 2u; octave++) {
    let period = array<f32,2>(32.0,8.0)[octave];
    let detail = select(lod.y,lod.z,octave > 0u)
      * (1.0 - smoothstep(0.2,0.65,footprint / period));
    let point = (meters + gqMaterial.anchor.xyz) / period + drift * f32(octave + 1u);
    let origin = gqMaterial.origin.xyz * i32(128.0 / period);
    let salt = u32(gqMaterial.scale.x * 65536.0) + 61357u + octave * 92821u;
    let value = vec3<f32>(gqNoise(point.yz,origin.yz,salt).x,
      gqNoise(point.zx,origin.zx,salt + 719u).x,gqNoise(point.xy,origin.xy,salt + 1877u).x);
    glow += dot(weights,value) * detail * select(0.12,0.06,octave > 0u);
  }
  var out = input;
  out.emission += vec3<f32>(1.0,0.08,0.005) * glow * clamp(lava,0.0,1.0);
  return out;
}
fn gqSurface(bodyPoint: vec3<f32>, meters: vec3<f32>, normal: vec3<f32>, materialId: f32) -> GQSurface {
  let lod = gqLod(gqMaterial.scale.z);
  let footprint = max(length(dpdx(meters)),length(dpdy(meters)));
  let macroFootprint = max(length(dpdx(bodyPoint)),length(dpdy(bodyPoint))) * 12.0;
  let macroWeight = lod.x * (1.0 - smoothstep(0.25,1.0,macroFootprint));
  var out: GQSurface;
  out.albedo = mix(gqMaterial.base.rgb,gqMaterial.accent.rgb,0.5 + 0.5 * gqMacro(bodyPoint) * macroWeight);
  out.normal = normal;
  out.roughness = gqMaterial.base.w;
  out.metallic = gqMaterial.accent.w;
  out.emission = vec3<f32>(0);
  if (materialId > 0.5 && materialId < 1.5) {
    out.albedo = mix(gqMaterial.mean.rgb,gqLinear(vec3<f32>(0.07,0.28,0.44)),macroWeight);
    out.roughness = mix(out.roughness,0.16,macroWeight);
  } else if (materialId > 1.5 && materialId < 2.5 && gqMaterial.mean.w != 2.0) {
    out.albedo = mix(gqMaterial.mean.rgb,gqLinear(vec3<f32>(0.72,0.85,0.91)),macroWeight);
    out.roughness = mix(out.roughness,0.38,macroWeight);
  }
  if (materialId > 2.5 && materialId < 3.5) {
    out.emission = gqMaterial.emission.rgb * macroWeight;
  }
  let weights = abs(normal) / max(dot(abs(normal),vec3<f32>(1)),0.00001);
  var perturbation = vec3<f32>(0);
  var grain = 0.0;
  // Integer origin preserves the noise identity without planet-scale Float32 positions.
  for (var octave = 0u; octave < 3u; octave++) {
    let period = array<f32,3>(16.0,2.0,0.25)[octave];
    let detailWeight = select(lod.y,lod.z,octave > 0u) * (1.0 - smoothstep(0.2,0.65,footprint / period));
    if (detailWeight > 0.001) {
      let point = (meters + gqMaterial.anchor.xyz) / period;
      let origin = gqMaterial.origin.xyz * i32(128.0 / period);
      let salt = u32(gqMaterial.scale.x * 65536.0) + octave * 92821u;
      let x = gqNoise(point.yz,origin.yz,salt);
      let y = gqNoise(point.zx,origin.zx,salt + 719u);
      let z = gqNoise(point.xy,origin.xy,salt + 1877u);
      grain += dot(weights,vec3<f32>(x.x,y.x,z.x)) * detailWeight / f32(octave + 1u);
      let gradient = vec3<f32>(
        weights.y * y.z + weights.z * z.y,
        weights.x * x.y + weights.z * z.z,
        weights.x * x.z + weights.y * y.y);
      perturbation += (gradient - normal * dot(gradient,normal)) * detailWeight / f32(octave + 1u);
    }
  }
  if (gqMaterial.mean.w != 6.0) {
    out.albedo *= 1.0 + grain * 0.09;
    out.roughness = clamp(out.roughness + grain * 0.08,0.08,1.0);
    out.normal = normalize(normal - perturbation * gqMaterial.scale.w);
  }
  return out;
}
fn gqDirectF0(surface: GQSurface, view: vec3<f32>, light: vec3<f32>, radiance: vec3<f32>, dielectricF0: vec3<f32>) -> vec3<f32> {
  let n = surface.normal;
  let v = normalize(view);
  let l = normalize(light);
  let halfway = v + l;
  let h = halfway / max(length(halfway),0.00001);
  let nl = max(dot(n,l),0.0);
  let nv = max(dot(n,v),0.0001);
  let nh = max(dot(n,h),0.0);
  let vh = max(dot(v,h),0.0);
  let alpha = surface.roughness * surface.roughness;
  let alpha2 = alpha * alpha;
  let denominator = nh * nh * (alpha2 - 1.0) + 1.0;
  let distribution = alpha2 / max(3.14159265 * denominator * denominator,0.00001);
  let k = (surface.roughness + 1.0) * (surface.roughness + 1.0) / 8.0;
  let geometry = nv / (nv * (1.0 - k) + k) * nl / (nl * (1.0 - k) + k);
  let f0 = mix(dielectricF0,surface.albedo,surface.metallic);
  let fresnel = f0 + (1.0 - f0) * pow(1.0 - vh,5.0);
  let specular = distribution * geometry * fresnel / max(4.0 * nv * nl,0.0001);
  let diffuse = (1.0 - fresnel) * (1.0 - surface.metallic) * surface.albedo / 3.14159265;
  return (diffuse + specular) * radiance * nl;
}
fn gqDirect(surface: GQSurface, view: vec3<f32>, light: vec3<f32>, radiance: vec3<f32>) -> vec3<f32> {
  return gqDirectF0(surface,view,light,radiance,vec3<f32>(0.04));
}
fn gqPointLinear() -> vec3<f32> {
  return gqMaterial.mean.rgb * 0.8;
}
fn gqFinish(color: vec3<f32>) -> vec3<f32> {
  return gqSrgb(mix(gqPointLinear(),color,gqLod(gqMaterial.scale.z).x));
}
`;

  function shader(source) {
    return `${WGSL}\n${source}`;
  }

  const api = { resolveBodyMaterial, materialUniforms, materialLod, terrainBoundaries, srgbToLinear, linearToSrgb,
    CLOUD_WGSL, ATMOSPHERE_WGSL, WGSL, shader };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.GQBodyMaterial = api;
})();
