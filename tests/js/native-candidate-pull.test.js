// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(name, content) {
  const filename = Buffer.from(name);
  const data = Buffer.from(content);
  const checksum = crc32(data);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(filename.length, 26);
  const local = Buffer.concat([localHeader, filename, data]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(data.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(filename.length, 28);
  const central = Buffer.concat([centralHeader, filename]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const hasRequiredTools = spawnSync(bash, ['-c', 'command -v unzip >/dev/null && command -v tar >/dev/null'], {
  encoding: 'utf8',
}).status === 0;

describe('non-deploying native candidate pull', () => {
  const shellPath = (value) => process.platform === 'win32'
    ? `/${value[0].toLowerCase()}${value.slice(2).replaceAll('\\', '/')}`
    : value;
  const script = shellPath(path.resolve('deploy', 'pull-native-candidate.sh'));
  const stageScript = shellPath(path.resolve('deploy', 'stage-native-candidate.sh'));
  let root;
  let spool;
  let candidateRoot;
  let bin;
  let fixtureZip;
  let traversalZip;
  let digest;
  let traversalDigest;

  function pull(expectedDigest = digest, token = 'ghp_test_token_1234567890', commit = 'a'.repeat(40)) {
    return spawnSync(bash, [
      '-c',
      'PATH="$1:$PATH"; shift; exec "$@"',
      'bash',
      shellPath(bin),
      script,
      '12345',
      expectedDigest,
      commit,
      shellPath(spool),
    ], {
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        GH_TOKEN: token,
        GQ_FIXTURE_ZIP: shellPath(fixtureZip),
      },
    });
  }

  function stage(zip = fixtureZip, expectedDigest = digest, commit = 'a'.repeat(40)) {
    return spawnSync(bash, [
      '-c',
      'PATH="$1:$PATH"; shift; exec "$@"',
      'bash',
      shellPath(bin),
      stageScript,
      shellPath(zip),
      expectedDigest,
      commit,
      shellPath(candidateRoot),
    ], { encoding: 'utf8', timeout: 30000 });
  }

  beforeAll(() => {
    if (!hasRequiredTools) return;

    root = mkdtempSync(path.join(os.tmpdir(), 'gq-native-candidate-pull-'));
    spool = path.join(root, 'spool');
    candidateRoot = path.join(root, 'staged');
    bin = path.join(root, 'bin');
    const release = path.join(root, 'release');
    const releaseAssets = path.join(release, 'dist', 'assets');
    mkdirSync(spool);
    mkdirSync(candidateRoot);
    mkdirSync(bin);
    mkdirSync(release);
    mkdirSync(releaseAssets, { recursive: true });
    writeFileSync(path.join(release, 'native-release.json'),
      `{"commit":"${'a'.repeat(40)}","web_image_id":"sha256:${'b'.repeat(64)}","status":"not-deployable"}`);
    writeFileSync(path.join(release, 'index.php'), '<?php declare(strict_types=1);\n');
    writeFileSync(path.join(release, 'dist', 'index.html'), '<main>candidate</main>\n');
    writeFileSync(path.join(releaseAssets, 'app.js'), 'fixture\n');
    fixtureZip = path.join(root, 'candidate.zip');
    const releaseTar = path.join(root, 'native-plesk-candidate.tar.gz');
    execFileSync(bash, ['-c', 'tar -czf "$1" -C "$2" .', 'bash', shellPath(releaseTar), shellPath(release)], {
      timeout: 10000,
    });
    writeFileSync(fixtureZip, createStoredZip('native-plesk-candidate.tar.gz', readFileSync(releaseTar)));
    digest = `sha256:${createHash('sha256').update(readFileSync(fixtureZip)).digest('hex')}`;

    const traversalTar = path.join(root, 'traversal.tar.gz');
    execFileSync(bash, [
      '-c',
      'tar --transform=\'s|^\\./native-release.json$|../escape|\' -czf "$1" -C "$2" .',
      'bash',
      shellPath(traversalTar),
      shellPath(release),
    ], { timeout: 10000 });
    traversalZip = path.join(root, 'traversal.zip');
    writeFileSync(traversalZip, createStoredZip('native-plesk-candidate.tar.gz', readFileSync(traversalTar)));
    traversalDigest = `sha256:${createHash('sha256').update(readFileSync(traversalZip)).digest('hex')}`;

    const mockCurl = path.join(bin, 'curl');
    writeFileSync(mockCurl, `#!/usr/bin/env bash
set -Eeuo pipefail
config=''
headers=''
output=''
url=''
while (($#)); do
  case "$1" in
    --config) config=$2; shift 2 ;;
    --dump-header) headers=$2; shift 2 ;;
    --output) output=$2; shift 2 ;;
    --write-out) shift 2 ;;
    --header) shift 2 ;;
    https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
if [[ "$config" == *github-api.conf ]]; then
  grep -Fxq 'header = "Authorization: Bearer ghp_test_token_1234567890"' "$config"
  [[ "$url" == https://api.github.com/repos/makr-code/GalaxyQuest/actions/artifacts/12345/zip ]]
  printf 'HTTP/2 302\\r\\nLocation: https://objects.example.invalid/artifact\\r\\n\\r\\n' > "$headers"
  printf 302
elif [[ "$config" == *download.conf ]]; then
  ! grep -qi authorization "$config"
  grep -Fq 'url = "https://objects.example.invalid/artifact"' "$config"
  output_line=$(grep '^output = ' "$config")
  output=\${output_line#output = \\\"}
  output=\${output%\\\"}
  cp "$GQ_FIXTURE_ZIP" "$output"
else
  exit 2
fi
`);
    chmodSync(mockCurl, 0o755);
    execFileSync(bash, ['-c', 'chmod 700 "$1"', 'bash', shellPath(spool)]);
    execFileSync(bash, ['-c', 'chmod 700 "$1"', 'bash', shellPath(candidateRoot)]);
  });

  beforeEach(() => {
    if (!hasRequiredTools) return;
    for (const entry of readdirSync(spool)) rmSync(path.join(spool, entry), { recursive: true, force: true });
    for (const entry of readdirSync(candidateRoot)) {
      rmSync(path.join(candidateRoot, entry), { recursive: true, force: true });
    }
  });

  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it.skipIf(!hasRequiredTools)('downloads only the digest-matched ZIP into the private spool without extracting it', () => {
    const result = pull();
    expect(result.status, result.stderr).toBe(0);
    const output = path.join(spool, `native-plesk-candidate-${'a'.repeat(40)}-12345.zip`);
    expect(readFileSync(output)).toEqual(readFileSync(fixtureZip));
    expect(readdirSync(spool)).toEqual([path.basename(output)]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      artifact_id: 12345,
      digest,
      commit: 'a'.repeat(40),
      file: path.basename(output),
      status: 'downloaded-unexpanded-not-deployable',
    }, 30000);
  });

  it.skipIf(!hasRequiredTools)('rejects a digest mismatch and removes temporary files', () => {
    const result = pull(`sha256:${'0'.repeat(64)}`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SHA-256 does not match');
    expect(readdirSync(spool)).toEqual([]);
  }, 30000);

  it.skipIf(!hasRequiredTools)('rejects an archive whose manifest commit differs from the verified commit', () => {
    const result = pull(digest, 'ghp_test_token_1234567890', 'c'.repeat(40));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('manifest does not match');
    expect(readdirSync(spool)).toEqual([]);
  }, 30000);

  it.skipIf(!hasRequiredTools)('rejects missing credentials before making an API request', () => {
    const result = pull(digest, '');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('GH_TOKEN');
    expect(readdirSync(spool)).toEqual([]);
  }, 30000);

  it.skipIf(!hasRequiredTools)('stages validated files privately without activating them', () => {
    const result = stage();
    expect(result.status, result.stderr).toBe(0);
    const destination = path.join(candidateRoot, 'a'.repeat(40));
    expect(readFileSync(path.join(destination, 'index.php'), 'utf8')).toContain('declare(strict_types=1)');
    expect(readFileSync(path.join(destination, 'dist', 'assets', 'app.js'), 'utf8')).toBe('fixture\n');
    expect(readdirSync(candidateRoot)).toEqual(['a'.repeat(40)]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      commit: 'a'.repeat(40),
      directory: 'a'.repeat(40),
      status: 'staged-private-not-deployable',
    });
  }, 30000);

  it.skipIf(!hasRequiredTools)('rejects path traversal before extracting any candidate files', () => {
    const result = stage(traversalZip, traversalDigest);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/outside its release root|traversal/);
    expect(readdirSync(candidateRoot)).toEqual([]);
    expect(existsSync(path.join(root, 'escape'))).toBe(false);
  }, 30000);
});
