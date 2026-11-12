// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const hasRequiredTools = spawnSync(bash, [
  '-c',
  'for tool in curl unzip sha256sum tar mktemp awk ln stat find chmod mv mkdir rm cat grep; do command -v "$tool" >/dev/null || exit 1; done; tar --version | grep -Fq "GNU tar"; stat --version | grep -Fq "GNU coreutils"; mv --version | grep -Fq "GNU coreutils"',
], { encoding: 'utf8' }).status === 0;

describe.skipIf(!hasRequiredTools)('read-only native candidate host preflight', () => {
  const shellPath = (value) => process.platform === 'win32'
    ? `/${value[0].toLowerCase()}${value.slice(2).replaceAll('\\', '/')}`
    : value;
  const script = shellPath(path.resolve('deploy', 'preflight-native-candidate-host.sh'));
  let root;
  let spool;
  let candidateRoot;
  let stagingDocumentRoot;
  let productionDocumentRoot;
  let bashEnv;

  function run(spoolPath = spool, candidatePath = candidateRoot, spoolMode = '700') {
    return spawnSync(bash, [
      script,
      shellPath(spoolPath),
      shellPath(candidatePath),
      shellPath(stagingDocumentRoot),
      shellPath(productionDocumentRoot),
    ], {
      encoding: 'utf8',
      timeout: 10000,
      env: process.platform === 'win32'
        ? { ...process.env, BASH_ENV: shellPath(bashEnv), PREFLIGHT_SPOOL_MODE: spoolMode }
        : process.env,
    });
  }

  beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'gq-native-host-preflight-'));
    spool = path.join(root, 'private', 'spool');
    candidateRoot = path.join(root, 'private', 'candidates');
    stagingDocumentRoot = path.join(root, 'staging', 'httpdocs');
    productionDocumentRoot = path.join(root, 'production', 'httpdocs');
    bashEnv = path.join(root, 'bash-env.sh');
    mkdirSync(spool, { recursive: true });
    mkdirSync(candidateRoot, { recursive: true });
    mkdirSync(stagingDocumentRoot, { recursive: true });
    mkdirSync(productionDocumentRoot, { recursive: true });
    if (process.platform !== 'win32') {
      chmodSync(path.join(root, 'private'), 0o700);
      chmodSync(spool, 0o700);
      chmodSync(candidateRoot, 0o700);
    } else {
      writeFileSync(bashEnv, `
stat() {
  if [[ "$1" == "--version" ]]; then printf 'stat (GNU coreutils) 9.5\\n'
  elif [[ "$1" == "-c" && "$2" == "%a" ]]; then
    case "$4" in */spool) printf '%s\\n' "$PREFLIGHT_SPOOL_MODE" ;; *) printf '700\\n' ;; esac
  else command stat "$@"
  fi
}
`);
    }
  });

  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it('accepts private roots outside both document roots without changing them', () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(spool)).toEqual([]);
    expect(readdirSync(candidateRoot)).toEqual([]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'native-candidate-host-preflight-passed',
      document_roots_checked: 2,
      downloaded: false,
      staged: false,
      activated: false,
    });
  });

  it('rejects private roots with group or other permissions', () => {
    if (process.platform !== 'win32') chmodSync(spool, 0o750);
    const result = run(spool, candidateRoot, '750');
    if (process.platform !== 'win32') chmodSync(spool, 0o700);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('permissions must exclude group and other access');
  });

  it('rejects private roots inside a supplied document root', () => {
    const exposedSpool = path.join(stagingDocumentRoot, 'private-spool');
    mkdirSync(exposedSpool);
    chmodSync(exposedSpool, 0o700);
    const result = run(exposedSpool);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('overlaps a supplied document root');
  });

  it('rejects nested spool and candidate roots', () => {
    const nestedCandidateRoot = path.join(spool, 'candidates');
    mkdirSync(nestedCandidateRoot);
    chmodSync(nestedCandidateRoot, 0o700);
    const result = run(spool, nestedCandidateRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must be separate, non-nested directories');
  });
});
