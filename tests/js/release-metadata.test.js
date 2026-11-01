import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateReleaseMetadata } from '../../scripts/check_release_metadata.mjs';

const script = path.resolve('scripts', 'check_release_metadata.mjs');
const unreleased = '## [Unreleased]\n\n### Added\n- Development work.\n';

function metadata(version, tag = null, changelog = unreleased) {
  return validateReleaseMetadata(
    `${version}\r\n`,
    { version },
    { version, packages: { '': { version } } },
    changelog,
    tag,
  );
}

describe('canonical release metadata', () => {
  it.each(['0.0.0', '1.0.0', '0.9.0-alpha.1', '2.3.4-rc.0', '1.0.0-beta-x', '1.2.3+build.01'])(
    'accepts SemVer %s without claiming readiness',
    (version) => expect(metadata(version).version).toBe(version),
  );
  it.each(['v1.0.0', '01.0.0', '1.01.0', '1.0.01', '1.0', '1.0.0-01', '1.0.0-',
    '1.0.0+', '1.0.0-a..b', '1.0.0\n2.0.0', '', '1.0.0/evil'])(
    'rejects invalid version %s',
    (version) => expect(() => metadata(version)).toThrow('valid SemVer'),
  );
  it.each(['manifest', 'lock', 'root'])('rejects divergent %s version', (surface) => {
    const manifest = { version: '1.0.0' };
    const lock = { version: '1.0.0', packages: { '': { version: '1.0.0' } } };
    if (surface === 'manifest') manifest.version = '2.0.0';
    if (surface === 'lock') lock.version = '2.0.0';
    if (surface === 'root') lock.packages[''].version = '2.0.0';
    expect(() => validateReleaseMetadata('1.0.0', manifest, lock, unreleased)).toThrow('mirror');
  });
  it('requires an unreleased section', () => {
    expect(() => metadata('1.0.0', null, '# Changelog')).toThrow('[Unreleased]');
  });
  it('rejects duplicate unreleased sections', () => {
    expect(() => metadata('1.0.0', null, unreleased + unreleased)).toThrow('exactly one');
  });
  it.each(['1.0.0', 'v2.0.0', 'v1.0.0-rc.1', ''])('rejects mismatched tag %s', (tag) => {
    expect(() => metadata('1.0.0', tag)).toThrow('exactly match');
  });
  it('extracts only the dated version section and identifies prereleases', () => {
    const notes = '### Fixed\n- Correct migration failures.';
    const changelog = `${unreleased}\n## [0.9.0-alpha.1] — 2026-11-01\n\n${notes}\n\n`
      + '## [0.8.0] - 2026-10-01\n- Older release.';
    expect(metadata('0.9.0-alpha.1', 'v0.9.0-alpha.1', changelog))
      .toEqual({ version: '0.9.0-alpha.1', prerelease: true, notes });
  });
  it.each([
    '',
    '## [1.0.0]\n- Missing date.',
    '## [1.0.0] - 2026-02-30\n- Invalid date.',
    '## [1.0.0] - 2026-11-01\n',
    '## [1.0.0] - 2026-11-01\nTBD\n- Placeholder.',
    '## [1.0.0] - 2026-11-01\nOnly a heading.',
    '## [1.0.0] - 2026-11-01\n- One.\n## [1.0.0] - 2026-11-02\n- Two.',
  ])('rejects absent, ambiguous or placeholder release notes', (section) => {
    expect(() => metadata('1.0.0', 'v1.0.0', `${unreleased}\n${section}`)).toThrow();
  });
  it('rejects build metadata in a release tag', () => {
    expect(() => metadata('1.0.0+build', 'v1.0.0+build')).toThrow('build metadata');
  });
});

describe('real release gate CLI', () => {
  function fixture(run) {
    const root = mkdtempSync(path.join(tmpdir(), 'gq-release-metadata-'));
    try {
      writeFileSync(path.join(root, 'VERSION.txt'), '0.9.0-alpha.1\n');
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.9.0-alpha.1' }));
      writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
        version: '0.9.0-alpha.1', packages: { '': { version: '0.9.0-alpha.1' } },
      }));
      writeFileSync(path.join(root, 'CHANGELOG.md'),
        `${unreleased}\n## [0.9.0-alpha.1] - 2026-11-01\n- Reviewed release change.\n`);
      run(root);
    } finally {
      rmSync(root, { recursive: true });
    }
  }

  it('passes actual version mirrors from disk', () => fixture((root) => {
    expect(execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' }))
      .toContain('metadata only');
  }));
  it('writes exact reviewed release notes', () => fixture((root) => {
    const notes = path.join(root, 'notes.md');
    execFileSync(process.execPath, [script, '--tag', 'v0.9.0-alpha.1', '--notes-file', notes], { cwd: root });
    expect(readFileSync(notes, 'utf8')).toBe('- Reviewed release change.\n');
  }));
  it.each([['--unknown', 'x'], ['--tag'], ['--tag', 'v1.0.0'], ['--notes-file', 'notes.md'],
    ['--tag', 'v0.9.0-alpha.1', '--tag', 'v0.9.0-alpha.1']])(
    'fails explicitly for invalid CLI arguments %j', (...arguments_) => fixture((root) => {
      const result = spawnSync(process.execPath, [script, ...arguments_], { cwd: root, encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Release metadata gate failed:');
    }),
  );
  it('rejects malformed JSON instead of passing', () => fixture((root) => {
    writeFileSync(path.join(root, 'package.json'), '{broken');
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Release metadata gate failed:');
  }));
  it('fails on a missing version file', () => fixture((root) => {
    rmSync(path.join(root, 'VERSION.txt'));
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Release metadata gate failed:');
  }));
  it('does not overwrite a notes deliverable when validation fails', () => fixture((root) => {
    const notes = path.join(root, 'notes.md');
    writeFileSync(notes, 'Previous reviewed notes.');
    const result = spawnSync(process.execPath,
      [script, '--tag', 'v9.0.0', '--notes-file', notes], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(readFileSync(notes, 'utf8')).toBe('Previous reviewed notes.');
  }));
});
