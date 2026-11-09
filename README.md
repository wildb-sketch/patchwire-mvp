# Patchwire MVP

Live voice rooms app: accounts, discover and join live rooms, speak with host approval, in-room chat, 1:1 messages, invite links.

## Run it
```
npm install
npm start
```
Open http://localhost:3000. To test chat, open a second window in a private/incognito tab and sign up as another user.

## Staying in your room
If you refresh the page, lose your connection or use the phone's back gesture, the server keeps your seat (and your speaker role) for 45 seconds (`ROOM_GRACE_MS`) and puts you back in the room when you return. The back gesture closes the open screen first (the room screen minimises to the bar) and never leaves the room by itself. Use the Leave or End options to exit.

## Free HTTPS hosting on Cloudflare
The `cloudflare` folder runs the whole app on Cloudflare's free plan (a Worker plus a Durable Object), with a permanent `workers.dev` HTTPS address and a database that survives restarts. See `cloudflare/README.md`. The Node server in this folder is still the easiest way to develop on your own computer.

## Two designs
`/` is the green and black Patchwire design. `/neon` is the purple neon design (mascot hero, cloud backdrop, yellow headline, big lime Go Live button). Both use the same server, accounts, rooms and messages. Profile > "Try the Neon design" / "Switch to the green design" switches between them and remembers your choice (the installed app opens the one you picked last).

## On your phone
Open the tunnel address in Chrome and use Install app to add it to the home screen, or build the Android app from the `mobile` folder (GitHub Actions workflow included). Steps are in `mobile/README.md`.

## What's in the app
Discover (topic filters, featured live room, your circle, live list), Feed (rooms started by you, friends and people you follow), Go Live (title, topic, artwork, who can listen, microphone check), live rooms (stage, queue, audience, chat, reactions, mute state), Inbox (messages and friends), Profile (followers, following, broadcasts, privacy, audio hardware), search and an activity sheet from the header. Follow people from a room or a profile sheet. Followers-only rooms admit followers and friends of the host.

## Photos, voice messages, room settings
Profile photo: Profile > camera button > choose from device (cropped to a square and stored on the server, max about 150 KB). Voice messages: tap the mic in a chat to record up to 60 seconds, then send. Audio is stored as files in a `voice` folder next to `data.json` (set `VOICE_DIR` to change it), so keep that folder on the same persistent disk. Room options: tap the three dots in a room for Invite people, Room settings (host only) and Leave or End. Room settings reuses the Start live screen to change the title, description, topic, artwork and who can listen.

## Friends
Usernames are unique (your nickname, spaces ignored, so "Alex Waves" is @alexwaves). Inbox has two tabs: Chats and Friends. In Friends you search by username, send a request, and the other person accepts or denies. "Active now" lists online friends only. Anyone can message you by default. In Profile > Privacy you can switch to "Friends only". Request, accept and new-message toasts are clickable and open the right screen.

## Going on stage
A host's invitation does not put anyone on stage by itself. The listener gets a prompt (Accept and go on stage, or Not now) and only after accepting does the microphone turn on. A listener who raised a hand is accepted directly. With three or more speakers the stage becomes one grid of round photos and names (up to 8).

## Hosting rules
A host never loses the room by accident. Leaving as host asks you to hand the room to a co-host or end it for everyone. Starting or joining another room while hosting asks the same, and you can cancel. If a host's connection drops, a co-host takes over, or the room closes when only listeners are left.

## Voice rooms
Rooms tab: start a room (you become host and speaker) or join one as a listener. Listeners raise a hand, the host taps Invite or Accept to bring them on stage. Up to 8 people per room.
Voice runs peer-to-peer (WebRTC) and uses your browser microphone, which needs HTTPS or localhost. Rooms live in server memory and disappear on restart.
Some strict networks (corporate Wi-Fi, some mobile carriers) block peer-to-peer audio. For production add a TURN server (for example Twilio or Cloudflare) to the `ICE` list in `public/index.html`, or move to an SFU such as LiveKit for bigger rooms.

## Optional: translation and corrections
```
ANTHROPIC_API_KEY=your_key npm start
```
The server keeps a translation endpoint (`POST /api/ai`) for later; the current screens do not use it.

## Deploy (Render, about 10 minutes)
1. Put the folder on GitHub: `git init && git add . && git commit -m "patchwire"`, create an empty repo on github.com, then follow its "push an existing repository" commands.
2. On render.com choose New > Blueprint, pick the repo. `render.yaml` sets everything up, including a 1 GB disk so `data.json` survives restarts.
3. When asked, paste `ANTHROPIC_API_KEY` (optional, for translation). Leave the TURN fields empty for now.
4. Open the `https://...onrender.com` address Render gives you. HTTPS is required for the microphone and Render provides it.
Note: a disk needs a paid Render plan. On a free plan the data file is wiped on every restart, so accounts and messages disappear. Check current pricing on render.com.
Other hosts work too: the included `Dockerfile` runs on Fly.io, Railway and similar. Mount a volume at `/data`.

## Voice on strict networks (TURN)
If two people cannot hear each other on some networks, add a TURN server from a provider such as Cloudflare, Metered or Twilio. Set `TURN_URL` (comma-separated), `TURN_USER` and `TURN_PASS` as environment variables. No code change needed.

## Invite links
In a voice room tap Invite to copy a link like `https://yourapp/#room=1a2b3c4d`. Whoever opens it signs in (or signs up) and lands directly in the room. If the room has ended they see "That room has ended".

## Known MVP limits
JSON-file storage (swap for Postgres before real scale), single server instance, no email verification or password reset, no push notifications.
Voice rooms are not recorded and have no speaking indicator yet. Moments still shows sample content.
