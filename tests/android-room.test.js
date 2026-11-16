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
  R: { mic: null, peers: {}, an: {} }, micCons: () => ({}),
  iSpeak: () => context.S.room?.members.some(m => m.uid === 'me' && m.role === 'speaker'),
  wsSend: value => { messages.push(value); return true; }, toast: value => toasts.push(value),
  watch() {}, setTrack: async () => {}, render() {}, paintOv() {}, mini() {},
  $: () => null, closeModal() {}, dropOv() {}, drop() {}
 });
 const start = html.indexOf("// Capacitor's injected");
 const end = html.indexOf('const bootRoom=', start);
 vm.runInContext(html.slice(start, end), context);
 vm.runInContext(html.match(/^function setMute\(v\).*$/m)[0], context);
 vm.runInContext(html.match(/^let pendingRoomExit=null;\nfunction doLeave.*$/m)[0], context);
 const connectCode = html.slice(html.indexOf('let wsHeartbeat='), html.indexOf('async function loadUsers()'));
 Object.assign(context, {
  WebSocket: class { constructor() { this.readyState = 1; } close() { this.readyState = 3; } },
  location: { protocol: 'https:', host: 'example.test' }, ws: null, retry: 0, booted: true,
  setInterval: () => 1, clearInterval() {}, setTimeout() {},
  conn() {}, setOv: value => { context.S.ov = value; }, stopMeter() {}, H: { sent: true },
  checkInvite() {}, bootRoom() {}, loadFriends() {}, loadFollows() {}, loadUsers() {},
  render() {}, paintOv() {}
 });
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
  assert(twice.includes('android:foregroundServiceType="microphone|mediaPlayback"'));
  assert(fs.existsSync(path.join(tmp, 'android/app/src/main/java/com/patchwire/app/RoomPlugin.java')));
  assert.equal(once.replace(/\s/g, ''), twice.replace(/\s/g, ''));
 } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
