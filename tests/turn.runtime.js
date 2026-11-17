const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Miniflare, convertV4MiniflareOptions } = require('../cloudflare/node_modules/miniflare');

test('native Workers fetch generates TURN credentials and never follows a redirect with its token', { timeout: 60000 }, async () => {
 const source = fs.readFileSync(path.join(__dirname, '../lib/turn.js'), 'utf8');
 const options = { workers: [
  { name: 'app', compatibilityDate: '2025-06-01', modules: true, outboundService: 'provider', script: `
   const module = { exports: {} };
   ${source}
   export default { async fetch(request) {
    const key = new URL(request.url).pathname.slice(1);
    const service = module.exports.createTurnService({ TURN_KEY_ID: key, TURN_KEY_API_TOKEN: 'fixture-token' });
    try { return Response.json(await service.ice('fixture-user')); }
    catch (error) { return Response.json(module.exports.relayFailure(error), { status: 503 }); }
   }};` },
  { name: 'provider', compatibilityDate: '2025-06-01', modules: true, script: `export default { async fetch(request) {
   const path = new URL(request.url).pathname;
   if (request.headers.get('Authorization') !== 'Bearer fixture-token' || request.method !== 'POST' || (await request.json()).ttl !== 86400) return new Response(null, { status: 400 });
   if (path.includes('/redirect/')) return new Response(null, { status: 302, headers: { Location: 'https://must-not-follow.invalid/' } });
   if (path.includes('/rejected/')) return new Response('private provider details', { status: 401 });
   const server = { urls: ['turn:turn.cloudflare.com:3478', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'fixture-user', credential: 'fixture-password' };
   return Response.json({ iceServers: path.includes('/single/') ? server : [server] });
  }};` },
 ] };
 const runtime = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
 try {
  for (const shape of ['array', 'single']) {
   const response = await runtime.dispatchFetch('https://fixture.test/' + shape);
   assert.equal(response.status, 200);
   const servers = await response.json(); assert.equal(servers[0].username, 'fixture-user');
   assert.equal(servers[0].urls.length, 2); assert(!JSON.stringify(servers).includes('fixture-token'));
  }
  const redirect = await runtime.dispatchFetch('https://fixture.test/redirect');
  assert.equal(redirect.status, 503); assert.deepEqual(await redirect.json(), { error: 'Voice relay is temporarily unavailable. Please retry.', code: 'TURN_UPSTREAM', upstreamStatus: 302 });
  const rejected = await runtime.dispatchFetch('https://fixture.test/rejected');
  assert.equal(rejected.status, 503);
  const body = await rejected.json(); assert.equal(body.code, 'TURN_AUTH'); assert.equal(body.upstreamStatus, 401);
  assert(!JSON.stringify(body).includes('private provider details'));
 } finally { await runtime.dispose(); }
});
