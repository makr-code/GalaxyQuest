// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const read = (file) => readFileSync(path.resolve(file), 'utf8').replaceAll('\r\n', '\n');
const compose = read('deploy/compose.yml');
const workflow = read('.github/workflows/deploy-plesk.yml');
const ci = read('.github/workflows/ci.yml');
const stack = read('deploy/stack.sh');

describe('protected Plesk delivery', () => {
  it('gates image publication on isolated native database compatibility', () => {
    expect(ci).toContain('native-db:');
    expect(ci).toContain('npm run check:native-db-compatibility');
    expect(ci).toMatch(/needs:\s*\[lint-php, lint-js, phpunit-unit, phpunit, vitest, playwright-smoke, native-db\]/);
  });

  it('accepts the exact native candidate on PHP 8.4 Apache before preserving it', () => {
    const packageStep = ci.indexOf('bash deploy/package-native-release.sh');
    const acceptanceStep = ci.indexOf('node scripts/check_native_candidate_http.mjs');
    const artifactStep = ci.indexOf('name: native-plesk-candidate-attempt-');
    expect(packageStep).toBeGreaterThanOrEqual(0);
    expect(acceptanceStep).toBeGreaterThan(packageStep);
    expect(artifactStep).toBeGreaterThan(acceptanceStep);
  });

  it('blocks the superseded reusable workflow without remote access', () => {
    const block = workflow.indexOf('name: Block superseded container deployment');
    expect(block).toBeGreaterThan(-1);
    expect(workflow).toContain('exit 1');
    expect(workflow).not.toMatch(/ssh |scp |PLESK_SSH_KEY|PLESK_KNOWN_HOSTS|actions\/checkout/);
  });

  it.each(['preflight', 'bootstrap', 'deploy', 'backup', 'verify', 'rollback', 'unknown'])(
    'blocks legacy %s before touching the deployment root', (command) => {
    const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
    const script = path.resolve('deploy', 'stack.sh').replaceAll('\\', '/');
    const root = mkdtempSync(path.join(os.tmpdir(), 'gq-legacy-block-'));
    const shellRoot = process.platform === 'win32'
      ? `/${root[0].toLowerCase()}${root.slice(2).replaceAll('\\', '/')}`
      : root;
    try {
      writeFileSync(path.join(root, 'sentinel'), 'untouched');
      const result = spawnSync(bash, [script, shellRoot, command], {
        encoding: 'utf8',
        timeout: 10000,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Legacy containerized Apache/MySQL deployment is disabled');
      expect(readdirSync(root)).toEqual(['sentinel']);
      expect(readFileSync(path.join(root, 'sentinel'), 'utf8')).toBe('untouched');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not push deployments from CI to the server', () => {
    expect(ci).not.toMatch(/deploy-staging:|deploy-production:|deploy-plesk\.yml|PLESK_DEPLOY_ENABLED|PLESK_SSH_KEY/);
    expect(workflow).not.toMatch(/ssh-keyscan|StrictHostKeyChecking=no|pull_request_target/);
  });

  it('backs up and restores into a disposable database before applying migrations', () => {
    const deploy = stack.slice(stack.indexOf('\n  deploy)'), stack.indexOf('\n  rollback)'));
    expect(deploy.indexOf('stop_writers')).toBeLessThan(deploy.indexOf('\n    backup'));
    expect(deploy.indexOf('\n    backup')).toBeLessThan(deploy.indexOf('up --dry-run'));
    expect(stack).toContain('gzip -dc "$dump" | docker exec -i "$cleanup_container"');
    expect(stack).toContain('SELECT CONCAT("CHECK TABLE');
    expect(stack).toContain('--approve-empty-database');
    expect(stack).toContain('--approve-compatible-schema');
    expect(stack).not.toMatch(/prune|down --volumes|migrate\.php rollback|adopt-[a-z]+/);
    expect(deploy.indexOf('\n    verify')).toBeLessThan(deploy.indexOf('mv "$RELEASE"'));
    expect(stack).toContain('Refusing cross-environment writes.');
    expect(stack).toContain('.name == $project');
  });

  it('keeps shell scripts executable on Linux after Windows checkout', () => {
    expect(read('.gitattributes')).toContain('deploy/*.sh text eol=lf');
    expect(readFileSync('deploy/stack.sh', 'utf8')).not.toContain('\r');
    expect(readFileSync('deploy/check-ports.sh', 'utf8')).not.toContain('\r');
    expect(stack).toContain('source "$BUNDLE/check-ports.sh"');
  });
});

describe('host-port guard', () => {
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  const guard = path.resolve('deploy', 'check-ports.sh').replaceAll('\\', '/');
  function run({ port = '8081', listeners = '', container = '', inspect = '', ssStatus = 0, composeStatus = 0 } = {}) {
    const script = `
      fail() { printf '%s\\n' "$*" >&2; exit 1; }
      ss() { printf '%s' "$LISTENERS"; return "$SS_STATUS"; }
      compose() { printf '%s' "$CONTAINER"; return "$COMPOSE_STATUS"; }
      docker() { printf '%s\\n' "$INSPECT"; }
      source "$GUARD"
      check_host_port web "$PORT" galaxyquest-production
    `;
    return spawnSync(bash, ['--noprofile', '--norc', '-c', script], {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env, GUARD: guard, PORT: port, LISTENERS: listeners, CONTAINER: container,
        INSPECT: inspect, SS_STATUS: String(ssStatus), COMPOSE_STATUS: String(composeStatus),
      },
    });
  }
  const localListener = 'LISTEN 0 4096 127.0.0.1:8081 0.0.0.0:*\n';
  it('accepts a free unprivileged port', () => {
    expect(run().status).toBe(0);
    expect(run({ port: '18081' }).status).toBe(0);
  });
  it.each(['80', '443', '3306', '65536', '0080', 'hello'])('rejects invalid or reserved port %s', (port) => {
    expect(run({ port }).status).not.toBe(0);
  });
  it('rejects Plesk or another listener without a matching running container', () => {
    const result = run({ listeners: localListener });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('already listening');
  });
  it('allows an existing exact loopback binding owned by this project and service', () => {
    expect(run({
      listeners: localListener,
      container: 'owned-id',
      inspect: 'true galaxyquest-production web 127.0.0.1:8081 ',
    }).status).toBe(0);
  });
  it.each([
    'true galaxyquest-staging web 127.0.0.1:8081 ',
    'true galaxyquest-production grafana 127.0.0.1:8081 ',
    'false galaxyquest-production web 127.0.0.1:8081 ',
    'true galaxyquest-production web 0.0.0.0:8081 ',
  ])('rejects a foreign or incorrect Docker binding', (inspect) => {
    expect(run({ listeners: localListener, container: 'id', inspect }).status).not.toBe(0);
  });
  it('rejects ambiguous wildcard or multiple listeners even if the project owns a binding', () => {
    const inspect = 'true galaxyquest-production web 127.0.0.1:8081 ';
    expect(run({ listeners: 'LISTEN 0 4096 0.0.0.0:8081 0.0.0.0:*\n', container: 'id', inspect }).status).not.toBe(0);
    expect(run({ listeners: localListener + localListener, container: 'id', inspect }).status).not.toBe(0);
  });
  it('fails closed when listener or Compose inspection fails', () => {
    expect(run({ ssStatus: 1 }).status).not.toBe(0);
    expect(run({ listeners: localListener, composeStatus: 1 }).status).not.toBe(0);
  });
});

describe.skipIf(process.env.GQ_DOCKER_CONTEXT_TESTS !== '1')('actual production Compose contract', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gq-production-contract-'));
  const digest = `example.invalid/fixture@sha256:${'a'.repeat(64)}`;
  for (const [file, text] of [
    ['runtime.env', 'DB_USER=game\nDB_PASS=fixture\nCOMFYUI_ENABLED=1\nTTS_SECRET=fixture\n'],
    ['database.env', 'MYSQL_USER=game\nMYSQL_PASSWORD=fixture\nMYSQL_ROOT_PASSWORD=fixture-root\n'],
    ['tts.env', 'TTS_SECRET=fixture\n'],
    ['grafana.env', 'GF_SECURITY_ADMIN_PASSWORD=fixture\n'],
  ]) writeFileSync(path.join(root, file), text);
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const cache = new Map();
  function config(project, gpu = true) {
    const key = `${project}:${gpu}`;
    if (cache.has(key)) return cache.get(key);
    const env = {
      ...process.env, DEPLOY_ROOT: root, DEPLOY_GID: '1001', COMPOSE_PROJECT_NAME: project,
      COMPOSE_PROFILES: gpu ? 'gpu' : '', WEB_PORT: project.endsWith('staging') ? '8082' : '8081',
      GRAFANA_PORT: project.endsWith('staging') ? '3001' : '3000',
    };
    for (const key of ['WEB', 'TTS', 'GPU', 'MYSQL', 'PROMETHEUS', 'GRAFANA', 'MYSQL_EXPORTER', 'NODE_EXPORTER', 'BLACKBOX', 'ALERTMANAGER']) {
      env[`${key}_IMAGE`] = digest;
    }
    const value = JSON.parse(execFileSync('docker', [
      'compose', '-f', 'deploy/compose.yml', 'config', '--format', 'json',
    ], { env, encoding: 'utf8', timeout: 30000 }));
    cache.set(key, value);
    return value;
  }
  it('has no code mounts, local builds, public database ports or shared container names', () => {
    const { services } = config('galaxyquest-production');
    for (const service of Object.values(services)) {
      expect(service.build).toBeUndefined();
      expect(service.container_name).toBeUndefined();
      expect(service.image).toBe(digest);
    }
    expect(services.web.environment.APP_ENV).toBe('production');
    expect(services.web.environment.DB_HOST).toBe('db');
    expect(services.web.environment.DB_PORT).toBe('3306');
    expect(services.web.environment.XDEBUG_MODE).toBe('off');
    expect(services.web.volumes.every((mount) => mount.type === 'volume')).toBe(true);
    for (const name of ['db', 'tts', 'comfyui', 'prometheus', 'mysql-exporter', 'node-exporter', 'blackbox', 'alertmanager']) {
      expect(services[name].ports ?? []).toEqual([]);
    }
    expect(services.web.ports[0].host_ip).toBe('127.0.0.1');
    expect(services.grafana.ports[0].host_ip).toBe('127.0.0.1');
    expect(services.comfyui.deploy.resources.reservations.devices[0].capabilities).toEqual(['gpu']);
  });
  it('isolates staging and production ports, data and GPU output', () => {
    const first = config('galaxyquest-production');
    const second = config('galaxyquest-staging');
    for (const key of ['database', 'generated', 'sessions', 'gpu-models', 'gpu-output', 'grafana']) {
      expect(first.volumes[key].name).not.toBe(second.volumes[key].name);
    }
    expect(first.services.web.ports[0].published).not.toBe(second.services.web.ports[0].published);
    expect(first.services.grafana.ports[0].published).not.toBe(second.services.grafana.ports[0].published);
  });
  it('requires explicit GPU profile and keeps the restore checker out of normal startup', () => {
    expect(config('galaxyquest-production', false).services.comfyui).toBeUndefined();
    expect(config('galaxyquest-production').services['restore-check']).toBeUndefined();
  });
  it('accepts different operator-selected loopback ports without exposing MySQL', () => {
    const env = {
      ...process.env, DEPLOY_ROOT: root, DEPLOY_GID: '1001', COMPOSE_PROJECT_NAME: 'galaxyquest-production',
      COMPOSE_PROFILES: '', WEB_PORT: '18081', GRAFANA_PORT: '13000',
    };
    for (const key of ['WEB', 'TTS', 'GPU', 'MYSQL', 'PROMETHEUS', 'GRAFANA', 'MYSQL_EXPORTER', 'NODE_EXPORTER', 'BLACKBOX', 'ALERTMANAGER']) {
      env[`${key}_IMAGE`] = digest;
    }
    const { services } = JSON.parse(execFileSync('docker', [
      'compose', '-f', 'deploy/compose.yml', 'config', '--format', 'json',
    ], { env, encoding: 'utf8', timeout: 30000 }));
    expect(services.web.ports[0]).toMatchObject({ host_ip: '127.0.0.1', published: '18081' });
    expect(services.grafana.ports[0]).toMatchObject({ host_ip: '127.0.0.1', published: '13000' });
    expect(services.db.ports ?? []).toEqual([]);
  });
});
