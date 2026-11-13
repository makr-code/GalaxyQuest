// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assessReleaseRuns, requiredReleaseWorkflows } from '../../scripts/check_release_gates.mjs';

const sha = 'a'.repeat(40);
const tag = 'v0.9.0-alpha.1';
const successfulRuns = () => requiredReleaseWorkflows.map((workflow, index) => ({
  path: workflow, id: index + 1, run_attempt: 1, head_sha: sha, head_branch: tag,
  event: 'push', status: 'completed', conclusion: 'success',
}));

describe('exact tagged commit release gates', () => {
  it('accepts only a complete successful set of required tag workflows', () => {
    expect(assessReleaseRuns(successfulRuns(), sha, tag)).toEqual({ ready: true, pending: [] });
  });
  it.each(['head_sha', 'head_branch', 'event'])('does not accept unrelated %s runs', (field) => {
    const runs = successfulRuns();
    runs[0][field] = 'unrelated';
    expect(assessReleaseRuns(runs, sha, tag))
      .toEqual({ ready: false, pending: [requiredReleaseWorkflows[0]] });
  });
  it('waits for missing or unfinished workflows instead of accepting a partial set', () => {
    const runs = successfulRuns().slice(1);
    runs[0].status = 'in_progress';
    runs[0].conclusion = null;
    expect(assessReleaseRuns(runs, sha, tag))
      .toEqual({ ready: false, pending: requiredReleaseWorkflows.slice(0, 2) });
  });
  it.each(['failure', 'cancelled', 'skipped', 'timed_out', 'action_required', null])(
    'blocks a completed gate with conclusion %s', (conclusion) => {
      const runs = successfulRuns();
      runs[0].conclusion = conclusion;
      expect(() => assessReleaseRuns(runs, sha, tag)).toThrow('Release gate failed');
    },
  );
  it('does not reuse an older successful run when a newer run failed', () => {
    const runs = successfulRuns();
    runs.push({ ...runs[0], id: 100, conclusion: 'failure' });
    expect(() => assessReleaseRuns(runs, sha, tag)).toThrow('Release gate failed');
  });
  it('uses the newest attempt rather than an earlier successful attempt', () => {
    const runs = successfulRuns();
    runs.push({ ...runs[0], run_attempt: 2, status: 'queued', conclusion: null });
    expect(assessReleaseRuns(runs, sha, tag).ready).toBe(false);
  });
  it.each([{ id: 0 }, { run_attempt: null }, { status: 'unknown' }])(
    'fails closed for malformed gate metadata %j', (changes) => {
      const runs = successfulRuns();
      Object.assign(runs[0], changes);
      expect(() => assessReleaseRuns(runs, sha, tag)).toThrow('Invalid workflow run');
    },
  );
  it('rejects invalid CLI arguments before querying GitHub', () => {
    const result = spawnSync(process.execPath, [
      path.resolve('scripts', 'check_release_gates.mjs'), '--sha', sha, '--unknown',
    ], { encoding: 'utf8', timeout: 10000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage:');
  });
});

describe('manual stable and automated developer release workflow', () => {
  const workflow = readFileSync(path.resolve('.github', 'workflows', 'github-release.yml'), 'utf8')
    .replaceAll('\r\n', '\n');
  it('runs automatically only on successful same-repository version-tag workflows', () => {
    expect(workflow).toContain("(github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')");
    expect(workflow).toContain("startsWith(github.event.workflow_run.head_branch, 'v')");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain('github.event.workflow_run.head_repository.full_name == github.repository');
    expect(workflow).toContain('Stable releases require an operator workflow_dispatch.');
    expect(workflow).toContain('if [ "$PRERELEASE" = true ]; then BRANCH=develop; fi');
    expect(workflow).toContain('git merge-base --is-ancestor "$SHA" "origin/$BRANCH"');
  });
  it('uses trusted gate logic and grants writes only to the separate publisher', () => {
    const prepare = workflow.slice(workflow.indexOf('\n  prepare:'), workflow.indexOf('\n  publish:'));
    const publisher = workflow.slice(workflow.indexOf('\n  publish:'));
    expect(prepare).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(prepare).toContain('node ../release-tools/scripts/check_release_gates.mjs');
    expect(prepare).toContain('npm ci');
    expect(prepare).toContain('npm run vite:build');
    expect(prepare).toContain('npm run check:bundle-budget');
    expect(prepare).toContain('test -s dist/index.html');
    expect(prepare).not.toContain('contents: write');
    expect(publisher).toContain("if: needs.prepare.outputs.eligible == 'true'");
    expect(publisher).toContain('contents: write');
    expect(publisher).toContain('ref: ${{ needs.prepare.outputs.tools_sha }}');
    expect(publisher).toContain('node release-tools/scripts/check_release_gates.mjs');
    expect(publisher).not.toContain('php scripts/prepare_release.php');
    expect(publisher).toContain("github.event_name == 'workflow_dispatch' && 'github-release' || 'developer-release'");
  });
  it('verifies commit, manifest and checksum, uploads a draft, then publishes without replacing releases', () => {
    const publisher = workflow.slice(workflow.indexOf('\n  publish:'));
    expect(publisher).toContain('gh api "repos/$GH_REPO/commits/$RELEASE_TAG" --jq .sha');
    expect(publisher).toContain('sha256sum --check "galaxyquest-${VERSION}.sha256"');
    expect(publisher).toContain('--verify-tag --target "$RELEASE_SHA" --draft --latest=false');
    expect(publisher).toContain('--draft=false --prerelease="$PRERELEASE" --latest="$LATEST"');
    expect(publisher).toContain('if [ "$PRERELEASE" = true ]; then LATEST=false; fi');
    expect(publisher).toContain('Matching release already published; no assets or metadata overwritten.');
    expect(publisher).toContain('cmp --silent "$RUNNER_TEMP/existing-release/$MANIFEST" "$MANIFEST"');
    expect(publisher).toContain('gh release download "$RELEASE_TAG" --dir "$RUNNER_TEMP/existing-release" --repo "$GH_REPO"');
    expect(publisher).not.toMatch(/--clobber|continue-on-error|\|\|\s*true/);
  });

  describe('actual publisher commands with isolated GitHub command fixtures', () => {
    const publisher = workflow.slice(workflow.indexOf('\n  publish:'));
    const commands = publisher.split('      - name: Publish existing tag without overwriting an existing release')[1]
      .split('        run: |\n')[1].split('\n')
      .map((line) => line.replace(/^          /, '')).join('\n');
    const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';

    function run(overrides = {}) {
      const root = mkdtempSync(path.join(tmpdir(), 'gq-release-publisher-'));
      try {
        const releaseTag = overrides.RELEASE_TAG ?? tag;
        const version = releaseTag.slice(1);
        writeFileSync(path.join(root, `galaxyquest-${version}.tar.gz`), `fixture archive ${version}`);
        writeFileSync(path.join(root, `galaxyquest-${version}.sha256`), `fixture-sha  galaxyquest-${version}.tar.gz\n`);
        writeFileSync(
          path.join(root, `galaxyquest-${version}.release.json`),
          `{"tag":"${releaseTag}","version":"${version}","commit":"${sha}"}\n`,
        );
        writeFileSync(path.join(root, 'release-notes.md'), 'Fixture notes.\n');
        const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail'], {
          input: `
gh() {
  if [ "$1" = api ]; then
    if [ "$2" = "repos/$GH_REPO/commits/$RELEASE_TAG" ]; then echo "$REMOTE_SHA"; else echo '[[]]'; fi
    return 0
  fi
  if [ "$1" = release ] && [ "$2" = download ]; then
    VERSION="\${RELEASE_TAG#v}"
    mkdir -p "$RUNNER_TEMP/existing-release"
    for asset in "galaxyquest-$VERSION.tar.gz" "galaxyquest-$VERSION.sha256" "galaxyquest-$VERSION.release.json"; do
      cp "$asset" "$RUNNER_TEMP/existing-release/$asset"
    done
    if [ "$CORRUPT_EXISTING_MANIFEST" = true ]; then
      printf 'stale manifest\\n' >> "$RUNNER_TEMP/existing-release/galaxyquest-$VERSION.release.json"
    fi
    return 0
  fi
  echo "GH:$*"
  if [ "$2" = "$FAIL_COMMAND" ]; then return 42; fi
}
sha256sum() { return "$CHECKSUM_STATUS"; }
jq() {
  if [ "$1" = length ]; then echo "$EXISTING_COUNT"
  elif [ "$1" = -e ]; then return "$EXISTING_MATCH_STATUS"
  else echo '[]'
  fi
}
` + commands,
          cwd: root, encoding: 'utf8', timeout: 10000,
          env: {
            ...process.env,
            GH_REPO: 'fixture/game', RELEASE_TAG: releaseTag, RELEASE_SHA: sha, REMOTE_SHA: sha,
            PRERELEASE: 'true', FAIL_COMMAND: '', CHECKSUM_STATUS: '0',
            EXISTING_COUNT: '0', EXISTING_MATCH_STATUS: '0',
            CORRUPT_EXISTING_MANIFEST: 'false', RUNNER_TEMP: root,
            ...overrides,
          },
        });
        if (result.error) throw result.error;
        return result;
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }

    it('publishes developer artifacts as prereleases without changing latest', () => {
      const result = run();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`GH:release create ${tag} galaxyquest-0.9.0-alpha.1.tar.gz galaxyquest-0.9.0-alpha.1.sha256 galaxyquest-0.9.0-alpha.1.release.json`);
      expect(result.stdout).toContain('--draft --latest=false');
      expect(result.stdout).toContain('--notes-file release-notes.md --prerelease');
      expect(result.stdout).toContain(`GH:release edit ${tag} --draft=false --prerelease=true --latest=false`);
    });
    it('publishes operator stable releases as latest without the prerelease flag', () => {
      const result = run({ PRERELEASE: 'false', RELEASE_TAG: 'v1.2.0' });
      expect(result.status, result.stderr).toBe(0);
      const creation = result.stdout.split('\n').find((line) => line.startsWith('GH:release create'));
      expect(creation).not.toContain('--prerelease');
      expect(result.stdout).toContain('GH:release edit v1.2.0 --draft=false --prerelease=false --latest=true');
    });
    it.each([
      { REMOTE_SHA: 'b'.repeat(40) },
      { CHECKSUM_STATUS: '13' },
    ])('never creates a release when source identity or checksum verification fails %j', (overrides) => {
      const result = run(overrides);
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('GH:release');
    });
    it('does not publish a draft if creation or asset upload fails', () => {
      const result = run({ FAIL_COMMAND: 'create' });
      expect(result.status).toBe(42);
      expect(result.stdout).not.toContain('GH:release edit');
    });
    it('propagates final publication failure instead of reporting success', () => {
      expect(run({ FAIL_COMMAND: 'edit' }).status).toBe(42);
    });
    it('leaves an already matching published release unchanged on repeated completion events', () => {
      const result = run({ EXISTING_COUNT: '1' });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('Matching release already published');
      expect(result.stdout).not.toContain('GH:release');
    });
    it('does not treat a release with a different tagged commit manifest as a match', () => {
      const result = run({ EXISTING_COUNT: '1', CORRUPT_EXISTING_MANIFEST: 'true' });
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('GH:release create');
    });
    it('does not overwrite an existing draft or mismatching published release', () => {
      const result = run({ EXISTING_COUNT: '1', EXISTING_MATCH_STATUS: '1' });
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('GH:release');
    });
  });
});
