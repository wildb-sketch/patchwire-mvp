const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
test('both app designs use compact deduplicated notices and usable block/report/account controls', { timeout: 90000 }, async t => {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whassabi-ui-'));
 const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
 const origin = `http://127.0.0.1:${port}`, operator = 'a'.repeat(64);
 const child = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { ...process.env, PORT: String(port), DATA_FILE: path.join(directory, 'data.json'), RESEND_API_KEY: '', OPS_TOKEN: operator, FCM_SERVICE_ACCOUNT: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
 let browser; const errors = [];
 t.after(async () => { await browser?.close(); child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
 await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
 browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
 const signup = async nick => (await fetch(origin + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nick, email: nick + '@example.invalid', password: 'fixture-password' }) })).json();
 for (const [index, route] of ['/neon', '/'].entries()) {
  const account = await signup('member' + index), other = await signup('other' + index);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(({ token, route }) => { localStorage.setItem('pw_tok', token); localStorage.setItem('pw_design', route === '/neon' ? 'neon' : 'green'); }, { token: account.token, route });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin + route);
  await page.waitForFunction(() => ws?.readyState === 1 && S.me); await page.bringToFront();
  assert.equal(await page.evaluate(() => bubble({ from: 'foreign', t: 'https://evil.invalid/room/abcdef12' }).includes('data-jr=')), false);
  assert.equal(await page.evaluate(() => bubble({ from: 'local', t: location.origin + '/room/abcdef12' }).includes('data-jr=')), true);
  await page.evaluate(() => { notices.clear(); for (let i = 0; i < 20; i++) toast('Repeated reconnect fixture'); });
  assert.equal(await page.locator('.tw').count(), 1);
  const bounds = await page.locator('.tw').boundingBox(); assert(bounds.width <= 360 && bounds.height < 90 && bounds.y > 500);
  await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await page.evaluate(() => toast('Repeated reconnect fixture')); assert.equal(await page.locator('.tw').count(), 0);
  await page.evaluate(() => { notices.clear(); toast('Old preview', () => { window.noticeAction = 'old'; }, { key: 'message-fixture' }); toast('Latest preview', () => { window.noticeAction = 'new'; }, { key: 'message-fixture' }); });
  assert.equal(await page.locator('.notice-message').textContent(), 'Latest preview');
  await page.locator('.tw.go').focus(); await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => window.noticeAction), 'new');
  await page.evaluate(uid => openProfile(uid), other.me.id); await page.click('[data-block]'); await page.click('#confirm-block');
  await page.waitForFunction(uid => S.blocks.some(user => user.id === uid), other.me.id);
  await page.evaluate(uid => openOv('chat', uid), other.me.id); assert.equal(await page.locator('#ci').count(), 0);
  await page.evaluate(uid => openProfile(uid), other.me.id); await page.click('[data-report]'); await page.selectOption('#report-reason', 'harassment');
  await page.fill('#report-details', '<img src=x onerror="window.reportExecuted=true">'); await page.click('#report-send'); await page.waitForFunction(() => document.getElementById('md').hidden);
  await page.evaluate(() => { notices.clear(); privSheet(); });
  await page.click('#verify-email'); await page.waitForFunction(() => [...document.querySelectorAll('.tw')].some(element => element.textContent.includes('not available yet')));
  await page.click('#blocked-people'); assert.equal(await page.locator('[data-unblock]').count(), 1); await page.click('[data-unblock]'); await page.waitForFunction(() => S.blocks.length === 0);
  if (process.env.NOTICE_SCREENSHOT && index === 0) {
   await page.evaluate(() => { closeModal(); dropOv(); notices.clear(); toast('New message from a friend', () => {}); });
   await page.waitForFunction(() => document.getElementById('md').hidden);
   await page.screenshot({ path: process.env.NOTICE_SCREENSHOT });
  }
  await context.close();
 }
 const signedOut = await browser.newPage(); signedOut.on('pageerror', error => errors.push(error.message)); await signedOut.goto(origin + '/neon');
 await signedOut.waitForSelector('#as'); if (await signedOut.locator('#an').count()) await signedOut.click('#as');
 await signedOut.click('#af'); await signedOut.waitForSelector('#mb'); assert((await signedOut.locator('#mb').textContent()).includes('not available yet')); assert.equal(await signedOut.locator('#reset-send').count(), 0);
 let confirmations = 0; await signedOut.route('**/api/account/verify', route => { confirmations++; return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
 await signedOut.goto(origin + '/account.html#verify=' + 'a'.repeat(43)); assert.equal(confirmations, 0); assert.equal(new URL(signedOut.url()).hash, '');
 await signedOut.click('#submit'); await signedOut.waitForFunction(() => document.getElementById('status').textContent.includes('Email verified')); assert.equal(confirmations, 1);
 const admin = await browser.newPage(); admin.on('pageerror', error => errors.push(error.message)); await admin.goto(origin + '/ops.html');
 await admin.fill('#token', operator); await admin.click('#unlock'); await admin.waitForSelector('#dashboard:not([hidden])');
 assert((await admin.locator('#reports').textContent()).includes('<img src=x')); assert.equal(await admin.evaluate(() => window.reportExecuted), undefined);
 await admin.locator('#reports button').first().click(); await admin.waitForFunction(() => document.getElementById('reports').textContent.includes('reviewed'));
 assert.deepEqual(errors, []);
});
