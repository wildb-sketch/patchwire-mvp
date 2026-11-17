const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('../cloudflare/node_modules/esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('../cloudflare/node_modules/miniflare');

test('deployed Worker routes persist device leases and dispatch authenticated room invitations through waitUntil', { timeout: 60000 }, async () => {
 const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
 const pem = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----';
 const bundle = await build({ entryPoints: [path.join(__dirname, '../cloudflare/src/worker.js')], bundle: true, write: false, format: 'esm', external: ['cloudflare:workers'] });
 const options = { workers: [
  { name: 'app', compatibilityDate: '2025-06-01', modules: true, script: bundle.outputFiles[0].text, outboundService: 'provider',
   durableObjects: { HUB: { className: 'Hub', useSQLite: true } },
   bindings: { FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'fixture-project', client_email: 'fixture@example.invalid', private_key: pem }), ANDROID_APP_LINK_SHA256: 'A1'.repeat(32) } },
  { name: 'provider', compatibilityDate: '2025-06-01', modules: true, script: `const messages=[];export default{async fetch(request){
   if(new URL(request.url).pathname==='/events')return Response.json(messages);
   if(new URL(request.url).hostname==='oauth2.googleapis.com')return Response.json({access_token:'fixture',expires_in:3600});
   messages.push((await request.json()).message);return Response.json({name:'fixture-message'});
  }};` },
 ] };
 const runtime = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
 const sockets = [];
 try {
  const api = (route, account, body) => runtime.dispatchFetch('https://fixture.test/api' + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(account ? { Authorization: 'Bearer ' + account.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const signup = async nick => { const response = await api('/signup', null, { email: nick + '@example.invalid', nick, password: 'fixture-password' }); assert.equal(response.status, 200); return response.json(); };
  const host = await signup('host'), guest = await signup('guest');
  const registrationResponse = await api('/push/register', guest, { deviceId: 'a'.repeat(32), token: 'fixture-token-'.repeat(4) });
  assert.equal(registrationResponse.status, 200); const registration = await registrationResponse.json();
  const socketResponse = await runtime.dispatchFetch('https://fixture.test/ws?token=' + host.token, { headers: { Upgrade: 'websocket' } });
  assert.equal(socketResponse.status, 101);
  const ws = socketResponse.webSocket, received = []; sockets.push(ws);
  ws.addEventListener('message', event => received.push(JSON.parse(event.data))); ws.accept();
  ws.send(JSON.stringify({ type: 'room:create', title: 'Invite fixture', audience: 'everyone' }));
  const wait = async check => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Worker event timed out'); };
  const room = (await wait(() => received.find(message => message.type === 'room:joined'))).room;
  assert.equal((await api('/rooms/' + room.id + '/invite', host, { to: guest.me.id })).status, 403);
  assert.equal((await api('/friends/request', host, { id: guest.me.id })).status, 200);
  assert.equal((await api('/friends/respond', guest, { id: host.me.id, accept: true })).status, 200);
  assert.equal((await api('/rooms/' + room.id + '/invite', host, { to: guest.me.id })).status, 200);
  const provider = await runtime.getWorker('provider');
  const delivered = await wait(async () => { const events = await (await provider.fetch('https://provider.test/events')).json(); return events[0]; });
  assert.equal(delivered.data.kind, 'room'); assert.equal(delivered.data.target, room.id);
  assert.equal(delivered.data.recipient, guest.me.id); assert.equal(delivered.data.binding, registration.binding);
  assert.equal(delivered.notification, undefined);
  assert.equal(delivered.android.collapse_key, undefined);
  // Reuse the same Hub, FCM sender and authenticated socket across separate message events.
  for (let i = 1; i <= 3; i++) ws.send(JSON.stringify({ type: 'msg', to: guest.me.id, t: 'Message ' + i }));
  const sequence = await wait(async () => {
   const events = await (await provider.fetch('https://provider.test/events')).json();
   return events.length === 4 && events;
  });
  assert.equal(new Set(sequence.map(event => event.data.eventId)).size, 4);
  for (const event of sequence.slice(1)) {
   assert.equal(event.data.kind, 'message'); assert.equal(event.data.target, host.me.id);
   assert.equal(event.data.recipient, guest.me.id); assert.equal(event.data.binding, registration.binding);
   assert.equal(event.android.collapse_key, undefined);
  }
  assert.equal((await api('/messages', guest)).status, 200);
  const association = await (await runtime.dispatchFetch('https://fixture.test/.well-known/assetlinks.json')).json();
  assert.equal(association[0].target.package_name, 'com.patchwire.app');
  const redirect = await runtime.dispatchFetch('https://fixture.test/room/' + room.id, { redirect: 'manual' });
  assert.equal(redirect.headers.get('Location'), '/neon#room=' + room.id);
  assert.equal((await runtime.dispatchFetch('https://fixture.test/healthz')).headers.get('X-Push'), 'configured');
  assert.equal((await api('/logout', guest, {})).status, 200);
  assert.equal((await api('/push/refresh', null, { ...registration, token: 'new-fixture-token-'.repeat(3) })).status, 404);
 } finally { sockets.forEach(ws => ws.close()); await runtime.dispose(); }
});
