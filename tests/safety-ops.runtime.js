const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('../cloudflare/node_modules/esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('../cloudflare/node_modules/miniflare');
test('actual Worker SQLite/R2 recovery preserves media and safety state, revokes credentials, and keeps account flows usable', { timeout: 90000 }, async () => {
 const bundle = await build({ entryPoints: [path.join(__dirname, '../cloudflare/src/worker.js')], bundle: true, write: false, format: 'esm', external: ['cloudflare:workers'] });
 const operator = 'a'.repeat(64);
 const options = { workers: [
  { name: 'app', compatibilityDate: '2025-06-01', modules: true, script: bundle.outputFiles[0].text, outboundService: 'provider', durableObjects: { HUB: { className: 'Hub', useSQLite: true } }, r2Buckets: ['BACKUPS'], bindings: { OPS_TOKEN: operator, RESEND_API_KEY: 'fixture', MAIL_FROM: 'test@example.invalid', PUBLIC_ORIGIN: 'https://fixture.test' } },
  { name: 'provider', compatibilityDate: '2025-06-01', modules: true, script: `const mail=[];export default{async fetch(request){if(new URL(request.url).pathname==='/mail')return Response.json(mail);if(new URL(request.url).hostname!=='api.resend.com')return new Response(null,{status:400});mail.push(await request.json());return Response.json({id:'fixture'});}};` },
 ] };
 const runtime = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options), sockets = [];
 try {
  const api = (route, account, body, method) => runtime.dispatchFetch('https://fixture.test/api' + route, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(account ? { Authorization: 'Bearer ' + account.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ops = (route, body, auth = operator) => runtime.dispatchFetch('https://fixture.test/internal/ops/' + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth }, body: body ? JSON.stringify(body) : undefined });
  const wait = async predicate => { const until = Date.now() + 10000; while (Date.now() < until) { const result = await predicate(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error('Worker fixture did not reach expected state'); };
  await wait(async () => (await runtime.dispatchFetch('https://fixture.test/healthz')).headers.get('X-Backup') === 'healthy');
  const signup = async nick => { const result = await api('/signup', null, { nick, email: nick + '@example.invalid', password: 'fixture-password' }); assert.equal(result.status, 200); return result.json(); };
  const host = await signup('host'), guest = await signup('guest'), outsider = await signup('outsider');
  const connect = async account => {
   const response = await runtime.dispatchFetch('https://fixture.test/ws?token=' + account.token, { headers: { Upgrade: 'websocket' } }); assert.equal(response.status, 101);
   const socket = response.webSocket, events = []; sockets.push(socket); socket.addEventListener('message', event => events.push(JSON.parse(event.data))); socket.accept();
   await wait(() => events.some(event => event.type === 'rooms'));
   return { socket, events, wait: predicate => wait(() => events.find(predicate)) };
  };
  const h = await connect(host), g = await connect(guest), o = await connect(outsider);
  h.socket.send(JSON.stringify({ type: 'room:create', title: 'Private fixture', audience: 'followers' }));
  const room = (await h.wait(event => event.type === 'room:joined')).room;
  assert(!o.events.flatMap(event => event.type === 'rooms' ? event.rooms : []).some(r => r.id === room.id));
  await api('/friends/request', host, { id: guest.me.id }); await api('/friends/respond', guest, { id: host.me.id, accept: true });
  await g.wait(event => event.type === 'rooms' && event.rooms.some(r => r.id === room.id));
  g.socket.send(JSON.stringify({ type: 'room:join', id: room.id })); await g.wait(event => event.type === 'room:joined');
  await api('/block', host, { id: guest.me.id }); await g.wait(event => event.type === 'room:removed');
  g.socket.send(JSON.stringify({ type: 'room:join', id: room.id })); await g.wait(event => event.type === 'room:error');
  assert.equal((await api('/friends/request', guest, { id: host.me.id })).status, 404);
  assert.equal((await api('/report', guest, { id: host.me.id, reason: 'spam', details: 'Fixture report' })).status, 200);
  assert.equal((await ops('reports', null, 'wrong')).status, 401);
  assert.equal((await (await ops('reports')).json())[0].reason, 'spam');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32)]).toString('base64');
  assert.equal((await api('/me/photo', host, { data: 'data:image/png;base64,' + png }, 'PUT')).status, 200);
  const voiceResponse = await api('/voice', host, { to: outsider.me.id, data: 'data:audio/webm;base64,' + Buffer.alloc(256, 7).toString('base64'), dur: 1 }); assert.equal(voiceResponse.status, 200);
  const voice = (await voiceResponse.json()).m;
  await api('/account/request-reset', null, { email: 'guest@example.invalid' });
  const provider = await runtime.getWorker('provider');
  const firstMail = await (await provider.fetch('https://provider.test/mail')).json();
  const oldReset = new URL(firstMail[0].text.match(/http\S+/)[0]).hash.split('=')[1];
  const snapshotResponse = await ops('backup', {}); assert.equal(snapshotResponse.status, 200); const snapshot = await snapshotResponse.json();
  const bucket = await runtime.getR2Bucket('BACKUPS');
  const metadata = await (await bucket.get('snapshots/' + snapshot.id + '/data.json')).json();
  assert(metadata.records.every(row => !['session', 'push', 'accountToken', 'rate', 'ops'].includes(row.kind)));
  await api('/me', host, { nick: 'changed' }, 'PUT');
  assert.equal((await ops('restore', { id: snapshot.id })).status, 200);
  assert.equal((await (await api('/me', host)).json()).nick, 'changed');
  assert.equal((await ops('restore', { id: snapshot.id, dryRun: false })).status, 400);
  assert.equal((await ops('restore', { id: snapshot.id, dryRun: false, confirmation: 'RESTORE ' + snapshot.id })).status, 200);
  assert.equal((await api('/me', host)).status, 401);
  assert.equal((await api('/account/reset', null, { token: oldReset, password: 'should-not-work' })).status, 400);
  const restoredHost = await (await api('/login', null, { email: 'host@example.invalid', password: 'fixture-password' })).json();
  assert.equal(restoredHost.me.nick, 'host'); assert(restoredHost.token);
  const audio = await api('/voice/' + voice.id, restoredHost); assert.equal(audio.status, 200); assert.deepEqual(Buffer.from(await audio.arrayBuffer()), Buffer.alloc(256, 7));
  assert.equal((await runtime.dispatchFetch('https://fixture.test/photo/' + host.me.id)).status, 200);
  assert.equal((await api('/friends/request', outsider, { id: host.me.id })).status, 401);
  const restoredGuest = await (await api('/login', null, { email: 'guest@example.invalid', password: 'fixture-password' })).json();
  assert(!(await (await api('/users', restoredGuest)).json()).some(user => user.id === host.me.id));
  await api('/account/request-reset', null, { email: 'guest@example.invalid' });
  const nextMail = await (await provider.fetch('https://provider.test/mail')).json(); const nextReset = new URL(nextMail.at(-1).text.match(/http\S+/)[0]).hash.split('=')[1];
  assert.equal((await api('/account/reset', null, { token: nextReset, password: 'restored-account-password' })).status, 200);
  assert.equal((await api('/me', restoredGuest)).status, 401);
  await bucket.put('snapshots/' + snapshot.id + '/voice/' + voice.id, Buffer.alloc(256, 9));
  assert.equal((await ops('restore', { id: snapshot.id })).status, 400);
  assert.equal((await api('/me', restoredHost)).status, 200);
 } finally { for (const socket of sockets) { try { socket.close(); } catch {} } await runtime.dispose(); }
});
