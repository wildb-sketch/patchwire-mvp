// Optional CI secret. The private key is never printed or committed.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const encoded = process.env.ANDROID_DEBUG_KEYSTORE_BASE64;
if (encoded) {
  const target = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'whassabi-debug.keystore');
  fs.writeFileSync(target, Buffer.from(encoded.replace(/\s/g, ''), 'base64'), { mode: 0o600 });
  try { execFileSync('keytool', ['-list', '-keystore', target, '-storepass', 'android', '-alias', 'androiddebugkey'], { stdio: 'ignore' }); }
  catch { throw Error('ANDROID_DEBUG_KEYSTORE_BASE64 must contain the Whassabi test keystore'); }
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, 'WHASSABI_DEBUG_KEYSTORE=' + target + '\n');
  console.log('Restored persistent test signing identity');
} else console.log('Using generated debug signing identity; verified links require this APK certificate to be published.');
