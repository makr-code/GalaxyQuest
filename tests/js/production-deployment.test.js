// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const read = (file) => readFileSync(path.resolve(file), 'utf8').replaceAll('\r\n', '\n');
const compose = read('deploy/compose.yml');
const workflow = read('.github/workflows/deploy-plesk.yml');
const ci = read('.github/workflows/ci.yml');
const stack = read('deploy/stack.sh');

describe('protected Plesk delivery', () => {
  it('deploys the same immutable main images to staging before production', () => {
    expect(ci).toContain('needs: [docker-build, deploy-staging]');
    expect(ci).toContain("github.ref == 'refs/heads/main' && vars.PLESK_DEPLOY_ENABLED == 'true'");
    expect(workflow).toContain('environment: ${{ inputs.environment }}');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('StrictHostKeyChecking=yes');
    expect(workflow).toContain('secrets.PLESK_KNOWN_HOSTS');
    expect(workflow).not.toMatch(/ssh-keyscan|StrictHostKeyChecking=no|pull_request_target/);
    expect(workflow).toContain('node scripts/check_deployment_http.mjs "$PUBLIC_URL"');
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
});
