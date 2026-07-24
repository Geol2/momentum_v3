/**
 * Cloudflare Worker — same-origin API proxy
 * =========================================
 * Purpose: make the API reachable at  momentum.geol2.com/api/*  so the browser only
 * ever talks to ONE origin. Cross-origin requests (momentum.geol2.com → api.geol2.com)
 * are blocked by in-app browsers such as KakaoTalk's WebView; routing /api through the
 * same host removes the cross-origin request entirely — no CORS, no in-app block.
 *
 * Deploy
 * ------
 * 1. Cloudflare dashboard → Workers & Pages → Create Worker → paste this file → Deploy.
 * 2. Worker → Settings → Triggers → Add route:
 *        Route:  momentum.geol2.com/api/*
 *        Zone:   geol2.com
 * 3. Deploy the frontend with VITE_API_BASE_URL empty (already set in .env.production)
 *    so it calls the relative "/api/..." path.
 *
 * After this, momentum.geol2.com/api/auth/login is served by the Worker, which forwards
 * to api.geol2.com/api/auth/login and streams the response back.
 */

const BACKEND_HOST = 'api.geol2.com'

export default {
  async fetch(request) {
    const url = new URL(request.url)

    // Only proxy the API path; anything else is a misconfigured route.
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 })
    }

    // Swap only the host — keep path, query, method, headers and body intact.
    url.hostname = BACKEND_HOST
    url.protocol = 'https:'
    url.port = ''

    // Cloning with the new URL preserves method/headers/body. redirect: 'manual' so
    // any backend redirect is passed through untouched rather than followed here.
    const proxied = new Request(url.toString(), request)
    proxied.headers.set('Host', BACKEND_HOST)

    return fetch(proxied, { redirect: 'manual' })
  },
}
