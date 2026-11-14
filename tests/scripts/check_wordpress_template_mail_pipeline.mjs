// Isolated E2E run for tests/Integration/WordPressTemplateMailPipelineTest.php.
// Creates only uniquely named, labelled throwaway Docker resources (internal network without
// egress, CA volume, Mailpit) and removes exactly those again. The repository is mounted
// read-only; no WordPress/game database, user Mailpit or external recipient is involved.
// Usage: node tests/scripts/check_wordpress_template_mail_pipeline.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const runId = randomBytes(6).toString('hex');
const name = `gq-wpmail-e2e-${runId}`;
const label = `gq.test.wpmail-e2e=${runId}`;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const image = process.env.GQ_TEST_WEB_IMAGE || 'galaxyquest:deployment-validation';
const mailpitImage = process.env.GQ_TEST_MAILPIT_IMAGE || 'axllent/mailpit:v1.29';
const realKses = existsSync(path.join(repo, 'wordpress', 'wp-includes', 'kses.php'));
const smtpAlias = 'gq-wpmail-smtp-fixture';
const created = { containers: [], network: false, volume: false };
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024, ...options,
});

try {
  docker(['volume', 'create', '--label', label, `${name}-ca`]);
  const volumeLabel = docker(['volume', 'inspect', `${name}-ca`,
    '--format', '{{index .Labels "gq.test.wpmail-e2e"}}']).trim();
  assert.equal(volumeLabel, runId, 'Refusing to use a volume owned by another run');
  created.volume = true;
  const ca = `type=volume,source=${name}-ca,target=/fixture`;
  docker(['run', '--rm', '--label', label, '--network', 'none', '--mount', ca, '--user', '0',
    '--entrypoint', 'sh', image, '-c',
    'set -e; openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=' + smtpAlias + '" '
      + '-addext "subjectAltName=DNS:' + smtpAlias + '" -keyout /fixture/key.pem -out /fixture/cert.pem 2>/dev/null; '
      + 'mkdir -p /fixture/ini; printf "curl.cainfo=/fixture/cert.pem\\n" > /fixture/ini/zz-gq-fixture-ca.ini; '
      + 'chmod -R a+rX /fixture']);

  // --internal: no route to the internet, so nothing can leave the fixture network.
  docker(['network', 'create', '--internal', '--label', label, name]);
  created.network = true;

  created.containers.push(`${name}-mailpit`);
  docker(['run', '-d', '--name', `${name}-mailpit`, '--label', label, '--network', name,
    '--network-alias', smtpAlias, '--mount', `${ca},readonly`, mailpitImage,
    '--smtp-auth-accept-any', '--smtp-require-starttls', '--disable-version-check',
    '--smtp-tls-cert', '/fixture/cert.pem', '--smtp-tls-key', '/fixture/key.pem']);

  created.containers.push(`${name}-php`);
  const run = spawnSync('docker', ['run', '--rm', '--name', `${name}-php`, '--label', label,
    '--network', name, '--mount', `type=bind,source=${repo},target=/src,readonly`, '--mount', `${ca},readonly`,
    '--workdir', '/src', '--tmpfs', '/tmp',
    '-e', 'PHP_INI_SCAN_DIR=:/fixture/ini', '-e', 'XDEBUG_MODE=off', '-e', `GQ_MAIL_PIPELINE_EXPECT_REAL_KSES=${realKses ? 1 : 0}`,
    '-e', 'APP_ENV=production', '-e', 'DB_HOST=db.fixture.invalid', '-e', 'GQ_MAIL_PIPELINE_MAILPIT_API=http://' + smtpAlias + ':8025',
    '-e', `SMTP_HOST=${smtpAlias}`, '-e', 'SMTP_PORT=1025', '-e', 'SMTP_TLS=starttls',
    '-e', 'SMTP_USER=fixture@example.invalid', '-e', 'SMTP_PASSWORD=fixture-only',
    '-e', 'SMTP_FROM=notifications@example.invalid',
    '--entrypoint', 'php', image, 'vendor/bin/phpunit', '--do-not-cache-result', '--fail-on-skipped',
    '--fail-on-risky', '--fail-on-warning', 'tests/Integration/WordPressTemplateMailPipelineTest.php',
  ], { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.write(run.stdout ?? '');
  process.stderr.write(run.stderr ?? '');
  assert.equal(run.status, 0, 'WordPress template mail pipeline E2E failed');
  assert.match(run.stdout, /OK \(5 tests,/, 'Expected all 5 pipeline tests to run');
  console.log(`WordPress template mail pipeline E2E passed (${realKses ? 'real WordPress KSES' : 'KSES stub, no local WordPress core'}).`);
} finally {
  const cleanup = (args) => spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 });
  for (const container of created.containers.reverse()) {
    const inspection = cleanup(['inspect', container,
      '--format', '{{index .Config.Labels "gq.test.wpmail-e2e"}}']);
    if (inspection.status === 0 && inspection.stdout.trim() === runId) {
      cleanup(['rm', '-f', '--volumes', container]);
    }
  }
  if (created.network) cleanup(['network', 'rm', name]);
  if (created.volume) cleanup(['volume', 'rm', '-f', `${name}-ca`]);
  const leftovers = cleanup(['ps', '-aq', '--filter', `label=${label}`]).stdout.trim()
    + cleanup(['network', 'ls', '-q', '--filter', `label=${label}`]).stdout.trim()
    + cleanup(['volume', 'ls', '-q', '--filter', `label=${label}`]).stdout.trim();
  if (leftovers !== '') {
    console.error(`Cleanup incomplete for label ${label}: ${leftovers}`);
    process.exitCode = 1;
  }
}
