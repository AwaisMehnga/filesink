# filesink

Minimal file transfer for devices on the same local network.

## How it works

- Start the local signaling server on the sending device.
- Generate a link in the app.
- Open that link from another device on the same Wi-Fi or LAN.
- Transfer files directly over WebRTC.

## Local setup

```bash
npm install
npm run server
npm run dev
```

The signaling server runs on `http://localhost:3000` and returns the host machine's LAN IP.
The shared link includes that LAN signaling address in the `sig` query param so another device on the same network can join.

## Cloudflare Pages

The frontend and signaling can both be deployed on Cloudflare Pages.

```bash
npm run build
npm run deploy
```

This uses `wrangler.toml`, publishes the `dist` folder, and serves signaling from `functions/api/[[route]].js`.

Before deploying, create a KV namespace for session storage:

```bash
wrangler kv namespace create SIGNALING_SESSIONS
wrangler kv namespace create SIGNALING_SESSIONS --preview
```

Then replace the placeholder IDs in `wrangler.toml`.

Important:

- `server.js` is still useful for local development.
- The deployed Pages app uses same-origin signaling instead of the local Node server.
- This app is still intended for devices on the same network.

## Notes

- This app is LAN-only.
- Both devices must be on the same network.
- Cross-network and internet relay support will be added soon.
