import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, constants, copyFileSync, createReadStream, lstatSync, mkdtempSync,
  openSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkReleaseMetadata } from '../scripts/check_release_metadata.mjs';
import { inspectGitHubCi } from './inspect-github-ci.mjs';

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function command(program, args, options = {}) {
  return execFileSync(program, args, {
    encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024, ...options,
  });
}

function inspectArchive(archive, commit, version) {
  // GNU tar interprets a Windows drive prefix as a remote archive host.
  const tar = (args, options = {}) => command('tar', args, { cwd: path.dirname(archive), ...options });
  const name = path.basename(archive);
  const entries = tar(['-tzf', name]).replaceAll('\r\n', '\n').trimEnd().split('\n');
  const seen = new Set();
  for (const entry of entries) {
    const relative = entry.slice(2).replace(/\/$/, '');
    if (!entry.startsWith('./') || /[\\\u0000-\u001f]/.test(relative)
      || (relative !== '' && relative.split('/').some((part) => ['', '.', '..'].includes(part)))
      || seen.has(relative)) {
      throw new Error('Candidate contains duplicate, ambiguous or traversing archive paths.');
    }
    seen.add(relative);
  }
  const details = tar(['-tvzf', name]).trimEnd().split('\n');
  if (details.length !== entries.length || details.some((line) => !['-', 'd'].includes(line[0]))) {
    throw new Error('Candidate may contain only regular files and directories.');
  }
  for (const required of ['./native-release.json', './VERSION.txt', './index.php', './dist/index.html']) {
    if (!entries.includes(required)) throw new Error(`Candidate is missing ${required}.`);
  }
  if (!entries.some((entry) => /^\.\/dist\/assets\/.+\.js$/.test(entry))) {
    throw new Error('Candidate has no built JavaScript assets.');
  }
  if (entries.some((entry) => /^\.\/(?:wordpress|generated|cache|\.git|node_modules)(?:\/|$)/.test(entry))) {
    throw new Error('Candidate contains mutable, WordPress or development content.');
  }
  const manifest = JSON.parse(tar(['-xOzf', name, './native-release.json'], {
    maxBuffer: 65536,
  }));
  assert.deepEqual(manifest, {
    commit, web_image_id: manifest.web_image_id, status: 'not-deployable',
  }, 'Candidate commit or non-deployable manifest does not match');
  assert.match(manifest.web_image_id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(tar(['-xOzf', name, './VERSION.txt'], { maxBuffer: 65536 }).trim(), version,
    'Candidate VERSION.txt does not match the release tag');
  return manifest;
}

export async function prepareNativePublication(args, inspect = inspectGitHubCi, source = process.cwd()) {
  if (args.length !== 6) {
    throw new Error('Usage: prepare-native-publication.mjs staging|production FULL_COMMIT_SHA RUN_ID TAG CANDIDATE_ZIP OUTPUT_DIR');
  }
  const [environment, commit, runId, tag, zip, output] = args;
  if (args.some((arg) => typeof arg !== 'string')
    || !tag || !['staging', 'production'].includes(environment) || !/^[a-f0-9]{40}$/.test(commit)
    || !/^[1-9][0-9]*$/.test(runId) || !Number.isSafeInteger(Number(runId))
    || !path.isAbsolute(zip) || !path.isAbsolute(output)) {
    throw new Error('Invalid source identity or absolute publication paths.');
  }
  const metadata = await checkReleaseMetadata(source, tag);
  if (metadata.prerelease !== (environment === 'staging')) {
    throw new Error('Prereleases require staging/develop CI; stable versions require production/main CI.');
  }
  if (!lstatSync(zip).isFile() || !lstatSync(output).isDirectory()) {
    throw new Error('Candidate ZIP and output directory must be regular paths, not symbolic links.');
  }
  const temporary = mkdtempSync(path.join(output, '.native-publication-'));
  const created = [];
  try {
    const entries = command('unzip', ['-Z1', zip]).replace(/\r?\n$/, '');
    if (entries !== 'native-plesk-candidate.tar.gz') {
      throw new Error('CI ZIP must contain only native-plesk-candidate.tar.gz.');
    }
    const archive = path.join(temporary, 'candidate.tar.gz');
    const file = openSync(archive, 'wx', 0o600);
    try {
      command('unzip', ['-p', zip, 'native-plesk-candidate.tar.gz'], {
        stdio: ['ignore', file, 'pipe'],
      });
    } finally {
      closeSync(file);
    }
    const nativeManifest = inspectArchive(archive, commit, metadata.version);
    const archiveDigest = await digest(archive);
    const zipDigest = `sha256:${await digest(zip)}`;
    // Recheck the attempt and artifact after reading the package, not just before download.
    const evidence = inspect([environment, commit, runId]);
    assert.equal(zipDigest, evidence.artifact.digest, 'Candidate ZIP does not match current CI evidence');
    const name = `galaxyquest-${metadata.version}.tar.gz`;
    const manifest = {
      schema_version: 1,
      repository: 'makr-code/GalaxyQuest',
      tag,
      version: metadata.version,
      commit,
      status: 'not-deployable',
      package: { name, digest: `sha256:${archiveDigest}`, size_in_bytes: lstatSync(archive).size },
      source_ci: evidence,
      web_image_id: nativeManifest.web_image_id,
    };
    const archiveOutput = path.join(output, name);
    copyFileSync(archive, archiveOutput, constants.COPYFILE_EXCL);
    created.push(archiveOutput);
    for (const [filename, body] of [
      [`galaxyquest-${metadata.version}.sha256`, `${archiveDigest}  ${name}\n`],
      [`galaxyquest-${metadata.version}.release.json`, `${JSON.stringify(manifest, null, 2)}\n`],
    ]) {
      const destination = path.join(output, filename);
      const file = openSync(destination, 'wx', 0o600);
      created.push(destination);
      try {
        writeFileSync(file, body);
      } finally {
        closeSync(file);
      }
    }
    return manifest;
  } catch (error) {
    for (const file of created) rmSync(file);
    throw error;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  prepareNativePublication(process.argv.slice(2)).then((manifest) => {
    console.log(JSON.stringify(manifest));
  }).catch((error) => {
    console.error(`NATIVE PUBLICATION: ${error.message}`);
    process.exitCode = 1;
  });
}
