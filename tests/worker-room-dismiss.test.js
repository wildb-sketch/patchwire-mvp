const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const turn = require('../lib/turn');
function fixture(env = {}, turnOptions = {}) {
 const source = fs.readFileSync(path.join(__dirname, '../cloudflare/src/worker.js'), 'utf8')
  .replace("import { DurableObject } from 'cloudflare:workers';", '')
  .replace("import turn from '../../lib/turn.js';", '')
  .replace('export default {', 'const worker = {').replace('export class Hub', 'class Hub');
 const context = vm.createContext({ turn, DurableObject: class {}, TextEncoder, Response, Request, URL, crypto: require('node:crypto').webcrypto, clearTimeout });
 vm.runInContext(source + '\nglobalThis.Hub=Hub;', context);
 const hub = Object.create(context.Hub.prototype), messages = [];
 Object.assign(hub, { env, turn: turn.createTurnService(env, turnOptions), hits: new Map(), D: { users: { u: { id: 'u', nick: 'Guest' }, h: { id: 'h', nick: 'Host' } }, sessions: { auth: 'u' } },
  grace: new Map(), roomOf: new Map([['u','r'], ['h','r']]), rooms: new Map(),
  online: new Map([['u', new Set([{ send: value => messages.push(JSON.parse(value)) }])]]) });
 const room = { id: 'r', title: 'Test', host: 'h', members: new Map([['u', { role: 'listener', leaveToken: 'private-lease' }], ['h', { role: 'speaker' }]]) };
 hub.rooms.set('r', room);
 const leave = async (auth, roomId, leaveToken) => {
  const request = new Request('https://example.test/api/room/leave', { method: 'POST', headers: { Authorization: 'Bearer '+auth }, body: JSON.stringify({ roomId, leaveToken }) });
  return hub.api(request, new URL(request.url));
 };
 return { hub, room, messages, leave };
}
test('Worker dismissal requires authentication and the private current room lease', async () => {
 const f = fixture();
 assert.equal((await f.leave('bad', 'r', 'private-lease')).status, 401);
 for (const [id, lease] of [['r','old-lease'], ['old-room','private-lease'], ['r',''], ['r',null]]) {
  assert.equal((await f.leave('auth', id, lease)).status, 200); assert(f.room.members.has('u'));
 }
 assert(!JSON.stringify(f.hub.view(f.room)).includes('private-lease'));
});
test('Worker dismissal removes membership immediately and repeated requests are harmless', async () => {
 const f = fixture();
 assert.equal((await f.leave('auth', 'r', 'private-lease')).status, 200);
 assert(!f.room.members.has('u')); assert(!f.hub.roomOf.has('u'));
 assert(f.messages.some(d => d.type === 'room:left' && d.id === 'r'));
 assert.equal((await f.leave('auth', 'r', 'private-lease')).status, 200);
 assert.equal(f.hub.rooms.get('r').host, 'h');
});

test('Worker TURN endpoint authenticates, hides the master token, and forbids response caching', async () => {
 let calls = 0;
 const f = fixture({ TURN_KEY_ID: 'test-key', TURN_KEY_API_TOKEN: 'master-secret' }, { fetch: async () => {
  calls++;
  return Response.json({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'temporary-user', credential: 'temporary-password' }] });
 } });
 const request = token => f.hub.fetch(new Request('https://example.test/api/ice', { headers: { Authorization: 'Bearer ' + token } }));
 assert.equal((await request('bad')).status, 401); assert.equal(calls, 0);
 const response = await request('auth');
 assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
 const body = await response.text(); assert(body.includes('temporary-password')); assert(!body.includes('master-secret'));
 const health = await f.hub.fetch(new Request('https://example.test/healthz'));
 assert.equal(health.headers.get('X-Voice-Relay'), 'configured');
 assert.equal(health.headers.get('X-Voice-Relay-Provider'), 'cloudflare');
 for (let i = 0; i < 29; i++) assert.equal((await request('auth')).status, 200);
 const limited = await request('auth'); assert.equal(limited.status, 429); assert.equal(limited.headers.get('Cache-Control'), 'no-store');
 assert.equal(calls, 1);
});

test('Worker TURN upstream failure returns a sanitized retryable error', async () => {
 const f = fixture({ TURN_KEY_ID: 'test-key', TURN_KEY_API_TOKEN: 'master-secret' }, { fetch: async () => { throw Error('master-secret upstream details'); } });
 const response = await f.hub.fetch(new Request('https://example.test/api/ice', { headers: { Authorization: 'Bearer auth' } }));
 assert.equal(response.status, 503); assert.equal(response.headers.get('Retry-After'), '5');
 assert.equal(response.headers.get('Cache-Control'), 'no-store');
 const body = await response.json();
 assert.equal(body.code, 'TURN_NETWORK');
 assert(!JSON.stringify(body).includes('master-secret'));
});
