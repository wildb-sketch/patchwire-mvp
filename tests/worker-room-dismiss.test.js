const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
 const source = fs.readFileSync(path.join(__dirname, '../cloudflare/src/worker.js'), 'utf8')
  .replace("import { DurableObject } from 'cloudflare:workers';", '')
  .replace('export default {', 'const worker = {').replace('export class Hub', 'class Hub');
 const context = vm.createContext({ DurableObject: class {}, TextEncoder, Response, Request, URL, crypto: require('node:crypto').webcrypto, clearTimeout });
 vm.runInContext(source + '\nglobalThis.Hub=Hub;', context);
 const hub = Object.create(context.Hub.prototype), messages = [];
 Object.assign(hub, { D: { users: { u: { id: 'u', nick: 'Guest' }, h: { id: 'h', nick: 'Host' } }, sessions: { auth: 'u' } },
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
