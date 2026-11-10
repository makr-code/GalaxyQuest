import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Only this uniquely named disposable stack is ever started or removed.
const project = `gq-deployment-check-${randomBytes(6).toString('hex')}`;
const root = mkdtempSync(path.join(os.tmpdir(), project));
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project, DEPLOY_ROOT: root, DEPLOY_GID: '1001', COMPOSE_PROFILES: '',
  WEB_IMAGE: process.env.GQ_TEST_WEB_IMAGE || 'galaxyquest:deployment-validation',
  MYSQL_IMAGE: 'mysql:8.4', TTS_IMAGE: process.env.GQ_TEST_TTS_IMAGE || 'galaxyquest-tts:latest', GPU_IMAGE: 'unused:validation',
  PROMETHEUS_IMAGE: 'unused:validation', GRAFANA_IMAGE: 'unused:validation',
  MYSQL_EXPORTER_IMAGE: 'unused:validation', NODE_EXPORTER_IMAGE: 'unused:validation',
  BLACKBOX_IMAGE: 'unused:validation', ALERTMANAGER_IMAGE: 'unused:validation',
  WEB_PORT: process.env.GQ_TEST_WEB_PORT || '18081', GRAFANA_PORT: '13000',
};
const password = randomBytes(24).toString('hex');
writeFileSync(path.join(root, 'runtime.env'), `DB_USER=game\nDB_PASS=${password}\nCOMFYUI_ENABLED=0\nTTS_SECRET=fixture-validation-only\nREGISTRATION_PUBLIC_URL=https://example.invalid\n`);
writeFileSync(path.join(root, 'database.env'), `MYSQL_USER=game\nMYSQL_PASSWORD=${password}\nMYSQL_ROOT_PASSWORD=${password}\n`);
writeFileSync(path.join(root, 'tts.env'), 'TTS_SECRET=fixture-validation-only\nTTS_ENGINE=piper\n');
writeFileSync(path.join(root, 'grafana.env'), 'GF_SECURITY_ADMIN_PASSWORD=fixture-validation-only\n');
const args = ['compose', '-f', 'deploy/compose.yml'];
function compose(command, options = {}) {
  return execFileSync('docker', [...args, ...command], {
    env, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024, ...options,
  });
}
async function probe(route, expected) {
  const response = await fetch(`http://127.0.0.1:${env.WEB_PORT}${route}`, {
    headers: { Connection: 'close' },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, expected, route);
  return response;
}
let started = false;
let restore = null;
try {
  started = true;
  compose(['up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '240', 'db', 'tts', 'web']);
  await probe('/health/live', 200);
  await probe('/health/ready', 503);
  const schema = compose(['run', '--rm', '--no-deps', '-T', 'web', 'cat', 'sql/schema.sql']);
  compose(['exec', '-T', 'db', 'sh', '-ec', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot galaxyquest'], { input: schema });
  for (let attempt = 0; attempt < 2; attempt++) {
    console.log(compose(['run', '--rm', '--no-deps', '-T', 'web', 'php', 'scripts/migrate.php', 'up', '--env=TEST']));
  }
  console.log(compose(['run', '--rm', '--no-deps', '-T', 'web', 'php', 'scripts/migrate.php', 'verify', '--env=TEST']));
  console.log(compose(['run', '--rm', '--no-deps', '-T', 'web', 'php', 'setup.php', '--skip-migrations', '--skip-bootstrap', '--skip-npc-seed']));
  await probe('/health/ready', 200);
  const html = await (await probe('/', 200)).text();
  const asset = html.match(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/);
  assert.ok(asset, 'Built Vite asset missing');
  await probe(asset[1], 200);
  for (const route of ['/config/config.php', '/sql/schema.sql', '/deploy/stack.sh']) await probe(route, 403);
  const extensions = compose(['exec', '-T', 'web', 'php', '-r',
    'exit(extension_loaded("curl") && extension_loaded("pdo_mysql") && !extension_loaded("xdebug") ? 0 : 1);']);
  assert.equal(extensions.trim(), '');
  compose(['stop', 'web']);
  const dump = compose(['exec', '-T', 'db', 'sh', '-ec',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --events --triggers --hex-blob --set-gtid-purged=OFF galaxyquest'],
  { maxBuffer: 32 * 1024 * 1024 });
  restore = `${project}-restorecheck`;
  compose(['--profile', 'maintenance', 'run', '-d', '--no-deps', '--name', restore, 'restore-check']);
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    const result = spawnSync('docker', ['exec', restore, 'sh', '-ec',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping --protocol=TCP -h 127.0.0.1 -uroot --silent'],
    { encoding: 'utf8', timeout: 10000 });
    if (result.status === 0) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.ok(ready, 'Disposable backup restore MySQL did not start');
  execFileSync('docker', ['exec', '-i', restore, 'sh', '-ec',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot galaxyquest'],
  { input: dump, timeout: 300000, encoding: 'utf8' });
  const checks = execFileSync('docker', ['exec', '-i', restore, 'sh', '-ec',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B galaxyquest'],
  { input: 'SELECT CONCAT("CHECK TABLE `", REPLACE(TABLE_NAME, "`", "``"), "`;") FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = "BASE TABLE";',
    timeout: 10000, encoding: 'utf8' });
  assert.ok(checks.trim(), 'Restored schema is empty');
  const checked = execFileSync('docker', ['exec', '-i', restore, 'sh', '-ec',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B galaxyquest'],
  { input: checks, timeout: 120000, encoding: 'utf8' });
  assert.ok(checked.trim().split('\n').every((line) => {
    const fields = line.trimEnd().split('\t');
    return fields[2] === 'status' && fields[3] === 'OK';
  }), 'Restored table integrity check failed');
  const restored = execFileSync('docker', ['exec', restore, 'sh', '-ec',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B -e "SELECT COUNT(*) FROM galaxyquest.schema_migrations;"'],
  { encoding: 'utf8', timeout: 10000 }).trim();
  const original = compose(['exec', '-T', 'db', 'sh', '-ec',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B -e "SELECT COUNT(*) FROM galaxyquest.schema_migrations;"']).trim();
  assert.equal(restored, original, 'Restored migration history differs');
  console.log('Production acceptance passed: readiness 503->200, repeat migrations, faction homeworlds, Vite assets, runtime extensions and full MySQL backup restore.');
} catch (error) {
  const logs = spawnSync('docker', [...args, 'logs', '--tail', '30', '--no-color', 'web', 'db'], {
    env, encoding: 'utf8', timeout: 30000,
  });
  console.error(logs.stdout, logs.stderr);
  throw error;
} finally {
  try {
    if (restore !== null) {
      execFileSync('docker', ['rm', '-f', restore], { encoding: 'utf8', timeout: 30000 });
    }
    if (started) {
      const cleanup = spawnSync('docker', [...args, 'down', '--volumes', '--remove-orphans'], {
        env, encoding: 'utf8', timeout: 120000,
      });
      if (cleanup.status !== 0) throw new Error(`Disposable stack cleanup failed: ${cleanup.stderr}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
