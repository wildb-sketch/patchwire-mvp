# Patchwire on Cloudflare (free HTTPS address, always on)

This folder runs the whole app on Cloudflare's free plan: one Worker serves the website and a Durable Object runs the accounts, messages, voice-room signalling and live connections. Data is stored in the Durable Object's built-in SQLite database, so it survives restarts. You get an address like `https://patchwire.YOURNAME.workers.dev` with HTTPS (needed for the microphone).

Why a Worker and not Cloudflare Pages: Pages only serves static files and cannot host the live WebSocket server. A Worker with static assets gives the same free address from the same Cloudflare dashboard and can run everything.

## Deploy (about 5 minutes, from your Mac)
1. Make a free account at dash.cloudflare.com (no card needed for the free plan).
2. In Terminal:
```
cd ~/Downloads/patchwire-mvp/cloudflare
npm install
npx wrangler login
npx wrangler deploy
```
`login` opens your browser once. The first deploy may ask you to pick a `workers.dev` subdomain. When it finishes it prints your address.
3. Open the address on your phone. In Chrome choose Install app, or paste it into the Android app's launcher.

## Or deploy automatically from GitHub (no local tools)
The repo includes `.github/workflows/cloudflare.yml`. After you put the project on GitHub:
1. In the Cloudflare dashboard open My Profile > API Tokens > Create Token and use the "Edit Cloudflare Workers" template. Copy the token.
2. Copy your Account ID (shown on the Workers & Pages overview page).
3. In your GitHub repo open Settings > Secrets and variables > Actions and add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Open the Actions tab, choose "Deploy to Cloudflare" and press Run workflow. Every later push to `main` that changes `cloudflare/` or `public/` deploys again.
Keep the token only in GitHub secrets, never in chat, and delete it from Cloudflare if you stop using it.

## Update later
Run `npx wrangler deploy` again after changing anything in `public/` or `src/`.

## Optional settings
- Translation: `npx wrangler secret put ANTHROPIC_API_KEY`
- TURN for strict networks: uncomment the `TURN_*` lines in `wrangler.toml` and run `npx wrangler secret put TURN_PASS`
- Seat grace period: `ROOM_GRACE_MS` in `wrangler.toml` (default 45000)

## Try it on your computer first
```
npx wrangler dev
```
Opens a local copy at http://localhost:8787 with its own temporary database.

## Free plan limits (check Cloudflare's current pricing page)
- Durable Objects on the free plan: 100,000 requests per day, and incoming WebSocket messages count 20 to 1 toward that.
- An open WebSocket keeps the object running, and its running time counts toward a daily allowance. One always-on object fits, but heavy use can hit the limit. When a free limit is reached, requests fail until 00:00 UTC.
- 5 GB of storage.
- Everything runs in a single Durable Object. That is fine for testing and small groups. For many users you would split it up or move audio to a media server.
- Passwords use PBKDF2 here (the Node server uses scrypt), so accounts from the Node server's `data.json` do not carry over.
