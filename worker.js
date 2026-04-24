const sessions = new Map();
const MAX_SESSION_AGE_MS = 5 * 60 * 1000;

const now = () => Date.now();

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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

const getSessionOrError = (sessionId, key) => {
  cleanupExpiredSessions();

  const session = sessions.get(sessionId);
  if (!session) {
    return { error: 'Session not found or expired.', status: 404 };
  }

  if (!key || !timingSafeEqual(session.key, key)) {
    return { error: 'Invalid session key.', status: 403 };
  }

  return { session };
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return json({}, 204);
    }

    cleanupExpiredSessions();

    if (url.pathname === '/api/session' && request.method === 'POST') {
      const payload = await request.json().catch(() => null);
      const offer = payload?.offer;

      if (!offer || offer.type !== 'offer' || !offer.sdp) {
        return json({ error: 'Missing valid offer.' }, 400);
      }

      const sessionId = crypto.randomUUID();
      const keyBytes = crypto.getRandomValues(new Uint8Array(24));
      const key = Array.from(keyBytes, (b) => b.toString(16).padStart(2, '0')).join('');

      sessions.set(sessionId, {
        key,
        offer,
        answer: null,
        status: 'waiting',
        createdAt: now(),
      });

      return json({
        offerToken: `${sessionId}.${key}`,
        expiresInMs: MAX_SESSION_AGE_MS,
      });
    }

    const parts = parseSessionPath(url.pathname);

    if (parts[0] === 'api' && parts[1] === 'session' && parts[2]) {
      const sessionId = parts[2];
      const key = url.searchParams.get('key');
      const { session, error, status } = getSessionOrError(sessionId, key);

      if (error) {
        return json({ error }, status);
      }

      if (request.method === 'GET' && parts.length === 3) {
        if (session.status === 'waiting') {
          session.status = 'joined';
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
        return json({ ok: true, status: session.status });
      }

      if (request.method === 'GET' && parts[3] === 'answer') {
        if (!session.answer) {
          return json({ status: session.status }, 202);
        }

        session.status = 'connected';
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
  },
};
