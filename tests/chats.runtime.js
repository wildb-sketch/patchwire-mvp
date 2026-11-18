const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('../cloudflare/node_modules/esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('../cloudflare/node_modules/miniflare');
const scenario = require('./helpers/chat-scenario.cjs');
test('actual Worker chunks private files and restores chat preferences, favorites and attachment bytes atomically', { timeout: 90000 }, async () => {
  const bundle = await build({ entryPoints: [path.join(__dirname, '../cloudflare/src/worker.js')], bundle: true, write: false, format: 'esm', external: ['cloudflare:workers'] });
  const operator = 'a'.repeat(64);
  const options = { workers: [{ name: 'app', compatibilityDate: '2025-06-01', modules: true, script: bundle.outputFiles[0].text, durableObjects: { HUB: { className: 'Hub', useSQLite: true } }, r2Buckets: ['BACKUPS'], bindings: { OPS_TOKEN: operator } }] };
  const runtime = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  try {
    const fixture = await scenario((...args) => runtime.dispatchFetch(...args), 'https://fixture.test');
    const ops = body => runtime.dispatchFetch('https://fixture.test/internal/ops/' + (body.id ? 'restore' : 'backup'), { method: 'POST', headers: { Authorization: 'Bearer ' + operator, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const snapshotResponse = await ops({}); assert.equal(snapshotResponse.status, 200); const snapshot = await snapshotResponse.json();
    await fixture.api('/chats/' + fixture.a.me.id, fixture.b, { action: 'delete' });
    const result = await ops({ id: snapshot.id, dryRun: false, confirmation: 'RESTORE ' + snapshot.id }); assert.equal(result.status, 200);
    const account = await (await fixture.api('/login', null, { email: 'receiver@example.invalid', password: 'fixture-password' })).json();
    const state = await (await fixture.api('/chats', account)).json(); assert(state.chats[fixture.a.me.id].pinned); assert(state.marks[fixture.nextMessage.id].favorite);
    const old = await fixture.api('/files/' + fixture.message.id, account); assert.equal(old.status, 404);
    const sender = await (await fixture.api('/login', null, { email: 'sender@example.invalid', password: 'fixture-password' })).json();
    const download = await fixture.api('/files/' + fixture.message.id, sender); assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), fixture.bytes);
    const next = await fixture.api('/files/' + fixture.nextMessage.id, account); assert.equal(next.status, 200); assert.equal(await next.text(), 'A fresh incoming file');
    assert.equal((await fixture.api('/me', fixture.a)).status, 401);
  } finally { await runtime.dispose(); }
});
