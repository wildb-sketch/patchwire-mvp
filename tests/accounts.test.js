const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMailer, createAccounts } = require('../lib/accounts');
const { createLimiter } = require('../lib/security');
function fixture() {
 let time = 100000, revoked = [];
 const users = { a: { id: 'a', email: 'member@example.invalid', salt: 'old', pw: 'old-hash' }, b: { id: 'b', email: 'other@example.invalid', salt: 'b', pw: 'b-hash' } };
 const tokens = {}, sent = [], rate = {};
 const accounts = createAccounts({ users, tokens, now: () => time, limiter: createLimiter({ state: rate, now: () => time }),
  mail: { configured: true, async send(message) { sent.push(message); return true; } },
  putToken() {}, removeToken() {}, userChanged() {}, hashPassword: async password => ({ salt: 'new', pw: 'hash:' + password }), revokeUser: uid => revoked.push(uid) });
 return { accounts, users, tokens, sent, revoked, advance: value => { time += value; } };
}
test('password reset requests do not disclose membership and only hashed, expiring tokens are persisted', async () => {
 const f = fixture();
 const known = await f.accounts.requestReset('MEMBER@example.invalid', 'ip');
 const unknown = await f.accounts.requestReset('unknown@example.invalid', 'ip');
 assert.deepEqual(known, unknown); assert.equal(f.sent.length, 1);
 assert(!JSON.stringify(f.tokens).includes(f.sent[0].secret)); assert(/^[a-f0-9]{64}$/.test(Object.keys(f.tokens)[0]));
 // A resend during the cooldown has the same public response, not an enumeration signal.
 assert.deepEqual(await f.accounts.requestReset('member@example.invalid', 'ip'), known);
});
test('one reset link cannot be consumed twice, including concurrently, and revokes the account sessions', async () => {
 const f = fixture(); await f.accounts.requestVerification('a'); await f.accounts.requestReset('member@example.invalid', 'ip');
 const secret = f.sent.find(message => message.purpose === 'reset').secret;
 const result = await Promise.allSettled([f.accounts.reset(secret, 'a-new-password'), f.accounts.reset(secret, 'another-password')]);
 assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
 assert.equal(result.find(item => item.status === 'rejected').reason.status, 400);
 assert.deepEqual(f.revoked, ['a']); assert.equal(f.users.a.pw, 'hash:a-new-password');
 assert.equal(f.users.a.emailVerified, true); assert.equal(Object.keys(f.tokens).length, 0);
});
test('reset links expire, are tied to credentials and cannot be used for verification', async () => {
 const f = fixture(); await f.accounts.requestReset('member@example.invalid', 'ip');
 const secret = f.sent[0].secret;
 await assert.rejects(f.accounts.verify(secret), { status: 400 });
 await assert.rejects(f.accounts.reset(secret, 'short'), { status: 400 });
 f.advance(1800001); await assert.rejects(f.accounts.reset(secret, 'long-enough-password'), { status: 400 });
 await f.accounts.requestReset('member@example.invalid', 'ip');
 f.users.a.pw = 'changed-elsewhere'; await assert.rejects(f.accounts.reset(f.sent[1].secret, 'long-enough-password'), { status: 400 });
});
test('verification requires an explicit, single-use confirmation and does not revoke sign-ins', async () => {
 const f = fixture(); await f.accounts.requestVerification('a'); assert(!f.users.a.emailVerified);
 await f.accounts.verify(f.sent[0].secret); assert.equal(f.users.a.emailVerified, true); assert.deepEqual(f.revoked, []);
 await assert.rejects(f.accounts.verify(f.sent[0].secret), { status: 400 });
 assert.deepEqual(await f.accounts.requestVerification('a'), { ok: true, verified: true });
});
test('email delivery uses a fixed HTTPS provider, fragment links, private configuration and sanitized failures', async () => {
 const errors = []; let calls = 0;
 const env = { RESEND_API_KEY: 'private-fixture-key', MAIL_FROM: 'Whassabi <hello@example.invalid>', PUBLIC_ORIGIN: 'https://app.example.invalid' };
 const mail = createMailer(env, { onFailure: value => errors.push(value), fetch: async (url, init) => {
  calls++; assert.equal(url, 'https://api.resend.com/emails'); assert.equal(init.redirect, 'manual');
  assert.equal(init.headers.Authorization, 'Bearer private-fixture-key');
  const body = JSON.parse(init.body); assert(body.text.includes('https://app.example.invalid/account.html#reset=' + 'a'.repeat(43)));
  assert(!body.text.includes('token=')); return new Response('private diagnostic', { status: 403 });
 } });
 assert.equal(await mail.send({ purpose: 'reset', email: 'member@example.invalid', secret: 'a'.repeat(43), id: 'b'.repeat(64) }), false);
 assert.deepEqual(errors, [{ service: 'mail', status: 403 }]); assert.equal(calls, 1);
 assert.equal(createMailer({}).configured, false);
 assert.throws(() => createMailer({ PUBLIC_ORIGIN: 'https://user:password@app.example.invalid/' }));
});
test('rate-limit records remain bounded and reset after their window', () => {
 let now = 1; const state = {}, limiter = createLimiter({ state, now: () => now, maxKeys: 2 });
 assert(limiter.allow('a', 2, 100)); assert(limiter.allow('a', 2, 100)); assert(!limiter.allow('a', 2, 100));
 assert(limiter.allow('b', 1, 100)); assert(!limiter.allow('c', 1, 100));
 now += 60001; assert(limiter.allow('c', 1, 100)); assert.equal(Object.keys(state).length, 1);
});
