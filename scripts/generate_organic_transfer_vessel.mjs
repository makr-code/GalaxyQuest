import fs from 'node:fs/promises';
import path from 'node:path';

const outputPath = path.resolve(
  'generated/trellis2/imported/ship/ship_generic_teaser_transfer_organic_lod0_dev.glb',
);
const longitudinalSegments = 64;
const radialSegments = 96;
const positions = [];
const normals = [];
const indices = [];

for (let longitudinal = 0; longitudinal <= longitudinalSegments; longitudinal += 1) {
  const phi = (longitudinal / longitudinalSegments) * Math.PI;
  const axis = Math.cos(phi);
  const ring = Math.sin(phi);
  const wingEnvelope = 0.32 + 0.62 * Math.exp(-(((axis + 0.08) / 0.42) ** 2));
  const cockpit = Math.exp(-(((axis - 0.3) / 0.2) ** 2));

  for (let radial = 0; radial < radialSegments; radial += 1) {
    const theta = (radial / radialSegments) * Math.PI * 2;
    const lateral = Math.sin(theta);
    const dorsal = Math.max(0, Math.cos(theta));
    const organicRib = 1 + 0.018 * Math.sin(theta * 3 + axis * 4) * ring;
    const width = ring * wingEnvelope * organicRib;
    const height = ring * (0.34 + cockpit * 0.08) * organicRib;
    positions.push(
      1.28 * axis + 0.12 * (1 - axis * axis),
      lateral * width,
      Math.cos(theta) * height + ring * 0.12 * cockpit * dorsal ** 4,
    );
  }
}

const appendTriangle = (firstIndex, secondIndex, thirdIndex) => {
  const first = positions.slice(firstIndex * 3, firstIndex * 3 + 3);
  const second = positions.slice(secondIndex * 3, secondIndex * 3 + 3);
  const third = positions.slice(thirdIndex * 3, thirdIndex * 3 + 3);
  const ab = [second[0] - first[0], second[1] - first[1], second[2] - first[2]];
  const ac = [third[0] - first[0], third[1] - first[1], third[2] - first[2]];
  const faceNormal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const center = [0, 1, 2].map((axis) => (first[axis] + second[axis] + third[axis]) / 3);
  const outward = faceNormal[0] * center[0] + faceNormal[1] * center[1] + faceNormal[2] * center[2] >= 0;
  const triangle = outward
    ? [firstIndex, secondIndex, thirdIndex]
    : [firstIndex, thirdIndex, secondIndex];
  indices.push(...triangle);
  for (const vertexIndex of triangle) {
    const offset = vertexIndex * 3;
    normals[offset] += faceNormal[0] * (outward ? 1 : -1);
    normals[offset + 1] += faceNormal[1] * (outward ? 1 : -1);
    normals[offset + 2] += faceNormal[2] * (outward ? 1 : -1);
  }
};

normals.push(...new Array(positions.length).fill(0));
for (let longitudinal = 0; longitudinal < longitudinalSegments; longitudinal += 1) {
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const nextRadial = (radial + 1) % radialSegments;
    const rear = longitudinal * radialSegments + radial;
    const rearNext = longitudinal * radialSegments + nextRadial;
    const forward = (longitudinal + 1) * radialSegments + radial;
    const forwardNext = (longitudinal + 1) * radialSegments + nextRadial;
    appendTriangle(rear, rearNext, forwardNext);
    appendTriangle(rear, forwardNext, forward);
  }
}

for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
  const offset = vertex * 3;
  const length = Math.hypot(normals[offset], normals[offset + 1], normals[offset + 2]) || 1;
  normals[offset] /= length;
  normals[offset + 1] /= length;
  normals[offset + 2] /= length;
}

const positionBytes = Buffer.from(new Float32Array(positions).buffer);
const normalBytes = Buffer.from(new Float32Array(normals).buffer);
const indexBytes = Buffer.from(new Uint32Array(indices).buffer);
const normalOffset = positionBytes.byteLength;
const indexOffset = normalOffset + normalBytes.byteLength;
const binary = Buffer.concat([positionBytes, normalBytes, indexBytes]);
const min = [0, 1, 2].map((axis) => Math.min(...positions.filter((_, index) => index % 3 === axis)));
const max = [0, 1, 2].map((axis) => Math.max(...positions.filter((_, index) => index % 3 === axis)));
const document = {
  asset: { version: '2.0', generator: 'GalaxyQuest Organic Transfer Vessel' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Nacre Transfer Vessel', mesh: 0, extras: { designLanguage: 'organic', engineAxis: [-1, 0, 0] } }],
  meshes: [{ name: 'Nacre Hull', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  materials: [{ name: 'Nacre Ceramic', pbrMetallicRoughness: {
    baseColorFactor: [0.34, 0.62, 0.7, 1], metallicFactor: 0.28, roughnessFactor: 0.38,
  } }],
  buffers: [{ byteLength: binary.byteLength }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength, target: 34962 },
    { buffer: 0, byteOffset: normalOffset, byteLength: normalBytes.byteLength, target: 34962 },
    { buffer: 0, byteOffset: indexOffset, byteLength: indexBytes.byteLength, target: 34963 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max },
    { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5125, count: indices.length, type: 'SCALAR', min: [0], max: [positions.length / 3 - 1] },
  ],
};

const json = Buffer.from(JSON.stringify(document));
const jsonPadding = (4 - (json.byteLength % 4)) % 4;
const binaryPadding = (4 - (binary.byteLength % 4)) % 4;
const paddedJson = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
const paddedBinary = Buffer.concat([binary, Buffer.alloc(binaryPadding)]);
const totalLength = 12 + 8 + paddedJson.byteLength + 8 + paddedBinary.byteLength;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(paddedJson.byteLength, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(paddedBinary.byteLength, 0);
binaryHeader.writeUInt32LE(0x004e4942, 4);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, paddedBinary]));
console.log(JSON.stringify({ outputPath, vertices: positions.length / 3, triangles: indices.length / 3, bytes: totalLength }));