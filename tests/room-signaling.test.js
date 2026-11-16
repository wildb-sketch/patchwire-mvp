const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const WebSocket = require('ws');

test('signaling heartbeat, muted seat recovery, host transfer, and room end', { timeout: 15000 }, async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whassabi-rooms-'));
 const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
 const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
 const base = `http://127.0.0.1:${port}`;
 const child = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { ...process.env, PORT: String(port), DATA_FILE: path.join(dir, 'data.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
 const clients = [];
 const socket = token => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`); clients.push(ws);
  const queued = [], waiting = [];
  ws.on('message', raw => { const d = JSON.parse(raw); const i = waiting.findIndex(w => w.pred(d)); if (i < 0) queued.push(d); else { const w = waiting.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(d); } });
  return { ws, send: d => ws.send(JSON.stringify(d)), wait: pred => {
   const i = queued.findIndex(pred); if (i >= 0) return Promise.resolve(queued.splice(i, 1)[0]);
   return new Promise((resolve, reject) => { const w = { pred, resolve, timer: setTimeout(() => reject(Error('Timed out waiting for room message')), 3000) }; waiting.push(w); });
  } };
 };
 try {
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', code => reject(Error(`Server exited ${code}`))); });
  const signup = async nick => {
   const response = await fetch(base + '/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${nick}@example.test`, nick, password: 'voice-test-password' }) });
   assert.equal(response.status, 200); return response.json();
  };
  const host = await signup('host'), guest = await signup('guest');
  const a = socket(host.token), b = socket(guest.token);
  await Promise.all([a.wait(d => d.type === 'rooms'), b.wait(d => d.type === 'rooms')]);
  a.send({ type: 'ping' }); assert.equal((await a.wait(d => d.type === 'pong')).type, 'pong');
  a.send({ type: 'room:create', title: 'Voice test', topic: 'Talk' }); const joined = await a.wait(d => d.type === 'room:joined'), room = joined.room;
  assert(joined.leaveToken); assert(!JSON.stringify(room).includes(joined.leaveToken));
  b.send({ type: 'room:join', id: room.id }); const guestJoined = await b.wait(d => d.type === 'room:joined');
  a.send({ type: 'room:leave' }); await a.wait(d => d.type === 'room:error' && d.error.includes('Choose a speaker'));
  a.send({ type: 'room:create', title: 'Do not replace the hosted room' }); await a.wait(d => d.type === 'room:error' && d.error.includes('Hand over or end'));
  b.send({ type: 'room:hand', on: true }); await a.wait(d => d.type === 'room:state' && d.room.members.some(m => m.uid === guest.me.id && m.hand));
  a.send({ type: 'room:role', uid: guest.me.id, role: 'speaker' }); await b.wait(d => d.type === 'room:state' && d.room.members.some(m => m.uid === guest.me.id && m.role === 'speaker'));
  b.send({ type: 'room:mute', on: true }); await b.wait(d => d.type === 'room:state' && d.room.members.some(m => m.uid === guest.me.id && m.muted));
  b.ws.close(); await new Promise(resolve => b.ws.once('close', resolve));
  const resumed = socket(guest.token); const restored = await resumed.wait(d => d.type === 'room:joined' && d.resumed);
  assert.equal(restored.room.id, room.id); assert(restored.room.members.find(m => m.uid === guest.me.id).muted);
  assert.notEqual(restored.leaveToken, guestJoined.leaveToken);
  const nativeLeave = (token, roomId, leaveToken) => fetch(base + '/api/room/leave', {
   method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
   body: JSON.stringify({ roomId, leaveToken })
  });
  assert.equal((await nativeLeave('invalid', room.id, joined.leaveToken)).status, 401);
  // A delayed dismissal from the previous connection cannot evict the recovered seat.
  assert.equal((await nativeLeave(guest.token, room.id, guestJoined.leaveToken)).status, 200);
  // A participant cannot use another participant's private lease to remove themselves/the host.
  assert.equal((await nativeLeave(guest.token, room.id, joined.leaveToken)).status, 200);
  resumed.send({ type: 'room:mute', on: false });
  await resumed.wait(d => d.type === 'room:state' && d.room.members.some(m => m.uid === guest.me.id && !m.muted));
  assert.equal((await nativeLeave(host.token, room.id, joined.leaveToken)).status, 200);
  await a.wait(d => d.type === 'room:left' && d.id === room.id);
  await resumed.wait(d => d.type === 'room:state' && d.room.host === guest.me.id);
  a.send({ type: 'room:join', id: room.id }); await a.wait(d => d.type === 'room:joined');
  assert.equal((await nativeLeave(guest.token, 'wrong-room', restored.leaveToken)).status, 200);
  assert.equal((await nativeLeave(guest.token, room.id, restored.leaveToken)).status, 200);
  assert.equal((await nativeLeave(guest.token, room.id, restored.leaveToken)).status, 200); // idempotent
  await a.wait(d => d.type === 'room:ended');
  await resumed.wait(d => d.type === 'rooms' && !d.rooms.some(r => r.id === room.id));
 } finally {
  for (const ws of clients) ws.terminate();
  child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
  fs.rmSync(dir, { recursive: true, force: true });
 }
});
