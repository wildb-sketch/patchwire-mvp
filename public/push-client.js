(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createPushClient = factory;
})(typeof window === 'object' ? window : globalThis, function createPushClient(options) {
  let working = null, generation = 0;
  async function start() {
    if (!options.available() || !options.uid()) return;
    if (working) return working;
    const epoch = generation, uid = options.uid();
    const current = () => generation === epoch && options.uid() === uid;
    working = (async () => {
      const permission = await options.prepare();
      if (!current()) return;
      if (!permission.enabled) { await options.native('clear'); return; }
      let state = await options.native('getState', { uid, origin: options.origin });
      if (!current()) return;
      if (state.uid && state.uid !== uid) {
        await options.native('clear'); state = await options.native('getState', { uid, origin: options.origin });
      }
      if (!current() || !state.enabled || !state.token) return;
      const registration = await options.api('/push/register', 'POST', { deviceId: state.deviceId, token: state.token, deviceKey: state.deviceKey || '' });
      if (!current()) {
        await options.api('/push/refresh', 'POST', { ...registration, remove: true }).catch(() => {}); return;
      }
      await options.native('configure', { ...registration, uid, origin: options.origin });
      if (!current()) await options.native('clear');
    })().catch(() => { /* Permission denial, offline mode, and old APKs never block rooms or messaging. */ }).finally(() => { working = null; });
    return working;
  }
  async function stop() { generation++; if (options.available()) await options.native('clear').catch(() => {}); }
  return { start, stop };
});
