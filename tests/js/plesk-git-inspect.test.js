// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('read-only Plesk Git inspection', () => {
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  const shellPath = (value) => process.platform === 'win32'
    ? `/${value[0].toLowerCase()}${value.slice(2).replaceAll('\\', '/')}`
    : value;
  const script = shellPath(path.resolve('deploy', 'inspect-plesk-git.sh'));
  let root;
  let bare;
  let work;
  let commit;

  function git(args) {
    return execFileSync('git', args, { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  }
  function inspect(environment, repository = bare, expected = commit) {
    return spawnSync(bash, [script, environment, shellPath(repository), expected], {
      encoding: 'utf8', timeout: 10000,
    });
  }

  beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'gq-plesk-git-'));
    bare = path.join(root, 'source.git');
    work = path.join(root, 'work');
    mkdirSync(work);
    git(['init', '-q', work]);
    git(['-C', work, 'config', 'user.name', 'Test']);
    git(['-C', work, 'config', 'user.email', 'test@example.invalid']);
    writeFileSync(path.join(work, 'fixture'), 'fixture\n');
    git(['-C', work, 'add', 'fixture']);
    git(['-C', work, 'commit', '-qm', 'fixture']);
    commit = git(['-C', work, 'rev-parse', 'HEAD']);
    git(['clone', '-q', '--bare', work, bare]);
    git([`--git-dir=${bare}`, 'config', 'remote.origin.url', 'https://github.com/makr-code/GalaxyQuest.git']);
    git([`--git-dir=${bare}`, 'update-ref', 'refs/heads/develop', commit]);
    git([`--git-dir=${bare}`, 'update-ref', 'refs/heads/main', commit]);
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it.each([['staging', 'develop'], ['production', 'main']])('reports matching %s source', (environment, branch) => {
    const configBefore = readFileSync(path.join(bare, 'config'), 'utf8');
    const result = inspect(environment);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ environment, branch, commit, status: 'source-only' });
    expect(readFileSync(path.join(bare, 'config'), 'utf8')).toBe(configBefore);
    expect(git([`--git-dir=${bare}`, 'rev-parse', `refs/heads/${branch}`])).toBe(commit);
  });
  it('rejects a different expected commit', () => {
    const result = inspect('staging', bare, '0'.repeat(40));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match');
  });
  it('rejects invalid environment, SHA, and non-bare repositories', () => {
    expect(inspect('other').status).not.toBe(0);
    expect(inspect('staging', bare, 'HEAD').status).not.toBe(0);
    expect(inspect('staging', work).status).not.toBe(0);
  });
  it('rejects a different origin', () => {
    git([`--git-dir=${bare}`, 'config', 'remote.origin.url', 'https://example.invalid/repository.git']);
    try {
      const result = inspect('staging');
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Unexpected origin');
    } finally {
      git([`--git-dir=${bare}`, 'config', 'remote.origin.url', 'https://github.com/makr-code/GalaxyQuest.git']);
    }
  });
  it('rejects a missing branch', () => {
    git([`--git-dir=${bare}`, 'update-ref', '-d', 'refs/heads/main']);
    try {
      const result = inspect('production');
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Missing branch main');
    } finally {
      git([`--git-dir=${bare}`, 'update-ref', 'refs/heads/main', commit]);
    }
  });
});
