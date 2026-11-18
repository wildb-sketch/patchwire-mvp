# Account, safety and recovery operations

The ordinary app keeps its existing room, microphone, messaging and native push flows. Both designs now use a compact bottom notice with one visible card, a two-item queue, duplicate suppression and a dismiss button. Notices are skipped while the page is hidden. New messages from the same peer update the existing notice. The notice moves above the minimized room controls.

Copied room links use the existing trusted Android handler or browser fallback. The browser tests cover canonical `/room/ID` redirects, sign-in, a fresh app document with a pending native destination, host switch confirmation and ended rooms. A text message containing a foreign site's room URL is not treated as a local room invitation.

## Password reset and email verification

Email delivery requires a verified sending domain. It is not active merely because the UI and API exist. Until configured, sign-ins and voice rooms continue working and the UI explains that email recovery is unavailable.

When a domain is available:

1. Verify the domain with [Resend](https://resend.com/docs/dashboard/domains/introduction).
2. Add Worker secret `RESEND_API_KEY` and variable `MAIL_FROM`, for example `Whassabi <hello@YOUR_DOMAIN>`.
3. Save and deploy. `PUBLIC_ORIGIN` is already set to the app's Worker URL in Wrangler.
4. Test **Log in → Forgot password?**, then **Profile → Privacy & Safety → Verify email address**.

The [Resend HTTP API](https://resend.com/docs/api-reference/emails/send-email) is called only from the backend. Credentials and provider response bodies are never returned to the client or logged. Existing accounts are not locked out for having an unverified address.

Reset requests use a generic response for both registered and unknown addresses. Links contain a random 256-bit token in the URL fragment, which is removed from the displayed URL when the dedicated account page loads. No GET request consumes a link. The user must explicitly save a new password or confirm verification. The backend stores only a SHA-256 token digest and its credential binding. Reset tokens expire after 30 minutes and verification tokens after 24 hours. A token cannot be reused, including concurrently. Password changes invalidate other pending links and revoke that account's sessions and push registrations. Resets use fresh password salts. New passwords contain 8–128 characters.

Account pages deliberately open in the browser: `/account.html` is outside the APK's room-link intent filters. Returning through **Open Whassabi** uses the existing app association. No new native APK is required for these account pages.

## Blocking, reports and room privacy

Profiles provide **Block**, **Report**, and, for the current host, **Remove from room**. Blocked people are managed under **Privacy & Safety**. Blocking is enforced in both directions for messages, invitations, following, friend requests, discovery and shared rooms. It removes existing friend/follow relationships; unblocking does not restore those relationships. Conversation history is retained so it can still be reviewed or reported.

If a host blocks a guest, the guest is removed. If a non-host blocks someone in the same room, the blocker leaves. The confirmation explains this before the action. Host removal prevents that person from rejoining the same room, including through copied links. Only the removed user receives the removal explanation. Other participants receive ordinary room state updates.

Followers-only rooms are filtered from unauthorized users' room catalogs as well as protected at join time. Friend/follow changes refresh those catalogs immediately. Blocking another participant also prevents joining a shared room or receiving an invitation into it. Report reasons/details are validated, repeated reports are deduplicated, and reports/actions have rate limits. Account attempts and email requests use bounded, persistent, hashed rate-limit keys. WebSocket signaling retains its separate generous limit for mesh negotiation. Logout closes that login's sockets; password reset closes all sockets for the account.

## Operator dashboard

1. Add Worker secret `OPS_TOKEN` using the privately supplied `whassabi-operations-secret.txt` file. It is separate from app sessions, Firebase credentials and Android signing.
2. Save and deploy.
3. Open `https://patchwire.whassabi.workers.dev/ops.html` and enter the token.

The token stays in tab memory, never in the URL or local storage. The dashboard exposes status, report review, manual snapshots and recovery checks. Report text is rendered as text, not HTML. Operator APIs require this separate token; normal account logins cannot access them. The dashboard has no button that applies a destructive restore.

## Private backups

The deployment workflow prepares a private R2 bucket named `patchwire-private-backups`. It disables its managed `r2.dev` domain and refuses to bind a bucket with public custom domains. The Cloudflare deployment token needs **Account → R2 Storage → Edit**, and R2 must be enabled on the account. If initial activation is unavailable, the other app changes can deploy, but health explicitly reports backups as missing and the monitor fails. A pre-existing backup binding is never silently removed when permissions become unavailable.

When provisioning succeeds, generated `cloudflare/wrangler.deploy.toml` binds `BACKUPS` and schedules a daily snapshot at **06:00 Türkiye time (03:00 UTC)**. A new object also starts a snapshot when none exists or the last one is over a day old. The latest 14 complete snapshots are retained. Cloudflare bucket pricing/limits apply; review the account's R2 usage as media grows.

The snapshot includes accounts, messages, friend/follow/block relationships, reports, feed history, profile photos, voice recordings, file attachments and private chat/saved-message preferences. It excludes sessions, push registrations, reset/verification tokens, rate counters, app secrets and live rooms. R2 is a private store with Cloudflare-managed encryption at rest. Snapshot objects are not exposed through the app.

SQLite staging copies provide a consistent view while media uploads proceed without holding a network lock on room requests. Every file has an explicit size and SHA-256 checksum; the manifest is written last. Failed uploads are not presented as recoverable snapshots. Recovery checks verify all metadata and media. Corruption, missing files, invalid relationships and path manipulation are rejected. Metadata is capped at 16 MiB and photo/voice media at 600 KB and file attachments at 10 MiB, consistent with upload limits. A snapshot that exceeds a limit fails visibly rather than silently omitting data. Retention failure preserves the newly committed snapshot and raises a health error.

Backups protect stored app data; they do not record or restore a live voice call. A restore logs out existing sessions and restores data to that snapshot's point in time. Changes made afterward will be replaced.

### Check recovery safely

Use the dashboard's **Check recovery**. This calls `POST /internal/ops/restore` with `{ "id": "SNAPSHOT_ID", "dryRun": true }` and does not modify live data. Omitting `dryRun` also defaults to a check.

Applying a Worker restore is an explicit operator action requiring `dryRun: false` plus `confirmation: "RESTORE SNAPSHOT_ID"`. The server stages and validates the entire snapshot before switching SQLite tables in a transaction. Do not apply a live restore as part of routine testing. Automated tests apply restores only to isolated temporary databases.

Cloudflare also provides [Durable Object point-in-time recovery](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#point-in-time-recovery-pitr-api), independent of the application snapshot format. R2 snapshots provide a separately stored recovery path.

### Node development server

The Node server writes its data file atomically and creates private daily filesystem snapshots under `BACKUP_DIR`, defaulting to `backups` beside `DATA_FILE`. It fails closed on unreadable/corrupt data, or a missing data file when snapshots already exist. Keep this directory on persistent storage. The repository ignores local backups.

Recover to a **new, empty directory**:

```sh
node scripts/restore-node.cjs BACKUP_DIRECTORY SNAPSHOT_ID NEW_OUTPUT_DIRECTORY
```

This validates and writes a new `data.json` and `voice` directory without overwriting a live server. After reviewing the output and stopping the old server, point `DATA_FILE` and `VOICE_DIR` at the recovered paths. Node and Worker password-hashing formats are different; recover each deployment's snapshots into the same backend type.

## Monitoring

The Worker persists bounded operation counters and sanitized service/status failure records, including relay failures and authenticated, rate-limited client audio recovery failures. Client reports contain a fixed event code, not peer identities or raw exception text. Logs exclude email addresses, account IDs, request URLs, session/reset tokens, message contents and provider bodies. [Invocation logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) are disabled because legacy WebSocket URLs contain session tokens. Explicit sanitized console events remain enabled.

`/healthz` checks backend availability and reports relay/push/mail configuration plus backup health. Configuration presence does not prove delivery to Google or an email inbox. The private operator dashboard shows recent operation failures and backup timestamps.

The **Monitor Whassabi** GitHub workflow runs every 30 minutes and can be run manually. It checks read-only health, relay/push configuration, backup freshness, shared-link redirects and anonymous account access rejection. It never creates users or sends test messages. Missing or overdue backups fail the job. Enable GitHub's failed-workflow notifications to receive alerts. Scheduled workflows can be delayed by GitHub and are not a continuous availability guarantee.

## Validation boundaries

Automated checks cover both designs, compact notice behavior, canonical links and sign-in, token expiry/replay/session revocation, report rendering, block/privacy enforcement, private bucket provisioning, metadata/media recovery, and real Worker SQLite/R2 round trips.

The eight-speaker Chromium test uses real WebRTC with synthetic microphones, verifies all 56 audio directions, rejects a ninth participant, and verifies fresh RTP after a muted peer reconnects and unmutes without replacing its microphone. This does not substitute for eight physical Android phones, carrier/Wi-Fi handovers, OEM battery behavior, or lock-screen testing. Native push and foreground room controls remain covered by the existing native tests and the user's prior real-device checks.
