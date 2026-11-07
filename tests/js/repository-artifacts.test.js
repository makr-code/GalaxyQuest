// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/check_repository_artifacts.mjs', import.meta.url));
const directories = [];

function repository() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'gq-artifacts-'));
  directories.push(directory);
  execFileSync('git', ['init', '--quiet', directory]);
  return directory;
}

function addFile(directory, name, contents, staged = true) {
  const target = path.join(directory, name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  if (staged) execFileSync('git', ['add', '--', name], { cwd: directory });
}

function check(directory) {
  return spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('repository artifact gate', () => {
  it('accepts an empty index', () => {
    expect(check(repository()).status).toBe(0);
  });

  it('preserves tracked SVG and unrelated gzip assets and ignores local caches', () => {
    const directory = repository();
    addFile(directory, 'generated/textures/planet/fallback.svg', '<svg/>');
    addFile(directory, 'assets/legacy.js.gz', 'fixture');
    addFile(directory, 'generated/textures/planet/local.png', 'cache', false);
    expect(check(directory).status).toBe(0);
  });

  it.each([
    'js/engine/example.ugl.js.gz',
    'js/packages/game.boot.bundle.runtime.js.gz',
  ])('rejects tracked legacy JavaScript gzip output: %s', (name) => {
    const directory = repository();
    addFile(directory, name, 'generated fixture');
    const result = check(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Legacy JavaScript gzip output must not be tracked');
  });

  it.each([
    'generated/comfyui/output/3D/model.glb',
    'generated/trellis2/test_mock_ship.glb',
    'generated/trellis2/fallback_job42.glb',
    'generated/trellis2/image2text/generated.glb',
    'generated/trellis2/text2image/20261107_prompt.glb',
  ])('rejects tracked generated TRELLIS2 output: %s', (name) => {
    const directory = repository();
    addFile(directory, name, 'generated fixture');
    const result = check(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Generated TRELLIS2 output must not be tracked');
  });

  it.each(['png', 'lock'])('rejects a staged texture-cache %s', (extension) => {
    const directory = repository();
    addFile(directory, `generated/textures/planet/cache.${extension}`, '');
    const result = check(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Generated texture cache must not be tracked');
  });

  it('inspects indexed contents rather than a changed working file', () => {
    const directory = repository();
    addFile(directory, 'asset.glb', 'small indexed fixture');
    addFile(directory, 'asset.glb', Buffer.alloc(100 * 1024 * 1024 + 1), false);
    expect(check(directory).status).toBe(0);
  });

  it('accepts exactly 100 MiB and rejects one byte above, including paths with spaces', () => {
    const directory = repository();
    addFile(directory, 'large asset.glb', Buffer.alloc(100 * 1024 * 1024));
    expect(check(directory).status).toBe(0);
    addFile(directory, 'large asset.glb', Buffer.alloc(100 * 1024 * 1024 + 1));
    const result = check(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('large asset.glb is 104857601 bytes; limit is 104857600');
  }, 30_000);

  it('reports Git errors rather than passing outside a repository', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'gq-artifacts-'));
    directories.push(directory);
    const result = check(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('not a git repository');
  });
});
