// Cloudflare Pages middleware — wraps every request under functions/api/.
//
// CORS for the native app shell. On iOS this is load-bearing: Capacitor iOS
// serves the bundled pages at capacitor://mycivix.com (WKWebView won't let an
// app claim https, so capacitor.config's iosScheme is ignored), and
// native-fetch.js rewrites relative /api/ calls to https://mycivix.com — so
// every Function call from the iPhone app is cross-origin and needs these
// headers. Android runs at https://mycivix.com and stays same-origin.
//
// None of these endpoints use cookies or any session-based auth (this app
// has no accounts system), so allowlisting a small, fixed set of app-shell
// origins carries no meaningful risk beyond ordinary API abuse, which the
// existing per-IP rate limits already guard against independently.
const ALLOWED_ORIGINS = new Set([
  'https://mycivix.com',
  'capacitor://mycivix.com',
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
