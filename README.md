# Whassabi Android test APK

[Download the APK](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-push-debug.apk)

Android push and room-link test build for [PR #10](https://github.com/wildb-sketch/patchwire-mvp/pull/10), source deployment `2ffa3d888a81062f7234fe7a1a66db97cf2bb46b`. Its certificate matches the deployed Android App Links association.

Only the test APK and public download information are included. No private signing key or Firebase service-account credential is included.

[Push setup guide](https://github.com/wildb-sketch/patchwire-mvp/blob/main/mobile/PUSH-AND-LINKS.md). Live push delivery requires Firebase configuration and real-device testing.

A signature mismatch with an existing installation requires uninstall/reinstall, resetting local login and permissions. Backend accounts and messages remain.
