import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const image = process.env.GQ_TEST_WEB_IMAGE;
if (!image) throw new Error('Set GQ_TEST_WEB_IMAGE to the isolated Apache test image.');
const name = `gq-wordpress-routing-${randomBytes(8).toString('hex')}`;
const root = mkdtempSync(path.join(os.tmpdir(), 'gq-wordpress-routing-'));
let container = false;
try {
  chmodSync(root, 0o755);
  mkdirSync(path.join(root, 'wordpress'));
  mkdirSync(path.join(root, 'api'));
  copyFileSync('.htaccess', path.join(root, '.htaccess'));
  writeFileSync(path.join(root, 'index.php'), '<?php echo "GAME";\n');
  writeFileSync(path.join(root, 'health.php'), '<?php echo "HEALTH";\n');
  writeFileSync(path.join(root, 'setup.php'), '<?php echo "SETUP MUST NOT RUN";\n');
  writeFileSync(path.join(root, 'settings.env'), 'sensitive game fixture\n');
  writeFileSync(path.join(root, 'api', 'status.php'), '<?php echo "API";\n');
  writeFileSync(path.join(root, 'wordpress', 'index.php'), '<?php echo "WORDPRESS:" . $_SERVER["REQUEST_URI"];\n');
  writeFileSync(path.join(root, 'wordpress', 'asset.css'), '/* wordpress asset */\n');
  writeFileSync(path.join(root, 'wordpress', 'robots.txt'), 'WordPress robots\n');
  writeFileSync(path.join(root, 'wordpress', 'settings.env'), 'sensitive fixture\n');
  writeFileSync(path.join(root, 'wordpress', 'settings.ENV'), 'sensitive fixture\n');
  writeFileSync(path.join(root, 'wordpress', '.htaccess'), `
RewriteEngine On
RewriteBase /wordpress/
RewriteRule ^index\\.php$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /wordpress/index.php [L]
`);
  execFileSync('docker', ['run', '-d', '--name', name, '--network', 'bridge',
    '-p', '127.0.0.1::8080', '--mount', `type=bind,source=${root},target=/var/www/html,readonly`, image],
  { encoding: 'utf8', timeout: 30000 });
  container = true;
  const binding = execFileSync('docker', ['port', name, '8080/tcp'], { encoding: 'utf8', timeout: 10000 }).trim();
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const base = `http://${binding}`;
  let response;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { response = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) }); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 1000)); }
  }
  assert.ok(response, 'Apache fixture did not start');
  assert.equal(await response.text(), 'GAME');
  for (const [url, expected] of [
    ['/health/live', 'HEALTH'],
    ['/api/v1/status.php', 'API'],
    ['/game-route', 'GAME'],
    ['/wordpress/', 'WORDPRESS:/wordpress/'],
    ['/wordpress/wp-json/', 'WORDPRESS:/wordpress/wp-json/'],
    ['/wordpress/sample-post/', 'WORDPRESS:/wordpress/sample-post/'],
    ['/wordpress/sample-post/?preview=1', 'WORDPRESS:/wordpress/sample-post/?preview=1'],
    ['/wordpress/asset.css', '/* wordpress asset */\n'],
    ['/wordpress/robots.txt', 'WordPress robots\n'],
  ]) {
    const result = await fetch(base + url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    assert.equal(result.status, 200, url);
    assert.equal(await result.text(), expected, url);
  }
  for (const url of ['/setup.php', '/SETUP.php', '/config/config.php', '/sql/schema.sql', '/settings.env',
    '/wordpress/settings.env', '/wordpress/settings.ENV']) {
    const result = await fetch(base + url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    assert.equal(result.status, 403, url);
  }
  rmSync(path.join(root, 'wordpress', '.htaccess'));
  for (const url of ['/wordpress/sample-post/', '/wordpress/wp-json/']) {
    const result = await fetch(base + url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    assert.equal(result.status, 404, `${url} without WordPress rewrite rules`);
    assert.notEqual(await result.text(), 'GAME', `${url} must not reach the game`);
  }
  const blogIndex = await fetch(`${base}/wordpress/`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  assert.equal(blogIndex.status, 200);
  assert.equal(await blogIndex.text(), 'WORDPRESS:/wordpress/');
  const blogText = await fetch(`${base}/wordpress/robots.txt`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  assert.equal(blogText.status, 200);
  assert.equal(await blogText.text(), 'WordPress robots\n');
  for (const url of ['/wordpress/settings.env', '/wordpress/settings.ENV']) {
    const result = await fetch(base + url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    assert.equal(result.status, 403, url);
  }
  renameSync(path.join(root, 'wordpress'), path.join(root, 'wordpress-disabled'));
  const absentBlog = await fetch(`${base}/wordpress/sample-post/`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  assert.equal(absentBlog.status, 200);
  assert.equal(await absentBlog.text(), 'GAME');
  console.log('Apache game and simulated WordPress routes are isolated.');
} finally {
  try {
    if (container) {
      const result = spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8', timeout: 30000 });
      if (result.status !== 0) throw new Error(`Fixture cleanup failed: ${result.stderr}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
