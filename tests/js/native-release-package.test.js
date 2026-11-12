// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe.skipIf(process.env.GQ_DOCKER_CONTEXT_TESTS !== '1')('native release candidate', () => {
  const tag = `gq-native-package-test:${randomBytes(8).toString('hex')}`;
  const otherTag = `${tag}-wrong-revision`;
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  const shellPath = (value) => process.platform === 'win32'
    ? `/${value[0].toLowerCase()}${value.slice(2).replaceAll('\\', '/')}`
    : value;
  const script = shellPath(path.resolve('deploy', 'package-native-release.sh'));
  let root;
  let context;
  let commit;
  let image;
  let otherImage;
  let built = false;
  let otherBuilt = false;

  function run(sha, output, id = image) {
    return spawnSync(bash, [script, id, sha, shellPath(output)], {
      encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    });
  }
  function tar(archive, ...args) {
    return execFileSync('tar', [...args, archive], { encoding: 'utf8', timeout: 30000 });
  }

  beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'gq-native-package-'));
    context = path.join(root, 'context');
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    mkdirSync(path.join(context, 'dist', 'assets'), { recursive: true });
    writeFileSync(path.join(context, 'Dockerfile'),
      `FROM scratch\nLABEL org.opencontainers.image.revision="${commit}"\nCOPY dist /var/www/html/dist\nCMD ["/not-executed"]\n`);
    writeFileSync(path.join(context, 'dist', 'index.html'), '<script src="/assets/app.js"></script>\n');
    writeFileSync(path.join(context, 'dist', 'assets', 'app.js'), 'fixture\n');
    execFileSync('docker', ['build', '--network=none', '--tag', tag, context], { timeout: 120000 });
    built = true;
    image = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', tag], { encoding: 'utf8' }).trim();
    execFileSync('docker', [
      'build', '--network=none', '--tag', otherTag, '--label', `org.opencontainers.image.revision=${'0'.repeat(40)}`, context,
    ], { timeout: 120000 });
    otherBuilt = true;
    otherImage = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', otherTag], { encoding: 'utf8' }).trim();
  }, 150000);

  afterAll(() => {
    try {
      if (otherBuilt) execFileSync('docker', ['image', 'rm', otherTag], { timeout: 30000 });
      if (built) execFileSync('docker', ['image', 'rm', tag], { timeout: 30000 });
    } finally {
      if (root) rmSync(root, { recursive: true, force: true });
    }
  });

  it('exports selected commit files and accepted image frontend without mutable data', () => {
    const archive = path.join(root, 'release.tar.gz');
    const result = run(commit, archive);
    expect(result.status, result.stderr).toBe(0);
    const entries = tar(archive, '-tzf').replaceAll('\r\n', '\n').split('\n');
    for (const entry of ['./index.php', './config/config.php', './sql/schema.sql', './dist/index.html', './dist/assets/app.js', './native-release.json']) {
      expect(entries).toContain(entry);
    }
    expect(entries.some((entry) => /^\.\/(generated|cache|wordpress|node_modules|\.git)(\/|$)/.test(entry))).toBe(false);
    const index = execFileSync('tar', ['-xOzf', archive, './index.php'], { encoding: 'utf8' });
    const sourceArchive = execFileSync('git', ['archive', commit, 'index.php']);
    const source = execFileSync('tar', ['-xOf', '-', 'index.php'], { input: sourceArchive, encoding: 'utf8' });
    expect(index).toBe(source);
    const manifest = JSON.parse(execFileSync('tar', ['-xOzf', archive, './native-release.json'], { encoding: 'utf8' }));
    expect(manifest).toEqual({ commit, web_image_id: image, status: 'not-deployable' });
  }, 150000);

  it('produces identical bytes for identical inputs and never overwrites an archive', () => {
    const first = path.join(root, 'release.tar.gz');
    const second = path.join(root, 'second.tar.gz');
    const result = run(commit, second);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(second).equals(readFileSync(first))).toBe(true);
    const existing = run(commit, second);
    expect(existing.status).not.toBe(0);
    expect(existing.stderr).toContain('Output already exists');
  }, 150000);

  it('rejects mutable image references and mismatching image revisions', () => {
    const tagResult = run(commit, path.join(root, 'tag.tar.gz'), tag);
    expect(tagResult.status).not.toBe(0);
    expect(tagResult.stderr).toContain('immutable local image ID');
    const mismatch = run(commit, path.join(root, 'mismatch.tar.gz'), otherImage);
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.stderr).toContain('revision label does not match');
  }, 150000);
});
