// Shared by the Worker and Node backends. The API token never leaves this module.
const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];
const TTL_SECONDS = 86400;
const CACHE_MS = 10 * 60 * 1000;
const BACKOFF_MS = 5000;
const MAX_USERS = 1024;

class TurnUnavailable extends Error {
  constructor() { super('Voice relay is temporarily unavailable. Please retry.'); }
}

function createTurnService(env, options = {}) {
  const now = options.now || Date.now;
  const request = options.fetch || globalThis.fetch;
  const key = String(env.TURN_KEY_ID || '').trim();
  const token = String(env.TURN_KEY_API_TOKEN || '').trim();
  const urls = String(env.TURN_URL || '').split(',').map(url => url.trim()).filter(Boolean);
  const user = String(env.TURN_USER || '').trim(), password = String(env.TURN_PASS || '').trim();
  const cloudflare = !!(key || token);
  const provider = cloudflare ? 'cloudflare' : urls.length || user || password ? 'static' : 'none';
  const complete = cloudflare ? !!(key && token) : !!(urls.length && user && password && urls.every(url => /^turns?:\S+$/i.test(url)));
  const status = provider === 'none' ? 'missing' : complete ? 'configured' : 'incomplete';
  const cache = new Map();

  function validate(list) {
    if (!Array.isArray(list) || !list.length || list.length > 16) throw new TurnUnavailable();
    let relay = false;
    const servers = list.map(server => {
      const values = typeof server.urls === 'string' ? [server.urls] : server.urls;
      if (!Array.isArray(values) || !values.length || values.some(url => typeof url !== 'string' || !/^(stun|stuns|turn|turns):\S+$/i.test(url))) throw new TurnUnavailable();
      // Browsers block port 53; retain all other provider-supplied UDP/TCP/TLS routes.
      const allowed = values.filter(url => !/:53(?:\?|$)/.test(url));
      if (!allowed.length) return null;
      const result = { urls: allowed };
      if (allowed.some(url => /^turns?:/i.test(url))) {
        if (typeof server.username !== 'string' || !server.username || typeof server.credential !== 'string' || !server.credential) throw new TurnUnavailable();
        result.username = server.username;
        result.credential = server.credential;
        relay = true;
      }
      return result;
    }).filter(Boolean);
    if (!relay) throw new TurnUnavailable();
    return servers;
  }

  async function generate() {
    try {
      const response = await request(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(key)}/credentials/generate-ice-servers`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3500),
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new TurnUnavailable(); }
      return validate((await response.json()).iceServers);
    } catch {
      // Never forward provider errors, response bodies, or the long-lived API token.
      throw new TurnUnavailable();
    }
  }

  async function ice(uid) {
    if (status === 'missing') return STUN;
    if (status !== 'configured') throw new TurnUnavailable();
    if (!cloudflare) return [...STUN, { urls, username: user, credential: password }];
    let entry = cache.get(uid);
    if (entry?.pending) return entry.pending;
    if (entry?.value && entry.reuseUntil > now()) return entry.value;
    if (entry?.retryAt > now()) throw new TurnUnavailable();
    // Bound memory without evicting in-flight requests (which would defeat coalescing).
    for (const [id, value] of cache) {
      if (!value.pending && Math.max(value.reuseUntil || 0, value.retryAt || 0) <= now()) cache.delete(id);
    }
    if (!cache.has(uid) && cache.size >= MAX_USERS) throw new TurnUnavailable();
    entry = { reuseUntil: 0, retryAt: 0 };
    cache.set(uid, entry);
    const started = now();
    entry.pending = generate().then(value => {
      entry.value = value;
      // Reuse is bounded from issuance, not from a potentially delayed response.
      entry.reuseUntil = started + CACHE_MS;
      return value;
    }).catch(error => {
      entry.retryAt = now() + BACKOFF_MS;
      throw error;
    }).finally(() => { entry.pending = null; });
    return entry.pending;
  }

  return { status, provider, ice };
}

module.exports = { createTurnService, TurnUnavailable };
