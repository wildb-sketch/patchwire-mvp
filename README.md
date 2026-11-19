# Whassabi Android test APKs

[Download the latest Whassabi APK — Android 12 headset input and new logo](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-android12-headset.apk)

Install over the previous APK; the signing certificate and application ID are unchanged.

This update waits for Android 12/12L Bluetooth SCO call-audio confirmation before capture and selects the browser-exposed headset microphone when available. Automatic microphone gain control is disabled, retaining echo cancellation and noise suppression. The supplied yellow/purple Whassabi logo is included in launcher, round, adaptive and launch-screen resources.

**Broadcast & Audio Hardware** now reports the actual recording input separately from selected output. Bluetooth playback alone does not confirm the earbud microphone. Missing recording information stays unverified. Device diagnostics remain local.

Source: [PR #15](https://github.com/wildb-sketch/patchwire-mvp/pull/15), merged as `af6c877fae0bd9506680eb6f418c1703d8fba593` and built from reviewed head `5fc2656100c4cefa18bc69dff3b9070db9d45d3f`. [GitHub checks](https://github.com/wildb-sketch/patchwire-mvp/actions/runs/44509741901) passed, covering Android assembly, lint, 29 native tests, 130 Node checks, 5 Worker runtime tests and 9 browser/WebRTC tests.

Physical validation remains necessary on Samsung Note 10+ / Android 12: with another participant listening, connect earbuds before joining, then disconnect/reconnect during the room. Verify playback and actual received speech through the earbud mic; check **Active microphone** in the hardware panel. Repeat while muted and screen-locked. [Detailed voice testing notes](https://github.com/wildb-sketch/patchwire-mvp/blob/main/mobile/ANDROID-VOICE-TESTING.md).

Earlier APKs: [previous Bluetooth attempt](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-bluetooth-fix.apk) · [chat tools](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-chat-tools.apk) · [notification fix](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-notifications-fix.apk) · [push preview](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-push-debug.apk).

Only public test APKs and download information are included. SHA256SUMS lists the file checksums.
