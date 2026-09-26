// Minimal FCM HTTP v1 client for Cloudflare Workers — signs a service-
// account JWT with Web Crypto (no npm dependency) to get an OAuth2 access
// token, then sends one message. Kept dependency-free, matching this
// project's no-framework/no-build-step convention everywhere else.
//
// FCM bridges to APNs for iOS-registered tokens too, so this one client
// covers both platforms rather than needing a second, separate signed-JWT
// flow for raw APNs.

function base64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

// Reused across every device in one cron run — a fresh Worker isolate
// still means this is worth having (avoids N token exchanges when there
// are N devices to notify in a single invocation).
let cachedToken = null;

async function getAccessToken(serviceAccount) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) return cachedToken.accessToken;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const signingInput = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claim));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = signingInput + '.' + base64url(signature);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt)
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('FCM auth failed: ' + JSON.stringify(data));

  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.accessToken;
}

// Sends one generic, non-revealing notification to one device (see this
// project's own privacy stance in push.js/push-register.js's comments —
// title/body here must never name the specific bill or topic). Returns
// { ok: true } or { ok: false, invalidToken: true }; the caller deletes the
// device record on invalidToken — the authoritative uninstall signal.
export async function sendPush(serviceAccount, projectId, token, title, body) {
  const accessToken = await getAccessToken(serviceAccount);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token, notification: { title, body } } })
  });
  if (res.ok) {
    const d = await res.json().catch(() => ({}));
    return { ok: true, id: d.name || '' };
  }
  const errBody = await res.json().catch(() => ({}));
  const err = (errBody && errBody.error) || {};
  const detail = (err.details || []).map(x => x.errorCode).filter(Boolean)[0] || '';
  // Only a definite "this app is gone" deletes the device. INVALID_ARGUMENT
  // used to count too, but it also covers message-format problems, which
  // would have silently unregistered healthy phones.
  const invalidToken = err.status === 'NOT_FOUND' || detail === 'UNREGISTERED';
  return { ok: false, invalidToken, status: err.status || String(res.status), detail, message: String(err.message || '').slice(0, 200) };
}
