const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');

test('stage changes render during blocked Android startup; host removal explains and retains the room ban in both designs', { timeout: 90000 }, async t => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whassabi-room-state-'));
 const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r));
 const port = listener.address().port; await new Promise(r => listener.close(r)); const origin = `http://127.0.0.1:${port}`;
 const server = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { ...process.env, PORT: String(port), DATA_FILE: path.join(dir, 'data.json'), FCM_SERVICE_ACCOUNT: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
 let browser; const errors = [];
 t.after(async () => { await browser?.close(); server.kill(); await new Promise(r => server.exitCode !== null ? r() : server.once('exit', r)); fs.rmSync(dir, { recursive: true, force: true }); });
 await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); });
 browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
 for (const [index, route] of ['/neon', '/'].entries()) {
  const pages = [];
  for (const role of ['host', 'guest']) {
   const nick = role + index, response = await fetch(origin + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nick, email: nick + '@example.test', password: 'fixture-room-password' }) });
   const account = await response.json(); assert(account.token);
   const context = await browser.newContext(); await context.grantPermissions(['microphone'], { origin });
   await context.addInitScript(({ token, route }) => { localStorage.setItem('pw_tok', token); localStorage.setItem('pw_design', route === '/neon' ? 'neon' : 'green'); }, { token: account.token, route });
   const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.goto(origin + route);
   await page.waitForFunction(() => typeof ws !== 'undefined' && ws?.readyState === 1 && S.me); pages.push(page);
  }
  const [host, guest] = pages;
  await host.evaluate(() => wsSend({ type: 'room:create', title: 'Stage rendering fixture' })); await host.waitForFunction(() => S.room && R.mic);
  const roomId = await host.evaluate(() => S.room.id), guestId = await guest.evaluate(() => S.me.id);
  await guest.evaluate(() => {
   window.playbackRouteChecks = 0;
   window.Capacitor = { getPlatform: () => 'android', addListener: () => Promise.resolve(), nativePromise: async (plugin, method) => {
    if (method === 'prepareAudioRoute') { window.playbackRouteChecks++; return { managed: true, generation: 1, route: 'speaker' }; } return {};
   } };
  });
  await guest.evaluate(id => wsSend({ type: 'room:join', id }), roomId); await guest.waitForSelector('#hand');
  await guest.waitForFunction(() => window.playbackRouteChecks > 0 && Object.values(R.peers).some(p => p.audio && !p.audio.paused));
  assert.equal(await guest.evaluate(() => R.mic), null, 'Listener playback must refresh output without opening a microphone');
  await guest.click('#hand');
  await host.waitForFunction(id => S.room.members.some(m => m.uid === id && m.hand), guestId);
  await guest.evaluate(() => {
   window.nativeWaiting = false; window.holdNative = () => { window.nativeWaiting = false; window.nativeGate = new Promise(resolve => window.releaseNative = resolve); }; window.holdNative();
   window.nativeOutput = 'auto';
   window.Capacitor = { getPlatform: () => 'android', addListener: () => Promise.resolve(), nativePromise: async (plugin, method, options) => {
    if (method === 'startRoom') { window.nativeWaiting = true; await window.nativeGate; }
    if (method === 'setAudioOutput') window.nativeOutput = options.route;
    if (method === 'getAudioStatus' || method === 'setAudioOutput') return { outputMode: window.nativeOutput, output: 'speaker', input: 'inactive' };
    return method === 'prepareAudioRoute' ? { managed: true, generation: 1, route: 'speaker' } : {};
   } };
  });
  await host.locator(`[data-role="${guestId}|speaker"]`).click();
  await guest.waitForFunction(() => window.nativeWaiting && S.room.members.some(m => m.uid === S.me.id && m.role === 'speaker'));
  await guest.locator(`#ob .strip [data-prof="${guestId}"], #ob .stgrid [data-prof="${guestId}"]`).waitFor({ state: 'visible', timeout: 2500 });
  assert.equal(await guest.evaluate(() => R.mic), null, 'Stage must render before microphone startup finishes');
  await guest.evaluate(() => window.releaseNative({})); await guest.waitForFunction(() => R.mic?.readyState === 'live');
  await guest.evaluate(() => { window.demotedTrack = R.mic; window.holdNative(); syncMic(); }); await guest.waitForFunction(() => window.nativeWaiting);
  await host.evaluate(uid => openProfile(uid), guestId); await host.locator('#mb [data-role]').click();
  await guest.waitForFunction(() => S.room.members.some(m => m.uid === S.me.id && m.role === 'listener'));
  await guest.locator('#hand').waitFor({ state: 'visible', timeout: 2500 });
  assert.equal(await guest.evaluate(() => window.demotedTrack.readyState), 'ended'); assert.equal(await guest.evaluate(() => R.mic), null);
  // Output choice must bypass the unresolved native start and must not open a listener mic.
  await guest.click('#dots'); await guest.getByRole('menuitem', { name: 'Audio output', exact: true }).click(); await guest.locator('[data-audio-output="speaker"]').click();
  await guest.waitForFunction(() => document.querySelector('[data-audio-output="speaker"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await guest.evaluate(() => R.mic), null); assert.equal(await guest.evaluate(() => window.nativeOutput), 'speaker');
  await guest.evaluate(() => closeModal());
  await guest.evaluate(() => window.releaseNative({}));
  await host.evaluate(uid => openProfile(uid), guestId); await host.locator('#mb [data-kick]').click();
  assert.match(await host.locator('#mb').textContent(), /hidden from them until it ends/); await host.click('#confirm-remove');
  await guest.waitForFunction(id => !S.room && !S.rooms.some(room => room.id === id), roomId);
  await guest.waitForFunction(() => [...document.querySelectorAll('.notice-message')].some(el => /hidden.*cannot rejoin until it ends/.test(el.textContent)));
  assert.equal(await host.evaluate(() => S.room.members.length), 1);
  await guest.evaluate(id => wsSend({ type: 'room:join', id }), roomId);
  await guest.waitForFunction(() => [...document.querySelectorAll('.notice-message')].some(el => el.textContent.includes('cannot join')));
  assert.equal(await guest.evaluate(() => S.room), null);
  await host.evaluate(() => wsSend({ type: 'room:end' })); await host.waitForFunction(() => !S.room);
  for (const page of pages) await page.context().close();
 }
 assert.deepEqual(errors, []);
});
