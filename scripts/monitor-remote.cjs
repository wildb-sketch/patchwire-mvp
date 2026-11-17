const assert = require('node:assert/strict');
async function check(options = {}) {
 const request = options.fetch || fetch, origin = options.origin || 'https://patchwire.whassabi.workers.dev';
 const health = await request(origin + '/healthz', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
 assert.equal(health.status, 200, 'Worker/database health check failed');
 assert.equal(health.headers.get('X-Push'), 'configured', 'Push configuration is missing');
 assert.equal(health.headers.get('X-Voice-Relay'), 'configured', 'Voice relay configuration is missing');
 assert.equal(health.headers.get('X-Backup'), 'healthy', 'Independent backups are missing, failed, or overdue');
 const link = await request(origin + '/room/abcdef12', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
 assert.equal(link.status, 302, 'Shared room link fallback failed');
 assert.equal(link.headers.get('Location'), '/neon#room=abcdef12', 'Shared room link target changed');
 const auth = await request(origin + '/api/me', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
 assert.equal(auth.status, 401, 'Account endpoint unexpectedly allows anonymous access');
 console.log('Worker, relay, push configuration, backups, links and authentication checks passed.');
}
if (require.main === module) (async () => {
 let error;
 for (let attempt = 0; attempt < 3; attempt++) {
  try { await check(); return; } catch (failure) { error = failure; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 10000)); }
 }
 console.error(error.message); process.exitCode = 1;
})();
module.exports = { check };
