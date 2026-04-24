const sessions = new Map();
const MAX_SESSION_AGE_MS = 5 * 60 * 1000;
const KV_SESSION_PREFIX = 'session:';

const now = () => Date.now();

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });

const cleanupExpiredSessions = () => {
  const currentTime = now();
  for (const [sessionId, session] of sessions.entries()) {
    if (currentTime - session.createdAt > MAX_SESSION_AGE_MS) {
      sessions.delete(sessionId);
    }
  }
};

const timingSafeEqual = (a, b) => {
  const encoder = new TextEncoder();
  const left = encoder.encode(String(a));
  const right = encoder.encode(String(b));
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left[i] ^ right[i];
  }

  return mismatch === 0;
};

const parseSessionPath = (pathname) => pathname.split('/').filter(Boolean);

const getKvStore = (env) => env?.SIGNALING_SESSIONS || null;

const getKvSessionKey = (sessionId) => `${KV_SESSION_PREFIX}${sessionId}`;

const saveSession = async (sessionId, session, env) => {
  const kv = getKvStore(env);
  if (kv) {
    await kv.put(getKvSessionKey(sessionId), JSON.stringify(session), {
      expirationTtl: Math.ceil(MAX_SESSION_AGE_MS / 1000),
    });
    return;
  }

  sessions.set(sessionId, session);
};

const loadSession = async (sessionId, env) => {
  const kv = getKvStore(env);
  if (kv) {
    const raw = await kv.get(getKvSessionKey(sessionId));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  cleanupExpiredSessions();
  return sessions.get(sessionId) || null;
};

const deleteSession = async (sessionId, env) => {
  const kv = getKvStore(env);
  if (kv) {
    await kv.delete(getKvSessionKey(sessionId));
    return;
  }

  sessions.delete(sessionId);
};

const getSessionOrError = async (sessionId, key, env) => {
  const session = await loadSession(sessionId, env);
  if (!session) {
    return { error: 'Session not found or expired.', status: 404 };
  }

  if (now() - session.createdAt > MAX_SESSION_AGE_MS) {
    await deleteSession(sessionId, env);
    return { error: 'Session not found or expired.', status: 404 };
  }

  if (!key || !timingSafeEqual(session.key, key)) {
    return { error: 'Invalid session key.', status: 403 };
  }

  return { session };
};

export const handleSignalingRequest = async (request, env = {}) => {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return json({}, 204);
  }

  if (!getKvStore(env)) {
    cleanupExpiredSessions();
  }

  if (url.pathname === '/api/session' && request.method === 'POST') {
    const payload = await request.json().catch(() => null);
    const offer = payload?.offer;

    if (!offer || offer.type !== 'offer' || !offer.sdp) {
      return json({ error: 'Missing valid offer.' }, 400);
    }

    const sessionId = crypto.randomUUID();
    const keyBytes = crypto.getRandomValues(new Uint8Array(24));
    const key = Array.from(keyBytes, (b) => b.toString(16).padStart(2, '0')).join('');

    const session = {
      key,
      offer,
      answer: null,
      status: 'waiting',
      createdAt: now(),
    };

    await saveSession(sessionId, session, env);

    return json({
      offerToken: `${sessionId}.${key}`,
      expiresInMs: MAX_SESSION_AGE_MS,
    });
  }

  const parts = parseSessionPath(url.pathname);

  if (parts[0] === 'api' && parts[1] === 'session' && parts[2]) {
    const sessionId = parts[2];
    const key = url.searchParams.get('key');
    const { session, error, status } = await getSessionOrError(sessionId, key, env);

    if (error) {
      return json({ error }, status);
    }

    if (request.method === 'GET' && parts.length === 3) {
      if (session.status === 'waiting') {
        session.status = 'joined';
        await saveSession(sessionId, session, env);
      }

      return json({ offer: session.offer, status: session.status });
    }

    if (request.method === 'PUT' && parts[3] === 'offer') {
      const payload = await request.json().catch(() => null);
      const offer = payload?.offer;

      if (!offer || offer.type !== 'offer' || !offer.sdp) {
        return json({ error: 'Missing valid offer.' }, 400);
      }

      session.offer = offer;
      session.answer = null;
      session.status = 'waiting';
      session.createdAt = now();
      await saveSession(sessionId, session, env);

      return json({ ok: true, status: session.status });
    }

    if (request.method === 'POST' && parts[3] === 'answer') {
      const payload = await request.json().catch(() => null);
      const answer = payload?.answer;

      if (!answer || answer.type !== 'answer' || !answer.sdp) {
        return json({ error: 'Missing valid answer.' }, 400);
      }

      session.answer = answer;
      session.status = 'answered';
      await saveSession(sessionId, session, env);
      return json({ ok: true, status: session.status });
    }

    if (request.method === 'GET' && parts[3] === 'answer') {
      if (!session.answer) {
        return json({ status: session.status }, 202);
      }

      session.status = 'connected';
      await saveSession(sessionId, session, env);
      return json({ answer: session.answer, status: session.status });
    }

    if (request.method === 'GET' && parts[3] === 'status') {
      return json({ status: session.status });
    }
  }

  if (url.pathname === '/health') {
    return json({ status: 'ok', sessionCount: sessions.size });
  }

  return json({ error: 'Not found' }, 404);
};
