const { problem } = require('./security');
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const CHUNK_SIZE = 256 * 1024;
function fileName(value) {
  return Array.from(String(value || '').replace(/[\\/\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_').replace(/[\ud800-\udfff]/gu, '_').trim()).slice(0, 180).join('') || 'attachment';
}
function downloadHeaders(name, size) {
  const encoded = encodeURIComponent(fileName(name)).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return { 'Content-Type': 'application/octet-stream', 'Content-Disposition': "attachment; filename=\"attachment\"; filename*=UTF-8''" + encoded,
    'Content-Length': String(size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox', 'Referrer-Policy': 'no-referrer' };
}
async function readFileBody(stream, length) {
  if (Number(length) > MAX_FILE_SIZE) throw problem(413, 'Files can be up to 10 MB.');
  if (!stream) throw problem(400, 'Choose a non-empty file.');
  const chunks = []; let size = 0;
  // Request.body is a Web stream in Workers and the Node request is async iterable.
  const source = typeof stream.iterator === 'function' ? stream.iterator({ destroyOnReturn: false }) : stream;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > MAX_FILE_SIZE) throw problem(413, 'Files can be up to 10 MB.');
    chunks.push(chunk);
  }
  if (!size) throw problem(400, 'Choose a non-empty file.');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
function fileChunks(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_SIZE) chunks.push(bytes.slice(offset, offset + CHUNK_SIZE));
  return chunks;
}
function fileRecipient(D, uid, peer, safety, areFriends, incomingSize = 0) {
  const user = D.users[peer];
  if (!user || peer === uid || safety.blocked(uid, peer)) throw problem(404, 'User not found');
  if (user.dm === 'friends' && !areFriends(uid, peer)) throw problem(403, 'This person only accepts messages from friends');
  const sent = D.msgs.filter(m => m.from === uid && m.kind === 'file' && m.ts > Date.now() - 86400000).reduce((size, m) => size + m.size, 0);
  if (sent >= 100 * 1024 * 1024 || sent + incomingSize > 100 * 1024 * 1024) throw problem(429, 'Daily file limit reached. Try again tomorrow.');
  return user;
}
module.exports = { MAX_FILE_SIZE, fileName, downloadHeaders, readFileBody, fileChunks, fileRecipient };
