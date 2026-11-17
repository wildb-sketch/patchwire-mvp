# Cloudflare Realtime TURN for Whassabi

TURN relays WebRTC media when direct peer connections are blocked. This integration keeps the current rooms, signaling, microphone ownership, Android service, and UI. Existing APKs load the updated web client remotely, so no APK rebuild is required.

## Account setup

1. Open the Cloudflare dashboard in the account hosting the `patchwire` Worker. Open **Realtime → TURN Server** and create a TURN key named `whassabi`. The dashboard may call its identifier **TURN Token ID** or **Key ID**. Follow any account activation prompts shown there.
2. Keep the key's ID and API token private. This token belongs to Realtime TURN; it is different from the GitHub Actions token used to deploy Workers. Do not use a Global API Key or generated temporary relay password.
3. Open **Workers & Pages → patchwire → Settings → Variables and Secrets → Add**. Add both values with type **Secret**:

   | Worker secret | Value |
   | --- | --- |
   | `TURN_KEY_ID` | The Realtime TURN key/token ID |
   | `TURN_KEY_API_TOKEN` | The API token associated with that TURN key |

4. Select **Deploy** to activate both secrets together. Do not put these values in the repository, GitHub Actions secrets, the mobile app, or chat.
5. Once the matching code is deployed, reopen the app and rejoin a room to fetch the new configuration.

Official references: [Create TURN keys and temporary credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/).

The CLI alternative, from `cloudflare/`, is `npx wrangler secret put TURN_KEY_ID` followed by `npx wrangler secret put TURN_KEY_API_TOKEN`. Enter each value at its private prompt. Each command deploys a version; relay configuration is incomplete until both are present.

## Behavior

The authenticated `/api/ice` endpoint calls Cloudflare's fixed credential-generation URL with a server-only bearer token. Clients receive only temporary ICE server URLs, usernames, and passwords. The endpoint is limited to 30 requests/minute per authenticated user and returns `Cache-Control: no-store`. Concurrent provider requests for the same user are coalesced. Credentials are reused server-side for ten minutes per user, have a 24-hour lifetime, and are held only in a bounded memory cache. Failed generation backs off for five seconds and returns a sanitized retryable 503; provider response bodies and API tokens are not forwarded or logged.

Both clients reuse successful ICE responses for at most one minute. New offers, incoming offers, and ICE restarts refresh settings before gathering candidates, so a long-open app does not use its startup credentials forever. Existing connection recovery also refreshes credentials if an allocation fails or expires. Cloudflare disconnects allocations after credential expiry; 24-hour credentials are not a promise of uninterrupted calls beyond that duration. No periodic timer restarts healthy room connections.

Provider-supplied UDP, TCP, and TLS routes are retained, including TLS on port 443. Browser-blocked port 53 URLs are omitted. TURN is available as fallback; the app does not force every normal call through a relay.

If neither Cloudflare secret is present, the previous `TURN_URL`, `TURN_USER`, and `TURN_PASS` static-provider configuration remains supported. With no provider configured, existing STUN/direct connections work. If either Cloudflare secret is present, Cloudflare takes precedence and both are required; partial settings do not silently fall back to a different provider. The Node server uses the same helper and environment names.

## Verification

`GET /healthz` exposes no credentials and returns:

- `X-Voice-Relay: configured`, `incomplete`, or `missing`.
- `X-Voice-Relay-Provider: cloudflare`, `static`, or `none`.

For Cloudflare, expect `configured` and `cloudflare`. These headers report configuration presence, not credential validity or actual media connectivity. Use a fresh request (for example, a unique query parameter) to avoid an intermediary's cached health response.

A signed-in `/api/ice` request should return 200 with temporary TURN credentials and `no-store`; unauthenticated requests return 401. Do not share its response, since it includes usable relay credentials. Incorrect/revoked API tokens, malformed provider responses, network failures, and incomplete configuration return a sanitized 503. Direct-path calls may still work when a relay is unavailable.

Actual relay verification must use two real WebRTC peers with `iceTransportPolicy: 'relay'`, confirm a selected relay candidate pair and increasing received RTP packets, and verify audio. Test UDP and then TLS/TCP fallback separately where possible. A successful STUN lookup or ordinary direct call does not prove TURN. This forced policy belongs in a diagnostic test, not the app's normal room configuration.

The **Build Android APK** workflow has an optional manual **verify_turn** input. Enable it to run `scripts/verify-turn.cjs` on a GitHub-hosted runner. It creates one clearly named diagnostic account on the live Worker, fetches temporary credentials, and verifies two synthetic audio streams through relay-only peers, including a separate TLS/443-only check. It confirms selected relay candidates, increasing received audio RTP packets. This verifies relay transport; audible speech and Android capture still require a device check. It never joins a user's room, never prints credentials, and logs its session out afterward; the diagnostic account remains registered. This check is opt-in because it uses the live service. A runner behind an HTTP-only proxy may be unable to carry TURN even when the HTTPS credential endpoint works.

Retryable 503 responses include a non-secret diagnostic `code`: `TURN_AUTH` (provider HTTP 401/403), `TURN_KEY` (404), `TURN_RATE_LIMIT` (429), `TURN_UPSTREAM` (other provider HTTP errors), `TURN_TIMEOUT`, `TURN_NETWORK`, `TURN_RESPONSE` (unusable credential response), or `TURN_CONFIG`. Provider HTTP failures include only their numeric `upstreamStatus`; their body and the server API token are never returned. The normal client still displays its existing voice recovery UI. After saving secrets, an active Durable Object may retain its previous configuration for up to five minutes under Cloudflare's default deferred update policy.

Run `npm test` and `npm run test:webrtc` from the repository root, and `npx wrangler deploy --dry-run` from `cloudflare/`. After `npm ci --prefix cloudflare`, run `npm run test:worker` to execute the credential helper in the actual Workers runtime against a local mock provider. This catches Workers-specific fetch behavior: `redirect: 'error'` is unsupported; `manual` rejects redirects without forwarding the API token. CI and deployment use Node 22 with the project's Wrangler version. Automated tests cannot validate a real Cloudflare account's keys or network path before setup is complete.
