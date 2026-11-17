const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['index.html', 'neon.html']) {
 test(`${file}: ICE refresh coalesces, expires, and retries a failed fetch`, async () => {
  let time = 1000, calls = 0, fail = false;
  const html = fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
  const context = vm.createContext({ ICE: [], S: { tok: 'test-session' }, AbortController,
   Date: { now: () => time }, setTimeout: () => 1, clearTimeout() {},
   fetch: async (url, options) => {
    calls++; assert.equal(url, '/api/ice'); assert.equal(options.headers.Authorization, 'Bearer test-session');
    return fail ? { ok: false } : { ok: true, json: async () => [{ urls: 'turn:example.test', username: 'temporary-' + calls, credential: 'test-password' }] };
   } });
  vm.runInContext(html.slice(html.indexOf('let iceRequest='), html.indexOf('let networkTimer=')), context);
  const [a, b] = await Promise.all([context.loadIce(), context.loadIce()]);
  assert.equal(calls, 1); assert.equal(a, b);
  await context.loadIce(); assert.equal(calls, 1);
  time += 60000; fail = true;
  assert.equal((await context.loadIce())[0].username, 'temporary-1');
  assert.equal(calls, 2); fail = false;
  assert.equal((await context.loadIce())[0].username, 'temporary-3'); assert.equal(calls, 3);
 });
}
