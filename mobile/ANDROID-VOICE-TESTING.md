# Android voice room reliability

## Diagnosis

The tracked Android project is a source overlay: `prepare-android` generates the actual manifest and Gradle project (the generated `mobile/android/` is ignored). Both `public/index.html` and `public/neon.html` are remotely served web clients; `mobile/www/index.html` is only the server launcher. Capacitor loads the Worker URL from `capacitor.config.json`.

The frontend called `window.RoomPlugin`, which is not the registered Capacitor plugin API. Errors were swallowed, so no foreground service or notification started. The service itself had no wake lock, notification permission request, or callback to the WebRTC client. Its Mute changed only notification state, and Leave stopped only the service. It was sticky even though it cannot restore a WebView's peer connections after process death. Mic capture also raced on repeated room updates; errors were all mislabeled as browser permission failures. Every WebSocket close stopped microphone tracks and the service immediately.

The standalone registered `RoomPlugin` now uses Capacitor's injected `nativePromise` / `addListener` API, including on remote pages. Room start waits for native confirmation that `startForeground` succeeded. Listeners use `mediaPlayback`; microphone mode requires `RECORD_AUDIO` and a visible activity when first enabled, as required by Android 14. Accepting a stage invite or requesting to speak prepares microphone eligibility while visible. Notification permission on Android 13+ is separate; denied or disabled notifications are reported without blocking voice. CPU and Wi-Fi locks are held only for the active service lifetime. Capacitor 6 defaults to keeping the WebView running; its existing WebChromeClient handles origin-level capture after the runtime permission is granted. No replacement WebChromeClient or blanket permission grant is installed.

Capture is serialized, stale capture results are stopped, and permission failure leaves the speaker muted with an explicit Unmute retry. Both designs keep their current UI. Notification mute changes the actual track, signaling state, and notification; listener notifications omit microphone controls. Notification Leave immediately leaves: the server atomically hands a host room to the first current co-host, or ends the room if none exists. This also works when the membership changed during a disconnect. The in-app host handover confirmation remains unchanged. Brief signaling disconnects preserve audio and mute state; reconnect resynchronizes membership and peers. A heartbeat detects stale signaling connections. Process death, task dismissal, page navigation, or a real room exit releases the service; a killed transport is never represented as an active call.

## Install and deploy together

This fix spans the APK **and remotely hosted frontend / signaling code**. Installing only a new APK against the old deployed pages will still run the old broken JavaScript. Deploy this branch's `public/` and `cloudflare/src/worker.js` to the test Worker, then install the APK from the same revision. A refreshed page is required; the existing service worker is network-first. Production deployment is not part of this change.

The debug signing key should match the installed app when updating. Otherwise uninstall first (which also resets Android permissions). A self-hosted Node deployment uses the updated `server.js`.

## Automated checks

From repository root: `npm ci && npm test`. Tests execute both clients' room bridge/capture code with mocked Android and media devices, and exercise real Node WebSocket signaling. They cover concurrent capture, stale capture after leave/demotion, permission failure and retry, notification controls, listener-only mode, missing saved devices, web browser fallback, service failure, repeatable manifest generation, heartbeat, muted seat recovery, host handover, and room end. They do not emulate Android power management or actual audio.

From `mobile/`: `npm ci && npm run prepare-android && npm run apk`. Requires JDK 17 and Android SDK 34. `cd android && ./gradlew lintDebug` checks native integration. The preparation script can be rerun and does not hide Capacitor failures. GitHub Actions runs regression tests and builds an APK on relevant PRs, main changes, and manual dispatch.

Validation in the development environment: 38 tests passed; JDK 17 / SDK 34 `assembleDebug` and `lintDebug` passed (0 lint errors, 22 warnings, including generated template/resource warnings and the intentionally service-scoped wake lock). Cloudflare `wrangler deploy --dry-run` passed without deploying. Physical microphone transmission, Android permission dialogs, and lock-screen notification actions remain unverified on hardware.

## Real-device acceptance (two participants)

Use Android 13 and 14+ if available, including the original affected phone. Record Android version, manufacturer, and Android System WebView version. Test both designs with the same build and web revision.

1. Clean install: join as listener without granting microphone. Verify persistent "Listening" notification and received audio. Request to speak, allow microphone, and verify the other participant hears you. Repeat with microphone denied, then granted through app settings and Unmute. Try a stale hardware selection or a disconnected headset.
2. Host or speak, lock the screen for at least 10 minutes (beyond the original 30–40 seconds), and have the remote participant verify continuous **received speech**, not merely an illuminated mic icon. Repeat while using another app, on Wi-Fi and mobile data, with Battery Saver, and after 30 minutes idle.
3. While locked, tap notification Mute: remote speech must stop, the button must become Unmute, and room state must show muted. Tap Unmute and verify speech resumes without opening the app. Open the app and verify UI state agrees. Repeat mute/unmute in-app while checking the notification.
4. While locked, tap Leave as listener, co-host, sole host, host with a co-host, and host with listeners only. Verify tracks stop, remote membership updates, the service/notification disappears, host handover/end follows the policy above, and reopening does not silently rejoin.
5. Deny notification permission, or disable just the Live room channel. Verify a clear message, no claim that the microphone is denied, and continued room audio. Re-enable in Android app settings and rejoin to check controls.
6. Interrupt Wi-Fi, switch Wi-Fi/mobile data, and reconnect within 45 seconds. Verify mute state is retained, the seat is recovered, and peers hear each other. Stay disconnected past the server grace period, reconnect, and verify the expired seat/service is cleaned up. Leave during disconnection and verify no automatic room resurrection.
7. Accept/demote speakers, switch microphone, leave while the permission dialog is open, end a room remotely, receive a phone call, dismiss the task, and force-stop the app. Verify no unintended unmute, leaked mic indicator, lock, or phantom service. A phone call taking audio focus mutes the room; explicitly Unmute afterward.
8. Smoke-test chat, DMs/voice messages, room creation/settings, stage invites, minimization/back gesture, and both UI designs.

Useful connected-device checks: `adb shell dumpsys activity services com.patchwire.app`, `adb shell dumpsys notification`, `adb shell dumpsys power`, and `adb logcat` for foreground-service security exceptions or capture errors. Android may hide notification actions on a secure lock screen until authentication; OEM battery policies and deep Doze behavior require physical testing. WebRTC remains peer-to-peer and requires an existing TURN configuration on networks that block direct audio; a microphone permission fix cannot repair a blocked ICE path.

## Swipe-away cleanup

The recording exposed two separate issues: each remaining peer locally raised a generic network/TURN error when the dismissed participant's audio link failed, and the native service tried to leave through a JavaScript listener in a WebView that Android could already be destroying.

Task dismissal and Activity destruction now ask the existing service to send an authenticated HTTPS leave request directly. It waits at most seven seconds before stopping, holds credentials only in memory, does not follow redirects, and only accepts the current WebView's HTTPS origin. Normal Home/app switching and screen locking do not invoke this dismissal path. Every room join/reconnect issues a private leave token; the server rejects stale leases so a delayed old request cannot remove a rapidly reopened session. Explicit in-app Leave still follows the existing host confirmation flow. Both backends have equivalent cleanup endpoints and cancel the departed seat's grace timer.

If Android force-kills the process without any lifecycle callback, or the phone is offline, immediate network cleanup cannot be guaranteed: the normal 45-second disconnect grace remains the fallback. Other participants now see one message naming whose audio disconnected and saying it is waiting for reconnection, rather than suggesting their own network needs TURN. Removed peer connections cannot emit late warnings.

Repeat the original recording test: while another device watches the room, swipe the Android task away, verify prompt membership removal without the TURN warning, then rapidly reopen and confirm an old leave request cannot eject the new session. Recheck 10-minute locked-screen audio to ensure ordinary background operation is unchanged.

## Audio recovery during Wi-Fi/mobile handover

Chat uses the signaling WebSocket; voice uses independent WebRTC ICE transports. A healthy chat connection does not prove that the media path survived a network change. Previously, failed media only produced a toast, and a renegotiation offer destroyed the existing peer/sender. ICE configuration could also arrive after initial room offers had already started.

Both designs now share `public/room-audio.js`. It serializes SDP changes, uses polite/impolite collision handling, associates answers with their current offer, buffers early ICE candidates, ignores stale ICE generations, and retains the microphone/transceiver during renegotiation. Failed/disconnected media and unanswered initial offers trigger bounded ICE restarts with refreshed server configuration; signaling outages wait for the socket before consuming retries. A clickable retry toast and return-to-foreground recovery are available after exhaustion. Successful recovery clears watchdogs even on browsers that keep the connection state connected throughout a restart.

The Android plugin observes default-network changes without requesting additional dangerous permissions. Both native events and browser online/connection events replace a stale signaling socket and restart media. Resuming a room preserves peers and microphone/mute state. Initial ICE settings are loaded before opening signaling. Lock-screen foreground-service behavior and native dismissal cleanup are unchanged.

`npm test` runs 52 unit/integration checks. `npx playwright install --with-deps chromium && npm run test:webrtc` runs five real Chromium tests: packet flow after simultaneous ICE restarts, preserving mute, signaling outage recovery, peer reopening, and both complete app designs recovering while retaining microphone identity, room, chat, and mute. GitHub Actions runs both suites before APK assembly/lint. These tests exercise real WebRTC but cannot emulate a particular mobile carrier or Android OEM.

Repeat Wi-Fi → mobile → Wi-Fi handover with another participant checking actual received speech; repeat while locked and muted. Verify recovery without leaving the room, no accidental unmute, and chat continuing. A short interruption during handover is expected; permanent silent audio is not. Also repeat initial connection several times on each network and the 10-minute lock-screen/swipe-away checks.

`/healthz` includes a non-secret `X-Voice-Relay` header: `configured` means the server has a TURN URL, and `missing` means only STUN/direct paths are available. It does not prove that relay credentials work. ICE restart cannot make blocked peer-to-peer carrier paths work without a reachable TURN relay. Existing server settings remain `TURN_URL`, `TURN_USER`, and `TURN_PASS`; do not paste credentials into chat or commit them. Check the deployed header before claiming mobile-network coverage is complete.
