import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const requiredReleaseWorkflows = [
  '.github/workflows/ci.yml',
  '.github/workflows/security-scan.yml',
  '.github/workflows/python-quality.yml',
  '.github/workflows/codeql-python.yml',
  '.github/workflows/webgpu-shader-validation.yml',
  '.github/workflows/release-metadata.yml',
];

export function assessReleaseRuns(runs, sha, tag) {
  if (!Array.isArray(runs)) throw new Error('Workflow runs must be an array.');
  const pending = [];
  for (const workflow of requiredReleaseWorkflows) {
    const candidates = runs.filter((run) => run.path === workflow
      && run.head_sha === sha && run.head_branch === tag && run.event === 'push');
    if (candidates.some((run) => !Number.isSafeInteger(run.id) || run.id <= 0
      || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0)) {
      throw new Error(`Invalid workflow run identity: ${workflow}`);
    }
    candidates.sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt);
    const latest = candidates[0];
    if (!latest) {
      pending.push(workflow);
    } else if (latest.status === 'completed') {
      if (latest.conclusion !== 'success') {
        throw new Error(`Release gate failed: ${workflow} (${latest.conclusion}).`);
      }
    } else if (['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(latest.status)) {
      pending.push(workflow);
    } else {
      throw new Error(`Invalid workflow run status: ${workflow}`);
    }
  }
  return { ready: pending.length === 0, pending };
}

async function main(args) {
  let sha;
  let tag;
  let automatic = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--automatic' && !automatic) {
      automatic = true;
    } else if (arg === '--sha' && sha === undefined && args[index + 1]) {
      sha = args[++index];
    } else if (arg === '--tag' && tag === undefined && args[index + 1]) {
      tag = args[++index];
    } else {
      throw new Error('Usage: check_release_gates.mjs --sha <commit> --tag <version-tag> [--automatic]');
    }
  }
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[0-9a-f]{40}$/.test(sha ?? '') || !/^v[0-9A-Za-z.-]+$/.test(tag ?? '')
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
    throw new Error('A full commit SHA, version tag and GITHUB_REPOSITORY are required.');
  }
  const response = execFileSync('gh', [
    'api', '--paginate', '--slurp',
    `repos/${repository}/actions/runs?event=push&branch=${encodeURIComponent(tag)}&head_sha=${sha}&per_page=100`,
  ], { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const pages = JSON.parse(response);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page.workflow_runs))) {
    throw new Error('GitHub returned an invalid workflow run response.');
  }
  const result = assessReleaseRuns(pages.flatMap((page) => page.workflow_runs), sha, tag);
  if (!result.ready && !automatic) {
    throw new Error(`Release gates are missing or unfinished: ${result.pending.join(', ')}`);
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `eligible=${result.ready}\n`, 'utf8');
  }
  console.log(result.ready
    ? `All release gates passed for ${tag} at ${sha}.`
    : `Developer release deferred until remaining gates complete: ${result.pending.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Release gate check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
