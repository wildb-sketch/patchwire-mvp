const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTurnService, TurnUnavailable, relayFailure } = require('../lib/turn');
const env = { TURN_KEY_ID: 'test-key', TURN_KEY_API_TOKEN: 'private-api-token' };
const result = (name = 'temporary') => ({ iceServers: [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:80?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp', 'turn:turn.cloudflare.com:53'], username: name, credential: 'temporary-password', ignored: 'private-provider-data' },
] });

test('unconfigured TURN preserves direct/STUN connections without provider calls', async () => {
 const service = createTurnService({}, { fetch: () => assert.fail('unexpected provider call') });
 assert.equal(service.status, 'missing'); assert.equal(service.provider, 'none');
 assert.deepEqual(await service.ice('u'), [{ urls: 'stun:stun.l.google.com:19302' }]);
});

test('partial configuration is explicit and cannot silently fall back to another provider', async () => {
 for (const partial of [{ TURN_KEY_ID: 'key' }, { TURN_KEY_API_TOKEN: 'secret' }, { TURN_URL: 'turn:example.test' }, { TURN_URL: 'https://example.test', TURN_USER: 'u', TURN_PASS: 'p' }]) {
  const service = createTurnService(partial);
  assert.equal(service.status, 'incomplete'); await assert.rejects(service.ice('u'), TurnUnavailable);
 }
 const service = createTurnService({ TURN_KEY_ID: 'key', TURN_URL: 'turn:example.test', TURN_USER: 'u', TURN_PASS: 'p' });
 assert.equal(service.provider, 'cloudflare'); assert.equal(service.status, 'incomplete');
});

test('existing static providers remain supported with trimmed UDP/TCP/TLS URLs', async () => {
 const service = createTurnService({ TURN_URL: ' turn:example.test:3478, turns:example.test:443?transport=tcp ', TURN_USER: 'user', TURN_PASS: 'password' });
 assert.equal(service.status, 'configured'); assert.equal(service.provider, 'static');
 assert.deepEqual((await service.ice('u'))[1], { urls: ['turn:example.test:3478', 'turns:example.test:443?transport=tcp'], username: 'user', credential: 'password' });
});

test('Cloudflare receives server-only authentication and returns only usable temporary ICE fields', async () => {
 const service = createTurnService(env, { fetch: async (url, options) => {
  assert.equal(url, 'https://rtc.live.cloudflare.com/v1/turn/keys/test-key/credentials/generate-ice-servers');
  assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'manual');
  assert.equal(options.headers.Authorization, 'Bearer private-api-token');
  assert.deepEqual(JSON.parse(options.body), { ttl: 86400 }); assert(options.signal instanceof AbortSignal);
  return Response.json(result());
 } });
 const servers = await service.ice('u');
 assert.equal(servers[1].urls.length, 3); assert(servers[1].urls.some(url => url.startsWith('turns:')));
 assert.equal(servers[1].credential, 'temporary-password');
 assert(!JSON.stringify(servers).includes('private-')); assert(!JSON.stringify(servers).includes(':53'));
});

test('concurrent requests coalesce per user; credentials renew and are not shared between users', async () => {
 let time = 1000, calls = 0;
 const service = createTurnService(env, { now: () => time, fetch: async () => Response.json(result('user-' + ++calls)) });
 const [a, b] = await Promise.all([service.ice('a'), service.ice('a')]);
 assert.deepEqual(a, b); assert.equal(calls, 1);
 assert.equal((await service.ice('a'))[1].username, 'user-1');
 assert.equal((await service.ice('b'))[1].username, 'user-2');
 time += 10 * 60 * 1000;
 assert.equal((await service.ice('a'))[1].username, 'user-3');
});

test('upstream errors are sanitized, backed off, then retried without poisoning the cache', async () => {
 let time = 1000, calls = 0;
 const service = createTurnService(env, { now: () => time, fetch: async () => {
  if (++calls === 1) throw Error('private-api-token sensitive details');
  return Response.json(result());
 } });
 await assert.rejects(service.ice('u'), error => error instanceof TurnUnavailable && !error.message.includes('private'));
 await assert.rejects(service.ice('u'), TurnUnavailable); assert.equal(calls, 1);
 time += 5000; assert.equal((await service.ice('u'))[1].credential, 'temporary-password'); assert.equal(calls, 2);
});

test('malformed, unauthenticated, and STUN-only upstream responses never masquerade as a working relay', async () => {
 const bad = [{}, { iceServers: [] }, { iceServers: [null] }, { iceServers: [{ urls: 'stun:example.test' }] },
  { iceServers: [{ urls: 'turn:example.test', username: 'u' }] },
  { iceServers: [{ urls: 'https://example.test', username: 'u', credential: 'p' }] },
  { iceServers: [{ urls: 'turn:example.test:53', username: 'u', credential: 'p' }] }];
 for (const body of bad) {
  const service = createTurnService(env, { fetch: async () => Response.json(body) });
  await assert.rejects(service.ice('u'), TurnUnavailable);
 }
 const service = createTurnService(env, { fetch: async () => new Response('private-api-token', { status: 401 }) });
 await assert.rejects(service.ice('u'), error => error instanceof TurnUnavailable && !error.message.includes('private'));
});

test('single-server credential responses normalize to the same validated ICE list', async () => {
 const service = createTurnService(env, { fetch: async () => Response.json({ iceServers: result().iceServers[1] }) });
 const list = await service.ice('u');
 assert.equal(list.length, 1); assert.equal(list[0].username, 'temporary'); assert.equal(list[0].urls.length, 3);
});

test('safe relay diagnostics distinguish provider rejection, timeout, and invalid responses without exposing secrets', async () => {
 for (const [status, code] of [[401, 'TURN_AUTH'], [403, 'TURN_AUTH'], [404, 'TURN_KEY'], [429, 'TURN_RATE_LIMIT'], [503, 'TURN_UPSTREAM']]) {
  const service = createTurnService(env, { fetch: async () => new Response('private-api-token sensitive provider details', { status }) });
  await assert.rejects(service.ice('u'), error => {
   assert.deepEqual(relayFailure(error), { error: 'Voice relay is temporarily unavailable. Please retry.', code, upstreamStatus: status });
   return true;
  });
 }
 const timeout = createTurnService(env, { fetch: async () => { const error = Error('private-api-token'); error.name = 'TimeoutError'; throw error; } });
 await assert.rejects(timeout.ice('u'), error => relayFailure(error).code === 'TURN_TIMEOUT');
 assert.deepEqual(relayFailure(Error('private-api-token')), { error: 'Voice relay is temporarily unavailable. Please retry.', code: 'TURN_UNAVAILABLE' });
});
