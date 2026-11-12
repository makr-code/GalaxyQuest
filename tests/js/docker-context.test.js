// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = path.resolve('scripts', 'check_docker_context.mjs');
const policy = readFileSync(path.resolve('.dockerignore'), 'utf8');

// Explicit opt-in: these tests exercise a real local Docker daemon, not a glob mock.
describe.skipIf(process.env.GQ_DOCKER_CONTEXT_TESTS !== '1')('real Docker context gate', () => {
  function run(contents) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'gq-context-policy-'));
    try {
      writeFileSync(path.join(directory, '.dockerignore'), contents);
      const result = spawnSync(process.execPath, [script], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 180000,
      });
      if (result.error) throw result.error;
      return result;
    } finally {
      rmSync(directory, { recursive: true });
    }
  }

  it('excludes private fixtures and preserves exact runtime input bytes', () => {
    const result = run(policy);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('68 excluded and 26 retained fixtures');
  }, 180000);

  it('rejects a weakened environment exclusion using actual Docker COPY', () => {
    const weakened = policy.split('\n')
      .filter((line) => !line.trim().startsWith('**/.env')).join('\n');
    const result = run(weakened);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Local/private material included: .env');
  }, 180000);

  it('rejects exclusions that accidentally remove required backend code', () => {
    const result = run(`${policy}\napi\n`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Required runtime input excluded: api/helpers.php');
  }, 180000);
});
