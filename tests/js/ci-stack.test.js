// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(path.resolve('.github', 'workflows', 'ci.yml'), 'utf8')
  .replaceAll('\r\n', '\n');
const smoke = workflow.slice(workflow.indexOf('\n  playwright-smoke:'), workflow.indexOf('\n  docker-build:'));

describe.skipIf(process.env.GQ_DOCKER_CONTEXT_TESTS !== '1')('actual merged CI Compose contract', () => {
  const configurations = new Map();
  function config(project) {
    if (configurations.has(project)) return configurations.get(project);
    const configuration = JSON.parse(execFileSync('docker', [
      'compose', '-p', project, '-f', 'docker-compose.yml', '-f', 'docker-compose.ci.yml',
      'config', '--format', 'json', '--no-env-resolution',
    ], { encoding: 'utf8', timeout: 30000 }));
    configurations.set(project, configuration);
    return configuration;
  }

  it('runs built web image without source mounts or fixed container identities', () => {
    const { services } = config('gq-ci-contract-one');
    expect(services.web.container_name).toBeUndefined();
    expect(services.db.container_name).toBeUndefined();
    expect(services.web.volumes ?? []).toEqual([]);
    expect(services.web.build.dockerfile).toBe('Dockerfile');
    expect(Object.keys(services.web.depends_on)).toEqual(['db']);
    expect(services.web.depends_on.db.condition).toBe('service_healthy');
    expect(services.web.healthcheck.test.slice(0, 3)).toEqual(['CMD', 'php', '-r']);
    expect(services.web.healthcheck.test[3]).toContain('/health/live');
    expect(services.web.healthcheck.test[3]).not.toContain('/health/ready');
  });
  it('only imports base schema, leaving migrations to canonical runner', () => {
    const { services } = config('gq-ci-contract-one');
    const mounts = services.db.volumes;
    expect(mounts).toHaveLength(2);
    expect(mounts[0]).toMatchObject({ type: 'volume', target: '/var/lib/mysql' });
    expect(mounts[1]).toMatchObject({
      type: 'bind', target: '/docker-entrypoint-initdb.d/001-schema.sql', read_only: true,
    });
    expect(path.basename(mounts[1].source)).toBe('schema.sql');
    expect(services.db.ports ?? []).toEqual([]);
    expect(services.db.healthcheck.test).toEqual([
      'CMD', 'mysqladmin', 'ping', '--protocol=TCP', '-h', '127.0.0.1', '-proot',
    ]);
  });
  it('keeps all optional AI paths disabled with debugging off', () => {
    const { environment } = config('gq-ci-contract-one').services.web;
    for (const flag of ['COMFYUI_ENABLED', 'TTS_ENABLED', 'THEMISDB_ENABLED', 'NPC_LLM_CONTROLLER_ENABLED']) {
      expect(environment[flag]).toBe('0');
    }
    expect(environment.XDEBUG_MODE).toBe('off');
    expect(environment.APP_ENV).toBe('dev');
  });
  it('uses different project-owned volume names per CI run', () => {
    const first = config('gq-ci-contract-one').volumes['galaxyquest-db-data'];
    const second = config('gq-ci-contract-two').volumes['galaxyquest-db-data'];
    expect(first.name).toBe('gq-ci-contract-one_galaxyquest-db-data');
    expect(second.name).toBe('gq-ci-contract-two_galaxyquest-db-data');
    expect(first.external ?? false).toBe(false);
    expect(second.external ?? false).toBe(false);
  });
});

describe('CI smoke workflow ordering and cleanup', () => {
  it('migrates the built image before user seeding and E2E', () => {
    const start = smoke.indexOf('name: Start application stack');
    const migrate = smoke.indexOf('name: Apply canonical migrations from the built image');
    const seed = smoke.indexOf('name: Seed E2E test user');
    const test = smoke.indexOf('name: Run view-flow smoke test');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(migrate);
    const notReady = smoke.indexOf('name: Check live but not ready before canonical migrations');
    expect(start).toBeLessThan(notReady);
    expect(notReady).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(seed);
    expect(seed).toBeLessThan(test);
    expect(smoke.match(/php scripts\/migrate\.php up --env=TEST/g)).toHaveLength(2);
    expect(smoke).toContain('php scripts/migrate.php status');
    expect(smoke).toContain('php scripts/migrate.php verify --env=TEST');
    expect(smoke).toContain('php scripts/ensure_default_e2e_user.php --skip-bootstrap');
    const ready = smoke.indexOf('name: Require application DB readiness after migrations');
    expect(migrate).toBeLessThan(ready);
    expect(ready).toBeLessThan(seed);
    expect(smoke).toContain('curl --fail --silent --show-error --max-time 5 http://localhost:8081/health/ready');
  });
  it('uses unique run identity and always removes only its Compose stack', () => {
    expect(smoke).toContain('COMPOSE_PROJECT_NAME: gq-ci-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(smoke).toContain('if: always()\n        run: docker compose -f docker-compose.yml -f docker-compose.ci.yml down --volumes --remove-orphans');
    expect(smoke).toContain('if: failure()\n        run: docker compose -f docker-compose.yml -f docker-compose.ci.yml logs --no-color web db');
    expect(smoke).not.toMatch(/docker\s+(?:system|volume)\s+prune|continue-on-error/);
  });
  it('publishes Vite entry and hashed assets to the Apache document root', () => {
    const dockerfile = readFileSync(path.resolve('Dockerfile'), 'utf8');
    expect(dockerfile).toContain('cp dist/index.html index.html');
    expect(dockerfile).toContain('cp -a dist/assets/. assets/');
    expect(dockerfile).toContain('HEALTHCHECK --interval=30s --timeout=5s');
    expect(dockerfile).toContain('/health/live');
  });
});
