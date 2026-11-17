(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createNotices = factory;
})(typeof window === 'object' ? window : globalThis, function createNotices(options = {}) {
  const doc = options.document || document, now = options.now || Date.now;
  const recent = new Map(), queue = [];
  let active = null, timer;
  function dismiss(next = true) {
    clearTimeout(timer); active?.element.remove(); active = null;
    if (next && !doc.hidden && queue.length) mount(queue.shift());
  }
  function mount(item) {
    if (doc.hidden) return;
    const element = doc.createElement('div'), message = doc.createElement('span'), close = doc.createElement('button');
    element.className = 'tw' + (item.action ? ' go' : ''); element.setAttribute('aria-live', 'polite');
    message.textContent = item.text; message.className = 'notice-message';
    close.type = 'button'; close.className = 'notice-close'; close.setAttribute('aria-label', 'Dismiss notification');
    close.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
    close.onclick = event => { event.stopPropagation(); dismiss(); };
    element.append(message, close);
    if (item.action) {
      element.setAttribute('role', 'button'); element.tabIndex = 0;
      element.onclick = () => { const action = active?.action; dismiss(); action?.(); };
      element.onkeydown = event => {
        if (event.target !== element) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); element.click(); }
        if (event.key === 'Escape') dismiss();
      };
    } else element.setAttribute('role', 'status');
    active = { ...item, element, message, since: now() }; doc.body.append(element);
    timer = setTimeout(dismiss, item.action ? 5000 : 3000);
  }
  function show(value, action, settings = {}) {
    const text = String(value || '').trim().slice(0, 240), key = settings.key || text;
    if (!text || doc.hidden) return;
    if (active?.key === key) {
      if (action && !active.action) { dismiss(false); mount({ key, text, action }); return; }
      active.message.textContent = text;
      if (action) active.action = action;
      return;
    }
    const queued = queue.find(item => item.key === key);
    if (queued) { Object.assign(queued, { text, action }); return; }
    const time = now();
    if (recent.has(key) && time - recent.get(key) < 10000) return;
    recent.set(key, time); if (recent.size > 50) recent.delete(recent.keys().next().value);
    const item = { key, text, action };
    if (!active) mount(item);
    else { if (queue.length >= 2) queue.shift(); queue.push(item); }
  }
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) { queue.length = 0; dismiss(false); } });
  return { show, clear() { queue.length = 0; dismiss(false); } };
});
