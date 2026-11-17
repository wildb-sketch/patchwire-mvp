const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');

test('Node TURN API authenticates and returns temporary credentials with safe health and cache headers', { timeout: 15000 }, async t => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whassabi-turn-'));
 // Only the child backend's upstream fetch is stubbed. Requests to its real HTTP API are not.
 const preload = path.join(dir, 'provider.cjs');
 fs.writeFileSync(preload, `globalThis.fetch = async (url, options) => {
  if (url !== 'https://rtc.live.cloudflare.com/v1/turn/keys/test-key/credentials/generate-ice-servers' || options.headers.Authorization !== 'Bearer test-master-token') throw Error('bad provider request');
  return Response.json({iceServers:[{urls:['turn:turn.cloudflare.com:3478'],username:'temporary-user',credential:'temporary-password'}]});
 };`);
 const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
 const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
 const base = `http://127.0.0.1:${port}`;
 const child = spawn(process.execPath, ['--require', preload, path.join(__dirname, '../server.js')], {
  env: { ...process.env, PORT: String(port), DATA_FILE: path.join(dir, 'data.json'), TURN_KEY_ID: 'test-key', TURN_KEY_API_TOKEN: 'test-master-token' },
  stdio: ['ignore', 'pipe', 'pipe'],
 });
 t.after(async () => {
  child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
  fs.rmSync(dir, { recursive: true, force: true });
 });
 await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', code => reject(Error('Server exited ' + code))); });
 const health = await fetch(base + '/healthz');
 assert.equal(health.headers.get('X-Voice-Relay'), 'configured'); assert.equal(health.headers.get('X-Voice-Relay-Provider'), 'cloudflare');
 assert.equal((await fetch(base + '/api/ice')).status, 401);
 const signup = await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'relay@example.test', nick: 'relay-test', password: 'test-voice-password' }) });
 assert.equal(signup.status, 200); const { token } = await signup.json();
 const request = () => fetch(base + '/api/ice', { headers: { Authorization: 'Bearer ' + token } });
 const response = await request(); assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
 const body = await response.text(); assert(body.includes('temporary-password')); assert(!body.includes('test-master-token'));
 for (let i = 0; i < 29; i++) assert.equal((await request()).status, 200);
 const limited = await request(); assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60');
});
