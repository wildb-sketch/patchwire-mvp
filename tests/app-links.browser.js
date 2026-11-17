const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');

test('room links survive design redirect/login and native warm taps preserve a live host room until confirmed', { timeout: 60000 }, async t => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whassabi-links-'));
 const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
 const base = `http://127.0.0.1:${port}`;
 const child = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { ...process.env, PORT: String(port), DATA_FILE: path.join(dir, 'data.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
 let browser;
 t.after(async () => { await browser?.close(); child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
 await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
 const signup = async nick => (await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: nick + '@example.invalid', nick, password: 'fixture-password' }) })).json();
 const hostAccount = await signup('host'), guestAccount = await signup('guest'), otherAccount = await signup('other');
 browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
 const errors = [];
 const pageFor = async (account, native = false) => {
  const context = await browser.newContext(); await context.grantPermissions(['microphone'], { origin: base });
  await context.addInitScript(({ account, native }) => {
   if (account) localStorage.setItem('pw_tok', account.token);
   if (native) {
    window.nativeListeners = {}; window.nativeCalls = []; window.documentIdentity = Math.random();
    window.Capacitor = { getPlatform: () => 'android',
     addListener: (plugin, event, callback) => { nativeListeners[plugin + ':' + event] = callback; return Promise.resolve({ remove() {} }); },
     nativePromise: async (plugin, method, options) => { nativeCalls.push({ plugin, method, options }); return method === 'prepareNotifications' ? { enabled: false } : method === 'startRoom' ? { notificationsEnabled: true } : {}; } };
   }
  }, { account, native });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); return page;
 };
 const host = await pageFor(hostAccount, true); await host.goto(base + '/neon');
 await host.waitForFunction(() => ws?.readyState === 1 && S.me);
 await host.evaluate(() => wsSend({ type: 'room:create', title: 'Original host room' })); await host.waitForFunction(() => S.room && R.mic);
 const original = await host.evaluate(() => ({ room: S.room.id, track: R.mic.id, document: documentIdentity }));
 const guest = await pageFor(null);
 await guest.addInitScript(() => localStorage.setItem('pw_design', 'green'));
 await guest.goto(base + '/neon#room=' + original.room);
 await guest.waitForFunction(() => S.ov?.t === 'auth'); assert.equal(new URL(guest.url()).pathname, '/');
 assert(await guest.evaluate(() => !!localStorage.getItem('pw_pending_navigation')));
 if (await guest.locator('#an').count()) await guest.click('#as');
 await guest.fill('#ae', 'guest@example.invalid'); await guest.fill('#ap', 'fixture-password'); await guest.click('#ag');
 await guest.waitForFunction(id => S.room?.id === id, original.room);
 assert.equal(await guest.evaluate(() => R.mic), null);
 const other = await pageFor(otherAccount); await other.goto(base + '/neon'); await other.waitForFunction(() => ws?.readyState === 1 && S.me);
 await other.evaluate(() => wsSend({ type: 'room:create', title: 'Destination room' })); await other.waitForFunction(() => S.room && R.mic);
 const destination = await other.evaluate(() => S.room.id);
 await host.waitForFunction(() => S.room.members.length === 2);
 const deliver = id => host.evaluate(({ target, id }) => nativeListeners['NavigationPlugin:navigation']({ id, kind: 'room', target }), { target: destination, id });
 await deliver('tap-1'); await host.waitForSelector('#mb [data-c]');
 assert.deepEqual(await host.evaluate(() => ({ room: S.room.id, track: R.mic.id, document: documentIdentity })), original);
 await host.click('#mb [data-c]'); await deliver('tap-1');
 assert.equal(await host.evaluate(() => document.getElementById('md').hidden), true);
 await deliver('tap-2'); await host.waitForSelector('#mb [data-e]'); await host.click('#mb [data-e]');
 await host.waitForFunction(id => S.room?.id === id, destination);
 assert.equal(await host.evaluate(() => R.mic), null); assert.equal(await host.evaluate(() => documentIdentity), original.document);
 await guest.waitForFunction(() => !S.room);
 await guest.evaluate(() => { location.hash = 'room=deadbeef'; });
 await guest.waitForFunction(() => [...document.querySelectorAll('.tw')].some(node => node.textContent === 'That room has ended'));
 assert.equal(await guest.evaluate(() => localStorage.getItem('pw_pending_navigation')), null);
 assert.deepEqual(errors, []);
});
