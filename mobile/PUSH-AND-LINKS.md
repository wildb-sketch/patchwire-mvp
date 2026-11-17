# Android push notifications and room links

The native Android app uses Firebase Cloud Messaging HTTP v1 for text/voice direct messages and explicit friend-to-room invitations. Browser/PWA push and friend-request notifications are outside this update. The web UI and the room foreground-service controls are preserved. The existing large in-app banners remain tracked in issue #9.

## Activate the Worker sender

The repository already contains the Android client configuration in `google-services.json` for Firebase project **patchwire-c4a0c**, package **com.patchwire.app**. This file identifies the client app; it cannot authorize the Worker to send messages. Do not replace it with a service-account key.

1. Open [Google Cloud IAM service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=patchwire-c4a0c) in project **patchwire-c4a0c**. Create a dedicated service account, for example `whassabi-push`.
2. Grant it **Firebase Cloud Messaging API Admin** (`roles/firebasecloudmessaging.admin`). The relevant permission is `cloudmessaging.messages.create`; see the [official role reference](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging#firebasecloudmessaging.admin).
3. Confirm the [Firebase Cloud Messaging API](https://console.cloud.google.com/apis/library/fcm.googleapis.com?project=patchwire-c4a0c) is enabled.
4. Open that service account → **Keys → Add key → Create new key → JSON**. Download it privately.
5. In Cloudflare → **Workers & Pages → patchwire → Settings → Variables and Secrets**, add a **Secret** named **FCM_SERVICE_ACCOUNT**. Paste the entire JSON file as its value, then save and deploy. `FCM_PROJECT_ID` is already set to `patchwire-c4a0c` in Wrangler configuration.

Do not paste the JSON in chat, commit it, or put it into a GitHub issue. Keep a private backup and delete the local download when no longer needed. The Worker exchanges its signed service-account assertion for a short-lived Google access token; it never sends this credential to the app. CLI alternative from `cloudflare`: `npx wrangler secret put FCM_SERVICE_ACCOUNT` (paste at the private prompt).

After deployment, `/healthz` returns `X-Push: configured` when the credential fields are present. An authenticated `GET /api/push/status` reports the same. This is a configuration check, not proof that Google accepts the key or that a phone receives a notification. Active Durable Objects can retain previous configuration for several minutes after deployment. Successful delivery still needs the device checks below.

## Keep Android signing stable for verified HTTPS links

Android verifies both the package name and APK signing certificate against `https://patchwire.whassabi.workers.dev/.well-known/assetlinks.json`. An ephemeral GitHub runner debug certificate changes on each build and cannot support repeatable APK updates or verified links.

The delivered local test APK uses a persistent test keystore. Its public certificate SHA-256 is:

```text
2D:6F:D1:A4:05:CF:B6:D7:8F:1C:51:0F:D5:E0:AC:3F:F2:C3:95:42:DF:65:7E:B5:E8:FA:AA:3E:E8:3A:32:67
```

This public fingerprint is configured in `cloudflare/wrangler.toml` as `ANDROID_APP_LINK_SHA256`; a reference Digital Asset Links document is under `android-src/well-known`. The Worker serves the actual document dynamically. Multiple public fingerprints can be comma-separated during a signing transition.

To make future GitHub APKs use the same identity:

1. Download the privately supplied `whassabi-android-debug-keystore.base64` file. It contains a **private signing key**: keep it out of the repository and do not share it with testers.
2. Open repository **Settings → Secrets and variables → Actions → New repository secret**.
3. Name it **ANDROID_DEBUG_KEYSTORE_BASE64** and paste the complete contents of that file as its value.
4. Run **Build Android APK**. Its artifact includes `app-debug.apk` and `app-link-fingerprint.txt`. The fingerprint should match the value above.

The workflow can still compile without the secret, but its fallback debug certificate will differ and the published HTTPS association will not verify that APK. The local supplied APK already matches. For a local build, set `WHASSABI_DEBUG_KEYSTORE` to the privately restored keystore path before running Gradle. The test key uses the standard Android debug alias/password; use a separate managed release key for any future store release.

If the installed APK has a different signature, Android will reject an in-place update. One uninstall/reinstall is then needed. This resets local login and permissions; backend accounts and messages remain. App-link verification can take time after installation; Android **Settings → Apps → Whassabi → Open by default** shows the verified domain and link preference.

## Behavior and privacy

- Register after login and Android notification permission; denial or missing Firebase configuration never blocks voice rooms. Permission changes are checked again when the app resumes.
- Notifications use a separate **Messages and invitations** channel at default importance. Every new event can alert, updates the timestamp and increments a visible count on the same conversation/room card. Dismissing a card does not suppress the next message. Duplicate deliveries do not alert again. Routine background token checks preserve existing notifications; actually opening the app clears social notifications and their counts. The room microphone foreground notification keeps its own channel and controls.
- The Worker dispatches even when a recipient has a live socket, because a background Android app can keep that socket connected. A visible Android activity suppresses the system push and retains the existing in-app experience.
- Push payloads contain typed destination IDs, an event ID and an account binding. They contain no message text, sender name or room title. The system notification uses generic text.
- Native storage holds only a scoped device refresh/revoke capability, not the account's full session token. Logout clears the account binding, cancels social notifications and revokes registrations for that login. Account changes reject delayed notifications from the previous binding. Invalid FCM tokens are pruned only on Google's explicit `UNREGISTERED` response.
- Canonical invites are `/room/ROOM_ID`; older `/#room=ROOM_ID`, `/neon#room=ROOM_ID`, `patchwire://room/ROOM_ID`, and `whassabi://room/ROOM_ID` remain supported. HTTPS has a browser fallback when the app is absent. Custom schemes require the installed Android app.
- A destination waits through login and the initial room list. Warm taps use the current WebView and existing room-switch/host confirmation. Cancel keeps the current room and microphone. Consumed destinations are not replayed. Room membership and privacy rules remain enforced by the server; an ended, full or restricted room cannot be entered just by having a link. Joining a different room starts as a listener.

## Validation and real-device checklist

Automated coverage includes device ownership, scoped token refresh/revocation, logout races, OAuth signing, safe FCM errors, account-bound payloads, authenticated invitations, room privacy, trusted link parsing, login/design redirects, native navigation deduplication and warm host confirmation with a live browser microphone. FCM request generation is also exercised in the actual Workers runtime against a mock Google endpoint. Android compilation, lint and pure-Java destination tests run in CI. These do not prove live Google/phone delivery.

After adding the private Worker credential and installing the matching APK, use two accounts/devices:

- Grant notifications; send text and voice DMs with the recipient foregrounded, in another app, and swiped away. Expect no duplicate system push while foregrounded and one generic notification per target in the background.
- Invite an accepted friend from a live room. Tap the notification and a copied HTTPS link with the recipient app closed, open, and signed out. Login should retain the room destination; an absent app should use the website.
- While hosting another room, tap an invite. Cancel must preserve voice and the current room. Confirming should use the existing handoff/end flow and enter the invited room as a listener.
- End a room or restrict access before opening its link. Expect the existing access/ended error, with no microphone activation.
- Deny notifications, then grant them in Android Settings and reopen. Messaging and rooms must work in both cases; background push should resume after granting.
- Log out and switch accounts with an old notification pending. It must not open a conversation for the wrong account or show delayed old-account notifications. Test token refresh when practical.
- Check lock-screen voice and the existing Mute/Unmute/Leave foreground controls while a DM arrives.
- Send three messages while the recipient stays in another app: the same notification card should show increasing counts. Dismiss it, send a fourth, and confirm a new card appears. Repeat with the app swiped away. Permission, channel, sound and battery settings remain controlled by Android.

The sender refreshes a rejected cached Google access token once and records final failures as sanitized `WhassabiPush delivery failed` status/HTTP-code entries in server logs. These logs omit tokens, account IDs, message contents and Google response bodies. Message events are sent without an FCM collapse key so queued events cannot overwrite each other before reaching Android. Native notification sequence tests run against Robolectric's Android notification manager, including dismissal, token rechecks, account changes and preservation of the voice notification; live Google/OEM behavior still needs the phone checks above.

Android **Force stop** in Settings prevents FCM delivery until the user opens the app again. Swiping the task away is different, though some manufacturer battery restrictions can also delay delivery. A real phone with Google Play services and permission granted is required for these checks. This update does not implement iOS/APNs or web push.
