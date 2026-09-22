// Cloudflare Pages middleware — wraps every request under functions/api/.
//
// Defensive CORS fallback for the native app shell. The primary fix is
// capacitor.config.json's server.hostname ("mycivix.com"), which makes the
// bundled app's WebView present its origin as https://mycivix.com so calls
// to these same-domain Functions are same-origin and need no CORS headers
// at all. This middleware exists in case that doesn't hold on some WebView/
// platform combination (or a future Capacitor Live Updates / remote-content
// mode) — it never needs to matter for it to be worth having.
//
// None of these endpoints use cookies or any session-based auth (this app
// has no accounts system), so allowlisting a small, fixed set of app-shell
// origins carries no meaningful risk beyond ordinary API abuse, which the
// existing per-IP rate limits already guard against independently.
const ALLOWED_ORIGINS = new Set([
  'https://mycivix.com',
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
]);

function corsHeadersFor(origin) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export async function onRequest({ request, next }) {
  const origin = request.headers.get('Origin');
  const cors = corsHeadersFor(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors || {} });
  }

  const response = await next();
  if (!cors) return response;

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
