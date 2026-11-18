# Chats, attachments and friend requests

In either design:

- Open a chat and tap **⋯** in the header to pin/unpin the chat, view pinned messages, clear its history or delete it from your inbox.
- Tap **⋯** beside a message to pin it or add it to favorites. Open **Inbox → Messages → Saved** to find favorites and pinned messages.
- Tap **+** beside the composer to send a file, up to 10 MiB. Tap the file card to save it. Android uses the system **Save as** picker; browsers use their download manager.

Chat pins, message pins and favorites belong only to your account and sync across its sessions. Up to 10 chats, 20 messages per chat and 500 saved messages may be pinned/saved. Clearing removes your history and its saved-message marks but keeps an empty chat. Deleting also removes the inbox entry and its chat pin. New messages reopen a deleted conversation. The other person's history is unchanged. The server and backups retain the shared messages for that person's copy; these controls are not account/data-erasure requests.

Attachments require an authenticated sender and follow the same blocking and friends-only rules as text messages. Only the sender and recipient can download a file, and clearing its history removes that account's download access. Files always download as attachments with `nosniff` and sandbox headers; uploaded HTML is never rendered as an application page. Filenames are escaped in the UI and sanitized for downloads. Limits are 10 uploads per minute and 100 MiB per sender per rolling day. Files are included in integrity-checked backups and recovery. Worker storage uses 256 KiB chunks so uploads larger than SQLite's per-row limit work. Local Node files live under `VOICE_DIR/files`.

New friend requests now send account-bound Android push events. Duplicate requests for the same pending relationship do not send another event. The notification opens the requester's profile with the current friend-request controls. Foreground requests use the existing compact notice and request badge. Push contains only typed destination/event/account-binding IDs, without names or message content.

Install the updated APK for friend-request notifications and Android file saving. Existing APKs continue to support rooms and direct-message notifications. The file picker uses no broad storage permission, and downloads never put account tokens into URLs or follow redirects to another host.

Reports are stored privately in the backend and reviewed at `/ops.html` with `OPS_TOKEN`. The dashboard shows the reported/reporter display names, account IDs, time, reason, details and review status. Reports are not emailed or sent to other app users.

Automated checks cover both designs, private state, same-millisecond arrivals after clearing, blocked/friends-only uploads, unauthenticated and unrelated-account downloads, large chunked files, backup recovery and Android notification intents. Physical Android checks still needed: receive a friend request while in another app, tap it and accept; send a file through Android's picker; save it to a chosen folder and cancel once. Confirm an active voice room continues during both pickers.
