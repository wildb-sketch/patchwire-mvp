const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Miniflare, convertV4MiniflareOptions } = require('../cloudflare/node_modules/miniflare');
test('FCM OAuth signing and data-only delivery work in the actual Workers runtime', { timeout: 60000 }, async () => {
 const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
 const pem = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----';
 const env = { FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'fixture-project', client_email: 'fixture@example.invalid', private_key: pem }) };
 const source = fs.readFileSync(path.join(__dirname, '../lib/push.js'), 'utf8');
 const options = { workers: [
  { name: 'app', compatibilityDate: '2025-06-01', modules: true, outboundService: 'provider', script: `const module={exports:{}};\n${source}\nexport default {async fetch(){const sender=module.exports.createFcm(${JSON.stringify(env)}); return Response.json(await sender.send({uid:'aaaaaaaaaaaa',token:'fixture-fcm-token',binding:'fixture-binding'},{kind:'room',target:'abcdef12',id:'bbbbbbbbbbbb'}));}};` },
  { name: 'provider', compatibilityDate: '2025-06-01', modules: true, script: `export default {async fetch(request){
   if(new URL(request.url).hostname==='oauth2.googleapis.com') { const assertion=(await request.formData()).get('assertion'); if(!assertion||assertion.split('.').length!==3)return new Response(null,{status:400});return Response.json({access_token:'fixture-access',expires_in:3600}); }
   const {message}=await request.json();
   if(request.headers.get('Authorization')!=='Bearer fixture-access'||message.notification||message.data.recipient!=='aaaaaaaaaaaa'||message.data.binding!=='fixture-binding'||message.data.target!=='abcdef12')return new Response(null,{status:400});
   return Response.json({name:'fixture-message'});
  }};` },
 ] };
 const runtime = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
 try { const response = await runtime.dispatchFetch('https://fixture.test/'); assert.deepEqual(await response.json(), { status: 'sent' }); }
 finally { await runtime.dispose(); }
});
