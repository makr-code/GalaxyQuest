import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const execute = promisify(execFile);
const excluded = [
  '.env', '.env.production', '.env.example', 'docker/.env.local',
  'docker/.env.trellis2.template', 'credentials/private.key', 'credentials/server.pem',
  '.git/config', 'tools/engine/.git/config', '.vscode/settings.json', '.idea/project.xml',
  'node_modules/module/index.js', 'vendor/autoload.php', 'tools/engine/node_modules/index.js',
  'tts_service/.venv/bin/python', 'tts_service/venv/bin/python',
  'scripts/__pycache__/worker.pyc', 'tts_service/.pytest_cache/state',
  '.mypy_cache/state', '.ruff_cache/state', '.phpstan-cache/resultCache.php',
  '.phpunit.result.cache', 'tools/.phpunit.result.cache', '.phpunit.cache/results',
  'dist/index.html', 'build/output.js', 'coverage/index.html', '.nyc_output/state.json',
  'playwright-report/index.html', 'test-results/trace.zip', '.playwright-mcp/session.json',
  'npm-debug.log.1', 'logs/request.log', 'temporary.tmp', 'editor.swp', 'editor.swo',
  'cookies.txt', 'tmp-gq-cookies.txt', 'headers.txt', '.gq_cookies.txt',
  '.gq_diag_cookies.txt', '.tmp-login.cookies.txt', '.tmp_system_test_cookies.txt',
  'create_test_user.sql', 'temp_create_user.sql', 'update_test_user.sql',
  'cache/tts/audio.mp3', 'generated/tts/audio.mp3',
  'generated/textures/cache.png', 'generated/textures/planet/nested/cache.png',
  'generated/textures/cache.lock', 'generated/textures/planet/cache.lock',
  'generated/trellis2/logs/events.jsonl', 'generated/trellis2/import_log.jsonl',
  'generated/dev-only/heralds/model.glb',
  'generated/comfyui/output/3D/trellis2_teaser_transfer_ship_00001_.glb',
];
const included = [
  '.htaccess', 'index.html', 'package.json', 'package-lock.json', 'vite.config.mjs',
  'VERSION.txt', 'composer.json', 'composer.lock', 'config/config.php',
  'config/config.php.example', 'config/migrations_manifest.php', 'sql/schema.sql',
  'api/helpers.php', 'lib/MigrationRunner.php', 'scripts/migrate.php',
  'js/runtime/boot-manifest.js', 'js/packages/legacy.js.gz',
  'docker/apache/vhost.conf', 'docker/php/conf.d/dev.ini',
  'docker/php/conf.d/xdebug.ini', 'assets/icon.png', 'music/theme.mp3',
  'generated/textures/planet/fallback.svg', 'generated/textures/fallback.svg',
  'generated/models/deployment.glb', 'tests/e2e/view-flow.spec.js',
];

const root = await mkdtemp(path.join(os.tmpdir(), 'gq-docker-context-'));
const image = `gq-context-check:${randomBytes(8).toString('hex')}`;
let container = null;
let built = false;
const docker = async (arguments_) => execute('docker', arguments_, {
  encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 120000,
});

try {
  const context = path.join(root, 'context');
  const output = path.join(root, 'output');
  await mkdir(context);
  await mkdir(output);
  await writeFile(path.join(context, '.dockerignore'), await readFile('.dockerignore', 'utf8'));
  // FROM scratch needs no pull; exercise Docker's actual ignore implementation.
  await writeFile(path.join(context, 'Dockerfile'), 'FROM scratch\nCOPY . /context/\n');
  await Promise.all([...excluded, ...included].map(async (name) => {
    const target = path.join(context, ...name.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `Synthetic context fixture: ${name}\n`);
  }));
  await docker(['build', '--network=none', '--tag', image, context]);
  built = true;
  const created = await docker(['create', image, '/not-executed']);
  container = created.stdout.trim();
  if (!/^[a-f0-9]{64}$/.test(container)) throw new Error('Invalid Docker fixture container ID.');
  await docker(['cp', `${container}:/context/.`, output]);
  const failures = [];
  for (const name of included) {
    try {
      const content = await readFile(path.join(output, ...name.split('/')), 'utf8');
      if (content !== `Synthetic context fixture: ${name}\n`) failures.push(`Runtime input changed: ${name}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      failures.push(`Required runtime input excluded: ${name}`);
    }
  }
  for (const name of excluded) {
    try {
      await access(path.join(output, ...name.split('/')));
      failures.push(`Local/private material included: ${name}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`Docker context gate passed: ${excluded.length} excluded and ${included.length} retained fixtures.`);
} finally {
  // Delete only resources created by this check, never application images/containers.
  try {
    if (container !== null) await docker(['rm', container]);
  } finally {
    try {
      if (built) await docker(['image', 'rm', image]);
    } finally {
      await rm(root, { recursive: true });
    }
  }
}
