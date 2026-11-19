# Whassabi Android test APKs

[Download the latest Whassabi APK — room startup, stage updates and headset removal](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-room-recovery.apk)

Install over the previous APK; the signing certificate and application ID are unchanged. The yellow/purple Whassabi logo remains included.

This build corrects blocked initial capture and competing Bluetooth routing on Android 12+. Capture can start while the hardware route settles, and confirmed headset routes replace provisional capture. A disconnected classic headset is excluded from a stale device list; automatic phone output selects the loudspeaker and recovers after WebView resets communication mode. Failed automatic headset acquisition falls back to usable capture, retaining a working bootstrap microphone until a late replacement succeeds. Permission errors stay explicit; automatic gain remains disabled.

Stage acceptance and demotion update the room view immediately while Android audio work is pending. Demotion stops microphone capture immediately. Host removal continues to prevent re-entry and hide that room for its lifetime; both participants now receive clearer explanations of this behavior.

Source: [PR #16](https://github.com/wildb-sketch/patchwire-mvp/pull/16), merged as `5d51ee9a6186a43be476726e944715d41475ff88` from reviewed head `bf556baf964fdca0a3719f27712e762ae5c82393`. [GitHub checks](https://github.com/wildb-sketch/patchwire-mvp/actions/runs/44592780362) passed: Android assembly/lint, 32 native tests, 144 Node checks, 5 Worker runtime tests and 10 browser/WebRTC tests. Browser tests verify stage changes in both designs while Android startup is deliberately unresolved, actual RTP after capture replacement, and retained host-removal restrictions.

Physical Bluetooth behavior on Samsung Note 10+ / Android 12 still needs a device check. Verify playback and received speech when connecting earbuds during a room and when disconnecting back to the loudspeaker and phone mic. **Broadcast & Audio Hardware** reports actual recording input separately from selected output. [Detailed voice testing notes](https://github.com/wildb-sketch/patchwire-mvp/blob/main/mobile/ANDROID-VOICE-TESTING.md).

Earlier APKs: [previous Android 12 attempt](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-android12-headset.apk) · [previous Bluetooth attempt](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-bluetooth-fix.apk) · [chat tools](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-chat-tools.apk) · [notification fix](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-notifications-fix.apk) · [push preview](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-push-debug.apk).

Only public test APKs and download information are included. SHA256SUMS lists the file checksums.
