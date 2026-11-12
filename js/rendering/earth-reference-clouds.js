import { EARTH_REFERENCE } from './earth-reference-geography.js';
import { Matrix4 } from 'three';

export function cloudShellRadius(altitudeKm) {
  if (!Number.isFinite(altitudeKm) || altitudeKm <= 0 || altitudeKm > 200) {
    throw new RangeError('Invalid Earth cloud altitude');
  }
  return 1 + altitudeKm / EARTH_REFERENCE.radiusKm;
}

export function createEarthClouds(device, format, cloudNoise) {
  const module = device.createShaderModule({ label: 'earth_cloud_shell', code: `${cloudNoise}
struct Clouds {
  projection: mat4x4<f32>,
  inverseProjection: mat4x4<f32>,
  eye: vec4<f32>,
  bodyX: vec4<f32>, bodyY: vec4<f32>, bodyZ: vec4<f32>,
  light: vec4<f32>,
  options: vec4<f32>,
};
@group(0) @binding(0) var<uniform> c: Clouds;
struct Out {
  @builtin(position) position: vec4<f32>,
  @location(0) farPoint: vec4<f32>,
};
@vertex fn vs_cloud(@builtin(vertex_index) vertex: u32) -> Out {
  let p = array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3))[vertex];
  var out: Out;
  out.position = vec4<f32>(p,0,1);
  out.farPoint = c.inverseProjection * vec4<f32>(p,1,1);
  return out;
}
struct CloudPixel {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
};
@fragment fn fs_cloud(in: Out) -> CloudPixel {
  let ray = normalize(in.farPoint.xyz / in.farPoint.w - c.eye.xyz);
  let along = -dot(c.eye.xyz,ray);
  let closest = c.eye.xyz + ray * along;
  let discriminant = c.options.x * c.options.x - dot(closest,closest);
  let distance = along - sqrt(max(0.0,discriminant));
  // Evaluate derivatives before discarding non-intersecting pixels.
  let hit = c.eye.xyz + ray * max(0.0,distance);
  let normal = hit / max(length(hit),0.00001);
  let inverse = transpose(mat3x3<f32>(c.bodyX.xyz,c.bodyY.xyz,c.bodyZ.xyz));
  let point = inverse * normal * 12.0;
  let footprint = max(length(dpdx(point)),length(dpdy(point)));
  let cloud = gqCloudCoverage(gqCloudNoise(point,c.options.y,c.options.z,footprint),0.65);
  let sun = normalize(c.light.xyz);
  let solarCosine = dot(normal,sun);
  let tangentSun = sun - normal * solarCosine;
  let sunwardPoint = normalize(normal + tangentSun * 0.018) * 12.0;
  let sunwardFootprint = max(length(dpdx(sunwardPoint)),length(dpdy(sunwardPoint)));
  let reliefDetail = 1.0 - smoothstep(0.15,0.6,max(footprint,sunwardFootprint));
  let clip = c.projection * vec4<f32>(hit,1);
  if (discriminant <= 0.0 || distance <= 0.0 || clip.w <= 0.0) { discard; }
  let depth = clip.z / clip.w;
  if (depth < 0.0 || depth > 1.0) { discard; }
  var relief = 1.0;
  if (c.options.w > 0.5 && solarCosine > -0.08 && cloud > 0.02 && reliefDetail > 0.0) {
    let sunward = gqCloudCoverage(gqCloudNoise(inverse * sunwardPoint,
      c.options.y,c.options.z,sunwardFootprint),0.65);
    relief = mix(1.0,gqCloudRelief(cloud,sunward,solarCosine),reliefDetail);
  }
  let daylight = mix(1.0,smoothstep(-0.08,0.22,solarCosine),c.options.w);
  let opacity = 1.0 - exp(-cloud * 2.0);
  // Premultiplied display-space blend matches the existing unorm planet target.
  let thickness = mix(0.82,1.0,smoothstep(0.05,0.65,cloud));
  let rgb = mix(vec3<f32>(0.025,0.035,0.055),
    vec3<f32>(0.9,0.93,0.98) * thickness * relief,daylight);
  var out: CloudPixel;
  out.color = vec4<f32>(rgb * opacity,opacity);
  out.depth = depth;
  return out;
}` });
  const pipeline = device.createRenderPipeline({
    label: 'earth_cloud_shell', layout: 'auto',
    vertex: { module, entryPoint: 'vs_cloud' },
    fragment: { module, entryPoint: 'fs_cloud', targets: [{ format, blend: {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    } }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
  });
  const buffer = device.createBuffer({ label: 'earth_cloud_uniforms', size: 224,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer } }] });
  const inverse = new Matrix4();
  return {
    draw(pass, frame, altitudeKm, lighting) {
      const { uniforms, phase, material } = frame;
      const data = new Float32Array(56);
      data.set(uniforms.subarray(0, 16), 0);
      data.set(inverse.fromArray(uniforms).invert().elements, 16);
      data.set(uniforms.subarray(32, 52), 32);
      data.set([cloudShellRadius(altitudeKm), frame.effectsEnabled ? phase : 0, material.seed, lighting ? 1 : 0], 52);
      device.queue.writeBuffer(buffer, 0, data);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
    },
    dispose() { buffer.destroy(); },
  };
}
