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

  function materialUniforms(material, projectedDiameter, anchorMeters = [0, 0, 0]) {
    materialLod(projectedDiameter);
    if (!Array.isArray(anchorMeters) || anchorMeters.length !== 3 || !anchorMeters.every(Number.isFinite)) {
      throw new TypeError('Invalid body material anchor');
    }
    const data = new Float32Array(24);
    data.set([...material.base, material.roughness], 0);
    data.set([...material.accent, material.metallic], 4);
    data.set([...material.emission, 1], 8);
    data.set([material.seed, material.radiusMeters, projectedDiameter, material.normalStrength], 12);
    data.set([...material.mean, BIOMES.indexOf(material.biome)], 16);
    data.set(anchorMeters.map((n) => ((n % 128) + 128) % 128), 20);
    return data;
  }

  const WGSL = `
struct GQMaterialUniforms {
  base: vec4<f32>, accent: vec4<f32>, emission: vec4<f32>,
  scale: vec4<f32>, mean: vec4<f32>, anchor: vec4<f32>,
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
fn gqLod(pixels: f32) -> vec3<f32> {
  return vec3<f32>(smoothstep(2.0,12.0,pixels),smoothstep(24.0,120.0,pixels),smoothstep(160.0,800.0,pixels));
}
fn gqMacro(point: vec3<f32>) -> f32 {
  let p = point * 6.0 + gqMaterial.scale.x;
  return sin(p.x + sin(p.z)) * cos(p.y * 1.3 - p.z * 0.7);
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
  // All physical periods divide 128 m, keeping the anchor phase stable in Float32.
  for (var octave = 0u; octave < 3u; octave++) {
    let period = array<f32,3>(16.0,2.0,0.25)[octave];
    let detailWeight = select(lod.y,lod.z,octave > 0u) * (1.0 - smoothstep(0.2,0.65,footprint / period));
    if (detailWeight > 0.001) {
      let phase = (meters + gqMaterial.anchor.xyz) * (6.283185307 / period) + gqMaterial.scale.x;
      let waves = sin(phase);
      let triplanar = vec3<f32>(waves.y * waves.z,waves.z * waves.x,waves.x * waves.y);
      grain += dot(weights,triplanar) * detailWeight / f32(octave + 1u);
      let gradient = cos(phase) * vec3<f32>(
        weights.y * waves.z + weights.z * waves.y,
        weights.x * waves.z + weights.z * waves.x,
        weights.x * waves.y + weights.y * waves.x);
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
fn gqDirect(surface: GQSurface, view: vec3<f32>, light: vec3<f32>, radiance: vec3<f32>) -> vec3<f32> {
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
  let f0 = mix(vec3<f32>(0.04),surface.albedo,surface.metallic);
  let fresnel = f0 + (1.0 - f0) * pow(1.0 - vh,5.0);
  let specular = distribution * geometry * fresnel / max(4.0 * nv * nl,0.0001);
  let diffuse = (1.0 - fresnel) * (1.0 - surface.metallic) * surface.albedo / 3.14159265;
  return (diffuse + specular) * radiance * nl;
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

  const api = { resolveBodyMaterial, materialUniforms, materialLod, srgbToLinear, linearToSrgb, WGSL, shader };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.GQBodyMaterial = api;
})();
