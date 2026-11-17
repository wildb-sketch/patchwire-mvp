// FCM HTTP v1 sender and account-bound device registry, shared by both backends.
const enc = new TextEncoder();
const DEVICE = /^[a-f0-9]{32}$/;
const TOKEN = /^[A-Za-z0-9:_\.\-]{20,4096}$/;
const b64url = bytes => btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const random = bytes => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

function createFcm(env, options = {}) {
  const request = options.fetch || ((...args) => globalThis.fetch(...args));
  const now = options.now || Date.now;
  let account, key, access, pending;
  try { account = JSON.parse(env.FCM_SERVICE_ACCOUNT || 'null'); } catch { account = null; }
  const project = String(env.FCM_PROJECT_ID || account?.project_id || '');
  const configured = !!(account?.client_email && account?.private_key && /^[a-z][a-z0-9-]{4,62}$/.test(project));
  async function accessToken() {
    if (access && access.until > now()) return access.token;
    if (pending) return pending;
    pending = (async () => {
      const seconds = Math.floor(now() / 1000);
      key ||= crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0)),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
      const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
      const claim = b64url(enc.encode(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: seconds, exp: seconds + 3600 })));
      const input = header + '.' + claim;
      const jwt = input + '.' + b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await key, enc.encode(input))));
      const response = await request('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString() });
      if (!response.ok) { await response.body?.cancel(); throw Error('PUSH_AUTH'); }
      const body = await response.json();
      if (typeof body.access_token !== 'string' || !body.access_token) throw Error('PUSH_AUTH');
      access = { token: body.access_token, until: now() + Math.max(0, Math.min(3600, Number(body.expires_in) || 3600) - 120) * 1000 };
      return access.token;
    })().finally(() => { pending = null; });
    return pending;
  }
  async function send(device, event) {
    if (!configured) return { status: 'disabled' };
    try {
      const bearer = await accessToken();
      const data = { kind: event.kind, target: event.target, eventId: event.id, recipient: device.uid, binding: device.binding };
      const response = await request(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
        headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: device.token, data, android: { priority: 'HIGH', ttl: event.kind === 'room' ? '300s' : '86400s', collapse_key: event.kind + ':' + event.target } } }),
      });
      if (response.ok) { await response.body?.cancel(); return { status: 'sent' }; }
      if (response.status === 401) access = null;
      let body; try { body = await response.json(); } catch { body = {}; }
      const stale = body.error?.details?.some(detail => detail['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' && detail.errorCode === 'UNREGISTERED');
      return { status: stale ? 'unregistered' : 'failed', code: response.status };
    } catch { return { status: 'failed' }; }
  }
  return { configured, project, send };
}

function createPushRegistry(options) {
  const devices = options.devices;
  const now = options.now || Date.now;
  const makeKey = options.random || random;
  const put = record => { devices[record.id] = record; options.put(record); };
  const remove = id => { if (devices[id]) { delete devices[id]; options.remove(id); } };
  function register(uid, session, body) {
    if (!DEVICE.test(body.deviceId || '') || !TOKEN.test(body.token || '')) throw Error('INVALID_DEVICE');
    const previous = devices[body.deviceId];
    if (previous && !equal(previous.key, body.deviceKey)) throw Error('STALE_DEVICE');
    for (const d of Object.values(devices)) if (d.token === body.token && d.id !== body.deviceId) remove(d.id);
    const own = Object.values(devices).filter(d => d.uid === uid && d.id !== body.deviceId).sort((a, b) => a.updated - b.updated);
    while (own.length >= 5) remove(own.shift().id);
    const sameSession = previous?.uid === uid && previous.session === session;
    const record = { id: body.deviceId, uid, session, token: body.token, key: sameSession ? previous.key : makeKey(32), binding: sameSession ? previous.binding : makeKey(16), updated: now() };
    put(record);
    return { deviceId: record.id, deviceKey: record.key, binding: record.binding };
  }
  function refresh(body) {
    const record = devices[body.deviceId];
    if (!record || !equal(record.key, body.deviceKey) || options.sessionOwner(record.session) !== record.uid) return false;
    if (body.remove === true) { remove(record.id); return true; }
    if (!TOKEN.test(body.token || '')) return false;
    for (const d of Object.values(devices)) if (d.token === body.token && d.id !== record.id) remove(d.id);
    put({ ...record, token: body.token, updated: now() });
    return true;
  }
  function logout(session) { for (const d of Object.values(devices)) if (d.session === session) remove(d.id); }
  async function notify(uid, event) {
    const list = Object.values(devices).filter(d => d.uid === uid);
    return Promise.all(list.map(async snapshot => {
      const current = devices[snapshot.id];
      if (current?.binding !== snapshot.binding || options.sessionOwner(snapshot.session) !== uid) return;
      const result = await options.sender.send(snapshot, event);
      const latest = devices[snapshot.id];
      if (result.status === 'unregistered' && latest?.binding === snapshot.binding && latest.token === snapshot.token) remove(snapshot.id);
    }));
  }
  return { register, refresh, logout, notify };
}

module.exports = { createFcm, createPushRegistry };
