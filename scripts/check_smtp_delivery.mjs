import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const name = `gq-smtp-check-${randomBytes(6).toString('hex')}`;
const root = mkdtempSync(path.join(os.tmpdir(), name));
const image = process.env.GQ_TEST_WEB_IMAGE || 'galaxyquest:deployment-validation';
const fixtureImage = process.env.GQ_TEST_MAILPIT_IMAGE || 'axllent/mailpit:v1.29';
let networkCreated = false;
let container = null;
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, ...options,
});
const mount = `type=bind,source=${root},target=/fixture`;
try {
  docker(['run', '--rm', '--mount', mount, '--entrypoint', 'openssl', image,
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=smtp-fixture', '-addext', 'subjectAltName=DNS:smtp-fixture',
    '-keyout', '/fixture/key.pem', '-out', '/fixture/cert.pem']);
  docker(['network', 'create', name]);
  networkCreated = true;
  for (const tls of ['starttls', 'implicit']) {
    container = docker(['run', '-d', '--network', name, '--network-alias', 'smtp-fixture',
      '--publish', '127.0.0.1::8025', '--mount', `${mount},readonly`, fixtureImage,
      '--smtp-auth-accept-any', '--smtp-tls-cert', '/fixture/cert.pem',
      '--smtp-tls-key', '/fixture/key.pem', tls === 'implicit' ? '--smtp-require-tls' : '--smtp-require-starttls']).trim();
    const port = docker(['inspect', container, '--format', '{{(index (index .NetworkSettings.Ports "8025/tcp") 0).HostPort}}']).trim();
    const api = `http://127.0.0.1:${port}`;
    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const response = await fetch(`${api}/livez`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) { healthy = true; break; }
      } catch (error) {
        if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(healthy, 'Local SMTP fixture did not become ready');
    const envArgs = [
      '-e', 'APP_ENV=production', '-e', 'REGISTRATION_PUBLIC_URL=https://game.example.invalid',
      '-e', 'SMTP_HOST=smtp-fixture', '-e', 'SMTP_PORT=1025', '-e', `SMTP_TLS=${tls}`,
      '-e', 'SMTP_USER=game@example.invalid', '-e', 'SMTP_PASSWORD=fixture-only',
      '-e', 'SMTP_FROM=game@example.invalid',
    ];
    const php = 'require "config/config.php"; require "lib/RegistrationMail.php"; registration_send_verification("player@example.invalid", str_repeat("a", 64));';
    const baseArgs = ['run', '--rm', '--network', name, '--mount', `${mount},readonly`,
      ...envArgs, '--entrypoint', 'php', image];
    docker([...baseArgs, '-d', 'curl.cainfo=/fixture/cert.pem', '-r', php]);
    const messages = await (await fetch(`${api}/api/v1/messages`)).json();
    assert.equal(messages.messages.length, 1, `${tls}: SMTP did not deliver exactly once`);
    const message = await (await fetch(`${api}/api/v1/message/${messages.messages[0].ID}`)).json();
    assert.equal(message.Text.trim(), `https://game.example.invalid/#registration-confirm=${'a'.repeat(64)}`);
    const rejected = spawnSync('docker', [...baseArgs, '-r', php], { encoding: 'utf8', timeout: 30000 });
    assert.notEqual(rejected.status, 0, 'SMTP accepted an untrusted server certificate');
    const after = await (await fetch(`${api}/api/v1/messages`)).json();
    assert.equal(after.messages.length, 1, 'Untrusted TLS attempt delivered a message');
    docker(['rm', '-f', container]);
    container = null;
  }
  console.log('Production SMTP: STARTTLS and implicit TLS delivery, exact confirmation link and untrusted-certificate rejection passed.');
} finally {
  try {
    if (container !== null) docker(['rm', '-f', container]);
  } finally {
    try {
      if (networkCreated) docker(['network', 'rm', name]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}
