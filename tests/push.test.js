const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFcm, createPushRegistry } = require('../lib/push');
const uid = 'a'.repeat(12), other = 'b'.repeat(12), id = 'c'.repeat(32), secondId = 'd'.repeat(32);
const token = 'fixture-fcm-token-' + 'a'.repeat(32), newerToken = token + 'b';
function registry(sender = { send: async () => ({ status: 'sent' }) }) {
 const devices = {}, sessions = { first: uid, second: uid, other }, writes = [];
 const r = createPushRegistry({ devices, sender, sessionOwner: s => sessions[s], put: d => writes.push(d), remove() {} });
 return { r, devices, sessions, writes };
}
test('device registration requires proof to replace an existing installation and remains private', () => {
 const { r, devices } = registry();
 const first = r.register(uid, 'first', { deviceId: id, token });
 assert(!JSON.stringify(first).includes(token)); assert(!JSON.stringify(first).includes('first'));
 assert.throws(() => r.register(other, 'other', { deviceId: id, token }), /STALE_DEVICE/);
 const repeat = r.register(uid, 'first', { deviceId: id, token, deviceKey: first.deviceKey });
 assert.deepEqual(repeat, first);
 const next = r.register(uid, 'second', { deviceId: id, token, deviceKey: first.deviceKey });
 assert.notEqual(next.binding, first.binding); assert.notEqual(next.deviceKey, first.deviceKey);
 assert.equal(r.refresh({ deviceId: id, deviceKey: first.deviceKey, token: newerToken }), false);
 r.logout('first'); assert.equal(devices[id].session, 'second');
 r.logout('second'); assert.equal(devices[id], undefined);
});
test('account switching on the same FCM token prevents notifications to the old account', async () => {
 const sent = [], { r, devices } = registry({ send: async (d, e) => { sent.push({ d, e }); return { status: 'sent' }; } });
 r.register(uid, 'first', { deviceId: id, token });
 const next = r.register(other, 'other', { deviceId: secondId, token });
 assert.equal(devices[id], undefined);
 await r.notify(uid, { kind: 'message', target: other, id: '1'.repeat(12) }); assert.equal(sent.length, 0);
 await r.notify(other, { kind: 'room', target: '1'.repeat(8), id: '2'.repeat(12) });
 assert.equal(sent[0].d.binding, next.binding); assert.equal(sent[0].d.uid, other);
});
test('background refresh is scoped to its device and logout revokes the capability', () => {
 const { r, sessions, devices } = registry();
 const first = r.register(uid, 'first', { deviceId: id, token });
 assert.equal(r.refresh({ ...first, token: newerToken }), true); assert.equal(devices[id].token, newerToken);
 assert.equal(r.refresh({ ...first, deviceId: secondId, token }), false);
 delete sessions.first;
 assert.equal(r.refresh({ ...first, token }), false);
});
test('a late UNREGISTERED response cannot delete refreshed or rebound registrations', async () => {
 let finish;
 const { r, devices } = registry({ send: () => new Promise(resolve => { finish = resolve; }) });
 const first = r.register(uid, 'first', { deviceId: id, token });
 const pending = r.notify(uid, { kind: 'message', target: other, id: '1'.repeat(12) });
 r.refresh({ ...first, token: newerToken }); finish({ status: 'unregistered' }); await pending;
 assert.equal(devices[id].token, newerToken);
});
test('revoked sessions are never notified and device counts are bounded per account', async () => {
 let sends = 0;
 const { r, sessions, devices } = registry({ send: async () => { sends++; return { status: 'sent' }; } });
 for (let i = 0; i < 7; i++) r.register(uid, 'first', { deviceId: i.toString(16).padStart(32, '0'), token: token + i });
 assert.equal(Object.keys(devices).length, 5);
 delete sessions.first; await r.notify(uid, {}); assert.equal(sends, 0);
});

async function credentials() {
 const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
 const encoded = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
 return { pair, env: { FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'fixture-project', client_email: 'push@fixture-project.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\n' + encoded + '\n-----END PRIVATE KEY-----' }) } };
}
test('FCM signs valid server-only OAuth JWTs and sends generic account-bound data messages', async () => {
 const { pair, env } = await credentials(); let auth = 0, sends = 0;
 const fcm = createFcm(env, { fetch: async (url, options) => {
  assert.equal(options.redirect, 'manual');
  if (url === 'https://oauth2.googleapis.com/token') {
   auth++;
   const assertion = new URLSearchParams(options.body).get('assertion'), parts = assertion.split('.');
   assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, Buffer.from(parts[2], 'base64url'), new TextEncoder().encode(parts[0] + '.' + parts[1])));
   const claim = JSON.parse(Buffer.from(parts[1], 'base64url'));
   assert.equal(claim.scope, 'https://www.googleapis.com/auth/firebase.messaging');
   assert.equal(claim.aud, url); assert.equal(claim.exp - claim.iat, 3600);
   return Response.json({ access_token: 'fixture-oauth-token', expires_in: 3600 });
  }
  assert.equal(url, 'https://fcm.googleapis.com/v1/projects/fixture-project/messages:send');
  assert.equal(options.headers.Authorization, 'Bearer fixture-oauth-token'); sends++;
  const { message } = JSON.parse(options.body);
  assert.equal(message.token, token); assert.equal(message.notification, undefined);
  assert.deepEqual(message.data, { kind: 'message', target: other, eventId: '1'.repeat(12), recipient: uid, binding: 'fixture-binding' });
  assert.equal(message.android.priority, 'HIGH');
  assert.equal(message.android.collapse_key, undefined);
  return Response.json({ name: 'projects/fixture/messages/1' });
 } });
 const device = { uid, token, binding: 'fixture-binding' }, event = { kind: 'message', target: other, id: '1'.repeat(12) };
 const results = await Promise.all([fcm.send(device, event), fcm.send(device, event)]);
 assert(results.every(r => r.status === 'sent')); assert.equal(auth, 1); assert.equal(sends, 2);
});
test('each distinct message is sent and an expired cached Google token is refreshed without dropping it', async () => {
 const { env } = await credentials(); let auth = 0;
 const accepted = [], failures = [];
 const sender = createFcm(env, { onFailure: result => failures.push(result), fetch: async (url, options) => {
  if (url.includes('oauth2')) return Response.json({ access_token: 'access-' + ++auth, expires_in: 3600 });
  const { message } = JSON.parse(options.body);
  if (message.data.eventId === '2'.repeat(12) && options.headers.Authorization === 'Bearer access-1') return new Response(null, { status: 401 });
  assert.equal(message.android.collapse_key, undefined);
  accepted.push(message.data.eventId); return Response.json({ name: 'accepted' });
 } });
 for (let i = 1; i <= 3; i++) assert.equal((await sender.send({ uid, token, binding: 'fixture-binding' }, { kind: 'message', target: other, id: String(i).repeat(12) })).status, 'sent');
 assert.equal(auth, 2); assert.deepEqual(accepted, ['1'.repeat(12), '2'.repeat(12), '3'.repeat(12)]); assert.deepEqual(failures, []);
});
test('a repeatedly rejected Google token stops after one refresh and reports only sanitized status', async () => {
 const { env } = await credentials(); let requests = 0; const failures = [];
 const sender = createFcm(env, { onFailure: result => failures.push(result), fetch: async url => {
  if (url.includes('oauth2')) return Response.json({ access_token: 'private-access-token', expires_in: 3600 });
  requests++; return new Response('private-provider-diagnostics', { status: 401 });
 } });
 assert.deepEqual(await sender.send({ uid, token, binding: 'binding' }, { kind: 'message', target: other, id: '1'.repeat(12) }), { status: 'failed', code: 401 });
 assert.equal(requests, 2); assert.deepEqual(failures, [{ status: 'failed', stage: 'fcm', code: 401 }]);
});
test('FCM errors do not expose credentials and only explicit UNREGISTERED marks a stale token', async () => {
 const { env } = await credentials();
 const fcm = createFcm(env, { fetch: async url => url.includes('oauth2') ? Response.json({ access_token: 'secret', expires_in: 3600 }) :
  Response.json({ error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } }, { status: 404 }) });
 assert.equal((await fcm.send({ uid, token, binding: 'binding' }, { kind: 'room', target: '1'.repeat(8), id: '2'.repeat(12) })).status, 'unregistered');
 const broken = createFcm(env, { fetch: async () => { throw Error(env.FCM_SERVICE_ACCOUNT); } });
 assert.deepEqual(await broken.send({}, {}), { status: 'failed' });
 assert.deepEqual(await createFcm({}).send({}, {}), { status: 'disabled' });
});
