#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'generated', 'trellis2', 'references', 'manifest.json');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'generated', 'comfyui', 'output');
const INPUT_NODE = 'Trellis2LoadImageWithTransparency';
const OUTPUT_NODE = '203';
const TEXTURING_NODE = '258';
const MESH_ONLY_FACE_TARGET = 15000;
const TEXTURED_FACE_TARGET = 5000;
const DEFAULT_SHAPE_RESOLUTION = 1024;
const SUPPORTED_SHAPE_RESOLUTIONS = new Set([512, 1024]);
const NODE_CLASSES = new Set([
  'PrimitiveInt',
  'PrimitiveString',
  'Trellis2DecodeLatents',
  'Trellis2ExportMesh',
  'Trellis2FillHolesNicelyWithMeshlib',
  'Trellis2FillHolesWithCuMesh',
  'Trellis2ImageCondGenerator',
  INPUT_NODE,
  'Trellis2LoadMesh',
  'Trellis2LoadModel',
  'Trellis2MeshTexturing',
  'Trellis2MeshWithVoxelToTrimesh',
  'Trellis2PreProcessImage',
  'Trellis2ReconstructMeshWithQuad',
  'Trellis2ShapeCascadeGenerator',
  'Trellis2ShapeGenerator',
  'Trellis2SimplifyMesh',
  'Trellis2SparseGenerator',
]);

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
if (manifest.schema !== 'gq.trellis-reference.v1' || manifest.status !== 'CONCEPT_REFERENCE_ONLY') {
  throw new Error('Unsupported or untrusted TRELLIS2 reference manifest.');
}

export function buildFacilityWorkflow({
  facilityKind,
  imageName,
  seed = 20261112,
  textured = false,
  targetShapeResolution = DEFAULT_SHAPE_RESOLUTION,
}) {
  if (!manifest.assets.some(asset => asset.asset_type === 'building' && asset.facility_kind === facilityKind)) {
    throw new RangeError(`Facility kind is not in the reference manifest: ${facilityKind}`);
  }
  const filenamePrefix = `gq_trellis2/building_${facilityKind}_pilot_v1${textured ? '_lowpoly_textured' : ''}`;
  return buildMeshWorkflow({ imageName, seed, textured, targetShapeResolution, filenamePrefix });
}

export function buildMeshWorkflow({
  imageName,
  seed = 20261112,
  textured = false,
  targetShapeResolution = DEFAULT_SHAPE_RESOLUTION,
  filenamePrefix,
}) {
  if (typeof imageName !== 'string' || !/^[a-z0-9][a-z0-9_.-]*\.png$/i.test(imageName)) {
    throw new TypeError('Image name must be a plain PNG filename.');
  }
  if (typeof filenamePrefix !== 'string' || !/^gq_trellis2\/[a-z0-9_]+$/i.test(filenamePrefix)) {
    throw new TypeError('Output prefix must be a safe gq_trellis2 filename prefix.');
  }
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647) {
    throw new RangeError('Seed must be an integer from 0 to 2147483647.');
  }
  if (!SUPPORTED_SHAPE_RESOLUTIONS.has(targetShapeResolution)) {
    throw new RangeError('Shape resolution must be 512 or 1024.');
  }
  if (textured && targetShapeResolution !== DEFAULT_SHAPE_RESOLUTION) {
    throw new RangeError('Textured generation requires shape resolution 1024.');
  }

  const pipeline = ['39', 0];
  const image = ['194', 0];
  const imageCondition = ['213', 0];
  const sparse = ['214', 0];
  const sparseResolution = ['214', 1];
  const sparsePipeline = ['214', 2];
  const shape = ['215', 0];
  const shapeResolution = ['215', 1];
  const shapePipeline = ['215', 2];
  const cascadedShape = ['216', 0];
  const cascadedResolution = ['216', 1];
  const cascadedPipeline = ['216', 2];
  const decodeShape = targetShapeResolution === 512 ? shape : cascadedShape;
  const decodeResolution = targetShapeResolution === 512 ? shapeResolution : cascadedResolution;
  const decodePipeline = targetShapeResolution === 512 ? shapePipeline : cascadedPipeline;
  const decodedMesh = ['217', 0];
  const holeFilledMesh = ['193', 0];
  const reconstructedMesh = ['161', 0];
  const firstSimplifiedMesh = ['218', 0];
  const filledMesh = ['250', 0];
  const simplifiedMesh = ['257', 0];
  const faceTarget = ['209', 0];

  const workflow = {
    '6': { class_type: INPUT_NODE, inputs: { image: imageName } },
    '39': {
      class_type: 'Trellis2LoadModel',
      inputs: {
        modelname: 'microsoft/TRELLIS.2-4B',
        backend: 'flash_attn',
        device: 'cuda',
        low_vram: true,
        keep_models_loaded: false,
        conv_backend: 'spconv',
        sparse_backend: 'flash_attn',
        use_reconviagen: false,
      },
    },
    '194': {
      class_type: 'Trellis2PreProcessImage',
      inputs: { image: ['6', 2], padding: 10, remove_background: false, max_size: 1024 },
    },
    '213': {
      class_type: 'Trellis2ImageCondGenerator',
      inputs: { pipeline, image, max_views: 1 },
    },
    '214': {
      class_type: 'Trellis2SparseGenerator',
      inputs: {
        pipeline: ['213', 2],
        image_cond: imageCondition,
        seed,
        sparse_structure_steps: 12,
        sparse_structure_guidance_strength: 7.5,
        sparse_structure_guidance_rescale: 0.01,
        sparse_structure_rescale_t: 5,
        sparse_structure_sampler: 'heun',
        sparse_structure_resolution: 32,
        sparse_structure_guidance_interval_start: 0.1,
        sparse_structure_guidance_interval_end: 1,
        fill_holes: true,
        hole_iterations: 1,
        verbose: false,
        dino_lock: 1,
        dino_substeps: 8,
        hole_fill_algorithm: 'flood_fill',
        dino_foundation_cap: 1,
        keep_only_shell: true,
      },
    },
    '215': {
      class_type: 'Trellis2ShapeGenerator',
      inputs: {
        pipeline: sparsePipeline,
        image_cond: imageCondition,
        coords: sparse,
        resolution: 512,
        shape_steps: 12,
        shape_guidance_strength: 7.5,
        shape_guidance_rescale: 0.01,
        shape_rescale_t: 3,
        shape_sampler: 'heun',
        shape_guidance_interval_start: 0.1,
        shape_guidance_interval_end: 1,
        verbose: false,
        dino_lock: 0,
        dino_substeps: 4,
        dino_foundation_cap: 1,
      },
    },
    ...(targetShapeResolution === 1024
      ? {
          '216': {
            class_type: 'Trellis2ShapeCascadeGenerator',
            inputs: {
              pipeline: shapePipeline,
              image_cond: ['213', 1],
              shape_slat: shape,
              from_resolution: shapeResolution,
              to_resolution: 1024,
              sparse_structure_resolution: sparseResolution,
              max_num_tokens: 999999,
              shape_steps: 12,
              shape_guidance_strength: 7.5,
              shape_guidance_rescale: 0.01,
              shape_rescale_t: 3,
              shape_sampler: 'heun',
              shape_guidance_interval_start: 0.1,
              shape_guidance_interval_end: 1,
              verbose: false,
              dino_lock: 0,
              dino_substeps: 4,
              dino_foundation_cap: 1,
            },
          },
        }
      : {}),
    '217': {
      class_type: 'Trellis2DecodeLatents',
      inputs: {
        pipeline: decodePipeline,
        shape_slat: decodeShape,
        resolution: decodeResolution,
        use_tiled_decoder: true,
      },
    },
    '193': {
      class_type: 'Trellis2FillHolesWithCuMesh',
      inputs: { mesh: decodedMesh, max_permieters: 1 },
    },
    '161': {
      class_type: 'Trellis2ReconstructMeshWithQuad',
      inputs: { mesh: holeFilledMesh, remesh_band: 1, resolution: 1024, remove_floaters: true, remove_inner_faces: true },
    },
    '209': {
      class_type: 'PrimitiveInt',
      inputs: { value: textured ? 500000 : MESH_ONLY_FACE_TARGET },
    },
    '218': {
      class_type: 'Trellis2SimplifyMesh',
      inputs: { mesh: reconstructedMesh, target_face_num: faceTarget, method: 'Cumesh' },
    },
    '250': { class_type: 'Trellis2FillHolesNicelyWithMeshlib', inputs: { mesh: firstSimplifiedMesh } },
    '257': {
      class_type: 'Trellis2SimplifyMesh',
      inputs: { mesh: filledMesh, target_face_num: faceTarget, method: 'Cumesh' },
    },
    '202': {
      class_type: 'Trellis2MeshWithVoxelToTrimesh',
      inputs: { mesh: simplifiedMesh, reorient_vertices: '90 degrees' },
    },
    '219': { class_type: 'PrimitiveString', inputs: { value: filenamePrefix } },
    [OUTPUT_NODE]: {
      class_type: 'Trellis2ExportMesh',
      inputs: { trimesh: ['202', 0], filename_prefix: ['219', 0], file_format: 'glb' },
    },
  };

  if (textured) {
    workflow['257'].inputs.target_face_num = TEXTURED_FACE_TARGET;
    workflow[TEXTURING_NODE] = {
      class_type: 'Trellis2MeshTexturing',
      inputs: {
        pipeline: ['217', 2],
        image: ['194', 0],
        trimesh: ['202', 0],
        seed,
        texture_steps: 12,
        texture_guidance_strength: 5,
        texture_guidance_rescale: 0.05,
        texture_rescale_t: 3,
        resolution: 1024,
        texture_size: 2048,
        texture_alpha_mode: 'OPAQUE',
        double_side_material: false,
        texture_guidance_interval_start: 0,
        texture_guidance_interval_end: 0.9,
        max_views: 1,
        bake_on_vertices: false,
        use_custom_normals: false,
        mesh_cluster_threshold_cone_half_angle_rad: 60,
        sampler: 'euler',
        inpainting: 'telea',
        verbose: false,
        dino_lock: 0,
        dino_substeps: 4,
        dino_foundation_cap: 1,
      },
    };
    workflow[OUTPUT_NODE].inputs.trimesh = [TEXTURING_NODE, 0];
  } else if (targetShapeResolution === 512) {
    delete workflow['250'];
    delete workflow['257'];
    workflow['202'].inputs.mesh = firstSimplifiedMesh;
  }

  return workflow;
}

export function selectNewExportPath(outputPaths, previousPaths) {
  const previous = new Set(previousPaths);
  const candidates = outputPaths.filter(outputPath => !previous.has(outputPath));
  if (candidates.length !== 1) {
    throw new Error(`Expected one new TRELLIS2 export, found ${candidates.length}.`);
  }
  return candidates[0];
}

export function getComfyJobFailure(job, promptId) {
  const status = job?.status;
  if (
    status?.status_str !== 'error'
    && status?.status_str !== 'failed'
    && !(status?.completed && status.status_str !== 'success')
  ) {
    return null;
  }
  return `ComfyUI job ${promptId} failed: ${JSON.stringify(status.messages || [])}`;
}

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.COMFYUI_BASE_URL || 'http://127.0.0.1:8188',
    preflight: false,
    submit: false,
    textured: false,
    shapeResolution: DEFAULT_SHAPE_RESOLUTION,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--kind') options.facilityKind = argv[++i];
    else if (arg === '--seed') options.seed = Number(argv[++i]);
    else if (arg === '--shape-resolution') options.shapeResolution = Number(argv[++i]);
    else if (arg === '--base-url') options.baseUrl = argv[++i];
    else if (arg === '--preflight') options.preflight = true;
    else if (arg === '--submit') options.submit = true;
    else if (arg === '--textured') options.textured = true;
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function endpoint(baseUrl, route) {
  return new URL(route.replace(/^\//, ''), `${baseUrl.replace(/\/+$/, '')}/`);
}

export async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(endpoint(baseUrl, route), {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
    headers: options.body instanceof FormData
      ? options.headers
      : { 'content-type': 'application/json', ...options.headers },
  });
  const body = await response.text();
  let payload;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    if (!response.ok) throw new Error(`ComfyUI ${route}: HTTP ${response.status}: ${body.slice(0, 500)}`);
    throw new Error(`ComfyUI ${route} returned invalid JSON.`);
  }
  if (!response.ok) throw new Error(`ComfyUI ${route}: HTTP ${response.status}: ${body.slice(0, 500)}`);
  return payload;
}

export function validateWorkflow(workflow, objectInfo) {
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!NODE_CLASSES.has(node.class_type)) throw new Error(`Workflow contains an unapproved node: ${node.class_type}`);
    const schema = objectInfo[node.class_type];
    if (!schema) throw new Error(`ComfyUI node is unavailable: ${node.class_type}`);
    for (const inputName of Object.keys(schema.input?.required || {})) {
      if (!Object.hasOwn(node.inputs, inputName)) {
        throw new Error(`Node ${nodeId} is missing required input ${inputName}.`);
      }
    }
    const inputs = new Set([
      ...Object.keys(schema.input?.required || {}),
      ...Object.keys(schema.input?.optional || {}),
    ]);
    for (const inputName of Object.keys(node.inputs)) {
      if (!inputs.has(inputName)) throw new Error(`Node ${nodeId} has unknown input ${inputName}.`);
      const declaration = schema.input?.required?.[inputName] ?? schema.input?.optional?.[inputName];
      const choices = Array.isArray(declaration?.[0]) ? declaration[0] : null;
      const value = node.inputs[inputName];
      if (choices && !Array.isArray(value) && !(node.class_type === INPUT_NODE && inputName === 'image')) {
        if (!choices.includes(value)) throw new Error(`Node ${nodeId} has invalid ${inputName} choice: ${value}.`);
      }
    }
    for (const value of Object.values(node.inputs)) {
      if (Array.isArray(value) && typeof value[0] === 'string' && /^\d+$/.test(value[0])) {
        const source = workflow[value[0]];
        if (!source) throw new Error(`Node ${nodeId} references missing node ${value[0]}.`);
        const outputCount = objectInfo[source.class_type]?.output?.length;
        if (!Number.isInteger(value[1]) || value[1] < 0 || value[1] >= outputCount) {
          throw new Error(`Node ${nodeId} references invalid output ${value[1]} from node ${value[0]}.`);
        }
      }
    }
  }
}

function imageChoices(objectInfo) {
  const schema = objectInfo[INPUT_NODE]?.input?.required?.image?.[0];
  if (!Array.isArray(schema)) throw new Error('ComfyUI image loader did not report its input choices.');
  return schema;
}

async function findFacilityExports(facilityKind, textured = false) {
  const exportDirectory = path.join(OUTPUT_ROOT, 'gq_trellis2');
  let entries;
  try {
    entries = await readdir(exportDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const profile = textured ? '_lowpoly_textured' : '';
  const pattern = new RegExp(`^building_${facilityKind}_pilot_v1${profile}_\\d{5}_\\.glb$`);
  return entries
    .filter(entry => entry.isFile() && pattern.test(entry.name))
    .map(entry => path.join(exportDirectory, entry.name));
}

export async function assertQueueEmpty(baseUrl) {
  const queue = await requestJson(baseUrl, '/queue');
  if (!Array.isArray(queue?.queue_running) || !Array.isArray(queue?.queue_pending)) {
    throw new Error('ComfyUI returned an invalid queue status.');
  }
  if (queue.queue_running.length || queue.queue_pending.length) {
    throw new Error(`ComfyUI queue is not empty (${queue.queue_running.length} running, ${queue.queue_pending.length} pending); no job submitted.`);
  }
}

async function uploadReference(baseUrl, imageName, bytes) {
  const form = new FormData();
  form.set('image', new Blob([bytes], { type: 'image/png' }), imageName);
  form.set('type', 'input');
  form.set('overwrite', 'false');
  const result = await requestJson(baseUrl, '/upload/image', { method: 'POST', body: form });
  if (typeof result?.name !== 'string' || !result.name) throw new Error('ComfyUI did not confirm the uploaded image name.');
  return result.name;
}

export async function ensureReferenceUploaded(baseUrl, objectInfo, imageName, bytes, expectedHash) {
  const choices = imageChoices(objectInfo);
  if (choices.includes(imageName)) {
    const query = new URLSearchParams({ filename: imageName, type: 'input' });
    const response = await fetch(endpoint(baseUrl, `/view?${query}`), { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Cannot verify existing ComfyUI input image: HTTP ${response.status}`);
    const existingHash = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    if (existingHash !== expectedHash) throw new Error(`Existing ComfyUI input image hash mismatch: ${imageName}`);
    return imageName;
  }
  return uploadReference(baseUrl, imageName, bytes);
}

async function waitForOutput(baseUrl, promptId, timeoutMs, facilityKind, previousExports, textured) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const history = await requestJson(baseUrl, `/history/${encodeURIComponent(promptId)}`);
    const job = history?.[promptId];
    const status = job?.status;
    const failure = getComfyJobFailure(job, promptId);
    if (failure) throw new Error(failure);
    if (status?.completed) {
      const output = job.outputs?.[OUTPUT_NODE];
      const relativePath = Array.isArray(output?.relative_path) ? output.relative_path[0] : output?.relative_path;
      let outputPath;
      if (typeof relativePath === 'string' && relativePath) {
        const normalized = relativePath.replaceAll('\\', '/');
        if (normalized.startsWith('/') || normalized.split('/').some(part => part === '..')) {
          throw new Error('TRELLIS2 export returned an unsafe output path.');
        }
        outputPath = path.resolve(OUTPUT_ROOT, ...normalized.split('/'));
        if (!outputPath.startsWith(`${OUTPUT_ROOT}${path.sep}`)) {
          throw new Error('TRELLIS2 export escaped the ComfyUI output directory.');
        }
      } else {
        outputPath = selectNewExportPath(await findFacilityExports(facilityKind, textured), previousExports);
      }
      const info = await stat(outputPath);
      if (info.size < 20) throw new Error(`TRELLIS2 GLB is too small: ${info.size} bytes.`);
      const file = await open(outputPath, 'r');
      const header = Buffer.alloc(12);
      let bytesRead;
      try {
        ({ bytesRead } = await file.read(header, 0, header.length, 0));
      } finally {
        await file.close();
      }
      if (bytesRead !== header.length) throw new Error(`TRELLIS2 GLB header is truncated: ${outputPath}`);
      if (header.toString('ascii', 0, 4) !== 'glTF' || header.readUInt32LE(4) !== 2 || header.readUInt32LE(8) !== info.size) {
        throw new Error(`TRELLIS2 output is not a valid GLB 2 file: ${outputPath}`);
      }
      return outputPath;
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(`Timed out waiting for ComfyUI job ${promptId}; the job may still be running.`);
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: node scripts/trellis2_generate_facility.mjs --kind <facility-kind> [--seed <int>] [--shape-resolution <512|1024>] [--textured] [--submit] [--base-url <url>]');
    console.log('Without --submit, validates the manifest image and prints the generation plan only.');
    return;
  }
  const asset = manifest.assets.find(entry => entry.asset_type === 'building' && entry.facility_kind === options.facilityKind);
  if (!asset) throw new RangeError(`Unknown facility kind: ${options.facilityKind}`);
  const trellisInput = asset.trellis_input ?? asset;
  const referencePath = path.join(REPO_ROOT, 'generated', 'trellis2', 'references', trellisInput.file);
  const imageBytes = await readFile(referencePath);
  const imageHash = createHash('sha256').update(imageBytes).digest('hex');
  if (imageHash !== trellisInput.sha256) {
    throw new Error(`Reference image SHA-256 mismatch: ${trellisInput.file}`);
  }
  const imageName = `gq_${asset.facility_kind}_concept_${imageHash.slice(0, 16)}.png`;
  const workflow = buildFacilityWorkflow({
    facilityKind: asset.facility_kind,
    imageName,
    seed: options.seed ?? 20261112,
    textured: options.textured,
    targetShapeResolution: options.shapeResolution,
  });
  console.log(`Facility: ${asset.facility_kind}`);
  console.log(`Reference: ${referencePath}`);
  console.log(`Reference SHA-256: ${imageHash}`);
  console.log(`Shape resolution: ${options.shapeResolution}`);
  console.log(`Output prefix: ${workflow['219'].inputs.value}`);
  if (!options.submit && !options.preflight) {
    console.log('Dry run only. Add --preflight to check ComfyUI or --submit to upload and enqueue one GPU generation.');
    return;
  }

  const objectInfo = await requestJson(options.baseUrl, '/object_info');
  validateWorkflow(workflow, objectInfo);
  await assertQueueEmpty(options.baseUrl);
  if (options.preflight && !options.submit) {
    console.log('Preflight passed: ComfyUI nodes, workflow inputs, and empty queue verified; no upload or job submitted.');
    return;
  }

  const previousExports = new Set(await findFacilityExports(asset.facility_kind, options.textured));
  const uploadedName = await ensureReferenceUploaded(
    options.baseUrl,
    objectInfo,
    imageName,
    imageBytes,
    imageHash,
  );
  workflow['6'].inputs.image = uploadedName;
  const refreshedInfo = await requestJson(options.baseUrl, '/object_info');
  if (!imageChoices(refreshedInfo).includes(uploadedName)) {
    throw new Error(`Uploaded image is not available to the TRELLIS2 loader: ${uploadedName}`);
  }
  validateWorkflow(workflow, refreshedInfo);
  await assertQueueEmpty(options.baseUrl);
  const prompt = await requestJson(options.baseUrl, '/prompt', {
    method: 'POST',
    body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
  });
  if (typeof prompt?.prompt_id !== 'string' || !prompt.prompt_id) {
    throw new Error(`ComfyUI did not return a prompt_id: ${JSON.stringify(prompt)}`);
  }
  console.log(`ComfyUI prompt: ${prompt.prompt_id}`);
  const outputPath = await waitForOutput(
    options.baseUrl,
    prompt.prompt_id,
    60 * 60 * 1000,
    asset.facility_kind,
    previousExports,
    options.textured,
  );
  console.log(`GLB: ${outputPath}`);
  console.log(`Status: ${options.textured ? 'low-poly textured ' : ''}generated, not inspected or imported; keep this asset DEV_ONLY pending manual review.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`[TRELLIS2] ${error.message}`);
    process.exitCode = 1;
  });
}
