// Cloudflare Worker for WebRTC Signaling
// Deploy with: npx wrangler publish worker.js

const pendingOffers = new Map();
const completedAnswers = new Map();
const MAX_AGE = 5 * 60 * 1000; // 5 minutes

// Clean up expired entries periodically
const cleanupExpired = () => {
  const now = Date.now();
  for (const [offerId, data] of pendingOffers.entries()) {
    if (now - data.createdAt > MAX_AGE) {
      pendingOffers.delete(offerId);
      completedAnswers.delete(offerId);
    }
  }
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // Enable CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    cleanupExpired();

    // POST /api/offer - Create offer and return shareable link
    if (url.pathname === '/api/offer' && request.method === 'POST') {
      try {
        const { offer } = await request.json();
        if (!offer) {
          return new Response(JSON.stringify({ error: 'Missing offer' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const offerId = crypto.randomUUID();
        pendingOffers.set(offerId, {
          offer,
          createdAt: Date.now(),
        });

        const workerUrl = new URL(request.url).origin;
        const link = `${workerUrl}?offer=${offerId}`;

        return new Response(
          JSON.stringify({
            offerId,
            link,
            serverUrl: workerUrl,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // GET /api/offer/:offerId - Retrieve offer
    if (url.pathname.match(/^\/api\/offer\/[a-f0-9\-]+$/) && request.method === 'GET') {
      const offerId = url.pathname.split('/').pop();
      const data = pendingOffers.get(offerId);

      if (!data) {
        return new Response(JSON.stringify({ error: 'Offer not found or expired' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ offer: data.offer }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /api/answer/:offerId - Store answer
    if (url.pathname.match(/^\/api\/answer\/[a-f0-9\-]+$/) && request.method === 'POST') {
      const offerId = url.pathname.split('/').pop();
      try {
        const { answer } = await request.json();
        if (!answer) {
          return new Response(JSON.stringify({ error: 'Missing answer' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (!pendingOffers.has(offerId)) {
          return new Response(JSON.stringify({ error: 'Offer not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        completedAnswers.set(offerId, answer);

        return new Response(
          JSON.stringify({ success: true, offerId }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // GET /api/answer/:offerId - Retrieve answer
    if (url.pathname.match(/^\/api\/answer\/[a-f0-9\-]+$/) && request.method === 'GET') {
      const offerId = url.pathname.split('/').pop();
      const answer = completedAnswers.get(offerId);

      if (!answer) {
        return new Response(JSON.stringify({ status: 'waiting' }), {
          status: 202,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ answer }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // GET /health - Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // GET / - API info
    if (url.pathname === '/') {
      return new Response(
        JSON.stringify({
          message: 'WebRTC Signaling Server (Cloudflare Worker)',
          endpoints: {
            health: '/health',
            createOffer: 'POST /api/offer',
            getOffer: 'GET /api/offer/:offerId',
            submitAnswer: 'POST /api/answer/:offerId',
            getAnswer: 'GET /api/answer/:offerId',
          },
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
};
