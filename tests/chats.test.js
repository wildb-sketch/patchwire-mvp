const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChats } = require('../lib/chats');
const files = require('../lib/files');
test('clearing a chat hides exactly its prior messages while new arrivals in the same millisecond survive', () => {
  const a = 'a'.repeat(12), b = 'b'.repeat(12), id = 'c'.repeat(12);
  const data = { users: { [a]: {}, [b]: {} }, msgs: [{ id, from: a, to: b, ts: 100, t: 'old' }], chats: {}, messageMarks: {} }, changes = [];
  const chats = createChats({ data, now: () => 100, put() {}, remove() {}, changed: uid => changes.push(uid) });
  chats.mark(b, id, { favorite: true }); chats.chat(b, a, 'delete');
  data.msgs.push({ id: 'd'.repeat(12), from: a, to: b, ts: 100, t: 'new' });
  assert.deepEqual(chats.snapshot(b).messages.map(m => m.t), ['new']); assert.equal(chats.snapshot(a).messages.length, 2);
  assert.deepEqual(chats.snapshot(b).marks, {}); assert(changes.every(uid => uid === b));
  chats.chat(b, a, 'pin'); assert.equal(chats.snapshot(b).chats[a].hidden, false);
  assert.throws(() => chats.mark(b, id, { favorite: true }), { status: 404 });
});
test('private saved-message limits cannot be bypassed through pinning another message', () => {
  const a = 'a'.repeat(12), b = 'b'.repeat(12), data = { users: { [a]: {}, [b]: {} }, msgs: [] };
  const chats = createChats({ data, put() {}, remove() {}, changed() {} });
  for (let i = 0; i < 21; i++) data.msgs.push({ id: i.toString(16).padStart(12, '0'), from: a, to: b, ts: i + 1 });
  for (const message of data.msgs.slice(0, 20)) chats.mark(b, message.id, { pinned: true });
  assert.throws(() => chats.mark(b, data.msgs[20].id, { pinned: true }), { status: 400 });
  assert.equal(Object.keys(chats.snapshot(a).marks).length, 0);
  chats.mark(b, data.msgs[0].id, { pinned: false }); chats.mark(b, data.msgs[20].id, { pinned: true });
  assert.equal(chats.snapshot(b).saved.length, 20);
});
test('attachment readers enforce streaming bounds and downloads cannot execute uploaded markup', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(files.MAX_FILE_SIZE)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
  await assert.rejects(files.readFileBody(stream), { status: 413 });
  await assert.rejects(files.readFileBody(null, files.MAX_FILE_SIZE + 1), { status: 413 });
  await assert.rejects(files.readFileBody(new ReadableStream({ start(controller) { controller.close(); } })), { status: 400 });
  const headers = files.downloadHeaders('evil\r\n<script>.html', 32);
  assert.doesNotThrow(() => files.downloadHeaders('a'.repeat(179) + '🎙file.txt', 32));
  assert(!headers['Content-Disposition'].includes('\r')); assert.equal(headers['Content-Security-Policy'], 'sandbox'); assert.equal(headers['Content-Type'], 'application/octet-stream');
  const a = 'a'.repeat(12), b = 'b'.repeat(12), data = { users: { [b]: {} }, msgs: [{ from: a, kind: 'file', size: 99 * 1024 * 1024, ts: Date.now() }] };
  assert.throws(() => files.fileRecipient(data, a, b, { blocked: () => false }, () => true, 2 * 1024 * 1024), { status: 429 });
});
