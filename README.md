# filesink

Minimal file transfer UI.

The app now supports same-origin signaling on Cloudflare Pages via `functions/api/[[route]].js`.
That means live deploys can generate links without setting `VITE_SIGNALING_URL`, as long as the Pages Functions bundle is deployed with the site.
For reliable public signaling across devices, bind a Cloudflare KV namespace as `SIGNALING_SESSIONS`.
Without that binding, production signaling falls back to in-memory storage and sessions can disappear between requests.

Create and bind the KV namespace before deploying:

```bash
wrangler kv namespace create SIGNALING_SESSIONS
wrangler kv namespace create SIGNALING_SESSIONS --preview
```

Then replace the placeholder IDs in `wrangler.toml` and `wrangler-worker.toml`, and redeploy.

## STUN setup

The app can use custom STUN servers for direct peer discovery.
If you want to use Twilio STUN instead of the default Google STUN servers, set `VITE_STUN_URLS` in your Vite environment.

Example:

```bash
VITE_SIGNALING_URL=https://filesink.pages.dev
VITE_STUN_URLS=stun:global.stun.twilio.com:3478
```

You can provide more than one STUN server as a comma-separated list:

```bash
VITE_STUN_URLS=stun:global.stun.twilio.com:3478,stun:stun.l.google.com:19302
```

Notes:

- STUN helps browsers discover public-facing ICE candidates.
- STUN does not relay file traffic.
- STUN alone still cannot guarantee cross-network connectivity through restrictive NATs or firewalls.

## TURN setup

Different networks often cannot establish a direct WebRTC path with STUN alone.
For reliable internet-to-internet transfers, add a TURN server and expose its credentials to the Vite build.

1. Copy `.env.example` to `.env`.
2. Fill in your TURN credentials.
3. Restart `npm run dev` for local testing, or set the same `VITE_` variables in your deployment environment before rebuilding.

Example:

```bash
VITE_SIGNALING_URL=https://filesink.pages.dev
VITE_STUN_URLS=stun:global.stun.twilio.com:3478
VITE_TURN_URL=turn:turn.example.com:3478
VITE_TURN_USERNAME=your-turn-username
VITE_TURN_CREDENTIAL=your-turn-password
```

If your provider supports TLS, prefer `turns:` on port `5349`:

```bash
VITE_TURN_URL=turns:turn.example.com:5349
VITE_TURN_USERNAME=your-turn-username
VITE_TURN_CREDENTIAL=your-turn-password
```

Notes:

- These values are read by the frontend at build time, so changing them requires a rebuild.
- TURN relays file traffic only when direct peer-to-peer ICE paths fail.
- Same-LAN transfers can still connect directly even with TURN configured.

## Scripts

```bash
npm install
npm run server
npm run dev
npm run build
npm run deploy
```
