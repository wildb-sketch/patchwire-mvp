const encoder = new TextEncoder();
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
const token = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function createLimiter(options) {
  const state = options.state, now = options.now || Date.now;
  let cleaned = 0;
  return {
    allow(key, limit, window) {
      const time = now();
      if (time - cleaned > 60000) {
        for (const [id, value] of Object.entries(state)) if (value.until <= time) { delete state[id]; options.remove?.(id); }
        cleaned = time;
      }
      let item = state[key];
      if (!item || item.until <= time) {
        if (!item && Object.keys(state).length >= (options.maxKeys || 5000)) return false;
        item = { until: time + window, count: 0 };
      }
      if (item.count >= limit) return false;
      item.count++; state[key] = item; options.put?.(key, item); return true;
    },
  };
}
function problem(status, message) { return Object.assign(Error(message), { status }); }
function parseBody(text) {
  try { const value = JSON.parse(text || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
async function readJson(request, max) {
  if (Number(request.headers.get('Content-Length')) > max) throw problem(413, 'Request too large');
  if (!request.body) return {};
  const reader = request.body.getReader(), chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw problem(413, 'Request too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return parseBody(new TextDecoder().decode(bytes));
}
module.exports = { digest, token, equal, createLimiter, problem, parseBody, readJson };
