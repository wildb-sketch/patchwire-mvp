// Patches the AndroidManifest.xml that Capacitor generates after `cap add android`.
// Run once: node scripts/patch-manifest.js   (also called by npm run prepare-android)
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
let x = fs.readFileSync(p, 'utf8');

// --- permissions ---
const perms = [
  'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'ACCESS_NETWORK_STATE',
  'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MICROPHONE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'WAKE_LOCK', 'ACCESS_WIFI_STATE',
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

// Paired headsets only: no discovery, scanning or location permission is needed.
for (const [perm, attributes] of [['BLUETOOTH', ' android:maxSdkVersion="30"'], ['BLUETOOTH_CONNECT', '']]) {
  x = x.replace(new RegExp('<uses-permission\\b[^>]*android:name="android\\.permission\\.' + perm + '"[^>]*/>', 'g'), '');
  x = x.replace('<application', `<uses-permission android:name="android.permission.${perm}"${attributes} />\n    <application`);
}


// network security config
if (!x.includes('android:networkSecurityConfig=')) x = x.replace(
  'android:label="@string/app_name"',
  'android:label="@string/app_name"\n        android:networkSecurityConfig="@xml/network_security_config"'
);

// Replace only our link filters so preparation stays repeatable on an existing Android tree.
x = x.replace(/<intent-filter\b[\s\S]*?<\/intent-filter>/g, filter => /patchwire\.whassabi\.workers\.dev|android:scheme="(?:patchwire|whassabi)"/.test(filter) ? '' : filter);
const deepLink = `
        <intent-filter>
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="patchwire" android:host="room" />
            <data android:scheme="whassabi" android:host="room" />
        </intent-filter>
        <intent-filter android:autoVerify="true">
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="https" android:host="patchwire.whassabi.workers.dev" />
            <data android:path="/" />
            <data android:path="/neon" />
            <data android:path="/index.html" />
            <data android:pathPrefix="/room/" />
        </intent-filter>`;
x = x.replace('</activity>', deepLink + '\n    </activity>');

// foreground service declaration
const service = `
    <service
        android:name="com.patchwire.app.RoomService"
        android:foregroundServiceType="microphone|mediaPlayback"
        android:exported="false" />`;
x = x.replace(/<service\b[^>]*android:name="com\.patchwire\.app\.RoomService"[^>]*\/>/g, '');
x = x.replace('</application>', service + '\n</application>');

// Push is distinct from the room foreground service; neither starts or mutes the other.
x = x.replace(/<service\b[^>]*android:name="com\.patchwire\.app\.WhassabiMessagingService"[\s\S]*?<\/service>/g, '');
x = x.replace(/<meta-data\b[^>]*android:name="firebase_messaging_auto_init_enabled"[^>]*\/>/g, '');
x = x.replace('</application>', `
    <service android:name="com.patchwire.app.WhassabiMessagingService" android:exported="false">
        <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>
    </service>
    <meta-data android:name="firebase_messaging_auto_init_enabled" android:value="false" />
</application>`);
if (!x.includes('android:fullBackupContent=')) x = x.replace('<application', '<application android:fullBackupContent="@xml/backup_rules" android:dataExtractionRules="@xml/data_extraction_rules"');

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

// Firebase resources and dependency belong to the generated project, never to manual local edits.
const appDir = path.join(__dirname, '..', 'android', 'app');
const services = path.join(__dirname, '..', '..', 'google-services.json');
if (fs.existsSync(services)) fs.copyFileSync(services, path.join(appDir, 'google-services.json'));
const gradlePath = path.join(appDir, 'build.gradle');
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  if (!gradle.includes('com.google.firebase:firebase-messaging:')) gradle = gradle.replace('dependencies {', "dependencies {\n    implementation 'com.google.firebase:firebase-messaging:24.1.2'");
  if (!gradle.includes('org.robolectric:robolectric:')) gradle = gradle.replace('dependencies {', "dependencies {\n    testImplementation 'org.robolectric:robolectric:4.13'");
  if (!gradle.includes('includeAndroidResources = true')) gradle += '\nandroid.testOptions.unitTests.includeAndroidResources = true\n';
  if (!gradle.includes('WHASSABI_DEBUG_KEYSTORE')) gradle += `
// A private, persistent test signing key enables verified links and repeatable APK updates.
if (System.getenv('WHASSABI_DEBUG_KEYSTORE')) {
    android.signingConfigs.debug.storeFile = file(System.getenv('WHASSABI_DEBUG_KEYSTORE'))
    android.signingConfigs.debug.storePassword = 'android'
    android.signingConfigs.debug.keyAlias = 'androiddebugkey'
    android.signingConfigs.debug.keyPassword = 'android'
}
`;
  fs.writeFileSync(gradlePath, gradle);
}
const testsSrc = path.join(__dirname, '..', 'android-src', 'app', 'src', 'test');
if (fs.existsSync(testsSrc)) fs.cpSync(testsSrc, path.join(appDir, 'src', 'test'), { recursive: true });
