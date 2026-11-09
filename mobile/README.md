# Patchwire for Android

The Android app is a thin shell (Capacitor) around the Patchwire web app. It asks for your server address once, then opens it. The server (`npm start` in the main folder) must be reachable over **https**, because voice and the microphone need a secure address.

## 1. Get an https address for the server
Best: deploy `../cloudflare` (see its README) and use the permanent `https://patchwire.YOURNAME.workers.dev` address it prints. For a quick test you can instead use a tunnel, below.

### Quick test with a tunnel
```
npm start                                          # in the main folder
cloudflared tunnel --url http://localhost:3000     # in a second terminal
```
Copy the `https://....trycloudflare.com` address it prints (it changes every time you restart the tunnel).

## 2a. Quickest test: install it from the browser (no APK)
Open that address in Chrome on your Android phone, open the menu and choose **Install app** (or **Add to Home screen**). It then opens full screen like an app. On iPhone use Safari > Share > **Add to Home Screen**.

## 2b. Get a real APK without installing Android Studio (GitHub Actions)
1. Put the whole project folder on GitHub (see the main README).
2. On GitHub open **Actions > Build Android APK > Run workflow**. After a few minutes download the `patchwire-debug-apk` artifact and unzip it.
3. Send `app-debug.apk` to your phone, open it and allow "install unknown apps" when asked.
4. Open Patchwire, paste the server address from step 1 and tap Connect.

## 2c. Build the APK on your computer
Needs Node 20, JDK 17 and the Android SDK (Android Studio installs it).
```
cd mobile
npm install
npm run prepare-android
npm run apk
```
The file is `android/app/build/outputs/apk/debug/app-debug.apk`.

## Notes
- This is a debug build for testing, not a Play Store release.
- Microphone permissions are added by `scripts/patch-manifest.js`. Android asks for microphone access the first time you go on stage or record a voice message.
- To point the app at another server open Profile > **Change server**.
