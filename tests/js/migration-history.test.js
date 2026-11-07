// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMigrationManifest, assertAppendOnly, checkMigrationHistory } from '../../scripts/check_migration_history.mjs';

const script = path.resolve('scripts', 'check_migration_history.mjs');
const manifest = (names) => `<?php\ndeclare(strict_types=1);\nreturn ${JSON.stringify(names)};\n`;

describe('strict non-executing migration manifest parser', () => {
  it('reads canonical repository manifest and comments', () => {
    const canonical = parseMigrationManifest(readFileSync(path.resolve('config', 'migrations_manifest.php'), 'utf8'));
    expect(canonical[0]).toBe('migrate_v2.sql');
    expect(canonical.length).toBeGreaterThan(0);
    expect(parseMigrationManifest("<?php /* comment */ return [// line\n'a.sql', 'b.sql',];"))
      .toEqual(['a.sql', 'b.sql']);
    expect(parseMigrationManifest('<?php return [];')).toEqual([]);
  });
  it.each([
    "<?php return ['a.sql', 'A.sql'];",
    "<?php return ['a_down.sql'];",
    "<?php return ['../a.sql'];",
    "<?php return ['nested/a.sql'];",
    "<?php return ['a.txt'];",
    "<?php return [1];",
    "<?php return ['a.sql' => 'b.sql'];",
    "<?php return ['a.sql',,];",
    "<?php return array('a.sql');",
    "<?php return get_manifest();",
    "<?php echo 'side effect'; return ['a.sql'];",
    "<?php return ['a.sql']; exit(0);",
    "<?php return ['a.sql']; ?>",
    "<?php declare(strict_types=0); return [];",
    "<?php /* unterminated",
    "<?php return ['a.sql']; /* unterminated",
    "<?php return ['a\\x.sql'];",
    "<?php return [\"$name.sql\"];",
  ])('rejects non-declarative or invalid manifest %s', (source) => {
    expect(() => parseMigrationManifest(source)).toThrow();
  });
  it('allows only an exact historical prefix', () => {
    expect(() => assertAppendOnly(['a.sql', 'b.sql'], ['a.sql', 'b.sql', 'c.sql'])).not.toThrow();
    for (const candidate of [['a.sql'], ['b.sql', 'a.sql'], ['a.sql', 'c.sql', 'b.sql'], ['A.sql', 'b.sql']]) {
      expect(() => assertAppendOnly(['a.sql', 'b.sql'], candidate)).toThrow('ordered prefix');
    }
  });
});

async function fixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'gq-migration-history-'));
  function git(args) {
    return execFileSync('git', ['--no-pager', ...args], { cwd: root, encoding: 'utf8', timeout: 10000 });
  }
  function write(relative, text) {
    writeFileSync(path.join(root, ...relative.split('/')), text);
  }
  try {
    mkdirSync(path.join(root, 'config'));
    mkdirSync(path.join(root, 'sql'));
    git(['init', '--quiet']);
    git(['config', 'user.name', 'Migration gate fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'core.autocrlf', 'false']);
    write('config/migrations_manifest.php', manifest(['a.sql', 'b.sql']));
    write('sql/a.sql', 'SELECT 1;\n');
    write('sql/b.sql', 'SELECT 2;\n');
    git(['add', '.']);
    git(['commit', '--quiet', '-m', 'Synthetic baseline']);
    const base = git(['rev-parse', 'HEAD']).trim();
    return await run({ root, base, git, write });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('actual Git history gate', () => {
  it('accepts unchanged history and append-only readable SQL', async () => fixture(async ({ root, base, write }) => {
    expect(await checkMigrationHistory(root, base)).toEqual({ existing: 2, added: 0, base });
    write('config/migrations_manifest.php', manifest(['a.sql', 'b.sql', 'c.sql']));
    write('sql/c.sql', 'ALTER TABLE example ADD value INT;');
    expect(await checkMigrationHistory(root, base)).toEqual({ existing: 2, added: 1, base });
  }));
  it('checks historical content even with unchanged manifest', async () => fixture(async ({ root, base, write }) => {
    write('sql/a.sql', 'SELECT 9;\n');
    await expect(checkMigrationHistory(root, base)).rejects.toThrow('Historical migration bytes changed: a.sql');
  }));
  it('rejects Git-staged historical changes too', async () => fixture(async ({ root, base, git, write }) => {
    write('sql/b.sql', 'DROP DATABASE example;');
    git(['add', 'sql/b.sql']);
    await expect(checkMigrationHistory(root, base)).rejects.toThrow('Historical migration bytes changed: b.sql');
  }));
  it('does not use HEAD as baseline when historical changes are committed', async () => fixture(async ({ root, base, git, write }) => {
    write('sql/a.sql', 'SELECT 3;');
    git(['add', '.']);
    git(['commit', '--quiet', '-m', 'Synthetic invalid rewrite']);
    await expect(checkMigrationHistory(root, base)).rejects.toThrow('Historical migration bytes changed: a.sql');
  }));
  it('honors Git-clean EOL policy without hiding substantive changes', async () => fixture(async ({ root, base, git, write }) => {
    git(['config', 'core.autocrlf', 'true']);
    write('sql/a.sql', 'SELECT 1;\r\n');
    expect((await checkMigrationHistory(root, base)).existing).toBe(2);
    write('sql/a.sql', 'SELECT 4;\r\n');
    await expect(checkMigrationHistory(root, base)).rejects.toThrow('Historical migration bytes changed');
  }));
  it('rejects raw line-ending drift when Git has no normalization', async () => fixture(async ({ root, base, write }) => {
    write('sql/a.sql', 'SELECT 1;\r\n');
    await expect(checkMigrationHistory(root, base)).rejects.toThrow('Historical migration bytes changed');
  }));
  it('rejects missing newly appended migration', async () => fixture(async ({ root, base, write }) => {
    write('config/migrations_manifest.php', manifest(['a.sql', 'b.sql', 'missing.sql']));
    await expect(checkMigrationHistory(root, base)).rejects.toThrow('ENOENT');
  }));
  it('rejects deleted historical file', async () => fixture(async ({ root, base }) => {
    unlinkSync(path.join(root, 'sql', 'a.sql'));
    await expect(checkMigrationHistory(root, base)).rejects.toThrow('ENOENT');
  }));
  it.each([
    ['b.sql', 'a.sql'],
    ['a.sql'],
    ['a.sql', 'c.sql', 'b.sql'],
    ['A.sql', 'b.sql'],
  ].map((names) => [names]))('rejects real history removal/reordering %j', async (names) => fixture(async ({ root, base, write }) => {
    write('config/migrations_manifest.php', manifest(names));
    await expect(checkMigrationHistory(root, base)).rejects.toThrow('ordered prefix');
  }));
  it('rejects a directory where new SQL should be', async () => fixture(async ({ root, base, write }) => {
    write('config/migrations_manifest.php', manifest(['a.sql', 'b.sql', 'c.sql']));
    mkdirSync(path.join(root, 'sql', 'c.sql'));
    await expect(checkMigrationHistory(root, base)).rejects.toThrow('regular file');
  }));
  it('rejects executable manifest without running it', async () => fixture(async ({ root, base, write }) => {
    write('config/migrations_manifest.php', "<?php file_put_contents('executed', 'bad'); return ['a.sql', 'b.sql'];");
    await expect(checkMigrationHistory(root, base)).rejects.toThrow('declarative');
    expect(() => readFileSync(path.join(root, 'executed'))).toThrow('ENOENT');
  }));
  it('rejects baseline with missing manifest', async () => fixture(async ({ root, git }) => {
    git(['rm', 'config/migrations_manifest.php']);
    git(['commit', '--quiet', '-m', 'Synthetic missing manifest']);
    const base = git(['rev-parse', 'HEAD']).trim();
    await expect(checkMigrationHistory(root, base)).rejects.toThrow();
  }));
  it.each(['', '0000000000000000000000000000000000000000', '--help', 'missing-ref'])(
    'fails closed for invalid or absent baseline %s', async (base) => fixture(async ({ root }) => {
      await expect(checkMigrationHistory(root, base)).rejects.toThrow();
    }),
  );
  it('rejects an unrelated baseline instead of silently choosing another', async () => fixture(async ({ root, base, git, write }) => {
    git(['checkout', '--quiet', '--orphan', 'unrelated']);
    write('config/migrations_manifest.php', manifest(['a.sql', 'b.sql']));
    git(['add', '.']);
    git(['commit', '--quiet', '-m', 'Synthetic unrelated history']);
    await expect(checkMigrationHistory(root, base)).rejects.toThrow();
  }));
});

describe('migration history CLI and workflow', () => {
  it('runs real CLI successfully and reports immutable/new counts', async () => fixture(async ({ root, base }) => {
    const result = spawnSync(process.execPath, [script, '--base', base], { cwd: root, encoding: 'utf8', timeout: 30000 });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('2 immutable files, 0 append-only additions');
  }));
  it.each([[], ['--base'], ['--unknown', 'HEAD'], ['--base', 'HEAD', '--base', 'HEAD']].map((args) => [args]))(
    'rejects missing or unknown CLI arguments %j', (args) => {
      const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 30000 });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Usage:');
      expect(result.stdout).not.toContain('valid:');
    },
  );
  it('reports real CLI drift as failure, not success', async () => fixture(async ({ root, base, write }) => {
    write('sql/a.sql', 'SELECT 9;');
    const result = spawnSync(process.execPath, [script, '--base', base], { cwd: root, encoding: 'utf8', timeout: 30000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Historical migration bytes changed');
    expect(result.stdout).toBe('');
  }));
  it('uses full history and event baseline rather than candidate HEAD', () => {
    const workflow = readFileSync(path.resolve('.github', 'workflows', 'ci.yml'), 'utf8').replaceAll('\r\n', '\n');
    const lint = workflow.slice(workflow.indexOf('\n  lint-js:'), workflow.indexOf('\n  phpunit-unit:'));
    expect(lint).toContain('fetch-depth: 0');
    expect(lint).toContain('MIGRATION_BASE: ${{ github.event.pull_request.base.sha || github.event.before }}');
    expect(lint).toContain('npm run check:migration-history -- --base "$MIGRATION_BASE"');
    expect(lint).toContain('MIGRATION_BASE=$(git merge-base HEAD "origin/$DEFAULT_BRANCH")');
    expect(lint).toContain('DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}');
    expect(lint).not.toContain('continue-on-error');
  });
});
