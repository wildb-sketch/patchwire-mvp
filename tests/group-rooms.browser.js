const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
test('eight real browser speakers exchange RTP and recover one muted peer without replacing its microphone', { timeout: 180000 }, async t => {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whassabi-eight-'));
 const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
 const origin = `http://127.0.0.1:${port}`;
 const child = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { ...process.env, PORT: String(port), DATA_FILE: path.join(directory, 'data.json'), RESEND_API_KEY: '', FCM_SERVICE_ACCOUNT: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
 let browser; const errors = [];
 t.after(async () => { await browser?.close(); child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
 await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
 browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
 const pages = [], accounts = [];
 for (let i = 0; i < 9; i++) {
  const response = await fetch(origin + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nick: 'speaker' + i, email: 'speaker' + i + '@example.invalid', password: 'fixture-password' }) });
  assert.equal(response.status, 200); const account = await response.json(); accounts.push(account);
  const context = await browser.newContext(); await context.grantPermissions(['microphone'], { origin });
  await context.addInitScript(token => { localStorage.setItem('pw_tok', token); localStorage.setItem('pw_design', 'neon'); }, account.token);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin + '/neon'); await page.waitForFunction(() => ws?.readyState === 1 && S.me); pages.push(page);
 }
 await pages[0].evaluate(() => wsSend({ type: 'room:create', title: 'Eight speaker validation' })); await pages[0].waitForFunction(() => S.room && R.mic);
 const room = await pages[0].evaluate(() => S.room.id);
 for (const page of pages.slice(1, 8)) { await page.evaluate(id => wsSend({ type: 'room:join', id }), room); await page.waitForFunction(() => S.room); await page.evaluate(() => wsSend({ type: 'room:hand', on: true })); }
 await pages[0].waitForFunction(() => S.room.members.length === 8 && S.room.members.slice(1).every(member => member.hand));
 for (const account of accounts.slice(1, 8)) await pages[0].evaluate(uid => wsSend({ type: 'room:role', uid, role: 'speaker' }), account.me.id);
 for (const page of pages.slice(0, 8)) await page.waitForFunction(() => R.mic && S.room.members.every(member => member.role === 'speaker'));
 await pages[8].evaluate(id => wsSend({ type: 'room:join', id }), room);
 await pages[8].waitForFunction(() => [...document.querySelectorAll('.tw')].some(node => node.textContent.includes('room is full')));
 assert.equal(await pages[8].evaluate(() => S.room), null);
 const inspect = page => page.evaluate(async () => {
  const peers = [];
  for (const [id, peer] of Object.entries(R.peers)) {
   const stats = await peer.pc.getStats(); let sent = 0, received = 0;
   stats.forEach(report => { if (report.type === 'outbound-rtp' && (report.kind || report.mediaType) === 'audio') sent += report.packetsSent || 0; if (report.type === 'inbound-rtp' && (report.kind || report.mediaType) === 'audio') received += report.packetsReceived || 0; });
   peers.push({ id, state: peer.pc.connectionState, sent, received });
  }
  return { uid: S.me.id, members: S.room?.members.length, leaveToken: S.roomLeaveToken, track: R.mic?.id, enabled: R.mic?.enabled, muted: S.muted, peers };
 });
 const waitForMedia = async () => {
  const deadline = Date.now() + 60000; let report;
  do {
   report = await Promise.all(pages.slice(0, 8).map(inspect));
   if (report.every(peer => peer.members === 8 && peer.peers.length === 7 && peer.peers.every(link => link.state === 'connected' && link.sent > 0 && link.received > 0))) return report;
   await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  throw Error('Eight-person RTP validation failed: ' + JSON.stringify(report));
 };
 const before = await waitForMedia();
 await pages[2].evaluate(() => { setMute(true); networkChanged(); });
 await pages[2].waitForFunction(old => S.roomLeaveToken !== old && S.muted && R.mic && !R.mic.enabled, before[2].leaveToken);
 const after = await waitForMedia(); assert.equal(after[2].track, before[2].track); assert.equal(after[2].muted, true); assert.equal(after[2].enabled, false);
 await pages[2].evaluate(() => setMute(false)); await pages[2].waitForFunction(() => R.mic.enabled && !S.muted);
 const checkpoint = await waitForMedia(), deadline = Date.now() + 20000;
 let progressing = false;
 while (Date.now() < deadline) {
  const latest = await Promise.all(pages.slice(0, 8).map(inspect));
  progressing = latest.every((member, index) => member.peers.every(link => { const previous = checkpoint[index].peers.find(p => p.id === link.id); return previous && link.sent > previous.sent && link.received > previous.received; }));
  if (progressing) break;
  await new Promise(resolve => setTimeout(resolve, 200));
 }
 assert(progressing, 'All 56 audio directions must carry fresh RTP after recovery and unmute');
 assert.deepEqual(errors, []);
 const report = { environment: 'Chromium with synthetic microphones and a local signaling server; not a physical Android radio/lock-screen test', speakers: 8, directedAudioLinks: after.reduce((sum, member) => sum + member.peers.length, 0), allLinksCarriedRtp: true, ninthParticipantRejected: true, mutedRecoveryPreservedMicrophone: true };
 if (process.env.GROUP_TEST_REPORT) fs.writeFileSync(process.env.GROUP_TEST_REPORT, JSON.stringify(report, null, 2));
 console.log(JSON.stringify(report));
});
