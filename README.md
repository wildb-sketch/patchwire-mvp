# Whassabi Android test APKs

[Download the latest Whassabi APK — Bluetooth/headset fix](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-bluetooth-fix.apk)

Install over the previous APK. Allow **Nearby devices** if Android asks when you join or start voice. The signing certificate is unchanged.

This update manages the phone/headset communication route, waits for Bluetooth microphone readiness and switches the active microphone when headphones connect or disconnect. Room membership, existing WebRTC connections and the current user mute are retained. Wired/USB headsets and Android 12+ HFP/LE routing are covered. Chat controls, file sharing and friend-request push from the previous update remain included.

Source: [PR #14](https://github.com/wildb-sketch/patchwire-mvp/pull/14), merged as `673dd0366dc00bf8c7353dcc5e6e7bb775e90919`. This APK was built from the same reviewed source at `4bc6079514c7a221b0d126907e18a8386b74eb6d`. [GitHub checks](https://github.com/wildb-sketch/patchwire-mvp/actions/runs/44352699751) passed, including Android build/lint/native tests, Node/Worker checks and browser/WebRTC recovery tests.

Physical earbud firmware and Android audio drivers require a phone check. With another participant listening, test earbuds connected before app launch, connect/disconnect/reconnect during the room, and repeat while muted and screen-locked. Verify both playback and the earbud microphone. [Detailed voice testing notes](https://github.com/wildb-sketch/patchwire-mvp/blob/main/mobile/ANDROID-VOICE-TESTING.md).

Previous APKs: [chat tools](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-chat-tools.apk) · [notification fix](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-notifications-fix.apk) · [push preview](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-push-debug.apk).

Only public test APKs and download information are included. SHA256SUMS lists the file checksums.
