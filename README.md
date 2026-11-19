# Whassabi Android test APKs

[Download the latest Whassabi APK — loudspeaker startup fix](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-speaker-startup.apk)

Install over the previous APK. Application ID, signing certificate, logo, stage updates and room-removal policy are unchanged.

The initial loudspeaker request could be accepted but overridden by WebView startup, leaving output on the call earpiece until the old timeout triggered another request. This update clears and reapplies pending phone/wired preferences at bounded 250 ms intervals, without restarting microphone capture or extending the deadline. Output is also refreshed when microphone capture or received playback actually starts, including listeners whose microphone stays closed. It does not repeatedly reset Bluetooth handshakes. Modern phone/wired requests and fallback have two-second deadlines; Bluetooth has five seconds before phone fallback. Android 5.1–11 legacy SCO timing is unchanged.

Recovering the requested loudspeaker no longer raises a headset error. Genuine failures identify the source route; older APK events use generic output wording. **Broadcast & Audio Hardware** now distinguishes **Phone loudspeaker** from **Phone call earpiece**.

Source: [PR #17](https://github.com/wildb-sketch/patchwire-mvp/pull/17), merged as `a06fe49be017b3a1ea165cdeed6f1d2f584015e7` from reviewed head `9fef7df141a10a3e04c1aabf344bee822eafdcde`. [GitHub checks](https://github.com/wildb-sketch/patchwire-mvp/actions/runs/44620237295) passed: Android assembly/lint, 38 native tests, 150 Node checks, 5 Worker runtime tests and 10 browser/WebRTC tests. The new speaker-startup regression fails against the prior routing algorithm and passes with this fix.

Physical validation remains necessary on Samsung Note 10+ / Android 12. With earbuds disconnected and another participant already speaking, join the room and verify loudspeaker playback starts promptly without waiting for an error. Repeat joining, stage acceptance, headset connect/disconnect and manually muted capture. Automated tests do not establish physical playback latency. [Detailed voice testing notes](https://github.com/wildb-sketch/patchwire-mvp/blob/main/mobile/ANDROID-VOICE-TESTING.md).

Earlier APKs: [room recovery](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-room-recovery.apk) · [previous Android 12 attempt](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-android12-headset.apk) · [previous Bluetooth attempt](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-bluetooth-fix.apk) · [chat tools](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-chat-tools.apk) · [notification fix](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-notifications-fix.apk) · [push preview](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-push-debug.apk).

Only public test APKs and download information are included. SHA256SUMS lists the file checksums.
