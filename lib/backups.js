const { problem } = require('./security');
const KINDS = new Set(['user', 'msg', 'friend', 'follow', 'feed', 'report', 'block']);
const enc = new TextEncoder(), dec = new TextDecoder();
const MAX_METADATA = 16 * 1024 * 1024;
const checksum = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
function prefixFor(id) {
  if (typeof id !== 'string' || !/^[0-9TZ.-]{20,32}-[a-f0-9]{12}$/.test(id)) throw problem(400, 'Invalid snapshot identifier');
  return 'snapshots/' + id + '/';
}
function validateRecords(records) {
  if (!Array.isArray(records) || records.length > 100000) throw Error('Invalid backup records');
  const users = new Set(), keys = new Set();
  for (const row of records) {
    if (!KINDS.has(row.kind) || typeof row.k !== 'string' || !row.k || row.k.length > 150 || typeof row.v !== 'string') throw Error('Invalid backup record');
    const key = row.kind + ':' + row.k; if (keys.has(key)) throw Error('Duplicate backup record'); keys.add(key);
    const value = JSON.parse(row.v);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value, '__proto__')) throw Error('Invalid backup value');
    if (row.kind === 'user') {
      if (!/^[a-f0-9]{12}$/.test(row.k) || value.id !== row.k || typeof value.email !== 'string' || !/^[a-f0-9]{32}$/.test(value.salt) || !/^[a-f0-9]{64}$/.test(value.pw)) throw Error('Invalid account backup');
      users.add(row.k);
    }
  }
  for (const row of records) {
    const value = JSON.parse(row.v);
    if (row.kind === 'msg' && (!/^[a-f0-9]{12}$/.test(row.k) || value.id !== row.k || !users.has(value.from) || !users.has(value.to))) throw Error('Orphan message in backup');
    if (['friend', 'follow'].includes(row.kind) && (!users.has(value.a) || !users.has(value.b))) throw Error('Orphan relationship in backup');
    if (row.kind === 'block' && (!users.has(value.by) || !users.has(value.who))) throw Error('Orphan block in backup');
  }
  return records;
}
function expectedMedia(records) {
  const expected = new Map();
  for (const row of records) {
    const value = JSON.parse(row.v);
    if (row.kind === 'user' && value.photo) expected.set('photo/' + row.k, value.photo.type);
    if (row.kind === 'msg' && value.kind === 'voice') expected.set('voice/' + row.k, value.mime);
  }
  return expected;
}
function validateMedia(expected, kind, id, bytes) {
  const key = kind + '/' + id;
  if (!expected.has(key)) throw Error('Unexpected or duplicate backup media');
  const mime = expected.get(key);
  if (kind === 'photo') {
    const value = JSON.parse(dec.decode(bytes));
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(value.type) || value.type !== mime || typeof value.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(value.data)) throw Error('Invalid photo backup');
    const raw = atob(value.data);
    if (raw.length > 150000 || !(raw.startsWith('\xff\xd8') || raw.startsWith('\x89PNG') || raw.startsWith('RIFF'))) throw Error('Invalid photo backup');
  } else if (bytes.length < 200 || bytes.length > 450000 || !/^audio\/[a-z0-9.+-]+$/i.test(mime || '')) throw Error('Invalid voice backup');
  expected.delete(key);
}
function createBackups(options) {
  const { bucket, source } = options, now = options.now || Date.now;
  const backend = options.backend || 'node';
  let working = null;
  const status = options.status || {};
  const persist = () => options.saveStatus?.(status);
  async function manifests() {
    if (!bucket) return [];
    const result = []; let cursor;
    do {
      const page = await bucket.list({ prefix: 'snapshots/', delimiter: '/', cursor, limit: 1000 });
      for (const prefix of page.delimitedPrefixes || []) {
        const object = await bucket.get(prefix + 'manifest.json');
        if (object && object.size < 4 * 1024 * 1024) {
          try { const manifest = await object.json(); if (manifest.schema === 1 && prefixFor(manifest.id) === prefix) result.push(manifest); } catch {}
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return result.sort((a, b) => b.created - a.created);
  }
  async function deletePrefix(prefix) {
    let cursor;
    do {
      const page = await bucket.list({ prefix, cursor, limit: 1000 });
      if (page.objects.length) await bucket.delete(page.objects.map(object => object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  async function run() {
    if (!bucket) throw problem(503, 'Backups are not configured');
    if (working) return working;
    working = (async () => {
      const id = new Date(now()).toISOString().replace(/:/g, '-') + '-' + [...crypto.getRandomValues(new Uint8Array(6))].map(x => x.toString(16).padStart(2, '0')).join('');
      const prefix = prefixFor(id); let snapshot;
      status.lastAttempt = now(); status.state = 'running'; persist();
      try {
        snapshot = await source.freeze();
        const records = validateRecords(snapshot.records.filter(row => KINDS.has(row.kind)));
        const expected = expectedMedia(records);
        const metadata = enc.encode(JSON.stringify({ schema: 1, backend, records }));
        if (metadata.byteLength > MAX_METADATA) throw Error('Backup metadata limit exceeded');
        const files = [];
        const upload = async (key, bytes, kind, mediaId) => {
          if (kind !== 'metadata' && bytes.byteLength > 600000) throw Error('Invalid backup media size');
          const hash = await checksum(bytes);
          await bucket.put(key, bytes, { httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'no-store' } });
          files.push({ key, size: bytes.byteLength, sha256: hash, kind, ...(mediaId ? { id: mediaId } : {}) });
        };
        await upload(prefix + 'data.json', metadata, 'metadata');
        for await (const media of snapshot.media()) {
          if (!['photo', 'voice'].includes(media.kind) || !/^[a-f0-9]{12}$/.test(media.id)) throw Error('Invalid backup media identifier');
          validateMedia(expected, media.kind, media.id, media.bytes);
          await upload(prefix + media.kind + '/' + media.id, media.bytes, media.kind, media.id);
        }
        if (expected.size) throw Error('Backup media is incomplete');
        const manifest = { schema: 1, backend, id, created: now(), files, records: records.length, bytes: files.reduce((n, file) => n + file.size, 0) };
        // The manifest is the commit marker; incomplete uploads never become restorable snapshots.
        await bucket.put(prefix + 'manifest.json', JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' } });
        Object.assign(status, { state: 'ok', lastSuccess: now(), snapshot: id, bytes: manifest.bytes }); persist();
        options.onEvent?.('backup_ok', 200);
        try {
          const all = await manifests();
          for (const old of all.slice(options.keep || 14)) await deletePrefix(prefixFor(old.id));
          delete status.retentionFailure; persist();
        } catch { status.retentionFailure = now(); persist(); options.onEvent?.('backup', 500); }
        return { id, created: manifest.created, bytes: manifest.bytes, objects: files.length };
      } catch (error) {
        status.state = 'failed'; status.lastFailure = now(); persist(); options.onEvent?.('backup', 500);
        await deletePrefix(prefix).catch(() => {}); throw problem(503, 'Backup could not be completed. Check the server logs.');
      } finally { await snapshot?.release(); }
    })().finally(() => { working = null; });
    return working;
  }
  async function load(id, sink) {
    const prefix = prefixFor(id), object = await bucket.get(prefix + 'manifest.json');
    if (!object || object.size > 4 * 1024 * 1024) throw problem(404, 'Snapshot not found');
    const manifest = await object.json();
    if (manifest.backend !== backend) throw problem(400, 'This snapshot belongs to a different backend type');
    if (manifest.schema !== 1 || manifest.id !== id || !Array.isArray(manifest.files) || manifest.files.length > 50000 || manifest.files[0]?.kind !== 'metadata') throw problem(400, 'Invalid snapshot manifest');
    const keys = new Set(); let records, expected, bytes = 0;
    for (const file of manifest.files) {
      if (!file || typeof file.key !== 'string' || !file.key.startsWith(prefix) || file.key.includes('..') || keys.has(file.key) || !/^[a-f0-9]{64}$/.test(file.sha256) ||
          !Number.isInteger(file.size) || file.size < 0 || file.size > (file.kind === 'metadata' ? MAX_METADATA : 600000)) throw problem(400, 'Invalid snapshot file');
      keys.add(file.key);
      if (file.kind !== 'metadata' && (!['photo', 'voice'].includes(file.kind) || !/^[a-f0-9]{12}$/.test(file.id) || file.key !== prefix + file.kind + '/' + file.id)) throw problem(400, 'Invalid snapshot media');
      const stored = await bucket.get(file.key);
      if (!stored || stored.size !== file.size) throw problem(400, 'Snapshot is incomplete');
      const content = new Uint8Array(await stored.arrayBuffer());
      if (await checksum(content) !== file.sha256) throw problem(400, 'Snapshot integrity check failed');
      bytes += content.byteLength;
      if (file.kind === 'metadata') {
        if (records || file.key !== prefix + 'data.json') throw problem(400, 'Invalid snapshot metadata');
        const data = JSON.parse(dec.decode(content)); if (data.schema !== 1 || data.backend !== backend) throw problem(400, 'Unsupported snapshot schema');
        records = validateRecords(data.records); expected = expectedMedia(records); await sink?.records(records);
      } else { validateMedia(expected, file.kind, file.id, content); await sink?.media(file.kind, file.id, content); }
    }
    if (!records || expected.size || bytes !== manifest.bytes || records.length !== manifest.records) throw problem(400, 'Invalid snapshot totals');
    return { id, created: manifest.created, bytes, records: records.length, objects: manifest.files.length };
  }
  return {
    run, status,
    health() { return !bucket ? 'missing' : status.state === 'failed' || status.retentionFailure ? 'error' : status.lastSuccess && now() - status.lastSuccess < 129600000 ? 'healthy' : status.state === 'running' && now() - status.lastAttempt < 900000 ? 'pending' : 'overdue'; },
    async list() { return (await manifests()).map(({ id, created, bytes, records }) => ({ id, created, bytes, records })); },
    async inspect(id) { if (!bucket) throw problem(503, 'Backups are not configured'); return load(id); },
    async restore(id, confirmation) {
      if (confirmation !== 'RESTORE ' + id) throw problem(400, 'Explicit restore confirmation is required');
      if (working) throw problem(409, 'A backup operation is already running');
      if (!source.beginRestore) throw problem(501, 'Use the offline recovery command for this server');
      working = (async () => {
        const sink = await source.beginRestore();
        try { const result = await load(id, sink); await sink.commit(); options.onEvent?.('restore', 200); return result; }
        catch (error) { await sink.abort(); throw error; }
      })().finally(() => { working = null; });
      return working;
    },
  };
}
module.exports = { createBackups, validateRecords, KINDS };
