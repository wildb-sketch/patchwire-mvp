const { test } = require('node:test');
const assert = require('node:assert/strict');
const createNavigation = require('../public/app-navigation');
const createPushClient = require('../public/push-client');
const { roomRedirect, assetLinks } = require('../lib/links');
function fixture() {
 const stored = new Map(), navigated = [], consumed = [];
 let ready = false, uid = null, wrong = 0;
 const options = { origin: 'https://example.test', storage: { getItem: k => stored.get(k), setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) },
  ready: () => ready, uid: () => uid, navigate: item => navigated.push(item), consumeNative: id => consumed.push(id), wrongAccount: () => wrong++ };
 return { options, navigated, consumed, setReady: value => { ready = value; }, setUid: value => { uid = value; }, get wrong() { return wrong; } };
}
test('room destinations survive login and page restart and dispatch only once when ready', () => {
 const f = fixture(); let nav = createNavigation(f.options);
 assert(nav.capture('https://example.test/neon#room=abcdef12')); assert.equal(f.navigated.length, 0);
 nav = createNavigation(f.options); f.setUid('a'.repeat(12)); f.setReady(true); nav.flush(); nav.flush();
 assert.equal(f.navigated.length, 1); assert.equal(f.navigated[0].target, 'abcdef12');
});
test('native callbacks and cold-start reads cannot deliver the same action twice', () => {
 const f = fixture(); f.setUid('a'.repeat(12)); f.setReady(true);
 const action = { id: 'native-1', kind: 'room', target: 'abcdef12' };
 let nav = createNavigation(f.options); nav.enqueue(action, true); nav.enqueue(action, true);
 nav = createNavigation(f.options); nav.enqueue(action, true);
 assert.equal(f.navigated.length, 1); assert(f.consumed.includes('native-1'));
});
test('stale callbacks and notifications for another account cannot override current navigation', () => {
 const f = fixture(), nav = createNavigation(f.options), now = Date.now();
 nav.enqueue({ id: 'new', kind: 'room', target: 'abcdef12', time: now }, true);
 assert.equal(nav.enqueue({ id: 'old', kind: 'room', target: '12345678', time: now - 5000 }, true), false);
 f.setUid('a'.repeat(12)); f.setReady(true); nav.flush(); assert.equal(f.navigated[0].target, 'abcdef12');
 nav.enqueue({ id: 'other-account', kind: 'chat', target: 'b'.repeat(12), recipient: 'c'.repeat(12) }, true);
 assert.equal(f.navigated.length, 1); assert.equal(f.wrong, 1);
});
test('canonical and legacy links accept only safe same-origin destinations', () => {
 const f = fixture(), nav = createNavigation(f.options);
 for (const path of ['/room/abcdef12', '/#room=abcdef12', '/neon#room=abcdef12']) assert(nav.capture('https://example.test' + path));
 for (const url of ['https://evil.test/room/abcdef12', 'javascript:alert(1)', 'https://other@example.test/room/abcdef12', 'https://example.test/room/../../evil', 'https://example.test/#room=oops']) assert(!nav.capture(url));
 assert.equal(roomRedirect('/room/abcdef12'), '/neon#room=abcdef12'); assert.equal(roomRedirect('/room/evil'), null);
 assert.deepEqual(assetLinks('placeholder'), []); assert.equal(assetLinks('ab'.repeat(32))[0].target.sha256_cert_fingerprints[0], Array(32).fill('AB').join(':'));
});
test('denied push permissions and old APKs cannot block the app or register a device', async () => {
 let registrations = 0, clears = 0;
 const client = createPushClient({ available: () => true, uid: () => 'a'.repeat(12), origin: 'https://example.test', prepare: async () => ({ enabled: false }),
  native: async method => { if (method === 'clear') clears++; }, api: async () => { registrations++; } });
 await client.start(); assert.equal(registrations, 0); assert.equal(clears, 1);
 const old = createPushClient({ available: () => true, uid: () => 'a'.repeat(12), prepare: async () => { throw Error('Plugin not available'); } });
 await old.start();
});
test('logout during registration revokes the late capability without binding a new native account', async () => {
 let resolve, configured = 0, removed = 0;
 const client = createPushClient({ available: () => true, uid: () => 'a'.repeat(12), origin: 'https://example.test', prepare: async () => ({ enabled: true }),
  native: async method => { if (method === 'configure') configured++; return { enabled: true, deviceId: 'd', token: 'token' }; },
  api: async path => { if (path === '/push/refresh') { removed++; return {}; } return new Promise(done => { resolve = done; }); } });
 const pending = client.start(); while (!resolve) await new Promise(done => setImmediate(done));
 await client.stop(); resolve({ deviceId: 'd', deviceKey: 'key', binding: 'binding' }); await pending;
 assert.equal(configured, 0); assert.equal(removed, 1);
});
