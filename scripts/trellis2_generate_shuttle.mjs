#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertQueueEmpty,
  buildMeshWorkflow,
  ensureReferenceUploaded,
  getComfyJobFailure,
  requestJson,
  validateWorkflow,
} from './trellis2_generate_facility.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const references = path.join(root, 'generated', 'trellis2', 'references', 'shuttles');
const outputDirectory = path.join(root, 'generated', 'comfyui', 'output', 'gq_trellis2');
const manifest = JSON.parse(await readFile(path.join(references, 'manifest.json'), 'utf8'));
if (manifest.schema !== 'gq.trellis-shuttle-reference.v1' || manifest.status !== 'CONCEPT_REFERENCE_ONLY') {
  throw new Error('Unsupported or untrusted shuttle reference manifest.');
}

export function buildShuttleWorkflow({ id, imageName, runId }) {
  if (!manifest.assets.some(asset => asset.id === id) || !/^[a-z0-9_]+$/.test(id)) {
    throw new RangeError(`Unknown shuttle: ${id}`);
  }
  if (typeof runId !== 'string' || !/^[a-f0-9]{32}$/.test(runId)) {
    throw new TypeError('Run ID must be a 32-digit hexadecimal UUID.');
  }
  return buildMeshWorkflow({
    imageName,
    targetShapeResolution: 512,
    filenamePrefix: `gq_trellis2/shuttle_${id}_${runId}`,
  });
}

export function buildShuttleTextureWorkflow({ id, imageName, runId }) {
  const asset = manifest.assets.find(entry => entry.id === id);
  if (!asset?.texture_mesh || !/^[a-z0-9_]+$/.test(id)) {
    throw new RangeError(`Shuttle has no pinned texture mesh: ${id}`);
  }
  if (typeof runId !== 'string' || !/^[a-f0-9]{32}$/.test(runId)) {
    throw new TypeError('Run ID must be a 32-digit hexadecimal UUID.');
  }
  const meshFile = asset.texture_mesh.file;
  if (typeof meshFile !== 'string' || !/^[a-z0-9_]+\.glb$/.test(meshFile)) {
    throw new TypeError('Texture mesh must be a plain GLB filename.');
  }
  const base = buildMeshWorkflow({
    imageName,
    textured: true,
    filenamePrefix: `gq_trellis2/shuttle_${id}_texture_${runId}`,
  });
  const texture = base['258'];
  texture.inputs.pipeline = ['39', 0];
  texture.inputs.trimesh = ['260', 0];
  texture.inputs.resolution = 512;
  texture.inputs.texture_size = 1024;
  return {
    '6': base['6'],
    '39': base['39'],
    '194': base['194'],
    '260': {
      class_type: 'Trellis2LoadMesh',
      inputs: { glb_path: `/workspace/output/gq_trellis2/${meshFile}` },
    },
    '258': texture,
    '219': base['219'],
    '203': base['203'],
  };
}

async function checkResources(baseUrl) {
  await assertQueueEmpty(baseUrl);
  const stats = await requestJson(baseUrl, '/system_stats');
  const gpu = stats?.devices?.find(device => device.type === 'cuda');
  if (!Number.isFinite(gpu?.vram_free) || gpu.vram_free < 10 * 1024 ** 3) {
    throw new Error('At least 10 GiB of reported free CUDA VRAM is required; no job submitted.');
  }
  console.log(`Free CUDA VRAM: ${(gpu.vram_free / 1024 ** 3).toFixed(2)} GiB`);
}

async function waitForExport(baseUrl, promptId, prefix) {
  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    const history = await requestJson(baseUrl, `/history/${encodeURIComponent(promptId)}`);
    const job = history?.[promptId];
    const failure = getComfyJobFailure(job, promptId);
    if (failure) throw new Error(failure);
    if (job?.status?.completed) {
      const entries = await readdir(outputDirectory);
      const matches = entries.filter(name => new RegExp(`^${prefix}_\\d{5}_\\.glb$`).test(name));
      if (matches.length !== 1) throw new Error(`Expected exactly one export for ${prefix}, found ${matches.length}.`);
      const output = path.join(outputDirectory, matches[0]);
      const bytes = await readFile(output);
      const info = await stat(output);
      if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF'
          || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== info.size) {
        throw new Error(`Invalid GLB output: ${output}`);
      }
      return output;
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(`Timed out waiting for ComfyUI job ${promptId}; the job may still be running.`);
}

async function main(args) {
  let id = 'patchwork_tug';
  let baseUrl = 'http://127.0.0.1:8188';
  let preflight = false;
  let submit = false;
  let texturePlan = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id') id = args[++i];
    else if (args[i] === '--base-url') baseUrl = args[++i];
    else if (args[i] === '--preflight') preflight = true;
    else if (args[i] === '--submit') submit = true;
    else if (args[i] === '--texture-plan') texturePlan = true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  const asset = manifest.assets.find(entry => entry.id === id);
  if (!asset || !/^[a-z0-9_]+$/.test(id)) throw new RangeError(`Unknown shuttle: ${id}`);
  if (texturePlan && submit) {
    throw new Error('Texture plans are preflight-only; no job can be submitted from this path.');
  }
  const input = asset.trellis_input;
  if (!input || !/^[a-z0-9_]+\.png$/.test(input.file) || !/^[a-f0-9]{64}$/.test(input.sha256)) {
    throw new Error('Invalid shuttle input manifest entry.');
  }
  const bytes = await readFile(path.join(references, input.file));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== input.sha256) throw new Error(`Reference SHA-256 mismatch: ${input.file}`);
  const runId = randomUUID().replaceAll('-', '');
  const imageName = `gq_shuttle_${id}_${hash.slice(0, 16)}.png`;
  const workflow = texturePlan
    ? buildShuttleTextureWorkflow({ id, imageName, runId })
    : buildShuttleWorkflow({ id, imageName, runId });
  if (texturePlan) {
    const mesh = asset.texture_mesh;
    if (!/^[a-f0-9]{64}$/.test(mesh.sha256)) throw new Error('Invalid texture mesh SHA-256.');
    const meshBytes = await readFile(path.join(outputDirectory, mesh.file));
    if (createHash('sha256').update(meshBytes).digest('hex') !== mesh.sha256) {
      throw new Error(`Texture mesh SHA-256 mismatch: ${mesh.file}`);
    }
    console.log(`Texture mesh: ${mesh.file}\nMesh SHA-256: ${mesh.sha256}`);
    console.log('Texture plan only: GPU compatibility, container mount, material and geometry are not verified.');
    console.log(JSON.stringify(workflow, null, 2));
  }
  const prefix = workflow['219'].inputs.value.slice('gq_trellis2/'.length);
  console.log(`Shuttle: ${id}\nInput: ${input.file}\nSHA-256: ${hash}\nOutput prefix: ${prefix}`);
  if (!submit && !preflight) {
    console.log(texturePlan ? 'Dry run only; use --preflight to validate node schemas.' : 'Dry run only; use --preflight or --submit.');
    return;
  }
  let objectInfo = await requestJson(baseUrl, '/object_info');
  validateWorkflow(workflow, objectInfo);
  await checkResources(baseUrl);
  if (!submit) {
    console.log('Preflight passed; no upload or job submitted.');
    return;
  }
  const uploadedName = await ensureReferenceUploaded(baseUrl, objectInfo, imageName, bytes, hash);
  workflow['6'].inputs.image = uploadedName;
  objectInfo = await requestJson(baseUrl, '/object_info');
  const choices = objectInfo.Trellis2LoadImageWithTransparency?.input?.required?.image?.[0];
  if (!Array.isArray(choices) || !choices.includes(uploadedName)) {
    throw new Error(`Uploaded image is unavailable to the loader: ${uploadedName}`);
  }
  validateWorkflow(workflow, objectInfo);
  await checkResources(baseUrl);
  const result = await requestJson(baseUrl, '/prompt', {
    method: 'POST',
    body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
  });
  if (typeof result?.prompt_id !== 'string' || !result.prompt_id) {
    throw new Error(`ComfyUI did not return a prompt ID: ${JSON.stringify(result)}`);
  }
  console.log(`ComfyUI prompt: ${result.prompt_id}`);
  const output = await waitForExport(baseUrl, result.prompt_id, prefix);
  console.log(`GLB: ${output}\nDEV_ONLY: inspection and manual review required.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`[TRELLIS2] ${error.message}`);
    process.exitCode = 1;
  });
}
