// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareNativePublication } from '../../deploy/prepare-native-publication.mjs';
import { createStoredZip } from '../helpers/stored-zip.js';

const commit = 'a'.repeat(40);
const version = '0.9.0-alpha.1';
const tag = `v${version}`;
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

describe('versioned native publication without rebuilding', () => {
  let root;
  let source;
  let tree;
  let output;
  let archive;
  let zip;
  let nativeManifest;
  let evidence;

  function pack(extra = []) {
    execFileSync('tar', ['-czf', path.basename(archive), '-C', 'tree', '.', ...extra], {
      cwd: root, timeout: 10000,
    });
    writeFileSync(zip, createStoredZip('native-plesk-candidate.tar.gz', readFileSync(archive)));
    evidence.artifact.digest = sha256(readFileSync(zip));
  }
  function prepare(overrides = {}, inspect = () => evidence) {
    return prepareNativePublication([
      overrides.environment ?? 'staging', overrides.commit ?? commit, overrides.runId ?? '12345',
      overrides.tag ?? tag, zip, output,
    ], inspect, source);
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'gq-native-publication-'));
    source = path.join(root, 'source');
    tree = path.join(root, 'tree');
    output = path.join(root, 'output');
    archive = path.join(root, 'candidate.tar.gz');
    zip = path.join(root, 'candidate.zip');
    mkdirSync(source);
    mkdirSync(output);
    mkdirSync(path.join(tree, 'dist', 'assets'), { recursive: true });
    writeFileSync(path.join(source, 'VERSION.txt'), `${version}\n`);
    writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version }));
    writeFileSync(path.join(source, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }));
    writeFileSync(path.join(source, 'CHANGELOG.md'),
      `## [Unreleased]\n- Development.\n\n## [${version}] - 2026-11-13\n- Native publication.\n`);
    writeFileSync(path.join(tree, 'VERSION.txt'), `${version}\n`);
    writeFileSync(path.join(tree, 'index.php'), '<?php echo "fixture";');
    writeFileSync(path.join(tree, 'dist', 'index.html'), '<script src="/assets/app.js"></script>');
    writeFileSync(path.join(tree, 'dist', 'assets', 'app.js'), '// built asset');
    nativeManifest = { commit, web_image_id: `sha256:${'b'.repeat(64)}`, status: 'not-deployable' };
    writeFileSync(path.join(tree, 'native-release.json'), JSON.stringify(nativeManifest));
    evidence = {
      environment: 'staging', commit, run_id: '12345', attempt: 2,
      artifact: { id: 67890, name: 'native-plesk-candidate-attempt-2', size_in_bytes: 4096, digest: '' },
      status: 'ci-candidate-evidence-only',
    };
    pack();
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('preserves the accepted tar bytes and records both ZIP and package digests without approval', async () => {
    const calls = [];
    const manifest = await prepare({}, (args) => { calls.push(args); return evidence; });
    const name = `galaxyquest-${version}.tar.gz`;
    const bytes = readFileSync(path.join(output, name));
    expect(bytes.equals(readFileSync(archive))).toBe(true);
    expect(calls).toEqual([['staging', commit, '12345']]);
    expect(manifest).toMatchObject({
      schema_version: 1, repository: 'makr-code/GalaxyQuest', tag, version, commit,
      status: 'not-deployable', source_ci: evidence, web_image_id: nativeManifest.web_image_id,
      package: { name, digest: sha256(bytes), size_in_bytes: bytes.length },
    });
    expect(JSON.parse(readFileSync(path.join(output, `galaxyquest-${version}.release.json`), 'utf8')))
      .toEqual(manifest);
    expect(readFileSync(path.join(output, `galaxyquest-${version}.sha256`), 'utf8'))
      .toBe(`${sha256(bytes).slice(7)}  ${name}\n`);
    expect(readdirSync(output).sort()).toEqual([
      name, `galaxyquest-${version}.sha256`, `galaxyquest-${version}.release.json`,
    ].sort());
  });

  it('rejects changed CI artifact evidence instead of publishing a previously downloaded ZIP', async () => {
    evidence.artifact.digest = `sha256:${'c'.repeat(64)}`;
    await expect(prepare()).rejects.toThrow('current CI evidence');
    expect(readdirSync(output)).toEqual([]);
  });

  it('propagates a retried or failed CI run and leaves the output empty', async () => {
    await expect(prepare({}, () => { throw new Error('Workflow run was retried'); }))
      .rejects.toThrow('retried');
    expect(readdirSync(output)).toEqual([]);
  });

  it.each([
    ['wrong commit', { commit: 'c'.repeat(40) }],
    ['invalid image identity', { web_image_id: 'latest' }],
    ['changed deployment status', { status: 'deployable' }],
  ])('rejects %s inside the package', async (_label, changes) => {
    writeFileSync(path.join(tree, 'native-release.json'), JSON.stringify({ ...nativeManifest, ...changes }));
    pack();
    await expect(prepare()).rejects.toThrow();
    expect(readdirSync(output)).toEqual([]);
  });

  it('requires the version inside the archive to match the reviewed tag', async () => {
    writeFileSync(path.join(tree, 'VERSION.txt'), '9.9.9\n');
    pack();
    await expect(prepare()).rejects.toThrow('VERSION.txt');
    expect(readdirSync(output)).toEqual([]);
  });

  it('rejects duplicate archive entries', async () => {
    pack(['./index.php']);
    await expect(prepare()).rejects.toThrow('duplicate');
    expect(readdirSync(output)).toEqual([]);
  });

  it('rejects archive hard links instead of treating them as regular runtime files', async () => {
    linkSync(path.join(tree, 'index.php'), path.join(tree, 'linked.php'));
    pack();
    await expect(prepare()).rejects.toThrow('only regular files and directories');
    expect(readdirSync(output)).toEqual([]);
  });

  it('rejects mutable WordPress contents even with matching CI ZIP digest', async () => {
    mkdirSync(path.join(tree, 'wordpress'));
    writeFileSync(path.join(tree, 'wordpress', 'wp-config.php'), '<?php // fixture');
    pack();
    await expect(prepare()).rejects.toThrow('WordPress');
    expect(readdirSync(output)).toEqual([]);
  });

  it('rejects an unexpected ZIP member without publishing files', async () => {
    writeFileSync(zip, createStoredZip('unexpected.tar.gz', readFileSync(archive)));
    await expect(prepare()).rejects.toThrow('must contain only');
    expect(readdirSync(output)).toEqual([]);
  });

  it('never overwrites existing output and rolls back only files created by the failed operation', async () => {
    const checksum = `galaxyquest-${version}.sha256`;
    writeFileSync(path.join(output, checksum), 'existing operator file');
    await expect(prepare()).rejects.toThrow();
    expect(readdirSync(output)).toEqual([checksum]);
    expect(readFileSync(path.join(output, checksum), 'utf8')).toBe('existing operator file');
  });

  it('rejects a prerelease with production CI and an unreviewed tag', async () => {
    await expect(prepare({ environment: 'production' })).rejects.toThrow('Prereleases');
    await expect(prepare({ tag: 'v9.9.9' })).rejects.toThrow('exactly match');
    expect(readdirSync(output)).toEqual([]);
  });

  it('rejects a missing tag before metadata validation or GitHub access', async () => {
    await expect(prepareNativePublication(
      ['staging', commit, '12345', null, zip, output],
      () => { throw new Error('GitHub must not be called'); }, source,
    )).rejects.toThrow('Invalid source identity');
    expect(readdirSync(output)).toEqual([]);
  });

  it('does not contact GitHub for invalid CLI inputs', () => {
    const result = spawnSync(process.execPath, [
      path.resolve('deploy', 'prepare-native-publication.mjs'), 'staging',
    ], { encoding: 'utf8', timeout: 10000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage:');
  });
});
