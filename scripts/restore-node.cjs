const path = require('node:path');
const { restoreOffline } = require('../lib/node-backups');
const [bucket, snapshot, output] = process.argv.slice(2);
if (!bucket || !snapshot || !output) { console.error('Usage: node scripts/restore-node.cjs BACKUP_DIRECTORY SNAPSHOT_ID NEW_OUTPUT_DIRECTORY'); process.exitCode = 1; }
else restoreOffline(path.resolve(bucket), snapshot, path.resolve(output)).then(result => console.log('Validated recovery written to the new output directory:', result.records, 'records.')).catch(error => { console.error(error.message); process.exitCode = 1; });
