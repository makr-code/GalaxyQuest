// Real WordPress-Core + HTTPS REST-auth E2E. WordPress core, MariaDB persistence,
// KSES, CPT permissions, and REST Application Passwords are real. Only the
// install welcome-email hook and a minimal theme are fixture-only; no SMTP is run.
// Uses only already-installed images, never pulls, and mounts no site data,
// wp-config.php, wp-content, .env, or checkout database.
// Run with: node tests/scripts/check_wordpress_template_mail_real_http_e2e.mjs
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const wp = path.join(repo, 'wordpress');
const phpImage = 'galaxyquest-web:latest';
const dbImage = 'mariadb:11.8';
const runId = randomBytes(8).toString('hex');
const resourceName = `gq-wpmail-real-e2e-${runId}`;
const resourceLabel = `gq.test.wordpress-mail-real-e2e=${runId}`;
const networkName = resourceName;
const caVolume = `${resourceName}-ca`;
const dbVolume = `${resourceName}-db`;
const wpContainer = `${resourceName}-wp`;
const dbContainer = `${resourceName}-db`;
const caMount = `type=volume,source=${caVolume},target=/fixture`;
const created = { containers: [], volumes: [], network: false };

const coreFiles = [
  'index.php',
  'wp-activate.php',
  'wp-blog-header.php',
  'wp-comments-post.php',
  'wp-cron.php',
  'wp-links-opml.php',
  'wp-load.php',
  'wp-login.php',
  'wp-mail.php',
  'wp-settings.php',
  'wp-signup.php',
  'wp-trackback.php',
  'xmlrpc.php',
];

function docker(args, timeout = 120_000) {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? `exit ${error.status}` : 'launch/timeout failure';
    let detail = [error?.stdout, error?.stderr]
      .filter(Boolean)
      .map(value => value.toString('utf8'))
      .join('\n')
      .trim();
    for (const argument of args) {
      if (argument.startsWith('GQ_FIXTURE_') && argument.includes('=')) {
        detail = detail.replaceAll(argument.slice(argument.indexOf('=') + 1), '[redacted]');
      }
    }
    throw new Error(`Docker command failed (${status}).${detail ? `\n${detail.slice(-1600)}` : ''}`);
  }
}

function assertLocalDockerAndImages() {
  const endpointText = docker([
    'context', 'inspect', '--format', '{{json .Endpoints.docker}}',
  ]).trim();
  const endpoint = JSON.parse(endpointText);
  assert.match(endpoint.Host ?? '', /^(npipe:|unix:)/i,
    'This test requires a local Docker Engine context; remote contexts are not used.');

  for (const image of [phpImage, dbImage]) {
    docker(['image', 'inspect', image]);
  }

  const probe = docker([
    'run', '--rm', '--pull=never', '--network', 'none', '--user', '0:0',
    '--entrypoint', 'sh', phpImage, '-c',
    'set -eu; command -v apache2-foreground >/dev/null; a2enmod ssl >/dev/null; '
      + 'php -r \'foreach(["mysqli","pdo_sqlite","mbstring","curl","openssl"] as $e) '
      + 'if (!extension_loaded($e)) { fwrite(STDERR, "missing PHP extension: ".$e."\\n"); exit(2); }\'',
  ]);
  assert.equal(probe, '');
}

function bindMount(source, target, readOnly = true) {
  assert.ok(path.isAbsolute(source), `Expected an absolute local path for ${target}`);
  return `type=bind,source=${source},target=${target}${readOnly ? ',readonly' : ''}`;
}

function createVolume(volumeName) {
  docker(['volume', 'create', '--label', resourceLabel, volumeName]);
  const owner = docker([
    'volume', 'inspect', volumeName, '--format', '{{index .Labels "gq.test.wordpress-mail-real-e2e"}}',
  ]).trim();
  assert.equal(owner, runId, `Refusing to use unowned volume ${volumeName}`);
  created.volumes.push(volumeName);
}

function waitFor(check, description, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (check()) return;
    } catch {
      // The fixture is still starting.
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error(`${description} did not become ready.`);
}

function runFixturePhp(script, args = [], env = {}) {
  const dockerArgs = ['exec'];
  for (const [key, value] of Object.entries(env)) {
    dockerArgs.push('--env', `${key}=${value}`);
  }
  dockerArgs.push(wpContainer, 'sh', '-c', 'php "$@" 2>&1', 'gq-fixture-php', script, ...args);
  return docker(dockerArgs, 120_000);
}

function cleanupOwnedResources() {
  let failedCleanup = false;
  for (const container of [...created.containers].reverse()) {
    const inspection = spawnSync('docker', [
      'inspect', container, '--format', '{{index .Config.Labels "gq.test.wordpress-mail-real-e2e"}}',
    ], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    if (inspection.status === 0 && inspection.stdout.trim() === runId) {
      const removal = spawnSync('docker', ['rm', '-f', container], {
        encoding: 'utf8', timeout: 60_000, windowsHide: true,
      });
      if (removal.status !== 0) failedCleanup = true;
    } else if (inspection.status === 0) {
      failedCleanup = true;
    }
  }

  if (created.network) {
    const inspection = spawnSync('docker', [
      'network', 'inspect', networkName, '--format', '{{index .Labels "gq.test.wordpress-mail-real-e2e"}}',
    ], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    if (inspection.status === 0 && inspection.stdout.trim() === runId) {
      const removal = spawnSync('docker', ['network', 'rm', networkName], {
        encoding: 'utf8', timeout: 60_000, windowsHide: true,
      });
      if (removal.status !== 0) failedCleanup = true;
    } else if (inspection.status === 0) {
      failedCleanup = true;
    }
  }

  for (const volume of [...created.volumes].reverse()) {
    const inspection = spawnSync('docker', [
      'volume', 'inspect', volume, '--format', '{{index .Labels "gq.test.wordpress-mail-real-e2e"}}',
    ], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    if (inspection.status === 0 && inspection.stdout.trim() === runId) {
      const removal = spawnSync('docker', ['volume', 'rm', volume], {
        encoding: 'utf8', timeout: 60_000, windowsHide: true,
      });
      if (removal.status !== 0) failedCleanup = true;
    } else if (inspection.status === 0) {
      failedCleanup = true;
    }
  }

  if (failedCleanup) {
    console.error(`Cleanup incomplete. Inspect only resources labelled ${resourceLabel}.`);
    process.exitCode = 1;
  }
}

try {
  for (const file of [
    'wp-admin/includes/upgrade.php',
    'wp-includes/version.php',
    ...coreFiles,
  ]) {
    assert.ok(existsSync(path.join(wp, file)), `WordPress core file is missing: ${file}`);
  }
  for (const file of [
    'tests/fixtures/wordpress_mail_templates_real_core_setup.php',
    'tests/fixtures/wordpress_mail_templates_real_http_client.php',
    'wordpress-integration/gq-game-news.php',
    'lib/WordPressNewsPublisher.php',
    'lib/WordPressTemplateMail.php',
    'lib/Mailer.php',
    'lib/mail_outbox.php',
  ]) {
    assert.ok(existsSync(path.join(repo, file)), `Fixture source file is missing: ${file}`);
  }

  assertLocalDockerAndImages();

  createVolume(caVolume);
  createVolume(dbVolume);
  docker([
    'run', '--rm', '--pull=never', '--label', resourceLabel, '--network', 'none',
    '--mount', caMount, '--user', '0:0', '--entrypoint', 'sh', phpImage, '-c',
    'set -eu; openssl req -x509 -newkey rsa:2048 -nodes -days 1 '
      + '-subj "/CN=wp.fixture.invalid" '
      + '-addext "subjectAltName=DNS:wp.fixture.invalid" '
      + '-keyout /fixture/key.pem -out /fixture/cert.pem 2>/dev/null; '
      + 'chmod 400 /fixture/key.pem; chmod 444 /fixture/cert.pem; '
      + 'printf "curl.cainfo=/fixture/cert.pem\\nopenssl.cafile=/fixture/cert.pem\\n" '
      + '> /fixture/zz-gq-fixture-ca.ini',
  ]);

  docker(['network', 'create', '--internal', '--label', resourceLabel, networkName]);
  created.network = true;

  created.containers.push(dbContainer);
  docker([
    'run', '-d', '--pull=never', '--name', dbContainer, '--label', resourceLabel,
    '--network', networkName, '--network-alias', 'gq-mail-db',
    '--mount', `type=volume,source=${dbVolume},target=/var/lib/mysql`,
    '--env', 'MARIADB_DATABASE=gq_fixture',
    '--env', 'MARIADB_USER=gq_fixture',
    '--env', 'MARIADB_PASSWORD=gq_fixture_only',
    '--env', 'MARIADB_ROOT_PASSWORD=gq_root_fixture_only',
    dbImage,
  ]);

  waitFor(() => {
    const result = spawnSync('docker', [
      'exec', dbContainer, 'mariadb-admin', 'ping', '-h127.0.0.1',
      '-uroot', '-pgq_root_fixture_only', '--silent',
    ], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
    return result.status === 0;
  }, 'The isolated database');

  const mounts = [
    '--tmpfs', '/run/gq-wp-site:rw,exec,size=128m',
    '--mount', `type=bind,source=${path.join(wp, 'wp-admin')},target=/run/gq-wp-site/wp-admin,readonly`,
    '--mount', `type=bind,source=${path.join(wp, 'wp-includes')},target=/run/gq-wp-site/wp-includes,readonly`,
  ];
  for (const file of coreFiles) {
    mounts.push('--mount', bindMount(path.join(wp, file), `/run/gq-wp-site/${file}`));
  }
  mounts.push(
    '--mount', caMount + ',readonly',
    '--mount', bindMount(path.join(repo, 'tests/fixtures/wordpress_mail_templates_real_core_setup.php'), '/run/gq-mail-setup.php'),
    '--mount', bindMount(path.join(repo, 'tests/fixtures/wordpress_mail_templates_real_http_client.php'), '/run/gq-mail-client.php'),
    '--mount', bindMount(path.join(repo, 'wordpress-integration/gq-game-news.php'), '/run/gq-game-news.php'),
    '--mount', bindMount(path.join(repo, 'lib/WordPressNewsPublisher.php'), '/run/gq-source/WordPressNewsPublisher.php'),
    '--mount', bindMount(path.join(repo, 'lib/WordPressTemplateMail.php'), '/run/gq-source/WordPressTemplateMail.php'),
    '--mount', bindMount(path.join(repo, 'lib/Mailer.php'), '/run/gq-source/Mailer.php'),
    '--mount', bindMount(path.join(repo, 'lib/mail_outbox.php'), '/run/gq-source/mail_outbox.php'),
  );

  created.containers.push(wpContainer);
  docker([
    'run', '-d', '--pull=never', '--name', wpContainer, '--label', resourceLabel,
    '--network', networkName, '--network-alias', 'wp.fixture.invalid',
    '--user', '0:0',
    '--env', 'PHP_INI_SCAN_DIR=:/fixture',
    '--env', 'HTTP_PROXY=', '--env', 'HTTPS_PROXY=', '--env', 'ALL_PROXY=',
    '--env', 'http_proxy=', '--env', 'https_proxy=', '--env', 'all_proxy=',
    ...mounts,
    '--entrypoint', '/bin/sh', phpImage, '-c',
    'set -eu; mkdir -p /run/gq-wp-site/wp-content/plugins/gq-game-news '
      + '/run/gq-wp-site/wp-content/themes/gq-fixture; '
      + 'cp /run/gq-game-news.php /run/gq-wp-site/wp-content/plugins/gq-game-news/gq-game-news.php; '
      + 'printf "%s\\n" "<?php /* Fixture theme, generated only in the throwaway container. */" '
      + '> /run/gq-wp-site/wp-content/themes/gq-fixture/index.php; '
      + 'printf "%s\\n" "/*" "Theme Name: GQ E2E Fixture" "Version: 1.0" "*/" '
      + '> /run/gq-wp-site/wp-content/themes/gq-fixture/style.css; '
      + 'a2enmod ssl rewrite >/dev/null; a2dissite default-ssl >/dev/null 2>&1 || true; '
      + 'cat > /etc/apache2/sites-available/gq-mail-fixture.conf <<\'APACHE\'\n'
      + '<VirtualHost *:443>\n'
      + '  ServerName wp.fixture.invalid\n'
      + '  DocumentRoot /run/gq-wp-site\n'
      + '  SSLEngine on\n'
      + '  SSLCertificateFile /fixture/cert.pem\n'
      + '  SSLCertificateKeyFile /fixture/key.pem\n'
      + '  <Directory /run/gq-wp-site>\n'
      + '    Options FollowSymLinks\n'
      + '    AllowOverride None\n'
      + '    Require all granted\n'
      + '  </Directory>\n'
      + '  RewriteEngine On\n'
      + '  RewriteCond %{REQUEST_FILENAME} !-f\n'
      + '  RewriteCond %{REQUEST_FILENAME} !-d\n'
      + '  RewriteRule ^ /index.php [QSA,L]\n'
      + '  ErrorLog /proc/self/fd/2\n'
      + '  CustomLog /proc/self/fd/1 combined\n'
      + '</VirtualHost>\n'
      + 'APACHE\n'
      + 'a2ensite gq-mail-fixture >/dev/null; exec apache2-foreground',
  ]);

  waitFor(() => {
    const state = docker([
      'inspect', wpContainer, '--format', '{{.State.Running}}',
    ]).trim();
    if (state !== 'true') return false;
    const socket = spawnSync('docker', [
      'exec', wpContainer, 'php', '-r',
      '$s=@fsockopen("127.0.0.1",443,$e,$m,1); if(!$s) exit(1); fclose($s);',
    ], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
    return socket.status === 0;
  }, 'The isolated HTTPS WordPress server');

  const setupOutput = runFixturePhp('/run/gq-mail-setup.php', ['bootstrap']);
  const setupLine = setupOutput.trim().split(/\r?\n/).at(-1);
  if (!setupLine || !setupLine.startsWith('{')) {
    const safeOutput = setupOutput.replace(
      /("(?:admin|reader)_app_password"\s*:\s*")[^"]*(")/g,
      '$1[redacted]$2',
    );
    throw new Error(`WordPress fixture bootstrap did not return its JSON record (stdout ${setupOutput.length} chars): ${safeOutput.slice(0, 500)}`);
  }
  const fixture = JSON.parse(setupLine);
  assert.ok(Number.isInteger(fixture.template_id) && fixture.template_id > 0);
  assert.equal(typeof fixture.admin_app_password, 'string');
  assert.equal(typeof fixture.reader_app_password, 'string');

  const draftOutput = runFixturePhp('/run/gq-mail-client.php', ['draft', String(fixture.template_id)], {
    GQ_FIXTURE_ADMIN_APP_PASSWORD: fixture.admin_app_password,
    GQ_FIXTURE_READER_APP_PASSWORD: fixture.reader_app_password,
  });
  process.stdout.write(draftOutput);
  runFixturePhp('/run/gq-mail-setup.php', ['approve', String(fixture.template_id)]);
  const clientOutput = runFixturePhp('/run/gq-mail-client.php', ['approved', String(fixture.template_id)], {
    GQ_FIXTURE_ADMIN_APP_PASSWORD: fixture.admin_app_password,
    GQ_FIXTURE_READER_APP_PASSWORD: fixture.reader_app_password,
  });

  process.stdout.write(clientOutput);
  console.log('PASS real WordPress core registration, editorial approval, HTTPS REST app-password auth, and SQLite outbox.');
} finally {
  cleanupOwnedResources();
}
