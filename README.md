# Secure P2P Link (Minimal)

Minimal WebRTC app with one action:
- Host clicks Generate URL
- URL looks like: `http://localhost:5173/?offer=<session-id-and-key>`
- Peer opens URL
- Secure WebRTC connection is established between exactly two peers

## Why this is secure

- WebRTC data channel is DTLS encrypted end-to-end.
- Signaling session uses a high-entropy secret key.
- Only one peer can consume an offer (single-use session).
- Sessions expire automatically (5 minutes).
- Backend never stores user files, only temporary offer/answer metadata.

## Local development

1. Install dependencies:

```bash
pnpm install
```

2. Run signaling server:

```bash
pnpm run server
```

3. Run frontend:

```bash
pnpm run dev
```

## LAN vs internet

- App attempts LAN/local signaling first (`http://localhost:3000`).
- If LAN/local signaling is not available, it falls back to Cloudflare worker signaling.
- WebRTC still connects peers directly when possible.
- For stricter cross-network reliability, configure TURN:

```bash
VITE_TURN_URL=turn:your-turn.example.com:3478
VITE_TURN_USERNAME=your-username
VITE_TURN_CREDENTIAL=your-password
```

## Cloudflare deploy

Frontend (Pages):

```bash
pnpm run build
pnpm run deploy:cf
```

Signaling backend (Worker):

```bash
pnpm run deploy:worker
```

Or both:

```bash
pnpm run deploy:all
```
