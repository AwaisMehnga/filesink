import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import cors from 'cors';
import crypto from 'crypto';
import express from 'express';
import os from 'os';

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_SESSION_AGE_MS = 5 * 60 * 1000;
const SESSION_STORE_FILE = path.join(process.cwd(), '.signaling-sessions.json');

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const sessions = new Map();

const now = () => Date.now();

const loadSessionsFromDisk = () => {
  try {
    if (!fs.existsSync(SESSION_STORE_FILE)) {
      return;
    }

    const raw = fs.readFileSync(SESSION_STORE_FILE, 'utf8');
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    for (const [sessionId, session] of Object.entries(parsed)) {
      sessions.set(sessionId, session);
    }
  } catch (error) {
    console.warn('Failed to load signaling sessions from disk:', error.message);
  }
};

const saveSessionsToDisk = () => {
  try {
    const serialized = Object.fromEntries(sessions.entries());
    fs.writeFileSync(SESSION_STORE_FILE, JSON.stringify(serialized), 'utf8');
  } catch (error) {
    console.warn('Failed to save signaling sessions to disk:', error.message);
  }
};

const cleanupExpiredSessions = () => {
  const currentTime = now();
  let changed = false;
  for (const [sessionId, session] of sessions.entries()) {
    if (currentTime - session.createdAt > MAX_SESSION_AGE_MS) {
      sessions.delete(sessionId);
      changed = true;
    }
  }

  if (changed) {
    saveSessionsToDisk();
  }
};

loadSessionsFromDisk();
setInterval(cleanupExpiredSessions, 30000);

const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name] || [];
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '';
};

const safeEqual = (a, b) => {
  const aBuffer = Buffer.from(String(a));
  const bBuffer = Buffer.from(String(b));
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
};

const getSessionOrError = (req, res) => {
  cleanupExpiredSessions();
  const { sessionId } = req.params;
  const key = req.query.key;

  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found or expired.' });
    return null;
  }

  if (!key || !safeEqual(session.key, key)) {
    res.status(403).json({ error: 'Invalid session key.' });
    return null;
  }

  return session;
};

app.post('/api/session', (req, res) => {
  cleanupExpiredSessions();

  const { offer } = req.body;
  if (!offer || offer.type !== 'offer' || !offer.sdp) {
    return res.status(400).json({ error: 'Missing valid offer.' });
  }

  const sessionId = crypto.randomUUID();
  const key = crypto.randomBytes(24).toString('hex');

  sessions.set(sessionId, {
    key,
    offer,
    answer: null,
    status: 'waiting',
    createdAt: now(),
  });
  saveSessionsToDisk();

  const localIP = getLocalIP();

  return res.json({
    offerToken: `${sessionId}.${key}`,
    expiresInMs: MAX_SESSION_AGE_MS,
    localIP,
  });
});

app.get('/api/session/:sessionId', (req, res) => {
  const session = getSessionOrError(req, res);
  if (!session) {
    return;
  }

  if (session.status === 'waiting') {
    session.status = 'joined';
    saveSessionsToDisk();
  }

  return res.json({
    offer: session.offer,
    status: session.status,
  });
});

app.put('/api/session/:sessionId/offer', (req, res) => {
  const session = getSessionOrError(req, res);
  if (!session) {
    return;
  }

  const { offer } = req.body;
  if (!offer || offer.type !== 'offer' || !offer.sdp) {
    return res.status(400).json({ error: 'Missing valid offer.' });
  }

  session.offer = offer;
  session.answer = null;
  session.status = 'waiting';
  session.createdAt = now();
  saveSessionsToDisk();

  return res.json({
    ok: true,
    status: session.status,
    localIP: getLocalIP(),
  });
});

app.post('/api/session/:sessionId/answer', (req, res) => {
  const session = getSessionOrError(req, res);
  if (!session) {
    return;
  }

  const { answer } = req.body;
  if (!answer || answer.type !== 'answer' || !answer.sdp) {
    return res.status(400).json({ error: 'Missing valid answer.' });
  }

  session.answer = answer;
  session.status = 'answered';
  saveSessionsToDisk();

  return res.json({ ok: true, status: session.status });
});

app.get('/api/session/:sessionId/answer', (req, res) => {
  const session = getSessionOrError(req, res);
  if (!session) {
    return;
  }

  if (!session.answer) {
    return res.status(202).json({ status: session.status });
  }

  session.status = 'connected';
  saveSessionsToDisk();

  return res.json({
    answer: session.answer,
    status: session.status,
  });
});

app.get('/api/session/:sessionId/status', (req, res) => {
  const session = getSessionOrError(req, res);
  if (!session) {
    return;
  }

  return res.json({ status: session.status });
});

app.get('/health', (_req, res) => {
  cleanupExpiredSessions();
  res.json({ status: 'ok', sessionCount: sessions.size });
});

app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP() || 'localhost';
  console.log(`Signaling server running on http://localhost:${PORT}`);
  console.log(`LAN signaling URL: http://${localIP}:${PORT}`);
});
