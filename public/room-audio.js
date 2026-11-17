/* WebRTC audio transport. Room membership and microphone ownership stay with the app. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createRoomAudio = factory;
})(typeof window === 'object' ? window : globalThis, function createRoomAudio(options) {
  const peers = Object.create(null);
  const later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
  const instance = Math.random().toString(36).slice(2);
  let serial = 0;
  const alive = p => peers[p.uid] === p && options.isMember(p.uid);
  const report = (p, state, error) => { if (alive(p)) options.onStatus?.(p.uid, state, error); };
  const connected = pc => pc.connectionState === 'connected' && ['connected', 'completed'].includes(pc.iceConnectionState);
  function enqueue(p, work) {
    const task = p.chain.then(async () => { if (alive(p)) return work(); });
    p.chain = task.catch(error => {
      if (alive(p)) { options.onError?.(p.uid, error); recover(p.uid, 'negotiation'); }
    });
    return p.chain;
  }
  function audioTransceiver(pc) {
    const audio = pc.getTransceivers().filter(t => !t.stopped && t.receiver?.track?.kind === 'audio');
    // Rollback can leave a local sender before the negotiated one, even with a different MID.
    for (let section of (pc.remoteDescription?.sdp || '').split(/\r?\nm=/)) {
      if (section.startsWith('m=')) section = section.slice(2);
      if (!/^audio [1-9]\d* /.test(section) || /^a=inactive\r?$/m.test(section)) continue;
      const mid = /^a=mid:(.+)$/m.exec(section)?.[1].trim();
      const negotiated = audio.find(t => t.mid === mid);
      if (negotiated) return negotiated;
    }
    return audio.find(t => typeof t.mid === 'string') || audio[0];
  }
  async function attach(p) {
    const sender = audioTransceiver(p.pc)?.sender;
    for (const t of p.pc.getTransceivers()) if (t.sender !== sender && t.sender?.track?.kind === 'audio') await t.sender.replaceTrack(null);
    if (sender) await sender.replaceTrack(options.getTrack() || null);
  }
  function clearTimer(p) { if (p.timer) cancel(p.timer); p.timer = null; }
  function schedule(p, delay, work) {
    clearTimer(p);
    p.timer = later(() => { p.timer = null; if (alive(p)) work(); }, delay);
  }
  async function offer(p, restart) {
    if (!alive(p)) return;
    if (!options.signalingReady()) { p.offerNeeded = true; schedule(p, 1500, () => recover(p.uid, 'signaling')); return; }
    if (p.pc.signalingState !== 'stable') {
      if (!restart || p.pc.signalingState !== 'have-local-offer') return;
      await p.pc.setLocalDescription({ type: 'rollback' });
    }
    p.makingOffer = true;
    try {
      const iceServers = restart && options.refreshIce ? await options.refreshIce() : options.getIce();
      if (!alive(p)) return;
      p.pc.setConfiguration({ iceServers });
      await attach(p);
      const description = await p.pc.createOffer(restart ? { iceRestart: true } : undefined);
      if (!alive(p)) return;
      await p.pc.setLocalDescription(description);
      if (!alive(p)) return;
      p.offerId = `${options.selfId()}:${instance}:${++serial}`;
      p.offerNeeded = !options.send(p.uid, { s: p.pc.localDescription, offerId: p.offerId });
      // Covers lost SDP, a peer that never answers, and failed initial ICE (not just later failures).
      schedule(p, 8000, () => { if (connected(p.pc) && p.pc.signalingState === 'stable') connectionChanged(p); else recover(p.uid, 'timeout'); });
    } finally { p.makingOffer = false; }
  }
  function recover(uid, reason = 'connection', reset = false) {
    const p = peers[uid]; if (!p || !alive(p)) return;
    if (reset) { p.attempts = 0; p.exhausted = false; }
    if (p.restartPending || p.exhausted) return;
    if (!p.recovering) { p.recovering = true; report(p, 'reconnecting'); }
    if (!options.signalingReady()) { schedule(p, 1500, () => recover(uid, reason)); return; }
    if (p.attempts >= 3) {
      clearTimer(p); p.exhausted = true; report(p, 'failed'); return;
    }
    p.attempts++; p.restartPending = true;
    enqueue(p, async () => {
      try { await offer(p, true); }
      finally { p.restartPending = false; }
    });
  }
  function connectionChanged(p) {
    if (!alive(p)) return;
    if (connected(p.pc) && p.pc.signalingState === 'stable') {
      const recovered = p.recovering;
      clearTimer(p); p.attempts = 0; p.exhausted = false; p.recovering = false;
      if (recovered) report(p, 'recovered');
    } else if (p.pc.connectionState === 'failed' || p.pc.iceConnectionState === 'failed') {
      recover(p.uid);
    } else if (p.pc.connectionState === 'disconnected' || p.pc.iceConnectionState === 'disconnected') {
      // Ignore a short handover blip; a native/online event can request recovery sooner.
      if (!p.timer) schedule(p, 1800, () => recover(p.uid));
    }
  }
  function connect(uid, initiate = false) {
    if (peers[uid]) return peers[uid];
    const pc = new (options.PeerConnection || RTCPeerConnection)({ iceServers: options.getIce() });
    const p = peers[uid] = { uid, pc, audio: null, chain: Promise.resolve(), candidates: [],
      ignoredUfrags: new Set(), makingOffer: false, ignoreOffer: false, timer: null,
      recovering: false, attempts: 0, exhausted: false, restartPending: false, offerNeeded: false };
    pc.addTransceiver('audio', { direction: 'sendrecv' });
    pc.onicecandidate = event => {
      if (alive(p) && event.candidate) options.send(uid, { c: event.candidate });
    };
    pc.ontrack = event => { if (alive(p)) options.onTrack?.(uid, event, p); };
    pc.onconnectionstatechange = () => connectionChanged(p);
    pc.oniceconnectionstatechange = () => connectionChanged(p);
    if (initiate) enqueue(p, () => offer(p, false));
    return p;
  }
  const ufrags = description => [...(description?.sdp || '').matchAll(/^a=ice-ufrag:(.+)\r?$/gm)].map(m => m[1].trim());
  async function candidate(p, c) {
    if (c.usernameFragment && p.ignoredUfrags.has(c.usernameFragment)) return;
    const current = ufrags(p.pc.remoteDescription);
    if (c.usernameFragment && current.length && !current.includes(c.usernameFragment)) return;
    try { await p.pc.addIceCandidate(c); }
    catch (error) { if (!p.ignoreOffer) options.onError?.(p.uid, error); }
  }
  function receive(uid, data) {
    if (!options.isMember(uid) || !data) return Promise.resolve();
    const p = connect(uid);
    return enqueue(p, async () => {
      const pc = p.pc;
      if (data.s) {
        const description = data.s;
        if (description.type === 'answer' &&
            (pc.signalingState !== 'have-local-offer' || (data.answerTo && data.answerTo !== p.offerId))) return;
        const collision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = collision && options.selfId() < uid;
        if (p.ignoreOffer) { ufrags(description).forEach(value => p.ignoredUfrags.add(value)); return; }
        if (collision && pc.signalingState === 'have-local-offer') await pc.setLocalDescription({ type: 'rollback' });
        // Keep the RTCPeerConnection and sender: an ICE restart is a renegotiation, not a new room.
        await pc.setRemoteDescription(description);
        if (!alive(p)) return;
        ufrags(description).forEach(value => p.ignoredUfrags.delete(value));
        if (description.type === 'offer') {
          const transceiver = audioTransceiver(pc);
          for (const t of pc.getTransceivers()) if (!t.stopped && t.receiver?.track?.kind === 'audio') t.direction = t === transceiver ? 'sendrecv' : 'inactive';
          await attach(p);
          await pc.setLocalDescription(await pc.createAnswer());
          if (!alive(p)) return;
          if (!options.send(uid, { s: pc.localDescription, answerTo: data.offerId })) p.offerNeeded = true;
          // The receiving peer also needs a watchdog if this path never connects.
          if (!connected(pc)) schedule(p, 8000, () => recover(uid, 'timeout'));
        }
        for (const c of p.candidates.splice(0)) await candidate(p, c);
        // Some browsers retain 'connected' throughout a successful restart and emit no new event.
        connectionChanged(p);
      } else if (data.c) {
        if (p.ignoreOffer && !data.c.usernameFragment) return;
        const fragments = ufrags(pc.remoteDescription);
        const future = data.c.usernameFragment && fragments.length && !fragments.includes(data.c.usernameFragment);
        if (pc.remoteDescription && !future) await candidate(p, data.c);
        else if (p.candidates.length < 128) p.candidates.push(data.c);
      }
    });
  }
  function remove(uid) {
    const p = peers[uid]; if (!p) return;
    delete peers[uid]; clearTimer(p);
    p.pc.onicecandidate = p.pc.ontrack = p.pc.onconnectionstatechange = p.pc.oniceconnectionstatechange = null;
    p.pc.close(); p.audio?.remove(); options.onRemove?.(uid);
  }
  return { peers, connect, receive, remove, retry: uid => recover(uid, 'manual', true),
    recoverAll: () => Object.keys(peers).forEach(uid => recover(uid, 'network', true)),
    syncTracks: () => Promise.all(Object.values(peers).map(p => enqueue(p, () => attach(p)))) };
});
