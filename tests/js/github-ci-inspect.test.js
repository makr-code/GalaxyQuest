// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { inspectGitHubCi, validateJobs, validateRun } from '../../deploy/inspect-github-ci.mjs';

const commit = 'a'.repeat(40);
const runId = '12345';
const run = () => ({
  id: 12345,
  run_attempt: 2,
  head_sha: commit,
  head_branch: 'develop',
  event: 'push',
  path: '.github/workflows/ci.yml',
  repository: { full_name: 'makr-code/GalaxyQuest' },
  head_repository: { full_name: 'makr-code/GalaxyQuest' },
  status: 'completed',
  conclusion: 'success',
});
const names = [
  'PHP Syntax, PSR-12 and PHPStan Level 5',
  'JavaScript Architecture Validation',
  'PHPUnit Unit Tests (SQLite)',
  'PHPUnit Tests',
  'Native PHP 8.4 and MariaDB 11.8',
  'Vitest Unit Tests',
  'Playwright E2E Smoke Test',
  'Build & Publish Docker Image',
];
const jobs = () => ({
  total_count: names.length,
  jobs: names.map((name) => ({ name, status: 'completed', conclusion: 'success' })),
});

describe('read-only GitHub CI evidence validation', () => {
  it('pins the attempt-specific jobs and rechecks the run before returning evidence', () => {
    const calls = [];
    const result = inspectGitHubCi(['staging', commit, runId], (endpoint) => {
      calls.push(endpoint);
      return calls.length === 2 ? jobs() : run();
    });
    expect(calls).toEqual([
      `repos/makr-code/GalaxyQuest/actions/runs/${runId}`,
      `repos/makr-code/GalaxyQuest/actions/runs/${runId}/attempts/2/jobs?per_page=100`,
      `repos/makr-code/GalaxyQuest/actions/runs/${runId}`,
    ]);
    expect(result).toEqual({ environment: 'staging', commit, run_id: runId, attempt: 2, status: 'ci-evidence-only' });
  });

  it('rejects a retry during inspection', () => {
    let count = 0;
    expect(() => inspectGitHubCi(['staging', commit, runId], () => {
      count++;
      return count === 2 ? jobs() : { ...run(), run_attempt: count === 3 ? 3 : 2 };
    })).toThrow(/retried/);
  });

  it('does not contact GitHub for invalid arguments', () => {
    let called = false;
    expect(() => inspectGitHubCi(['staging', commit, '../1'], () => { called = true; })).toThrow();
    expect(called).toBe(false);
  });

  it('accepts a pinned successful push on each environment branch', () => {
    expect(validateRun(run(), 'staging', commit, runId)).toBe(2);
    expect(validateRun({ ...run(), head_branch: 'main' }, 'production', commit, runId)).toBe(2);
    expect(() => validateJobs(jobs())).not.toThrow();
  });

  it.each([
    ['wrong run ID', { id: 12346 }],
    ['wrong commit', { head_sha: 'b'.repeat(40) }],
    ['wrong branch', { head_branch: 'main' }],
    ['pull request', { event: 'pull_request' }],
    ['other workflow', { path: '.github/workflows/other.yml' }],
    ['fork repository', { head_repository: { full_name: 'other/GalaxyQuest' } }],
    ['wrong repository', { repository: { full_name: 'other/GalaxyQuest' } }],
    ['missing attempt', { run_attempt: 0 }],
    ['in progress', { status: 'in_progress' }],
    ['failed', { conclusion: 'failure' }],
  ])('rejects %s', (_label, changes) => {
    expect(() => validateRun({ ...run(), ...changes }, 'staging', commit, runId)).toThrow();
  });

  it.each([
    ['unknown environment', 'test', commit, runId],
    ['short commit', 'staging', 'abc', runId],
    ['uppercase commit', 'staging', 'A'.repeat(40), runId],
    ['non-numeric run ID', 'staging', commit, '1/../../jobs'],
    ['unsafe run ID', 'staging', commit, '9007199254740992'],
  ])('rejects %s before accepting evidence', (_label, environment, sha, id) => {
    expect(() => validateRun(run(), environment, sha, id)).toThrow();
  });

  it.each([
    ['missing job', (value) => { value.jobs.pop(); value.total_count--; }],
    ['truncated page', (value) => { value.total_count++; }],
    ['duplicate job', (value) => { value.jobs[1].name = value.jobs[0].name; }],
    ['failed job', (value) => { value.jobs[0].conclusion = 'failure'; }],
    ['skipped image build', (value) => { value.jobs[7].conclusion = 'skipped'; }],
    ['running job', (value) => { value.jobs[0].status = 'in_progress'; }],
    ['more than one page', (value) => { value.total_count = 101; }],
  ])('rejects %s', (_label, change) => {
    const value = jobs();
    change(value);
    expect(() => validateJobs(value)).toThrow();
  });
});
