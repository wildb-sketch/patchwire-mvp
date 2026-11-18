# Whassabi Android test APKs

[Download the latest Whassabi APK](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-chat-tools.apk)

This update adds Android friend-request notifications and authenticated file saving through the system picker. Both app designs also provide private clear/delete chat controls, inbox pins, message pins and favorites, and file sending up to 10 MiB.

Install over the previous version. The persistent signing certificate is unchanged. Source: [PR #13](https://github.com/wildb-sketch/patchwire-mvp/pull/13), merged as `8384d9d7b89146127511b35af5a052a16288fcb8`; APK built from the identical reviewed source at `2b76c74def00d28fcad6f93c4cdf1902afddab87`. [GitHub build and checks](https://github.com/wildb-sketch/patchwire-mvp/actions/runs/44334411821) passed, including Node/Worker/browser tests, Android compilation, lint and native notification/file tests. Actual phone delivery and Android document-provider behavior still require device checks.

[Chat controls and files](https://github.com/wildb-sketch/patchwire-mvp/blob/main/CHAT-TOOLS.md) · [Push setup](https://github.com/wildb-sketch/patchwire-mvp/blob/main/mobile/PUSH-AND-LINKS.md)

Previous APKs: [notification fix](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-notifications-fix.apk) · [push preview](https://github.com/wildb-sketch/patchwire-mvp/raw/refs/heads/android-test-download-20261117/whassabi-push-debug.apk).

Only public test APKs and download information are included. SHA256SUMS lists the file checksums.
