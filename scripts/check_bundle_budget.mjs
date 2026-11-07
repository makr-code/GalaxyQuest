import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const distributionDirectory = path.resolve('dist');
const assetsDirectory = path.join(distributionDirectory, 'assets');
const maxChunkBytes = 1.25 * 1024 * 1024;
const maxInitialGzipBytes = 650 * 1024;
const maxTotalGzipBytes = 800 * 1024;
const assetNames = (await readdir(assetsDirectory)).filter((name) => name.endsWith('.js'));

if (assetNames.length === 0) {
  throw new Error(`No JavaScript assets found in ${assetsDirectory}`);
}

const html = await readFile(path.join(distributionDirectory, 'index.html'), 'utf8');
const initialAssets = new Set();
const getAttribute = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];

for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
  const [tag, tagName] = match;
  const isModuleScript = tagName.toLowerCase() === 'script' && getAttribute(tag, 'type') === 'module';
  const isModulePreload = tagName.toLowerCase() === 'link' && getAttribute(tag, 'rel') === 'modulepreload';
  if (!isModuleScript && !isModulePreload) continue;

  const assetUrl = getAttribute(tag, isModuleScript ? 'src' : 'href');
  if (!assetUrl || !/\.js(?:[?#]|$)/i.test(assetUrl)) continue;

  const relativePath = decodeURIComponent(new URL(assetUrl, 'https://galaxyquest.invalid').pathname)
    .replace(/^[/\\]+/, '');
  const absolutePath = path.resolve(distributionDirectory, relativePath);
  const resolvedPath = path.relative(distributionDirectory, absolutePath);
  if (resolvedPath.startsWith('..') || path.isAbsolute(resolvedPath)) {
    throw new Error(`Initial JavaScript asset escapes the distribution directory: ${assetUrl}`);
  }
  initialAssets.add(absolutePath);
}

if (initialAssets.size === 0) {
  throw new Error(`No initial JavaScript entry or modulepreload assets found in ${path.join(distributionDirectory, 'index.html')}`);
}

let totalGzipBytes = 0;
let initialGzipBytes = 0;
let largestChunk;

for (const name of assetNames) {
  const contents = await readFile(path.join(assetsDirectory, name));
  const gzipBytes = gzipSync(contents).byteLength;
  totalGzipBytes += gzipBytes;
  if (initialAssets.has(path.join(assetsDirectory, name))) {
    initialGzipBytes += gzipBytes;
  }

  if (!largestChunk || contents.byteLength > largestChunk.bytes) {
    largestChunk = { name, bytes: contents.byteLength };
  }
}

for (const assetPath of initialAssets) {
  if (!assetNames.some((name) => path.join(assetsDirectory, name) === assetPath)) {
    throw new Error(`Initial JavaScript asset is missing from ${assetsDirectory}: ${assetPath}`);
  }
}

const failures = [];

if (largestChunk.bytes > maxChunkBytes) {
  failures.push(
    `Largest chunk ${largestChunk.name} is ${largestChunk.bytes} bytes; limit is ${maxChunkBytes}.`,
  );
}

if (initialGzipBytes > maxInitialGzipBytes) {
  failures.push(
    `Initial JavaScript gzip total is ${initialGzipBytes} bytes; limit is ${maxInitialGzipBytes}.`,
  );
}

if (totalGzipBytes > maxTotalGzipBytes) {
  failures.push(
    `All JavaScript asset gzip total is ${totalGzipBytes} bytes; limit is ${maxTotalGzipBytes}.`,
  );
}

console.log(
  `JavaScript bundle budget: ${initialAssets.size} initial assets at ${(initialGzipBytes / 1024).toFixed(1)} `
  + `/ ${(maxInitialGzipBytes / 1024).toFixed(0)} KiB gzip; ${assetNames.length} total chunks, `
  + `${(totalGzipBytes / 1024).toFixed(1)} / ${(maxTotalGzipBytes / 1024).toFixed(0)} KiB gzip; largest `
  + `${largestChunk.name} ${(largestChunk.bytes / 1024).toFixed(1)} KiB.`,
);

if (failures.length > 0) {
  throw new Error(failures.join('\n'));
}
