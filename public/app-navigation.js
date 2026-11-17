(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createAppNavigation = factory;
})(typeof window === 'object' ? window : globalThis, function createAppNavigation(options) {
  const key = 'pw_pending_navigation', now = options.now || Date.now;
  let pending = null;
  let seen = [];
  try { const saved = JSON.parse(options.storage.getItem(key + '_seen')); if (Array.isArray(saved)) seen = saved.filter(id => typeof id === 'string').slice(-32); } catch {}
  const valid = item => item && (item.kind === 'room' ? /^[a-f0-9]{8}$/.test(item.target || '') :
    ['chat', 'profile'].includes(item.kind) && /^[a-f0-9]{12}$/.test(item.target || '')) &&
    (!item.recipient || /^[a-f0-9]{12}$/.test(item.recipient));
  try { const saved = JSON.parse(options.storage.getItem(key)); if (valid(saved) && now() - saved.time < 86400000 && saved.time <= now() + 60000) pending = saved; } catch {}
  function save() { try { if (pending) options.storage.setItem(key, JSON.stringify(pending)); else options.storage.removeItem(key); } catch {} }
  function clear() {
    const old = pending; pending = null; save();
    if (old?.nativeId) {
      seen = [...seen.filter(id => id !== old.nativeId), old.nativeId].slice(-32);
      try { options.storage.setItem(key + '_seen', JSON.stringify(seen)); } catch {}
      try { Promise.resolve(options.consumeNative?.(old.nativeId)).catch(() => {}); } catch {}
    }
  }
  function flush() {
    if (!pending || !options.ready()) return;
    if (now() - pending.time >= 86400000) return clear();
    const item = pending;
    // An account switch must not turn an old notification into navigation for another user.
    if (item.recipient && item.recipient !== options.uid()) { clear(); options.wrongAccount?.(); return; }
    clear();
    options.navigate(item);
  }
  function enqueue(item, native = false) {
    if (!valid(item)) return false;
    if (native && (typeof item.id !== 'string' || !item.id || item.id.length > 100)) return false;
    if (native && seen.includes(item.id)) { try { Promise.resolve(options.consumeNative?.(item.id)).catch(() => {}); } catch {} return true; }
    if (native && item.time && (now() - item.time >= 86400000 || item.time > now() + 60000 || pending && pending.time > item.time)) return false;
    if (native && pending?.nativeId === item.id) { flush(); return true; }
    pending = { kind: item.kind, target: item.target, recipient: item.recipient || '', time: native && item.time || now(), ...(native ? { nativeId: item.id } : {}) };
    save(); flush(); return true;
  }
  function capture(value) {
    let url; try { url = new URL(value, options.origin); } catch { return false; }
    if (url.origin !== options.origin || url.username || url.password) return false;
    const canonical = /^\/room\/([a-f0-9]{8})\/?$/.exec(url.pathname);
    const legacy = /^(room|u|chat)=([a-f0-9]+)$/.exec(url.hash.slice(1));
    return canonical ? enqueue({ kind: 'room', target: canonical[1] }) : legacy && ['/', '/neon', '/index.html'].includes(url.pathname) ?
      enqueue({ kind: legacy[1] === 'room' ? 'room' : legacy[1] === 'u' ? 'profile' : 'chat', target: legacy[2] }) : false;
  }
  return { enqueue, capture, flush, clear };
});
