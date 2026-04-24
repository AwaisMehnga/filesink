# PeerWire - Direct WebRTC File Transfer

A React-based P2P file transfer application using WebRTC. Transfer files directly between devices on the same network or over the internet with automatic LAN detection and shareable links.

## Features

✨ **Shareable Links** - Generate links for quick same-network sharing (auto-discovers local server)  
🔐 **Peer-to-Peer** - Direct WebRTC connection, no central file storage  
🚀 **High Speed** - LAN transfers use direct local IP, internet uses STUN/TURN  
📁 **Multi-file** - Drag-drop multiple files with progress tracking  
🎯 **Manual Code Exchange** - Fallback to base64-encoded offer/answer codes  
🛡️ **Optional TURN** - Configure TURN servers for symmetric NAT/CGN scenarios  

## Quick Start

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Run with Signaling Server (LAN Links)

**Terminal 1 - Start Signaling Server:**
```bash
pnpm run server
```
Server runs on `http://localhost:3000`

**Terminal 2 - Start Frontend Dev Server:**
```bash
pnpm run dev
```
Frontend runs on `http://localhost:5173`

Visit both devices on the same network:
- Device 1: `http://<device1-ip>:5173`
- Device 2: `http://<device2-ip>:5173`

Then click **"Generate shareable link"** on one device and share with the other.

### 3. Run Without Server (Manual Code Exchange)

If the server is not running, the app falls back to manual mode:

```bash
pnpm run dev
```

- Click **"Create offer code"** on one device
- Copy the code and paste on the other device
- Complete the connection with the answer code

## Build for Production

```bash
pnpm run build
```

Output in `dist/` directory (220 KB gzipped JS + 6 KB gzipped CSS).

## Deployment

### Option 1: LAN Only (No Server)
Best for private networks with direct device access.

```bash
# Build frontend
pnpm run build

# Deploy dist/ folder to any static host (Netlify, Vercel, GitHub Pages, etc.)
# App will use manual code exchange (no server needed)
```

### Option 2: LAN + Internet (Recommended)
Works great for both same-network and internet transfers.

```bash
# Build and deploy frontend to Cloudflare Pages
pnpm run build
pnpm run deploy:cf

# Deploy signaling server to Cloudflare Worker
pnpm run deploy:worker
```

**How it works:**
- **LAN:** Auto-detects local server on `localhost:3000` if running
- **Internet:** Uses Cloudflare Worker for signaling
- **Fallback:** Manual code exchange always available

### Option 3: Production Only (No Local Server)
Simplest setup, all traffic through internet.

```bash
pnpm run build
pnpm run deploy:cf
```

App automatically uses Cloudflare Worker. No local server needed.

### Local Development (All Modes)

```bash
# Terminal 1: Local signaling server (optional, enables LAN links)
pnpm run server

# Terminal 2: Frontend dev server
pnpm run dev

# Visit http://localhost:5173
# On same network: http://<your-ip>:5173
```

## How It Works

### LAN Mode (Shareable Links)
1. Device A clicks "Generate shareable link"
2. App creates WebRTC offer, sends to local server
3. Server generates link like `http://192.168.1.100:3000?offer=<uuid>`
4. Device A displays link for copying
5. Device B opens link, server returns offer
6. Device B creates answer, sends to server
7. Device A polls server, receives answer
8. Direct P2P connection established ✓

### Manual Mode (Code Exchange)
1. Device A creates offer → copies base64 code
2. Device B pastes code → creates answer → copies code
3. Device A pastes answer → connection complete

### Internet Mode
- Uses STUN servers by default (Google public STUN)
- Optional: Add TURN server for NAT traversal
- TURN configuration panel in app settings

## Server API

The signaling server provides REST endpoints for link-based connections.

**Available on:**
- **Local:** `http://localhost:3000` (Express server via `pnpm run server`)
- **Cloud:** `https://<worker-subdomain>.workers.dev` (Cloudflare Worker)

```bash
POST /api/offer
  Request:  { offer: RTCSessionDescription }
  Response: { offerId: uuid, link: string, serverUrl: string }

GET /api/offer/:offerId
  Response: { offer: RTCSessionDescription }

POST /api/answer/:offerId
  Request:  { answer: RTCSessionDescription }
  Response: { success: true, offerId: uuid }

GET /api/answer/:offerId
  Response: { answer: RTCSessionDescription } or { status: 'waiting' }

GET /health
  Response: { status: 'ok' }
```

**Server Features:**
- Auto-generates UUIDs for offer sessions
- 5-minute expiration for offers (cleanup every 30 seconds)
- CORS enabled for cross-origin requests
- Zero external dependencies (except Express/Cloudflare runtime)

## Architecture

```
Device A (Sender)              Signaling Server            Device B (Receiver)
   │                                  │                            │
   ├─ createOffer() ─────────────────>│                            │
   │   POST /api/offer               │                            │
   │  (gets link)                     │                            │
   │                                  │<───── Share Link ────────  │
   │                                  │                            │
   │                                  │<─ GET /api/offer ─────────┤
   │                                  │  (opens link)             │
   │  (polling)                       │                            │
   │ GET /api/answer/:offerId ───────>│                           │
   │                                  │<─ POST /api/answer ──────┤
   │<────────── answer ───────────────┤  (createAnswer)           │
   │                                  │                            │
   └──────── P2P Connection ──────────────────────────────────────┘
             (Direct WebRTC)
```

## Configuration

### TURN Servers
For internet transfers across restrictive NATs:
1. Enable "TURN" toggle in app
2. Enter TURN server URL: `turn:turnserver.example.com`
3. Add username and credential if required

### Server Port
Change default port (3000) with environment variable:
```bash
PORT=8080 pnpm run server
```

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 15+
- Mobile Safari (iOS 15+)

**Note:** WebRTC requires HTTPS in production or localhost in development.

## Development

### Project Structure
```
src/
  App.jsx          - Main React component with all WebRTC logic
  index.css        - Global styles (TailwindCSS)
  main.jsx         - Entry point
server.js          - Express signaling server (Node.js, local only)
worker.js          - Cloudflare Worker (serverless, production)
package.json       - Dependencies and scripts
wrangler.toml      - Cloudflare configuration
```

### Server Implementations

**Express Server** (`server.js`)
- Local development and LAN transfers
- Runs on `localhost:3000` (default)
- Full Node.js environment
- Start with: `pnpm run server`

**Cloudflare Worker** (`worker.js`)
- Production deployment
- Serverless, globally distributed
- No cold starts, instant scaling
- Deploy with: `pnpm run deploy:worker`

Both servers implement the same API, so the frontend works with either one.

### Tech Stack
- **Frontend:** React 19, Vite 8, TailwindCSS 4
- **Local Server:** Express 4, CORS, Node.js
- **Cloud Server:** Cloudflare Worker, Cloudflare Pages
- **WebRTC:** Native RTCPeerConnection, RTCDataChannel
- **Icons:** Lucide React
- **Deployment:** Wrangler CLI

### Running in Development

```bash
# Terminal 1: Server
pnpm run server

# Terminal 2: Frontend with HMR
pnpm run dev

# Open http://localhost:5173
```

## Troubleshooting

### "Local server not available"
- Ensure `pnpm run server` is running on port 3000
- Check firewall allows localhost connections
- Fall back to manual code mode if server unavailable

### "ICE failed" error
- Same network: Usually works with default STUN
- Across internet: Add TURN server in settings
- Check network connectivity between devices

### Link expires after 5 minutes
- Offers are automatically cleaned up after 5 minutes
- Generate a new link if connection takes too long

## License

MIT

