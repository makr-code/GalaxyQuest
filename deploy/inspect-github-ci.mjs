import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'makr-code/GalaxyQuest';
const requiredJobs = [
  'PHP Syntax, PSR-12 and PHPStan Level 5',
  'JavaScript Architecture Validation',
  'PHPUnit Unit Tests (SQLite)',
  'PHPUnit Tests',
  'Native PHP 8.4 and MariaDB 11.8',
  'Vitest Unit Tests',
  'Playwright E2E Smoke Test',
  'Build & Publish Docker Image',
];

export function validateRun(run, environment, commit, runId) {
  const branch = { staging: 'develop', production: 'main' }[environment];
  if (!branch || !/^[a-f0-9]{40}$/.test(commit)
    || !/^[1-9][0-9]*$/.test(runId) || !Number.isSafeInteger(Number(runId))) {
    throw new Error('Invalid environment, full commit SHA, or workflow run ID.');
  }
  if (!run || String(run.id) !== runId || run.head_sha !== commit
    || run.head_branch !== branch || run.event !== 'push'
    || run.path !== '.github/workflows/ci.yml'
    || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository
    || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1
    || run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error('Workflow run does not match the requested successful branch push.');
  }
  return run.run_attempt;
}

export function validateJobs(response) {
  if (!response || !Array.isArray(response.jobs)
    || !Number.isSafeInteger(response.total_count) || response.total_count !== response.jobs.length
    || response.total_count > 100) {
    throw new Error('Workflow job list is incomplete or invalid.');
  }
  const jobs = new Map();
  for (const job of response.jobs) {
    if (!job || typeof job.name !== 'string' || jobs.has(job.name)
      || job.status !== 'completed' || job.conclusion !== 'success') {
      throw new Error('A workflow job is duplicated, incomplete, skipped, or unsuccessful.');
    }
    jobs.set(job.name, job);
  }
  for (const name of requiredJobs) {
    if (!jobs.has(name)) throw new Error(`Required workflow job is missing: ${name}`);
  }
}

function request(endpoint) {
  let output;
  try {
    output = execFileSync('gh', ['api', '--hostname', 'github.com', endpoint], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error('GitHub API request failed; check gh authentication and network access.', { cause: error });
  }
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error('GitHub API returned invalid JSON.', { cause: error });
  }
}

export function inspectGitHubCi(args, apiRequest = request) {
  if (args.length !== 3) {
    throw new Error('Usage: node deploy/inspect-github-ci.mjs staging|production FULL_COMMIT_SHA RUN_ID');
  }
  const [environment, commit, runId] = args;
  // Validate user input before constructing any API path.
  if (!['staging', 'production'].includes(environment)
    || !/^[a-f0-9]{40}$/.test(commit)
    || !/^[1-9][0-9]*$/.test(runId) || !Number.isSafeInteger(Number(runId))) {
    throw new Error('Invalid environment, full commit SHA, or workflow run ID.');
  }
  const runEndpoint = `repos/${repository}/actions/runs/${runId}`;
  const first = apiRequest(runEndpoint);
  const attempt = validateRun(first, environment, commit, runId);
  validateJobs(apiRequest(`${runEndpoint}/attempts/${attempt}/jobs?per_page=100`));
  const latest = apiRequest(runEndpoint);
  if (validateRun(latest, environment, commit, runId) !== attempt) {
    throw new Error('Workflow run was retried during inspection.');
  }
  return { environment, commit, run_id: runId, attempt, status: 'ci-evidence-only' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(inspectGitHubCi(process.argv.slice(2))));
  } catch (error) {
    console.error(`GITHUB CI INSPECT: ${error.message}`);
    process.exitCode = 1;
  }
}
