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

The frontend can be deployed to Cloudflare Pages while signaling still runs locally on the sending device.

```bash
npm run build
npm run deploy
```

This uses `wrangler.toml` and publishes the `dist` folder to Pages.

Important:

- The website can be hosted on Pages.
- The signaling server must still be running locally on the sender with `npm run server`.
- The generated link includes the sender's LAN signaling address so another device on the same network can connect.

## Notes

- This app is LAN-only.
- Both devices must be on the same network.
- Cross-network and internet relay support were intentionally removed.
