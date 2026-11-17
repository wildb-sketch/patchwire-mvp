const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createBackups } = require('../lib/backups');
const { fileBucket, nodeSource, restoreOffline } = require('../lib/node-backups');
const { createMonitor, operatorAuthorized } = require('../lib/operations');
const { prepare } = require('../cloudflare/scripts/prepare-deployment.cjs');
test('private snapshots recover account data and media without reviving sessions, devices or reset tokens', async t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whassabi-backup-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 const voice = path.join(root, 'voice'); fs.mkdirSync(voice);
 const uid = 'a'.repeat(12), other = 'b'.repeat(12), message = 'c'.repeat(12);
 const image = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32)]).toString('base64');
 const data = { users: { [uid]: { id: uid, email: 'one@example.invalid', salt: 'a'.repeat(32), pw: 'b'.repeat(64), photo: { type: 'image/png', data: image, v: 1 } }, [other]: { id: other, email: 'two@example.invalid', salt: 'c'.repeat(32), pw: 'd'.repeat(64) } },
  msgs: [{ id: message, from: uid, to: other, kind: 'voice', mime: 'audio/webm', dur: 1, ts: 1 }], friends: [], follows: [], feed: [], reports: [], blocks: [], sessions: { private: uid }, pushDevices: { private: 'token' }, accountTokens: { private: 'reset' } };
 fs.writeFileSync(path.join(voice, message + '.bin'), Buffer.alloc(256, 7));
 const directory = path.join(root, 'backups'), bucket = fileBucket(directory), backups = createBackups({ bucket, source: nodeSource(data, voice) });
 const snapshot = await backups.run(); assert.equal(backups.health(), 'healthy');
 const metadata = await (await bucket.get('snapshots/' + snapshot.id + '/data.json')).json();
 assert(metadata.records.every(row => !['session', 'push', 'accountToken', 'rate'].includes(row.kind)));
 assert(!JSON.stringify(metadata).includes(image));
 const output = path.join(root, 'recovered'); await restoreOffline(directory, snapshot.id, output);
 const restored = JSON.parse(fs.readFileSync(path.join(output, 'data.json')));
 assert.equal(restored.users[uid].photo.data, image); assert.deepEqual(restored.msgs, data.msgs);
 assert.deepEqual(restored.sessions, {}); assert.deepEqual(restored.pushDevices, {}); assert.deepEqual(restored.accountTokens, {});
 assert.deepEqual(fs.readFileSync(path.join(output, 'voice', message + '.bin')), Buffer.alloc(256, 7));
 await assert.rejects(restoreOffline(directory, snapshot.id, output), /new or empty/);
 const media = 'snapshots/' + snapshot.id + '/voice/' + message; await bucket.put(media, Buffer.alloc(256, 9));
 await assert.rejects(backups.inspect(snapshot.id), /integrity/);
 await assert.rejects(backups.restore(snapshot.id, 'wrong'), { status: 400 });
});
test('an incomplete snapshot is never listed, and failed retention never deletes the newly committed backup', async t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whassabi-backup-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 const bucket = fileBucket(root), source = { freeze: () => ({ records: [], async *media() {}, release() {} }) };
 const put = bucket.put.bind(bucket); bucket.put = async (key, value) => { if (key.endsWith('manifest.json')) throw Error('fixture failure'); return put(key, value); };
 const broken = createBackups({ bucket, source }); await assert.rejects(broken.run(), { status: 503 }); assert.deepEqual(await broken.list(), []);
 bucket.put = put; const list = bucket.list.bind(bucket); let calls = 0;
 bucket.list = async options => { if (options.delimiter && ++calls === 1) throw Error('retention unavailable'); return list(options); };
 const healthy = createBackups({ bucket, source }); const snapshot = await healthy.run();
 assert(await bucket.get('snapshots/' + snapshot.id + '/manifest.json')); assert.equal(healthy.status.state, 'ok'); assert(healthy.status.retentionFailure);
});
test('monitoring never serializes supplied request or credential fields and operator access requires its own strong token', () => {
 const events = [], monitor = createMonitor({ log: event => events.push(event), now: () => 100 });
 monitor.record('push', 401); assert.deepEqual(events, [{ event: 'whassabi_operation', category: 'push', status: 401 }]);
 assert.equal(monitor.state.lastFailure.category, 'push');
 const request = value => new Request('https://fixture.invalid/internal/ops/status', { headers: { Authorization: 'Bearer ' + value } });
 assert.equal(operatorAuthorized(request('x'), { OPS_TOKEN: 'x' }), false);
 assert.equal(operatorAuthorized(request('a'.repeat(64)), { OPS_TOKEN: 'a'.repeat(64) }), true);
 assert.equal(operatorAuthorized(request('b'.repeat(64)), { OPS_TOKEN: 'a'.repeat(64) }), false);
});
test('deployment binds backups only after verifying private access and never silently drops an existing binding', async () => {
 const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'fixture-private-token' };
 const create = (bound, denied = false, publicDomain = false) => async (url, init) => {
  assert.equal(init.redirect, 'manual'); assert.equal(init.headers.Authorization, 'Bearer fixture-private-token');
  if (url.endsWith('/settings')) return Response.json({ success: true, result: { bindings: bound ? [{ name: 'BACKUPS', type: 'r2_bucket' }] : [] } });
  if (denied) return Response.json({ success: false }, { status: 403 });
  if (url.endsWith('/domains/managed')) { assert.equal(JSON.parse(init.body).enabled, false); return Response.json({ result: { enabled: false } }); }
  if (url.endsWith('/domains/custom')) return Response.json({ result: { domains: publicDomain ? [{ enabled: true }] : [] } });
  return Response.json({ result: { name: 'patchwire-private-backups' } });
 };
 const result = await prepare({ env, fetch: create(false), write: false, config: 'name="fixture"\n' }); assert(result.available); assert(result.config.includes('binding = "BACKUPS"'));
 const warnings = []; const missing = await prepare({ env, fetch: create(false, true), warn: value => warnings.push(value), write: false, config: '' });
 assert(!missing.available); assert(!missing.config.includes('BACKUPS')); assert.equal(warnings.length, 1);
 await assert.rejects(prepare({ env, fetch: create(true, true), write: false }), /preserve/);
 await assert.rejects(prepare({ env, fetch: create(false, false, true), write: false }), /public custom domains/);
});
