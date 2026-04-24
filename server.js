import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Store for pending offers: Map<offerId, { offer, createdAt }>
const pendingOffers = new Map();

// Store for completed answers: Map<offerId, answer>
const completedAnswers = new Map();

// Cleanup interval: remove offers older than 5 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutes
  
  for (const [offerId, data] of pendingOffers.entries()) {
    if (now - data.createdAt > maxAge) {
      pendingOffers.delete(offerId);
      completedAnswers.delete(offerId);
    }
  }
}, 30 * 1000); // Check every 30 seconds

// Get local IP address (prefer IPv4)
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    for (const alias of iface) {
      // Skip internal and non-IPv4 addresses
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address;
      }
    }
  }
  
  return 'localhost';
}

// POST /api/offer - Create a new offer link
app.post('/api/offer', (req, res) => {
  const { offer } = req.body;
  
  if (!offer) {
    return res.status(400).json({ error: 'Missing offer in request body' });
  }
  
  const offerId = uuidv4();
  pendingOffers.set(offerId, {
    offer,
    createdAt: Date.now()
  });
  
  const localIP = getLocalIP();
  const link = `http://${localIP}:${PORT}?offer=${offerId}`;
  
  res.json({
    offerId,
    link,
    localIP
  });
});

// GET /api/offer/:offerId - Retrieve an offer
app.get('/api/offer/:offerId', (req, res) => {
  const { offerId } = req.params;
  const data = pendingOffers.get(offerId);
  
  if (!data) {
    return res.status(404).json({ error: 'Offer not found or expired' });
  }
  
  res.json({ offer: data.offer });
});

// POST /api/answer/:offerId - Submit an answer for an offer
app.post('/api/answer/:offerId', (req, res) => {
  const { offerId } = req.params;
  const { answer } = req.body;
  
  if (!answer) {
    return res.status(400).json({ error: 'Missing answer in request body' });
  }
  
  if (!pendingOffers.has(offerId)) {
    return res.status(404).json({ error: 'Offer not found or expired' });
  }
  
  completedAnswers.set(offerId, answer);
  
  res.json({ success: true, offerId });
});

// GET /api/answer/:offerId - Retrieve the answer for an offer (polling)
app.get('/api/answer/:offerId', (req, res) => {
  const { offerId } = req.params;
  const answer = completedAnswers.get(offerId);
  
  if (!answer) {
    return res.status(202).json({ status: 'waiting', message: 'Answer not ready yet' });
  }
  
  res.json({ answer });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Basic endpoint info
app.get('/', (req, res) => {
  const localIP = getLocalIP();
  res.json({
    message: 'WebRTC Signaling Server',
    endpoints: {
      health: '/health',
      createOffer: 'POST /api/offer',
      getOffer: 'GET /api/offer/:offerId',
      submitAnswer: 'POST /api/answer/:offerId',
      getAnswer: 'GET /api/answer/:offerId'
    },
    localIP,
    port: PORT
  });
});

app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`\n🚀 WebRTC Signaling Server running`);
  console.log(`📍 Local:    http://localhost:${PORT}`);
  console.log(`📡 Network:  http://${localIP}:${PORT}`);
  console.log(`\n✨ Server ready for LAN file transfers\n`);
});
