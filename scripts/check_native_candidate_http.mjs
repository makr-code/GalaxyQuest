import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [archive, expectedCommit] = process.argv.slice(2);
if (process.argv.length !== 4 || !/^[a-f0-9]{40}$/.test(expectedCommit ?? '')) {
  throw new Error('Usage: node scripts/check_native_candidate_http.mjs CANDIDATE_TAR_GZ FULL_COMMIT_SHA');
}
if (!path.isAbsolute(archive)) throw new Error('Candidate archive must use an absolute path.');

const suffix = randomBytes(8).toString('hex');
const apacheImage = `gq-native-candidate-http:${suffix}`;
const fpmImage = `gq-native-candidate-fpm:${suffix}`;
const network = `gq-native-candidate-${suffix}`;
const apacheContainer = `gq-native-candidate-http-${suffix}`;
const fpmContainer = `gq-native-candidate-fpm-${suffix}`;
const root = mkdtempSync(path.join(os.tmpdir(), 'gq-native-candidate-http-'));
const site = path.join(root, 'site');
let apacheImageCreated = false;
let fpmImageCreated = false;
let networkCreated = false;
let apacheContainerCreated = false;
let fpmContainerCreated = false;

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 900000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

function safeArchiveEntries() {
  const entries = execFileSync('tar', ['-tzf', archive], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  }).replaceAll('\r\n', '\n').trimEnd().split('\n');
  if (!entries.length || entries.some((entry) => !entry.startsWith('./'))) {
    throw new Error('Candidate tar contains a path outside its release root.');
  }
  for (const entry of entries) {
    const relative = entry.slice(2);
    if (relative.includes('\\') || /[\u0000-\u001f]/.test(relative)
      || relative.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error('Candidate tar contains an ambiguous or traversing path.');
    }
  }
  const details = execFileSync('tar', ['-tvzf', archive], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  }).replaceAll('\r\n', '\n').trimEnd().split('\n');
  if (details.some((line) => !['-', 'd'].includes(line[0]))) {
    throw new Error('Candidate tar may contain only regular files and directories.');
  }
  return entries;
}

function addWordPressFixture() {
  const wordpress = path.join(site, 'wordpress');
  mkdirSync(wordpress);
  writeFileSync(path.join(wordpress, 'index.php'),
    '<?php echo "WORDPRESS:" . $_SERVER["REQUEST_URI"];\n');
  writeFileSync(path.join(wordpress, 'asset.css'), '/* wordpress asset */\n');
  writeFileSync(path.join(wordpress, 'robots.txt'), 'WordPress robots\n');
  writeFileSync(path.join(wordpress, 'settings.env'), 'sensitive fixture\n');
  writeFileSync(path.join(wordpress, '.htaccess'), `
RewriteEngine On
RewriteBase /wordpress/
RewriteRule ^index\\.php$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /wordpress/index.php [L]
`);
}

async function waitForRoot(base) {
  let lastStatus = 'no response';
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) return response;
      lastStatus = `HTTP ${response.status}`;
    } catch {
      lastStatus = 'no response';
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`PHP 8.4 Apache/PHP-FPM candidate did not start (${lastStatus}).`);
}

try {
  const entries = safeArchiveEntries();
  assert.ok(entries.includes('./native-release.json'), 'Candidate manifest is missing');
  assert.ok(entries.includes('./index.php'), 'Candidate PHP entry point is missing');
  assert.ok(entries.includes('./dist/index.html'), 'Candidate Vite entry point is missing');
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', archive, './native-release.json'], {
    encoding: 'utf8',
    timeout: 10000,
  }));
  assert.deepEqual(manifest, {
    commit: expectedCommit,
    web_image_id: manifest.web_image_id,
    status: 'not-deployable',
  });
  assert.match(manifest.web_image_id, /^sha256:[a-f0-9]{64}$/);

  mkdirSync(site);
  execFileSync('tar', [
    '-xzf', archive, '-C', site, '--no-same-owner', '--no-same-permissions',
  ], { timeout: 120000 });
  const extractedManifest = JSON.parse(readFileSync(path.join(site, 'native-release.json'), 'utf8'));
  assert.deepEqual(extractedManifest, manifest);
  assert.ok(readdirSync(path.join(site, 'dist', 'assets')).length > 0, 'Candidate assets are missing');
  addWordPressFixture();
  chmodSync(root, 0o755);
  chmodSync(site, 0o755);

  writeFileSync(path.join(root, 'Dockerfile'), `
FROM php:8.4-apache
RUN a2dismod php \\
    && a2enmod rewrite headers proxy proxy_fcgi \\
    && sed -i 's/^Listen 80$/Listen 8080/' /etc/apache2/ports.conf \\
    && mkdir -p /var/run/apache2 /var/lock/apache2 \\
    && chown -R www-data:www-data /var/run/apache2 /var/lock/apache2 /var/log/apache2
COPY vhost.conf /etc/apache2/sites-available/000-default.conf
COPY security.conf /etc/apache2/conf-available/zzz-gq-security.conf
RUN a2enconf zzz-gq-security
EXPOSE 8080
USER www-data
CMD ["apache2-foreground"]
`);
  chmodSync(path.join(root, 'Dockerfile'), 0o644);
  writeFileSync(path.join(root, 'Dockerfile.fpm'), `
FROM php:8.4-fpm
RUN docker-php-ext-install pdo_mysql
`);
  chmodSync(path.join(root, 'Dockerfile.fpm'), 0o644);
  const fpmHandler = String.raw`    <FilesMatch "\.php$">
        SetHandler "proxy:fcgi://php-fpm:9000"
    </FilesMatch>
`;
  const vhost = readFileSync('docker/apache/vhost.conf', 'utf8');
  assert.ok(vhost.includes('</VirtualHost>'), 'Apache virtual host is missing its closing tag');
  writeFileSync(path.join(root, 'vhost.conf'),
    vhost.replace('</VirtualHost>', `${fpmHandler}</VirtualHost>`));
  writeFileSync(path.join(root, 'security.conf'), readFileSync('docker/apache/security.conf'));

  docker(['build', '--tag', apacheImage, root]);
  apacheImageCreated = true;
  docker(['build', '--tag', fpmImage, '--file', path.join(root, 'Dockerfile.fpm'), root]);
  fpmImageCreated = true;
  docker(['network', 'create', network]);
  networkCreated = true;
  docker(['run', '--detach', '--name', fpmContainer, '--network', network, '--network-alias', 'php-fpm',
    '--mount', `type=bind,source=${site},target=/var/www/html,readonly`,
    '-e', 'APP_ENV=production',
    '-e', 'DB_HOST=127.0.0.1',
    '-e', 'DB_NAME=gq_candidate_uninitialized',
    '-e', 'DB_USER=gq_candidate',
    '-e', 'DB_PASS=candidate-fixture-only',
    fpmImage]);
  fpmContainerCreated = true;
  docker(['run', '--detach', '--name', apacheContainer, '--network', network, '--publish', '127.0.0.1::8080',
    '--mount', `type=bind,source=${site},target=/var/www/html,readonly`,
    apacheImage]);
  apacheContainerCreated = true;
  const binding = docker(['port', apacheContainer, '8080/tcp']).trim();
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const phpVersion = docker(['exec', fpmContainer, 'php', '-r', 'echo PHP_VERSION;']).trim();
  assert.match(phpVersion, /^8\.4\./);
  const base = `http://${binding}`;
  const rootResponse = await waitForRoot(base);
  assert.equal(rootResponse.status, 200);
  assert.equal(rootResponse.headers.get('x-content-type-options'), 'nosniff');
  const html = await rootResponse.text();
  const assetPaths = [...new Set(html.match(/\/assets\/[^"'?#\s]+/g) ?? [])];
  assert.ok(assetPaths.length > 0, 'Rendered candidate page has no built assets');
  for (const assetPath of assetPaths) {
    const asset = await fetch(`${base}${assetPath}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(asset.status, 200, assetPath);
    assert.notEqual(asset.headers.get('content-type'), 'text/html', assetPath);
  }

  const live = await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(5000) });
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: 'alive' });
  const ready = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(10000) });
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { status: 'unavailable' });
  for (const route of ['/setup.php', '/config/config.php', '/sql/schema.sql', '/scripts/migrate.php']) {
    const response = await fetch(`${base}${route}`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 403, route);
  }

  for (const [route, expected] of [
    ['/wordpress/', 'WORDPRESS:/wordpress/'],
    ['/wordpress/sample-post/', 'WORDPRESS:/wordpress/sample-post/'],
    ['/wordpress/asset.css', '/* wordpress asset */\n'],
    ['/wordpress/robots.txt', 'WordPress robots\n'],
  ]) {
    const response = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, route);
    assert.equal(await response.text(), expected, route);
  }
  const hiddenWordPressFile = await fetch(`${base}/wordpress/settings.env`, { redirect: 'manual' });
  assert.equal(hiddenWordPressFile.status, 403);

  rmSync(path.join(site, 'wordpress', '.htaccess'));
  for (const route of ['/wordpress/sample-post/', '/wordpress/wp-json/']) {
    const response = await fetch(`${base}${route}`, { redirect: 'manual' });
    assert.equal(response.status, 404, route);
    const body = await response.text();
    assert.ok(!assetPaths.some((assetPath) => body.includes(assetPath)),
      'Missing WordPress rewrites must not reach the game.');
  }
  rmSync(path.join(site, 'wordpress'), { recursive: true });
  const absentWordPress = await fetch(`${base}/wordpress/sample-post/`);
  assert.equal(absentWordPress.status, 200);
  assert.match(await absentWordPress.text(), /<html/i);
  console.log(`Native candidate PHP ${phpVersion} FPM/Apache smoke passed; candidate remains non-deployable.`);
} finally {
  try {
    if (apacheContainerCreated) {
      const result = spawnSync('docker', ['rm', '-f', apacheContainer], { encoding: 'utf8', timeout: 30000 });
      if (result.status !== 0) throw new Error(`Candidate Apache container cleanup failed: ${result.stderr}`);
    }
  } finally {
    try {
      if (fpmContainerCreated) {
        const result = spawnSync('docker', ['rm', '-f', fpmContainer], { encoding: 'utf8', timeout: 30000 });
        if (result.status !== 0) throw new Error(`Candidate PHP-FPM container cleanup failed: ${result.stderr}`);
      }
    } finally {
      try {
        if (networkCreated) {
          const result = spawnSync('docker', ['network', 'rm', network], { encoding: 'utf8', timeout: 30000 });
          if (result.status !== 0) throw new Error(`Candidate network cleanup failed: ${result.stderr}`);
        }
      } finally {
        try {
          if (apacheImageCreated) {
            const result = spawnSync('docker', ['image', 'rm', apacheImage], { encoding: 'utf8', timeout: 30000 });
            if (result.status !== 0) throw new Error(`Candidate Apache image cleanup failed: ${result.stderr}`);
          }
        } finally {
          try {
            if (fpmImageCreated) {
              const result = spawnSync('docker', ['image', 'rm', fpmImage], { encoding: 'utf8', timeout: 30000 });
              if (result.status !== 0) throw new Error(`Candidate PHP-FPM image cleanup failed: ${result.stderr}`);
            }
          } finally {
            rmSync(root, { recursive: true, force: true });
          }
        }
      }
    }
  }
}
