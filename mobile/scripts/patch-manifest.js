// Patches the AndroidManifest.xml that Capacitor generates after `cap add android`.
// Run once: node scripts/patch-manifest.js   (also called by npm run prepare-android)
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
let x = fs.readFileSync(p, 'utf8');

// --- permissions ---
const perms = [
  'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'ACCESS_NETWORK_STATE',
  'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MICROPHONE',
  'POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED',
  'INTERNET', 'VIBRATE'
];
for (const perm of perms) {
  const tag = `<uses-permission android:name="android.permission.${perm}" />`;
  if (!x.includes(`android.permission.${perm}`)) x = x.replace('<application', tag + '\n    <application');
}

// microphone foreground service type
const micType = '<uses-feature android:name="android.hardware.microphone" android:required="false" />';
if (!x.includes('android.hardware.microphone')) x = x.replace('<application', micType + '\n    <application');

// network security config
x = x.replace(
  'android:label="@string/app_name"',
  'android:label="@string/app_name"\n        android:networkSecurityConfig="@xml/network_security_config"'
);

// deep link intent filter on MainActivity
const deepLink = `
        <intent-filter android:autoVerify="true">
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="patchwire" android:host="room" />
        </intent-filter>
        <intent-filter android:autoVerify="true">
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="https" android:host="patchwire.whassabi.workers.dev" android:pathPrefix="/neon" />
        </intent-filter>`;

if (!x.includes('patchwire.whassabi.workers.dev')) {
  x = x.replace('</activity>', deepLink + '\n    </activity>');
}

// foreground service declaration
const service = `
    <service
        android:name="com.patchwire.app.RoomService"
        android:foregroundServiceType="microphone"
        android:exported="false" />`;
if (!x.includes('RoomService')) x = x.replace('</application>', service + '\n</application>');

fs.writeFileSync(p, x);
console.log('AndroidManifest.xml patched');

// copy Java source files
const srcDir = path.join(__dirname, '..', 'android-src', 'app', 'src', 'main', 'java', 'com', 'patchwire', 'app');
const dstDir = path.join(__dirname, '..', 'android',    'app', 'src', 'main', 'java', 'com', 'patchwire', 'app');
if (fs.existsSync(srcDir)) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f));
    console.log('copied', f);
  }
}

// copy res files (xml, values)
const resSrc = path.join(__dirname, '..', 'android-src', 'app', 'src', 'main', 'res');
const resDst = path.join(__dirname, '..', 'android',    'app', 'src', 'main', 'res');
if (fs.existsSync(resSrc)) {
  for (const dir of fs.readdirSync(resSrc)) {
    const s = path.join(resSrc, dir), d = path.join(resDst, dir);
    fs.mkdirSync(d, { recursive: true });
    for (const f of fs.readdirSync(s)) {
      fs.copyFileSync(path.join(s, f), path.join(d, f));
      console.log('copied res', dir + '/' + f);
    }
  }
}
console.log('Done');
