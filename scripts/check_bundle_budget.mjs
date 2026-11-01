import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const assetsDirectory = path.resolve('dist', 'assets');
const maxChunkBytes = 1.25 * 1024 * 1024;
const maxTotalGzipBytes = 650 * 1024;
const assetNames = (await readdir(assetsDirectory)).filter((name) => name.endsWith('.js'));

if (assetNames.length === 0) {
  throw new Error(`No JavaScript assets found in ${assetsDirectory}`);
}

let totalGzipBytes = 0;
let largestChunk;

for (const name of assetNames) {
  const contents = await readFile(path.join(assetsDirectory, name));
  const gzipBytes = gzipSync(contents).byteLength;
  totalGzipBytes += gzipBytes;

  if (!largestChunk || contents.byteLength > largestChunk.bytes) {
    largestChunk = { name, bytes: contents.byteLength };
  }
}

const failures = [];

if (largestChunk.bytes > maxChunkBytes) {
  failures.push(
    `Largest chunk ${largestChunk.name} is ${largestChunk.bytes} bytes; limit is ${maxChunkBytes}.`,
  );
}

if (totalGzipBytes > maxTotalGzipBytes) {
  failures.push(
    `JavaScript gzip total is ${totalGzipBytes} bytes; limit is ${maxTotalGzipBytes}.`,
  );
}

console.log(
  `JavaScript bundle budget: ${assetNames.length} chunks; largest ${largestChunk.name} `
  + `${(largestChunk.bytes / 1024).toFixed(1)} KiB; total gzip `
  + `${(totalGzipBytes / 1024).toFixed(1)} / ${(maxTotalGzipBytes / 1024).toFixed(0)} KiB.`,
);

if (failures.length > 0) {
  throw new Error(failures.join('\n'));
}
