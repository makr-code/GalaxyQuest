import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const numeric = '(?:0|[1-9][0-9]*)';
const identifier = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const semver = new RegExp(
  `^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?`
  + '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$',
);

export function validateReleaseMetadata(versionText, manifest, lock, changelog, tag = null) {
  const version = versionText.trim();
  if (!semver.test(version) || /[\r\n]/.test(version)) {
    throw new Error('VERSION.txt must contain one valid SemVer version without a v prefix.');
  }
  if (manifest.version !== version || lock.version !== version
      || lock.packages?.['']?.version !== version) {
    throw new Error('package.json and both package-lock.json versions must mirror VERSION.txt.');
  }
  if ([...changelog.matchAll(/^## \[Unreleased\](?:[ \t].*)?$/gm)].length !== 1) {
    throw new Error('CHANGELOG.md must have exactly one [Unreleased] section.');
  }
  const prerelease = version.split('+')[0].includes('-');
  let notes = null;
  if (tag !== null) {
    if (tag !== `v${version}`) throw new Error('Release tag must exactly match v plus VERSION.txt.');
    // Build metadata has no precedence and is unsuitable for unambiguous release tags.
    if (version.includes('+')) throw new Error('Tagged releases must not contain SemVer build metadata.');
    const headings = [...changelog.matchAll(/^## \[([^\]]+)\](?:[ \t]+(?:—|-)[ \t]+([0-9]{4}-[0-9]{2}-[0-9]{2}))?[^\r\n]*$/gm)];
    const matches = headings.filter((heading) => heading[1] === version);
    if (matches.length !== 1 || !matches[0][2]) {
      throw new Error('Tagged release needs exactly one dated CHANGELOG.md section for its version.');
    }
    const heading = matches[0];
    const date = new Date(`${heading[2]}T00:00:00Z`);
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== heading[2]) {
      throw new Error('Release changelog date is invalid.');
    }
    const start = heading.index + heading[0].length;
    const rest = changelog.slice(start);
    const end = rest.search(/^## /m);
    notes = (end === -1 ? rest : rest.slice(0, end)).trim();
    if (!notes || !/^[-*] \S/m.test(notes) || /(?:^|\n)\s*(?:TODO|TBD)\b/i.test(notes)) {
      throw new Error('Release changelog section must contain actual change bullets, not placeholder notes.');
    }
  }
  return { version, prerelease, notes };
}

export async function checkReleaseMetadata(root, tag = null) {
  const [version, manifest, lock, changelog] = await Promise.all([
    readFile(path.join(root, 'VERSION.txt'), 'utf8'),
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, 'package-lock.json'), 'utf8'),
    readFile(path.join(root, 'CHANGELOG.md'), 'utf8'),
  ]);
  return validateReleaseMetadata(version, JSON.parse(manifest), JSON.parse(lock), changelog, tag);
}

async function main(arguments_) {
  let tag = null;
  let notesFile = null;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
    if (argument === '--tag' && tag === null) tag = value;
    else if (argument === '--notes-file' && notesFile === null) notesFile = value;
    else throw new Error(`Unknown or duplicate argument: ${argument}`);
    index += 1;
  }
  if (notesFile !== null && tag === null) throw new Error('--notes-file requires --tag.');
  const result = await checkReleaseMetadata(process.cwd(), tag);
  if (notesFile !== null) await writeFile(notesFile, `${result.notes}\n`, 'utf8');
  console.log(`Release metadata valid: ${result.version} (${result.prerelease ? 'prerelease' : 'stable'} metadata only).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Release metadata gate failed: ${error.message}`);
    process.exitCode = 1;
  });
}
