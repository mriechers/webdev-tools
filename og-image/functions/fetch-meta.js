/**
 * OG Image Preview Tool — CORS Proxy (Cloudflare Worker)
 * ======================================================
 *
 * WHY THIS EXISTS:
 * Browsers enforce the Same-Origin Policy, which means JavaScript on our
 * GitHub Pages site cannot directly fetch HTML from other domains. This
 * Cloudflare Worker acts as a lightweight proxy: it receives a URL from
 * our frontend, fetches that URL's HTML server-side (where CORS doesn't
 * apply), and returns the content with permissive CORS headers so our
 * browser code can read it.
 *
 * DEPLOYMENT OPTIONS:
 *
 * Option A: Cloudflare Workers (recommended — free tier: 100K requests/day)
 *   1. Sign up at https://workers.cloudflare.com
 *   2. Create a new Worker
 *   3. Paste this entire file as the Worker script
 *   4. Deploy and note the URL (e.g., https://og-proxy.your-subdomain.workers.dev)
 *   5. In the OG Preview Tool, select "Custom proxy" and enter:
 *      https://og-proxy.your-subdomain.workers.dev/?url=
 *
 * Option B: Netlify Functions
 *   1. This same code works with minor adaptations for Netlify Functions
 *   2. Place it in netlify/functions/fetch-meta.js
 *   3. See the Netlify adaptation section at the bottom of this file
 *
 * SECURITY NOTES:
 * - Only fetches text/html content (won't proxy binary files or APIs)
 * - Limits response size to 2MB to prevent abuse
 * - Includes basic rate limiting via Cloudflare's built-in protections
 * - Strips sensitive headers from the proxied response
 * - Only allows GET requests
 *
 * ALTERNATIVE APPROACHES (and why they weren't chosen as default):
 *
 * 1. allOrigins (api.allorigins.win) — Used as the default in the frontend.
 *    Pros: Free, no deployment needed. Cons: Third-party dependency, may
 *    have downtime or rate limits. Good enough for casual use.
 *
 * 2. corsproxy.io — Backup option. Similar tradeoffs to allOrigins.
 *
 * 3. Your own Express/Node server — Overkill for this use case. This
 *    Worker is ~100 lines and costs nothing to run.
 *
 * 4. Browser extension — Would bypass CORS entirely but limits audience.
 */

// Maximum response body size we'll accept (2MB).
// Most HTML pages are well under this, but some sites have enormous
// inline assets or server-rendered content.
const MAX_RESPONSE_SIZE = 2 * 1024 * 1024;

// Request timeout in milliseconds
const FETCH_TIMEOUT_MS = 10000;

// Allowed origins — restrict this to your GitHub Pages domain in production.
// Using '*' during development is fine but less secure.
const ALLOWED_ORIGINS = [
  '*', // Allow all origins during development
  // Uncomment and edit for production:
  // 'https://your-username.github.io',
  // 'http://localhost:8080',
];

/**
 * Main request handler for Cloudflare Workers.
 *
 * Expected request format:
 *   GET /?url=https://example.com/page
 *
 * Returns the HTML of the target URL with CORS headers added.
 */
export default {
  async fetch(request) {
    // Only allow GET requests
    if (request.method === 'OPTIONS') {
      return handleCorsPreFlight(request);
    }

    if (request.method !== 'GET') {
      return jsonError('Only GET requests are allowed', 405);
    }

    // Extract the target URL from the query string
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return jsonError(
        'Missing "url" query parameter. Usage: ?url=https://example.com',
        400
      );
    }

    // Validate the target URL
    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return jsonError('Invalid URL provided', 400);
    }

    // Only allow http/https protocols (prevent file://, data://, etc.)
    if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
      return jsonError('Only HTTP and HTTPS URLs are allowed', 400);
    }

    try {
      // Fetch the target URL with a timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          // Identify ourselves as a bot/crawler — some sites serve different
          // content to bots (often simpler HTML with OG tags in the head,
          // which is exactly what we want).
          'User-Agent':
            'OGImagePreviewBot/1.0 (+https://github.com/MarkOnFire/og-image-test)',
          Accept: 'text/html,application/xhtml+xml',
        },
        // Follow redirects automatically
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return jsonError(
          `Target URL returned HTTP ${response.status} ${response.statusText}`,
          502
        );
      }

      // Check content type — we only want HTML
      const contentType = response.headers.get('content-type') || '';
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml')
      ) {
        return jsonError(
          `Target URL returned ${contentType}, expected text/html`,
          400
        );
      }

      // Read the response body with a size limit
      const reader = response.body.getReader();
      const chunks = [];
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.length;
        if (totalSize > MAX_RESPONSE_SIZE) {
          reader.cancel();
          return jsonError(
            'Response too large (>2MB). This usually means the page has excessive inline content.',
            413
          );
        }

        chunks.push(value);
      }

      // Combine chunks into a single response body
      const body = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }

      // Return the HTML with CORS headers
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...corsHeaders(request),
          // Cache for 5 minutes — OG tags don't change frequently,
          // and this reduces load on both the proxy and target site
          'Cache-Control': 'public, max-age=300',
        },
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        return jsonError('Request to target URL timed out', 504);
      }

      return jsonError(`Failed to fetch target URL: ${err.message}`, 502);
    }
  },
};

/**
 * Handle CORS preflight (OPTIONS) requests.
 * Browsers send these before certain cross-origin requests.
 */
function handleCorsPreFlight(request) {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request),
      // Allow these headers in the actual request
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      // Cache preflight for 24 hours
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Generate CORS response headers.
 * Checks the request origin against our allowed list.
 */
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';

  // If we allow all origins, just reflect it back
  if (ALLOWED_ORIGINS.includes('*')) {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };
  }

  // Otherwise, check if this origin is allowed
  if (ALLOWED_ORIGINS.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };
  }

  // Origin not allowed — omit the CORS header (browser will block)
  return {};
}

/**
 * Return a JSON error response with CORS headers.
 */
function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/* ============================================================
   NETLIFY FUNCTIONS ADAPTATION
   ============================================================

   If deploying to Netlify instead of Cloudflare, rename this file
   to netlify/functions/fetch-meta.js and use this export format:

   exports.handler = async (event, context) => {
     const targetUrl = event.queryStringParameters?.url;

     if (!targetUrl) {
       return {
         statusCode: 400,
         body: JSON.stringify({ error: 'Missing url parameter' }),
       };
     }

     try {
       const response = await fetch(targetUrl, {
         headers: {
           'User-Agent': 'OGImagePreviewBot/1.0',
           Accept: 'text/html',
         },
       });

       const html = await response.text();

       return {
         statusCode: 200,
         headers: {
           'Content-Type': 'text/html',
           'Access-Control-Allow-Origin': '*',
           'Cache-Control': 'public, max-age=300',
         },
         body: html,
       };
     } catch (err) {
       return {
         statusCode: 502,
         body: JSON.stringify({ error: err.message }),
       };
     }
   };

   ============================================================ */
