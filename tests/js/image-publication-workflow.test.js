// @vitest-environment node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(path.resolve('.github', 'workflows', 'ci.yml'), 'utf8').replaceAll('\r\n', '\n');
const publication = workflow.slice(workflow.indexOf('\n  docker-build:'), workflow.indexOf('\n  deploy-staging:'));

function step(name) {
  const marker = `      - name: ${name}\n`;
  const start = publication.indexOf(marker);
  if (start === -1) throw new Error(`Missing publication step: ${name}`);
  const rest = publication.slice(start + marker.length);
  const end = rest.indexOf('\n      - name:');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('image publication workflow contract (configuration, not live registry proof)', () => {
  it('requires all main CI quality gates before publication', () => {
    const dependencies = publication.match(/^    needs: \[([^\]]+)\]/m)[1]
      .split(',').map((value) => value.trim());
    expect(dependencies).toEqual([
      'lint-php', 'lint-js', 'phpunit-unit', 'phpunit', 'vitest', 'playwright-smoke',
    ]);
    expect(publication).toContain("github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/develop')");
  });

  describe('actual publication bash with isolated Docker command fixtures', () => {
    const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
    const commands = step('Push only the scanned candidate without rebuilding')
      .split('        run: |\n')[1].split('\n')
      .map((line) => line.replace(/^          /, '')).join('\n');

    function run(overrides = {}) {
      const dockerFixture = `
  docker() {
    if [ "$1" = image ]; then printf '%s\\n' "$INSPECTED_ID"; return 0; fi
    printf 'DOCKER:%s\\n' "$*"
    if [ "$1" = "$FAIL_COMMAND" ]; then return 42; fi
  }
  `;
      const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail'], {
        input: dockerFixture + commands,
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          CANDIDATE_ID: 'sha256:fixture',
          INSPECTED_ID: 'sha256:fixture',
          IMAGE_TAGS: 'ghcr.io/fixture/game:sha-test\nghcr.io/fixture/game:main',
          FAIL_COMMAND: '',
          ...overrides,
        },
      });
      if (result.error) throw result.error;
      return result;
    }

    it('pushes all requested tags from the scanned ID without rebuilding', () => {
      const result = run();
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        'DOCKER:tag sha256:fixture ghcr.io/fixture/game:sha-test',
        'DOCKER:push ghcr.io/fixture/game:sha-test',
        'DOCKER:tag sha256:fixture ghcr.io/fixture/game:main',
        'DOCKER:push ghcr.io/fixture/game:main',
      ]);
    });
    it.each([
      { CANDIDATE_ID: '' },
      { IMAGE_TAGS: '' },
      { INSPECTED_ID: 'sha256:changed-after-scan' },
    ])('rejects missing metadata or changed image before any push', (overrides) => {
      const result = run(overrides);
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('DOCKER:');
    });
    it('stops before push when retagging fails', () => {
      const result = run({ FAIL_COMMAND: 'tag' });
      expect(result.status).toBe(42);
      expect(result.stdout).not.toContain('DOCKER:push');
    });
    it('stops on the first push failure rather than reporting success', () => {
      const result = run({ FAIL_COMMAND: 'push' });
      expect(result.status).toBe(42);
      expect(result.stdout).not.toContain('game:main');
    });
  });
  it('builds a locally loaded candidate with publishing disabled', () => {
    const build = step('Build local candidate without publishing');
    expect(build).toContain('id: candidate');
    expect(build).toContain('load: true');
    expect(build).toContain('push: false');
    expect(build).toContain('tags: galaxyquest:publish-candidate');
    expect(publication).not.toContain('push: true');
  });
  it('scans that candidate for high/critical vulnerabilities and secrets', () => {
    const scan = step('Scan exact candidate before registry authentication');
    expect(scan).toContain('image-ref: galaxyquest:publish-candidate');
    expect(scan).toContain('scanners: vuln,secret');
    expect(scan).toContain('severity: HIGH,CRITICAL');
    expect(scan).toContain('ignore-unfixed: false');
    expect(scan).toContain('exit-code: "1"');
  });
  it('authenticates and publishes only after the scan', () => {
    const names = [...publication.matchAll(/^      - name: (.+)$/gm)].map((match) => match[1]);
    expect(names.indexOf('Build local candidate without publishing'))
      .toBeLessThan(names.indexOf('Scan exact candidate before registry authentication'));
    expect(names.indexOf('Scan exact candidate before registry authentication'))
      .toBeLessThan(names.indexOf('Log in to GitHub Container Registry after scan'));
    expect(names.indexOf('Log in to GitHub Container Registry after scan'))
      .toBeLessThan(names.indexOf('Push only the scanned candidate without rebuilding'));
    expect(publication).not.toMatch(/continue-on-error|always\(\)|ignore-errors|\|\|\s*(?:true|echo)/);
  });
  it('checks image identity and tags/pushes the built ID without a second build', () => {
    const push = step('Push only the scanned candidate without rebuilding');
    expect(push).toContain('CANDIDATE_ID: ${{ steps.candidate.outputs.imageid }}');
    expect(push).toContain('IMAGE_TAGS: ${{ steps.meta.outputs.tags }}');
    expect(push).toContain('test -n "$CANDIDATE_ID"');
    expect(push).toContain('test -n "$IMAGE_TAGS"');
    expect(push).toContain('test "$(docker image inspect --format \'{{.Id}}\' galaxyquest:publish-candidate)" = "$CANDIDATE_ID"');
    expect(push).toContain('docker tag "$CANDIDATE_ID" "$tag"');
    expect(push).toContain('docker push "$tag"');
    expect([...publication.matchAll(/uses: docker\/build-push-action/g)]).toHaveLength(2);
  });
});
