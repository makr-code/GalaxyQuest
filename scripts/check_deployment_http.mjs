import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] ?? '');
assert.equal(origin.protocol, 'https:', 'Public deployment requires HTTPS');
assert.equal(origin.pathname, '/');
assert.equal(origin.username + origin.password + origin.search + origin.hash, '');
async function request(path) {
  const response = await fetch(new URL(path, origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  return { response, text: await response.text() };
}
for (const [path, status] of [['/health/live', 'alive'], ['/health/ready', 'ready']]) {
  const { response, text } = await request(path);
  assert.equal(response.status, 200, path);
  assert.equal(JSON.parse(text).status, status, path);
}
const { response, text } = await request('/');
assert.equal(response.status, 200);
for (const header of ['x-content-type-options', 'x-frame-options', 'referrer-policy']) {
  assert.ok(response.headers.get(header), `Missing security header ${header}`);
}
const asset = text.match(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/);
assert.ok(asset, 'Built Vite asset missing from public entry');
assert.equal((await request(asset[1])).response.status, 200, 'Built asset is inaccessible');
for (const path of ['/api/metrics.php', '/api/v1/metrics.php', '/config/config.php', '/sql/schema.sql', '/deploy/stack.sh']) {
  assert.equal((await request(path)).response.status, 403, `Operational endpoint exposed: ${path}`);
}
console.log(`Public HTTPS, readiness, built assets and access restrictions verified: ${origin.origin}`);
