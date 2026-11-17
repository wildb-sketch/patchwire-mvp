const { equal } = require('./security');
const CATEGORIES = new Set(['http', 'socket', 'push', 'mail', 'backup', 'backup_ok', 'restore']);
function createMonitor(options = {}) {
  const state = options.state || {}, now = options.now || Date.now;
  return { state, record(category, status) {
    if (!CATEGORIES.has(category)) category = 'http';
    status = Number.isInteger(status) && status >= 0 && status <= 599 ? status : 500;
    if (!state.since || now() - state.since >= 86400000) { state.since = now(); state.counts = {}; }
    const key = category + ':' + status; state.counts[key] = (state.counts[key] || 0) + 1;
    if (status >= 500 || status === 0 || category === 'push' && status >= 400 || category === 'mail' && status >= 400) state.lastFailure = { category, status, time: now() };
    try { options.save?.(state); } catch {}
    // Deliberately exclude request URLs, tokens, emails, message text and exception messages.
    try { options.log?.({ event: 'whassabi_operation', category, status }); } catch {}
  } };
}
function operatorAuthorized(request, env) {
  return typeof env.OPS_TOKEN === 'string' && env.OPS_TOKEN.length >= 43 && equal(request.headers.get('Authorization') || '', 'Bearer ' + env.OPS_TOKEN);
}
module.exports = { createMonitor, operatorAuthorized };
