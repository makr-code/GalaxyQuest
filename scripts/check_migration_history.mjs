import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Parse only the manifest's declarative subset; never execute PHP from a candidate.
export function parseMigrationManifest(source) {
  let rest = source.replace(/^\uFEFF/, '');
  function trivia() {
    while (true) {
      const match = rest.match(/^(?:\s+|\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)/);
      if (!match) return;
      rest = rest.slice(match[0].length);
    }
  }
  function consume(token) {
    trivia();
    if (!rest.startsWith(token)) throw new Error(`Manifest must be declarative; expected ${token}.`);
    rest = rest.slice(token.length);
  }
  consume('<?php');
  trivia();
  if (rest.startsWith('declare')) {
    const declaration = rest.match(/^declare\s*\(\s*strict_types\s*=\s*1\s*\)\s*;/);
    if (!declaration) throw new Error('Only declare(strict_types=1) is supported.');
    rest = rest.slice(declaration[0].length);
  }
  consume('return');
  consume('[');
  const names = [];
  const seen = new Set();
  trivia();
  while (!rest.startsWith(']')) {
    const entry = rest.match(/^(['"])([A-Za-z0-9][A-Za-z0-9_-]*\.sql)\1/);
    if (!entry || /_down\.sql$/i.test(entry[2])) {
      throw new Error('Manifest entries must be plain forward SQL filenames.');
    }
    const name = entry[2];
    if (seen.has(name.toLowerCase())) throw new Error(`Duplicate migration filename: ${name}.`);
    names.push(name);
    seen.add(name.toLowerCase());
    rest = rest.slice(entry[0].length);
    trivia();
    if (rest.startsWith(']')) break;
    consume(',');
    trivia();
  }
  consume(']');
  consume(';');
  trivia();
  if (rest !== '') throw new Error('Executable or trailing manifest content is not allowed.');
  return names;
}

export function assertAppendOnly(previous, current) {
  if (current.length < previous.length
      || previous.some((name, index) => current[index] !== name)) {
    throw new Error('Existing migration manifest entries must remain an exact ordered prefix; append new migrations only.');
  }
}

export async function checkMigrationHistory(root, base) {
  if (!base || /^0+$/.test(base) || base.startsWith('-')) {
    throw new Error('An existing nonzero baseline Git commit is required.');
  }
  function git(args) {
    return execFileSync('git', ['--no-pager', ...args], {
      cwd: root, maxBuffer: 20 * 1024 * 1024, timeout: 30000,
    });
  }
  const commit = git(['rev-parse', '--verify', `${base}^{commit}`]).toString('utf8').trim();
  git(['merge-base', '--is-ancestor', commit, 'HEAD']);
  const manifestPath = path.join(root, 'config', 'migrations_manifest.php');
  if (!(await lstat(manifestPath)).isFile()) throw new Error('Manifest must be a regular file, not a symlink.');
  const previous = parseMigrationManifest(git(['show', `${commit}:config/migrations_manifest.php`]).toString('utf8'));
  const current = parseMigrationManifest(await readFile(manifestPath, 'utf8'));
  assertAppendOnly(previous, current);
  for (const name of current) {
    const file = path.join(root, 'sql', name);
    if (!(await lstat(file)).isFile()) throw new Error(`Migration must be a regular file: ${name}.`);
    const currentObject = git(['hash-object', `--path=sql/${name}`, file]).toString('utf8').trim();
    if (previous.includes(name)
        && currentObject !== git(['rev-parse', `${commit}:sql/${name}`]).toString('utf8').trim()) {
      throw new Error(`Historical migration bytes changed: ${name}. Restore the original; add a reviewed forward migration.`);
    }
  }
  return { existing: previous.length, added: current.length - previous.length, base: commit };
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--base') {
    throw new Error('Usage: node scripts/check_migration_history.mjs --base <existing-ancestor-commit>');
  }
  const result = await checkMigrationHistory(process.cwd(), args[1]);
  console.log(`Migration history valid: ${result.existing} immutable files, ${result.added} append-only additions (base ${result.base}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Migration history gate failed: ${error.message}`);
    process.exitCode = 1;
  });
}
