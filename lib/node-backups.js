const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createBackups } = require('./backups');
function fileBucket(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const root = path.resolve(directory);
  const target = key => { const file = path.resolve(root, key); if (!file.startsWith(root + path.sep) || key.includes('..')) throw Error('Invalid backup key'); return file; };
  function files(dir = root) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(path.join(dir, item.name)) : [path.relative(root, path.join(dir, item.name)).split(path.sep).join('/')]);
  }
  return {
    async put(key, body) { const file = target(key); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, body, { mode: 0o600 }); },
    async get(key) {
      const file = target(key); if (!fs.existsSync(file)) return null;
      const bytes = fs.readFileSync(file); return { size: bytes.length, async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }, async json() { return JSON.parse(bytes.toString('utf8')); } };
    },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) fs.rmSync(target(key), { force: true }); },
    async list({ prefix = '', delimiter, cursor, limit = 1000 } = {}) {
      const objects = new Map(), prefixes = new Set();
      for (const key of files().filter(key => key.startsWith(prefix))) {
        const rest = key.slice(prefix.length), slash = delimiter ? rest.indexOf(delimiter) : -1;
        if (slash >= 0) prefixes.add(prefix + rest.slice(0, slash + 1)); else objects.set(key, { key });
      }
      const all = [...objects.keys(), ...prefixes].sort().filter(key => !cursor || key > cursor), selected = all.slice(0, limit);
      return { objects: selected.filter(key => objects.has(key)).map(key => objects.get(key)), delimitedPrefixes: selected.filter(key => prefixes.has(key)), truncated: all.length > limit, cursor: selected.at(-1) };
    },
  };
}
function nodeSource(data, voiceDirectory) {
  return { freeze() {
    const snapshot = JSON.parse(JSON.stringify(data));
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'whassabi-snapshot-'));
    try {
      for (const message of snapshot.msgs.filter(m => m.kind === 'voice')) fs.copyFileSync(path.join(voiceDirectory, message.id + '.bin'), path.join(temp, message.id));
      const records = [];
      for (const [id, user] of Object.entries(snapshot.users)) {
        const metadata = { ...user }; if (user.photo) metadata.photo = { type: user.photo.type, v: user.photo.v };
        records.push({ kind: 'user', k: id, v: JSON.stringify(metadata) });
      }
      for (const [field, kind, key] of [
        ['msgs', 'msg', m => m.id], ['friends', 'friend', f => f.a + ':' + f.b], ['follows', 'follow', f => f.a + ':' + f.b],
        ['feed', 'feed', f => f.ts + ':' + f.rid], ['reports', 'report', r => r.id || r.ts + ':' + r.by], ['blocks', 'block', b => b.by + ':' + b.who],
      ]) for (const record of snapshot[field] || []) records.push({ kind, k: key(record), v: JSON.stringify(record) });
      return { records, async *media() {
        for (const user of Object.values(snapshot.users)) if (user.photo) yield { kind: 'photo', id: user.id, bytes: new TextEncoder().encode(JSON.stringify({ type: user.photo.type, data: user.photo.data })) };
        for (const message of snapshot.msgs.filter(m => m.kind === 'voice')) yield { kind: 'voice', id: message.id, bytes: fs.readFileSync(path.join(temp, message.id)) };
      }, release() { fs.rmSync(temp, { recursive: true, force: true }); } };
    } catch (error) { fs.rmSync(temp, { recursive: true, force: true }); throw error; }
  } };
}
async function restoreOffline(bucketDirectory, id, output) {
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw Error('Recovery output must be a new or empty directory');
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const temporary = fs.mkdtempSync(path.join(output, '.restore-'));
  const data = { users: {}, sessions: {}, msgs: [], friends: [], follows: [], feed: [], reports: [], blocks: [], pushDevices: {}, accountTokens: {}, rate: {}, ops: {} };
  const fields = { msg: 'msgs', friend: 'friends', follow: 'follows', feed: 'feed', report: 'reports', block: 'blocks' };
  const source = { async beginRestore() { return {
    records(rows) { for (const row of rows) { const value = JSON.parse(row.v); if (row.kind === 'user') data.users[row.k] = value; else data[fields[row.kind]].push(value); } },
    media(kind, mediaId, bytes) {
      if (kind === 'photo') { if (!data.users[mediaId]) throw Error('Orphan photo'); data.users[mediaId].photo = { ...data.users[mediaId].photo, ...JSON.parse(new TextDecoder().decode(bytes)) }; }
      else { fs.mkdirSync(path.join(temporary, 'voice'), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(temporary, 'voice', mediaId + '.bin'), bytes, { mode: 0o600 }); }
    },
    commit() {
      fs.mkdirSync(path.join(temporary, 'voice'), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(temporary, 'data.json'), JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(path.join(temporary, 'voice'), path.join(output, 'voice')); fs.renameSync(path.join(temporary, 'data.json'), path.join(output, 'data.json'));
      fs.rmSync(temporary, { recursive: true, force: true });
    }, abort() { fs.rmSync(temporary, { recursive: true, force: true }); },
  }; } };
  const backups = createBackups({ bucket: fileBucket(bucketDirectory), source });
  return backups.restore(id, 'RESTORE ' + id);
}
module.exports = { fileBucket, nodeSource, restoreOffline };
