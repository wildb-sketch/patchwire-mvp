// Adds the microphone permissions the voice rooms and voice messages need.
const fs = require('fs');
const p = 'android/app/src/main/AndroidManifest.xml';
let x = fs.readFileSync(p, 'utf8');
for (const perm of ['RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'ACCESS_NETWORK_STATE']) {
  const tag = '<uses-permission android:name="android.permission.' + perm + '" />';
  if (!x.includes('android.permission.' + perm)) x = x.replace('<application', tag + '\n    <application');
}
fs.writeFileSync(p, x);
console.log('Manifest patched');
