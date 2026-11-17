const { digest, token, equal, problem } = require('./security');
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function createMailer(env, options = {}) {
  const request = options.fetch || globalThis.fetch;
  const from = String(env.MAIL_FROM || '').trim();
  const configured = !!(env.RESEND_API_KEY && from.length <= 200 && !/[\r\n\0]/.test(from) && /<?[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>?$/.test(from));
  let origin = 'https://patchwire.whassabi.workers.dev';
  if (env.PUBLIC_ORIGIN) {
    const url = new URL(env.PUBLIC_ORIGIN);
    if (url.username || url.password || !(['https:'].includes(url.protocol) || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) || url.pathname !== '/' || url.search || url.hash) throw Error('Invalid PUBLIC_ORIGIN');
    origin = url.origin;
  }
  return { configured, async send({ purpose, email, secret, id }) {
    if (!configured) return false;
    const reset = purpose === 'reset', link = origin + '/account.html#' + purpose + '=' + secret;
    try {
      const response = await request('https://api.resend.com/emails', {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'whassabi:' + purpose + ':' + id },
        body: JSON.stringify({ from, to: [email], subject: reset ? 'Reset your Whassabi password' : 'Verify your Whassabi email',
          text: (reset ? 'Set a new password using this link. It expires in 30 minutes.' : 'Confirm your email using this link. It expires in 24 hours.') + '\n\n' + link + '\n\nIf you did not request this, you can ignore this email.' }),
      });
      await response.body?.cancel();
      if (!response.ok) options.onFailure?.({ service: 'mail', status: response.status });
      return response.ok;
    } catch { options.onFailure?.({ service: 'mail', status: 0 }); return false; }
  } };
}
function createAccounts(options) {
  const { users, tokens, limiter, mail } = options, now = options.now || Date.now;
  const remove = id => { delete tokens[id]; options.removeToken(id); };
  const version = user => user.salt + ':' + user.pw;
  const emailOf = value => String(value || '').trim().slice(0, 120).toLowerCase();
  async function allow(action, ip, email) {
    const ipKey = await digest('ip:' + String(ip || 'unknown').slice(0, 64));
    const who = await digest('email:' + emailOf(email));
    return limiter.allow(action + ':' + ipKey, action === 'signup' ? 25 : action === 'login' ? 30 : 10, action === 'signup' ? 3600000 : 900000) &&
      limiter.allow(action + ':' + who, action === 'login' ? 8 : action === 'signup' ? 5 : 3, action === 'login' ? 900000 : 3600000);
  }
  async function issue(user, purpose) {
    const key = purpose + ':' + user.id;
    if (!limiter.allow('mail:' + key, 1, 60000)) return false;
    for (const [id, record] of Object.entries(tokens)) if (record.expires <= now() || record.uid === user.id && record.purpose === purpose) remove(id);
    const secret = token(), id = await digest(secret);
    if (users[user.id] !== user) return false;
    const record = { uid: user.id, purpose, version: version(user), expires: now() + (purpose === 'reset' ? 1800000 : 86400000) };
    tokens[id] = record; options.putToken(id, record);
    const sent = await mail.send({ purpose, email: user.email, secret, id });
    if (!sent && tokens[id] === record) remove(id);
    return sent;
  }
  async function claim(secret, purpose) {
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw problem(400, 'This link is invalid or has expired. Request a new one.');
    const id = await digest(secret), record = tokens[id], user = users[record?.uid];
    if (!record || record.purpose !== purpose || record.expires <= now() || !user || !equal(record.version, version(user))) throw problem(400, 'This link is invalid or has expired. Request a new one.');
    // Claim synchronously before password hashing: two concurrent requests cannot use one link.
    remove(id); return user;
  }
  return {
    allow,
    async requestReset(value, ip) {
      const email = emailOf(value);
      if (!await allow('reset', ip, email)) throw problem(429, 'Too many requests. Try again later.');
      const user = EMAIL.test(email) && Object.values(users).find(user => user.email === email);
      if (user && mail.configured) await issue(user, 'reset');
      return { ok: true, message: 'If that email is registered, a reset link will arrive shortly.' };
    },
    async requestVerification(uid) {
      const user = users[uid]; if (!user) throw problem(401, 'Please log in');
      if (user.emailVerified) return { ok: true, verified: true };
      if (!mail.configured) throw problem(503, 'Email verification is not available yet.');
      if (!await issue(user, 'verify')) throw problem(429, 'Please wait a minute before requesting another email.');
      return { ok: true, message: 'Check your inbox for the verification link.' };
    },
    async reset(secret, password) {
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw problem(400, 'Use a password with 8–128 characters.');
      const user = await claim(secret, 'reset');
      for (const [id, record] of Object.entries(tokens)) if (record.uid === user.id) remove(id);
      const credentials = await options.hashPassword(password);
      Object.assign(user, credentials, { emailVerified: true }); options.userChanged(user);
      await options.revokeUser(user.id); return { ok: true };
    },
    async verify(secret) {
      const user = await claim(secret, 'verify'); user.emailVerified = true; options.userChanged(user);
      return { ok: true };
    },
  };
}
module.exports = { createMailer, createAccounts };
