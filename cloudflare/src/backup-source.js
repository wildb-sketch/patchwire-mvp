import files from '../../lib/files.js';
export function backupSource(hub) {
  const sql = hub.sql;
  const drop = prefix => { for (const table of ['kv', 'photos', 'voice', 'files']) sql.exec('DROP TABLE IF EXISTS ' + prefix + table); };
  return {
    freeze() {
      hub.lifecycle.storage.transactionSync(() => {
        drop('backup_');
        sql.exec("CREATE TABLE backup_kv AS SELECT kind, k, v FROM kv WHERE kind IN ('user','msg','friend','follow','feed','report','block','chat','messageMark')");
        sql.exec('CREATE TABLE backup_photos AS SELECT uid, type, data FROM photos');
        sql.exec('CREATE TABLE backup_voice AS SELECT id, data FROM voice');
        sql.exec('CREATE TABLE backup_files AS SELECT id, part, data FROM files');
      });
      const records = sql.exec('SELECT kind, k, v FROM backup_kv').toArray();
      const photos = sql.exec('SELECT uid FROM backup_photos').toArray(), voices = sql.exec('SELECT id FROM backup_voice').toArray(), attachments = sql.exec('SELECT DISTINCT id FROM backup_files').toArray();
      return { records, async *media() {
        for (const { uid } of photos) {
          const row = sql.exec('SELECT type, data FROM backup_photos WHERE uid = ?', uid).toArray()[0];
          yield { kind: 'photo', id: uid, bytes: new TextEncoder().encode(JSON.stringify(row)) };
        }
        for (const { id } of voices) {
          const row = sql.exec('SELECT data FROM backup_voice WHERE id = ?', id).toArray()[0];
          yield { kind: 'voice', id, bytes: new Uint8Array(row.data) };
        }
        for (const { id } of attachments) {
          const chunks = sql.exec('SELECT data FROM backup_files WHERE id = ? ORDER BY part', id).toArray();
          const bytes = new Uint8Array(chunks.reduce((size, row) => size + row.data.byteLength, 0)); let offset = 0;
          for (const row of chunks) { bytes.set(new Uint8Array(row.data), offset); offset += row.data.byteLength; }
          yield { kind: 'file', id, bytes };
        }
      }, release() { drop('backup_'); } };
    },
    beginRestore() {
      drop('restore_');
      sql.exec('CREATE TABLE restore_kv (kind TEXT, k TEXT, v TEXT, PRIMARY KEY(kind,k))');
      sql.exec('CREATE TABLE restore_photos (uid TEXT PRIMARY KEY, type TEXT, data TEXT)');
      sql.exec('CREATE TABLE restore_voice (id TEXT PRIMARY KEY, data BLOB)');
      sql.exec('CREATE TABLE restore_files (id TEXT, part INTEGER, data BLOB, PRIMARY KEY(id,part))');
      return {
        records(rows) { for (const row of rows) sql.exec('INSERT INTO restore_kv VALUES (?, ?, ?)', row.kind, row.k, row.v); },
        media(kind, id, bytes) {
          if (kind === 'photo') {
            const row = JSON.parse(new TextDecoder().decode(bytes));
            sql.exec('INSERT INTO restore_photos VALUES (?, ?, ?)', id, row.type, row.data);
          } else if (kind === 'file') files.fileChunks(bytes).forEach((chunk, part) => sql.exec('INSERT INTO restore_files VALUES (?, ?, ?)', id, part, chunk.buffer));
          else sql.exec('INSERT INTO restore_voice VALUES (?, ?)', id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        },
        commit() {
          // Network reads and integrity checks finish before this synchronous atomic switch.
          for (const sockets of hub.online.values()) for (const ws of sockets) { try { ws.close(4401, 'recovery completed'); } catch {} }
          for (const timer of hub.grace.values()) clearTimeout(timer);
          hub.online.clear(); hub.rooms.clear(); hub.roomOf.clear(); hub.grace.clear();
          hub.lifecycle.storage.transactionSync(() => {
            sql.exec("DELETE FROM kv WHERE kind != 'ops'"); sql.exec('INSERT INTO kv SELECT * FROM restore_kv');
            sql.exec('DELETE FROM photos'); sql.exec('INSERT INTO photos SELECT * FROM restore_photos');
            sql.exec('DELETE FROM voice'); sql.exec('INSERT INTO voice SELECT * FROM restore_voice');
            sql.exec('DELETE FROM files'); sql.exec('INSERT INTO files SELECT * FROM restore_files');
          });
          hub.loadState(true); drop('restore_');
        }, abort() { drop('restore_'); },
      };
    },
  };
}
