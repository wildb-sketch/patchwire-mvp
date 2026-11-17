# Whassabi Android test APKs

[Download the repeat-notification fix](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-notifications-fix.apk)

This update refreshes the conversation notification for every new event, shows a message count, and preserves notifications during background token checks. It includes the [PR #11](https://github.com/wildb-sketch/patchwire-mvp/pull/11) changes, with the same signing certificate used by the previous APK and deployed Android App Links association.

Android build, lint and notification sequence tests pass locally and on GitHub. Source deployment: `dabb172dbc96318c45476dae3e2fc923816e4dae`. Actual Google delivery and OEM behavior require phone testing.

Only test APKs and public download information are included. No private signing key or Firebase service-account credential is included.

[Push setup guide](https://github.com/wildb-sketch/patchwire-mvp/blob/main/mobile/PUSH-AND-LINKS.md).

[Previous push preview APK](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-push-debug.apk).
