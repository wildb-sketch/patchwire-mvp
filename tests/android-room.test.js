const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function stream() {
 const track = { enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; } };
 return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}
function harness(file, { android = true, capture = async () => stream(), native = async () => ({}) } = {}) {
 const html = fs.readFileSync(path.join(root, 'public', file), 'utf8');
 const calls = [], messages = [], toasts = []; let listener;
 const context = vm.createContext({
  window: android ? { Capacitor: { getPlatform: () => 'android', addListener: (plugin, event, callback) => { listener = callback; }, nativePromise: async (methodPlugin, method, options) => { calls.push({ method, ...options }); return native(method, options); } } } : {},
  navigator: { mediaDevices: { getUserMedia: capture } }, localStorage: { removeItem() {} },
  console, MediaStream: class {},
  S: { me: { id: 'me' }, room: { id: 'room1', title: 'Test', host: 'me', members: [{ uid: 'me', role: 'speaker' }] }, muted: false, ov: null },
  audio: {syncTracks: async () => {},recoverAll() {}}, networkTimer: 0,
  clearTimeout() {},
  R: { mic: null, peers: {}, an: {} },
  iSpeak: () => context.S.room?.members.some(m => m.uid === 'me' && m.role === 'speaker'),
  wsSend: value => { messages.push(value); return true; }, toast: value => toasts.push(value),
  watch() {}, setTrack: async () => {}, render() {}, paintOv() {}, mini() {},
  $: () => null, closeModal() {}, dropOv() {}, drop() {}
 });
 const start = html.indexOf("// Capacitor's injected");
 context.window.createRoomDiagnostics=require('../public/room-diagnostics');
 const end = html.indexOf('const navigation=', start);
 vm.runInContext(html.match(/^const micCons=.*$/m)[0], context);
 vm.runInContext(html.slice(start, end), context);
 vm.runInContext(html.match(/^function setMute\(v\).*$/m)[0], context);
 vm.runInContext(html.match(/^let pendingRoomExit=null;\nfunction doLeave.*$/m)[0], context);
 const connectCode = html.slice(html.indexOf('let wsRetryTimer='), html.indexOf('async function loadUsers()'));
 Object.assign(context, {
  WebSocket: class { constructor() { this.readyState = 1; } close() { this.readyState = 3; } },
  location: { protocol: 'https:', host: 'example.test', origin: 'https://example.test' }, ws: null, retry: 0, booted: true,
  setInterval: () => 1, clearInterval() {}, setTimeout() {},
  conn() {}, setOv: value => { context.S.ov = value; }, stopMeter() {}, H: { sent: true },
  checkInvite() {}, bootRoom() {}, loadFriends() {}, loadFollows() {}, loadUsers() {},
  render() {}, paintOv() {}
 });
 context.window.createRoomHeartbeat=()=>({start(){},stop(){},message(){}});
 vm.runInContext(connectCode, context);
 return { context, calls, messages, toasts, action: data => listener(data), run: code => vm.runInContext(code, context) };
}
for (const file of ['index.html', 'neon.html']) {
 test(`${file}: native service acknowledges microphone type before capture; concurrent state updates share a track`, async () => {
  let captures = 0; const h = harness(file, { capture: async () => { captures++; assert(h.calls.some(c => c.method === 'startRoom' && c.microphone)); return stream(); } });
  await Promise.all([h.context.syncMic(), h.context.syncMic(), h.context.syncMic()]);
  assert.equal(captures, 1); assert(h.context.R.mic.enabled);
 });
 test(`${file}: late capture after Leave is stopped and cannot resurrect the room`, async () => {
  const pending = deferred(); let started = false;
  const h = harness(file, { capture: () => { started = true; return pending.promise; } });
  const sync = h.context.syncMic(); while (!started) await tick();
  h.context.cleanup(); const st = stream(); pending.resolve(st); await sync; await tick();
  assert.equal(st.track.readyState, 'ended'); assert.equal(h.context.R.mic, null); assert.equal(h.context.S.room, null);
  assert.equal(h.calls.at(-1).method, 'stopRoom');
 });
 test(`${file}: demotion while capture is pending discards its microphone`, async () => {
  const pending = deferred(); let started = false;
  const h = harness(file, { capture: () => { started = true; return pending.promise; } });
  const sync = h.context.syncMic(); while (!started) await tick();
  h.context.S.room.members[0].role = 'listener'; h.context.syncMic();
  const st = stream(); pending.resolve(st); await sync;
  assert.equal(st.track.readyState, 'ended'); assert.equal(h.context.R.mic, null);
 });
 test(`${file}: permission denial mutes and only explicit Unmute retries`, async () => {
  let captures = 0; const h = harness(file, { capture: async () => { if (++captures === 1) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); return stream(); } });
  await h.context.syncMic(); await h.context.syncMic();
  assert.equal(captures, 1); assert(h.context.S.muted); assert(h.toasts.some(t => t.includes('Android Settings')));
  h.context.setMute(false); await h.context.syncMic(); assert.equal(captures, 2); assert(h.context.R.mic.enabled);
 });
 test(`${file}: notification Mute and Unmute change the WebRTC track and server state`, async () => {
  const h = harness(file); await h.context.syncMic();
  h.action({ action: 'mute', muted: true }); await h.context.syncMic();
  assert.equal(h.context.R.mic.enabled, false); assert.equal(h.messages.at(-1).on, true);
  h.action({ action: 'mute', muted: false }); await h.context.syncMic();
  assert.equal(h.context.R.mic.enabled, true); assert.equal(h.calls.at(-1).muted, false);
 });
 test(`${file}: notification Leave hands the host room to a co-host and releases audio`, async () => {
  const h = harness(file); h.context.S.room.members.push({ uid: 'cohost', role: 'speaker' }); await h.context.syncMic();
  const track = h.context.R.mic; h.action({ action: 'leave' }); await tick();
  assert.equal(h.messages.at(-1).type, 'room:leave'); assert.equal(h.messages.at(-1).automatic, true);
  assert.equal(track.readyState, 'ended'); assert.equal(h.context.S.room, null); assert.equal(h.calls.at(-1).method, 'stopRoom');
 });
 test(`${file}: notification Leave ends a host room with no co-host`, async () => {
  const h = harness(file); await h.context.syncMic(); h.action({ action: 'leave' }); await tick();
  assert.equal(h.messages.at(-1).type, 'room:leave'); assert.equal(h.messages.at(-1).automatic, true); assert.equal(h.context.S.room, null);
 });
 test(`${file}: a listener starts playback without microphone permission or capture`, async () => {
  const h = harness(file, { capture: () => { throw Error('listener must not capture'); } });
  h.context.S.room.members[0].role = 'listener'; await h.context.syncMic();
  assert.equal(h.calls.find(c => c.method === 'startRoom').microphone, false);
  assert(!h.calls.some(c => c.method === 'prepareMicrophone'));
 });
 test(`${file}: missing saved audio device falls back to the system microphone`, async () => {
  let captures = 0; const h = harness(file, { capture: async () => { if (++captures === 1) throw Object.assign(Error('missing'), { name: 'OverconstrainedError' }); return stream(); } });
  h.context.S.micId = 'removed-usb-device'; await h.context.syncMic();
  assert.equal(captures, 2); assert.equal(h.context.S.micId, null); assert(h.context.R.mic);
 });
 test(`${file}: web browsers still capture without a Capacitor bridge`, async () => {
  const h = harness(file, { android: false }); await h.context.syncMic(); assert(h.context.R.mic.enabled); assert.equal(h.calls.length, 0);
 });
 test(`${file}: foreground-service failure is visible and cannot open a microphone`, async () => {
  let captures = 0;
  const h = harness(file, { native: async method => { if (method === 'startRoom') throw Error('service refused'); return {}; }, capture: async () => { captures++; return stream(); } });
  await h.context.syncMic(); assert.equal(captures, 0); assert(h.context.S.muted); assert(h.toasts.includes('service refused'));
 });
 test(`${file}: signaling disconnect retains the live microphone and local mute state`, async () => {
  const h = harness(file); await h.context.syncMic(); const track = h.context.R.mic;
  h.context.setMute(true); await h.context.syncMic(); h.context.connect(); h.context.ws.onclose({ code: 1006 });
  assert.equal(h.context.R.mic, track); assert.equal(track.readyState, 'live'); assert(h.context.S.muted); assert(h.context.S.room);
 });
 test(`${file}: reconnect preserves local mute when server snapshot is stale`, async () => {
  const h = harness(file); await h.context.syncMic(); h.context.setMute(true); await h.context.syncMic();
  h.context.connect(); const room = JSON.parse(JSON.stringify(h.context.S.room)); room.members[0].muted = false;
  h.context.ws.onmessage({ data: JSON.stringify({ type: 'room:joined', room, resumed: true }) }); await h.context.syncMic();
  assert(h.context.S.muted); assert.equal(h.context.R.mic.enabled, false);
 });
 test(`${file}: a pending Leave suppresses automatic seat restoration`, async () => {
  const h = harness(file); await h.context.syncMic(); const room = JSON.parse(JSON.stringify(h.context.S.room));
  h.context.doLeave('end'); h.context.connect();
  h.context.ws.onmessage({ data: JSON.stringify({ type: 'room:joined', room, resumed: true }) });
  assert.equal(h.context.S.room, null); assert.equal(h.context.R.mic, null);
 });
 test(`${file}: native membership confirmation cleans only the matching room`, async () => {
  const h = harness(file); await h.context.syncMic(); h.context.connect();
  h.context.ws.onmessage({ data: JSON.stringify({ type: 'room:left', id: 'old-room' }) }); assert(h.context.S.room);
  h.context.ws.onmessage({ data: JSON.stringify({ type: 'room:left', id: 'room1' }) }); await tick();
  assert.equal(h.context.S.room, null); assert.equal(h.context.R.mic, null); assert.equal(h.context.S.roomLeaveToken, '');
 });
 test(`${file}: stage acceptance repaints immediately while the native service is still starting`, async () => {
  const pending=deferred();let starting=false,paintedRole;
  const h=harness(file,{native:async method=>{if(method==='startRoom'){starting=true;return pending.promise}return{}}});
  h.context.S.ov={t:'room'};h.context.S.room.members[0].role='listener';h.context.paintOv=()=>{paintedRole=h.context.S.room.members[0].role};
  h.context.connect();const sync=h.context.syncMic();while(!starting)await tick();
  const room=JSON.parse(JSON.stringify(h.context.S.room));room.members[0].role='speaker';
  h.context.ws.onmessage({data:JSON.stringify({type:'room:state',room})});
  assert.equal(paintedRole,'speaker');assert.equal(h.context.R.mic,null);
  pending.resolve({});await sync;assert(h.context.R.mic.enabled);
 });
 test(`${file}: moving a speaker to the audience stops capture before a delayed native call finishes`, async () => {
  const pending=deferred();let blocked=false,starting=false,paintedRole;
  const h=harness(file,{native:async method=>{if(method==='startRoom'&&blocked){starting=true;return pending.promise}return{}}});
  await h.context.syncMic();const previous=h.context.R.mic;h.context.S.ov={t:'room'};h.context.paintOv=()=>{paintedRole=h.context.S.room.members[0].role};
  h.context.connect();blocked=true;const sync=h.context.syncMic();while(!starting)await tick();
  const room=JSON.parse(JSON.stringify(h.context.S.room));room.members[0].role='listener';
  h.context.ws.onmessage({data:JSON.stringify({type:'room:state',room})});
  assert.equal(paintedRole,'listener');assert.equal(previous.readyState,'ended');assert.equal(h.context.R.mic,null);
  pending.resolve({});await sync;assert.equal(h.context.R.mic,null);
 });
 test(`${file}: route failures name the failed phone output rather than blaming a headset`, async () => {
  const h=harness(file);await h.context.roomCall('prepareBluetooth');
  h.action({action:'audioRouteChanged',ready:true,generation:1,route:'system',failed:true,failedRoute:'speaker'});
  assert.equal(h.toasts.length,1);assert.match(h.toasts[0],/Phone loudspeaker/);assert(!/headset|Bluetooth/i.test(h.toasts[0]));
  h.action({action:'audioRouteChanged',ready:true,generation:2,route:'system',failed:true});
  assert.match(h.toasts[1],/Audio output/);assert(!/headset|Bluetooth/i.test(h.toasts[1]));
 });
 test(`${file}: a genuine Bluetooth fallback explains the confirmed loudspeaker route`, async () => {
  const h=harness(file);await h.context.roomCall('prepareBluetooth');
  h.action({action:'audioRouteChanged',ready:true,generation:1,route:'speaker',failed:true,failedRoute:'bluetooth'});
  assert.match(h.toasts[0],/Bluetooth.*Switched to the phone loudspeaker/);assert.equal(h.context.S.muted,false);
 });
 test(`${file}: microphone startup immediately refreshes Android output after AudioRecord can reset it`, async () => {
  let capturing=false,refreshed=false;const track=stream();
  const h=harness(file,{native:async method=>{if(method==='prepareAudioRoute'){if(capturing)refreshed=true;return{managed:true,generation:1,route:'speaker'}}return{}},capture:async()=>{capturing=true;return track}});
  await h.context.syncMic();await tick();assert.equal(refreshed,true);assert.equal(h.context.R.mic,track.track);assert.equal(h.context.S.muted,false);
 });
 test(`${file}: output recovery failures do not replace a live microphone or change user mute`, async () => {
  let captures=0;const h=harness(file,{capture:async()=>{captures++;return stream()}});await h.context.syncMic();const track=h.context.R.mic;
  for(let generation=1;generation<=5;generation++)h.action({action:'audioRouteChanged',ready:true,generation,route:'system',failed:true,failedRoute:'speaker'});
  await h.context.syncMic();assert.equal(captures,1);assert.equal(h.context.R.mic,track);assert.equal(track.readyState,'live');assert.equal(h.context.S.muted,false);
 });
 test(`${file}: choosing phone output preserves a muted microphone and listener output selection never captures`, async () => {
  let captures=0;const h=harness(file,{capture:async()=>{captures++;return stream()}});h.context.micSheet=async()=>{};
  h.context.S.muted=true;await h.context.syncMic();const track=h.context.R.mic;await h.context.chooseAudioOutput('speaker');
  assert(h.calls.some(c=>c.method==='setAudioOutput'&&c.route==='speaker'));assert.equal(captures,1);assert.equal(h.context.R.mic,track);assert.equal(track.enabled,false);assert.equal(h.context.S.muted,true);
  const listener=harness(file,{capture:async()=>{throw Error('Listener must never record')}});listener.context.micSheet=async()=>{};listener.context.S.room.members[0].role='listener';
  await listener.context.chooseAudioOutput('speaker');assert.equal(listener.context.R.mic,null);assert(!listener.calls.some(c=>c.method==='prepareMicrophone'));
 });
 test(`${file}: older APK output selection asks for an update without disturbing current capture`, async () => {
  const h=harness(file,{native:async method=>{if(method==='setAudioOutput')throw Object.assign(Error('not implemented'),{code:'UNIMPLEMENTED'});return{}}});
  await h.context.syncMic();const track=h.context.R.mic;await h.context.chooseAudioOutput('speaker');
  assert.equal(h.context.R.mic,track);assert.equal(track.readyState,'live');assert(h.toasts.some(t=>t.includes('latest Android update')));
 });
 test(`${file}: connected earbuds wait for native route confirmation before microphone capture`, async () => {
  const ready = deferred(); let captures = 0, preparing = false;
  const h = harness(file, { native: async method => { if (method === 'prepareAudioRoute') { preparing = true; return ready.promise; } return {}; }, capture: async () => { captures++; return stream(); } });
  h.context.S.micId = 'saved-phone-mic'; const pending = h.context.syncMic(); while (!preparing) await tick();
  assert.equal(captures, 0); ready.resolve({ managed: true, generation: 10, route: 'bluetooth' }); await pending;
  assert.equal(captures, 1); assert.equal(h.context.S.micId, null); assert.equal(h.context.R.micRoute, 10);
  assert(h.calls.findIndex(c => c.method === 'prepareBluetooth') < h.calls.findIndex(c => c.method === 'prepareAudioRoute'));
 });
 test(`${file}: headset hot-plug replaces only the microphone, preserves mute and keeps the room transport`, async () => {
  let generation = 1, captures = 0, recoveries = 0;
  const h = harness(file, { native: async method => method === 'prepareAudioRoute' ? { managed: true, generation } : {}, capture: async () => { captures++; return stream(); } });
  await h.context.syncMic(); const room = h.context.S.room, peer = { pc: {} }; h.context.R.peers.peer = peer;
  h.context.audio.recoverAll = () => recoveries++;
  for (const muted of [false, true]) {
   h.context.setMute(muted); await h.context.syncMic(); const previous = h.context.R.mic, oldEnded = previous.onended;
   generation++; h.action({ action: 'audioRouteChanged', ready: false, generation }); assert.equal(h.context.R.mic, previous);
   h.action({ action: 'audioRouteChanged', ready: true, generation }); await h.context.syncMic();
   assert.notEqual(h.context.R.mic, previous); assert.equal(previous.readyState, 'ended'); assert.equal(h.context.R.mic.enabled, !muted); assert.equal(h.context.S.muted, muted);
   assert.equal(h.context.S.room, room); assert.equal(h.context.R.peers.peer, peer);
   oldEnded(); await tick(); assert.equal(h.context.R.micRoute, generation);
   h.action({ action: 'audioRouteChanged', ready: true, generation }); await h.context.syncMic();
  }
  assert.equal(captures, 3); assert.equal(recoveries, 0); assert(!h.calls.some(c => c.method === 'stopRoom'));
 });
 test(`${file}: a second headset change discards an in-flight capture for the previous route`, async () => {
  let generation = 1, captures = 0, started = false; const pending = deferred();
  const h = harness(file, { native: async method => method === 'prepareAudioRoute' ? { managed: true, generation } : {}, capture: async () => { if (++captures === 2) { started = true; return pending.promise; } return stream(); } });
  await h.context.syncMic(); generation = 2; h.action({ action: 'audioRouteChanged', ready: true, generation }); while (!started) await tick();
  generation = 3; h.action({ action: 'audioRouteChanged', ready: true, generation });
  const stale = stream(); pending.resolve(stale); await h.context.syncMic();
  assert.equal(stale.track.readyState, 'ended'); assert.equal(captures, 3); assert.equal(h.context.R.micRoute, 3); assert.equal(h.context.S.muted, false);
 });
 test(`${file}: notification Mute and Leave bypass a Bluetooth wait and cannot resurrect capture`, async () => {
  let generation = 1, waiting = false, captures = 0; const pending = deferred();
  const h = harness(file, { native: async method => {
   if (method === 'prepareAudioRoute') { if (generation === 2) { waiting = true; return pending.promise; } return { managed: true, generation }; }
   if (method === 'stopRoom') pending.resolve({ managed: false }); return {};
  }, capture: async () => { captures++; return stream(); } });
  await h.context.syncMic(); generation = 2; h.action({ action: 'audioRouteChanged', ready: true, generation }); while (!waiting) await tick();
  h.action({ action: 'mute', muted: true }); await tick(); await tick();
  assert(h.calls.some(c => c.method === 'setMuted' && c.muted)); assert.equal(h.context.S.muted, true);
  h.action({ action: 'leave' }); await h.context.syncMic(); await tick();
  assert.equal(captures, 1); assert.equal(h.context.S.room, null); assert.equal(h.context.R.mic, null); assert.equal(h.calls.at(-1).method, 'stopRoom');
 });
 test(`${file}: hardware-ended tracks recover without automatic mute and retries remain bounded`, async () => {
  let captures = 0; const h = harness(file, { capture: async () => { captures++; return stream(); } });
  h.context.setTimeout = callback => setImmediate(callback);
  await h.context.syncMic();
  for (let attempt = 0; attempt < 3; attempt++) {
   const track = h.context.R.mic; track.readyState = 'ended'; track.onended(); await tick(); await h.context.syncMic();
   if (attempt < 2) { assert(h.context.R.mic); assert.equal(h.context.S.muted, false); }
  }
  assert.equal(captures, 3); assert.equal(h.context.R.mic, null); assert.equal(h.context.S.muted, true);
 });
 test(`${file}: repeated physical headset changes reset recovery without unmuting the user`, async () => {
  let generation = 1;
  const h = harness(file, { native: async method => method === 'prepareAudioRoute' ? { managed: true, generation } : {} });
  h.context.S.muted = true; await h.context.syncMic();
  for (let change = 0; change < 4; change++) {
   const old = h.context.R.mic; old.readyState = 'ended'; old.onended();
   generation++; h.action({ action: 'audioRouteChanged', ready: true, generation }); await h.context.syncMic();
   assert.notEqual(h.context.R.mic, old); assert.equal(h.context.R.micRoute, generation); assert.equal(h.context.S.muted, true); assert.equal(h.context.R.mic.enabled, false);
  }
 });
 test(`${file}: routing cannot retry microphone permission denial or capture for a listener`, async () => {
  let captures = 0; const h = harness(file, { capture: async () => { captures++; throw Object.assign(Error('denied'), { name: 'NotAllowedError' }); } });
  await h.context.syncMic(); h.action({ action: 'audioRouteChanged', ready: true, generation: 1 }); await h.context.syncMic(); assert.equal(captures, 1);
  h.context.S.room.members[0].role = 'listener'; h.action({ action: 'audioRouteChanged', ready: true, generation: 2 }); await h.context.syncMic(); assert.equal(captures, 1);
 });
 test(`${file}: older APKs and denied Bluetooth access retain phone microphone operation`, async () => {
  for (const old of [false, true]) {
   const h = harness(file, { native: async method => {
    if (['prepareBluetooth', 'prepareAudioRoute'].includes(method)) { if (old) throw Object.assign(Error('not implemented'), { code: 'UNIMPLEMENTED' }); return { enabled: false, managed: true, generation: 1, route: 'speaker' }; }
    return {};
   } });
   await h.context.syncMic(); assert(h.context.R.mic); assert.equal(h.context.S.muted, false);
  }
 });
 test(`${file}: transient headset capture errors get one bounded retry without changing user mute`, async () => {
  let captures = 0;
  const h = harness(file, { native: async method => method === 'prepareAudioRoute' ? { managed: true, generation: 1 } : {}, capture: async () => {
   if (++captures === 1) throw Object.assign(Error('device transitioning'), { name: 'NotReadableError' }); return stream();
  } });
  h.context.setTimeout = (callback,ms) => {if(ms===250)queueMicrotask(callback)}; h.context.S.muted = true;
  await h.context.syncMic(); assert.equal(captures, 2); assert(h.context.R.mic); assert.equal(h.context.S.muted, true); assert.equal(h.context.R.mic.enabled, false);
 });
 test(`${file}: Android headset input is selected explicitly after device labels become available, with standard speech gain control enabled`, async () => {
  let captures=0;const streams=[],constraints=[];
  const h=harness(file,{native:async method=>method==='prepareAudioRoute'?{managed:true,generation:1,route:'bluetooth'}:method==='getAudioStatus'?{headsetNames:['Galaxy Buds2'],outputName:'Galaxy Buds2'}:{},capture:async options=>{
   constraints.push(options.audio);captures++;const s=stream();s.track.getSettings=()=>({deviceId:options.audio.deviceId?.exact||'phone-input'});streams.push(s);return s;
  }});
  h.context.navigator.mediaDevices.enumerateDevices=async()=>captures?[{kind:'audioinput',deviceId:'phone-input',label:'Built-in microphone'},{kind:'audioinput',deviceId:'bud-input',label:'Galaxy Buds2 Bluetooth Headset'}]:[];
  await h.context.syncMic();assert.equal(captures,2);assert.equal(streams[0].track.readyState,'ended');assert.equal(h.context.R.mic,streams[1].track);
  assert.equal(constraints[1].deviceId.exact,'bud-input');assert(constraints.every(c=>c.autoGainControl===true&&c.echoCancellation===true&&c.noiseSuppression===true));
 });
 test(`${file}: leaving during headset diagnostics cannot open a new microphone`, async () => {
  const pending=deferred();let inspecting=false,captures=0;
  const h=harness(file,{native:async method=>{
   if(method==='prepareAudioRoute')return{managed:true,generation:1,route:'bluetooth'};
   if(method==='getAudioStatus'){inspecting=true;return pending.promise}return{};
  },capture:async()=>{captures++;return stream()}});
  const sync=h.context.syncMic();while(!inspecting)await tick();h.context.cleanup();pending.resolve({});await sync;
  assert.equal(captures,0);assert.equal(h.context.R.mic,null);
 });
 test(`${file}: route confirmation during bootstrap capture replaces the provisional microphone`, async () => {
  let confirmed=false,started=false,captures=0;const pending=deferred(),bootstrap=stream();
  const h=harness(file,{native:async method=>method==='prepareAudioRoute'?{managed:true,generation:confirmed?20:0,route:confirmed?'bluetooth':'system'}:{},capture:async()=>{
   if(++captures===1){started=true;return pending.promise}return stream();
  }});
  h.context.S.muted=true;const sync=h.context.syncMic();while(!started)await tick();
  confirmed=true;h.action({action:'audioRouteChanged',ready:true,generation:20,route:'bluetooth'});pending.resolve(bootstrap);await sync;
  assert.equal(captures,2);assert.equal(bootstrap.track.readyState,'ended');assert.equal(h.context.R.micRoute,20);
  assert.equal(h.context.S.muted,true);assert.equal(h.context.R.mic.enabled,false);assert(h.context.S.room);
 });
 test(`${file}: an older APK waiting for Bluetooth cannot block initial microphone capture`, async () => {
  const pending=deferred();let timeout,preparing=false,captures=0;
  const h=harness(file,{native:async method=>{if(method==='prepareAudioRoute'){preparing=true;return pending.promise}return{}},capture:async()=>{captures++;return stream()}});
  h.context.setTimeout=(callback,ms)=>{if(ms===800)timeout=callback;return 1};
  const sync=h.context.syncMic();while(!preparing||!timeout)await tick();timeout();await sync;
  assert.equal(captures,1);assert(h.context.R.mic.enabled);assert.equal(h.context.S.muted,false);
  pending.resolve({managed:true,generation:22,route:'bluetooth'});h.action({action:'audioRouteChanged',ready:true,generation:22});await h.context.syncMic();
  assert.equal(captures,2);assert.equal(h.context.R.micRoute,22);
 });
 test(`${file}: a busy advertised headset input does not fail an otherwise usable initial connection`, async () => {
  let captures=0;const h=harness(file,{native:async method=>method==='prepareAudioRoute'?{managed:true,generation:1,route:'bluetooth'}:{},capture:async options=>{
   captures++;if(options.audio.deviceId)throw Object.assign(Error('headset not ready'),{name:'NotReadableError'});return stream();
  }});
  h.context.navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audioinput',deviceId:'bt',label:'Bluetooth headset'}];
  await h.context.syncMic();assert.equal(captures,2);assert(h.context.R.mic.enabled);assert.equal(h.context.S.muted,false);assert.equal(h.toasts.length,0);
 });
 test(`${file}: a late headset capture failure keeps the already working microphone alive`, async () => {
  let captures=0;const bootstrap=stream();
  const h=harness(file,{native:async method=>method==='prepareAudioRoute'?{managed:true,generation:1,route:'bluetooth'}:{},capture:async options=>{
   captures++;if(options.audio.deviceId)throw Object.assign(Error('headset not ready'),{name:'AbortError'});return bootstrap;
  }});
  h.context.navigator.mediaDevices.enumerateDevices=async()=>captures?[{kind:'audioinput',deviceId:'bt',label:'Bluetooth headset'}]:[];
  await h.context.syncMic();assert.equal(captures,2);assert.equal(h.context.R.mic,bootstrap.track);assert.equal(bootstrap.track.readyState,'live');assert.equal(h.context.S.muted,false);
 });
 test(`${file}: headset fallback does not conceal a microphone permission rejection`, async () => {
  let captures=0;const bootstrap=stream();
  const h=harness(file,{native:async method=>method==='prepareAudioRoute'?{managed:true,generation:1,route:'bluetooth'}:{},capture:async options=>{
   captures++;if(options.audio.deviceId)throw Object.assign(Error('permission revoked'),{name:'NotAllowedError'});return bootstrap;
  }});
  h.context.navigator.mediaDevices.enumerateDevices=async()=>captures?[{kind:'audioinput',deviceId:'bt',label:'Bluetooth headset'}]:[];
  await h.context.syncMic();assert.equal(captures,2);assert.equal(bootstrap.track.readyState,'ended');assert.equal(h.context.R.mic,null);
  assert.equal(h.context.S.muted,true);assert(h.toasts.some(t=>t.includes('Android Settings')));
 });
 test(`${file}: unusable advertised headset inputs fall back once without leaking capture tracks`, async () => {
  let captures=0;const h=harness(file,{native:async method=>method==='prepareAudioRoute'?{managed:true,generation:1,route:'bluetooth'}:{},capture:async options=>{
   captures++;if(options.audio.deviceId?.exact==='unsupported-bt')throw Object.assign(Error('unsupported'),{name:'OverconstrainedError'});return stream();
  }});
  h.context.navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audioinput',deviceId:'unsupported-bt',label:'Bluetooth headset'}];
  await h.context.syncMic();assert.equal(captures,2);assert(h.context.R.mic);assert.equal(h.context.S.muted,false);
 });
 // Parse every inline script too, including bootstrap and the two independent designs.
 test(`${file}: every inline script parses`, () => {
  const html = fs.readFileSync(path.join(root, 'public', file), 'utf8');
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
 });
}
test('manifest patch is repeatable, upgrades existing service types, and copies the standalone plugin', () => {
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whassabi-manifest-'));
 try {
  fs.cpSync(path.join(root, 'mobile/scripts'), path.join(tmp, 'scripts'), { recursive: true });
  fs.cpSync(path.join(root, 'mobile/android-src'), path.join(tmp, 'android-src'), { recursive: true });
  const manifest = path.join(tmp, 'android/app/src/main/AndroidManifest.xml'); fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(manifest, '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="@string/app_name"><activity></activity><service android:name="com.patchwire.app.RoomService" android:foregroundServiceType="microphone" android:exported="false" /></application></manifest>');
  const patch = () => execFileSync(process.execPath, [path.join(tmp, 'scripts/patch-manifest.js')], { stdio: 'pipe' });
  patch(); const once = fs.readFileSync(manifest, 'utf8'); patch(); const twice = fs.readFileSync(manifest, 'utf8');
  assert.equal((twice.match(/android:networkSecurityConfig=/g) || []).length, 1);
  assert.equal((twice.match(/android:name="com.patchwire.app.RoomService"/g) || []).length, 1);
  for (const permission of ['RECORD_AUDIO', 'FOREGROUND_SERVICE_MICROPHONE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'WAKE_LOCK', 'POST_NOTIFICATIONS']) assert(twice.includes(`android.permission.${permission}"`));
  assert(twice.includes('android.permission.BLUETOOTH" android:maxSdkVersion="30"'));
  assert.equal((twice.match(/android:name="android.permission.BLUETOOTH_CONNECT"/g) || []).length, 1);
  assert(!twice.includes('android.permission.BLUETOOTH_SCAN')); assert(!twice.includes('android.permission.ACCESS_FINE_LOCATION'));
  assert(twice.includes('android:foregroundServiceType="microphone|mediaPlayback"'));
  assert(fs.existsSync(path.join(tmp, 'android/app/src/main/java/com/patchwire/app/RoomPlugin.java')));
  assert(fs.existsSync(path.join(tmp, 'android/app/src/main/java/com/patchwire/app/RoomAudioRoute.java')));
  assert(fs.existsSync(path.join(tmp, 'android/app/src/main/java/com/patchwire/app/RoomAudioStatus.java')));
  for(const density of ['mdpi','hdpi','xhdpi','xxhdpi','xxxhdpi'])assert(fs.existsSync(path.join(tmp,'android/app/src/main/res','mipmap-'+density,'ic_launcher.png')));
  assert(fs.readFileSync(path.join(tmp,'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'),'utf8').includes('whassabi_brand_yellow'));
  assert.equal(once.replace(/\s/g, ''), twice.replace(/\s/g, ''));
 } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
