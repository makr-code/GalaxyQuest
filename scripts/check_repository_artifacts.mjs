import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const maxBlobBytes = 100 * 1024 * 1024;
const gitOptions = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };

// Inspect the index, not local caches or unstaged file contents.
const { stdout: tree } = await execFileAsync('git', ['write-tree'], gitOptions);
const { stdout: listing } = await execFileAsync(
  'git', ['ls-tree', '-r', '-l', '-z', tree.trim()], gitOptions,
);
const failures = [];
let blobCount = 0;

for (const record of listing.split('\0').filter(Boolean)) {
  const separator = record.indexOf('\t');
  if (separator === -1) throw new Error(`Invalid Git tree record: ${record}`);
  const metadata = record.slice(0, separator).trim().split(/\s+/);
  const name = record.slice(separator + 1);
  if (metadata[1] === 'commit') continue;
  const bytes = Number(metadata[3]);
  if (metadata[1] !== 'blob' || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(`Invalid Git blob metadata: ${record}`);
  }
  blobCount += 1;
  if (/^generated\/textures\/.*\.(?:png|lock)$/i.test(name)) {
    failures.push(`Generated texture cache must not be tracked: ${name}`);
  }
  if (
    /^generated\/comfyui\/output\/3d\/[^/]+\.glb$/i.test(name)
    || /^generated\/trellis2\/[^/]+\.glb$/i.test(name)
    || /^generated\/trellis2\/fallback_job[^/]*\.glb$/i.test(name)
    || /^generated\/trellis2\/image2text\/[^/]+\.glb$/i.test(name)
    || /^generated\/trellis2\/text2image\/[^/]*_prompt\.glb$/i.test(name)
  ) {
    failures.push(`Generated TRELLIS2 output must not be tracked: ${name}`);
  }
  if (/^js\/.*\.ugl\.js\.gz$/i.test(name) || /^js\/packages\/game\.boot\.bundle(?:\.[^/]+)?\.js\.gz$/i.test(name)) {
    failures.push(`Legacy JavaScript gzip output must not be tracked: ${name}`);
  }
  if (bytes > maxBlobBytes) {
    failures.push(`Git blob ${name} is ${bytes} bytes; limit is ${maxBlobBytes}.`);
  }
}

if (failures.length > 0) throw new Error(failures.join('\n'));
console.log(`Repository artifact gate passed: ${blobCount} indexed files; maximum blob 100 MiB.`);
