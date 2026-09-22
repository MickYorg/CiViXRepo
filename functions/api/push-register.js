// Cloudflare Pages Function — device registry for real push notifications
// on the watchlist (take-action.html's `renderWatchingZone()`). Written for
// the app-store MVP push: this app has no accounts system, so a device's
// own push token IS its identity here, same spirit as the docket-token
// capability links used elsewhere in this codebase.
//
// "Never shared, never sold" is a literal build constraint on this file,
// not just a promise kept elsewhere: only watch KEYS are stored (e.g.
// "federal:119:hr1234"), never a bill's title or a citizen's free-text
// stance — this is the first Function in this app to persist anything
// identifying server-side at all, so what it keeps is deliberately minimal.
// See push.js (root) for the client side and workers/push-scheduler/ for
// what actually reads this and sends a push.
import { todayKey } from '../_lib/token-stats.js';

const DEVICE_TTL_SECONDS = 60 * 60 * 24 * 45; // refreshed on every register call; passive uninstall cleanup for devices that never come back
const MAX_WATCH_ITEMS = 200;
const COUNTER_TTL_SECONDS = 60 * 60 * 24 * 2;

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const kv = env.DIG_KV;
  if (!kv) return json({ error: { message: 'Server is missing the DIG_KV binding.' } }, 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: { message: 'Invalid JSON body' } }, 400);
  }

  const token = body && typeof body.token === 'string' && body.token.trim().slice(0, 4096);
  const platform = body && (body.platform === 'ios' || body.platform === 'android') ? body.platform : null;
  if (!token || !platform) {
    return json({ error: { message: 'Missing required "token" (string) or "platform" ("ios"|"android")' } }, 400);
  }

  // Per-IP daily cap — protects against abusive registration spam. Generous
  // relative to dig-check.js's AI-call limits since this is just a cheap KV
  // write, not a metered Anthropic call.
  const limitPerIp = Number(env.PUSH_REGISTER_DAILY_LIMIT_PER_IP || 200);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const dateKey = todayKey();
  const rateKey = `pushrate:${ip}:${dateKey}`;
  let rateRecord = { count: 0 };
  try {
    rateRecord = (await kv.get(rateKey, { type: 'json' })) || { count: 0 };
  } catch (e) { /* fail open */ }
  if (rateRecord.count >= limitPerIp) {
    return json({ error: { message: 'Too many registration requests today. Try again tomorrow.' } }, 429);
  }

  const zip = body && typeof body.zip === 'string' ? body.zip.trim().slice(0, 10) : '';
  const watchingIn = Array.isArray(body.watching) ? body.watching.slice(0, MAX_WATCH_ITEMS) : [];
  // Strip to watch-keys-only shape — never persist a raw title or stance.
  const watching = watchingIn
    .filter(w => w && typeof w.key === 'string')
    .map(w => ({
      key: w.key.slice(0, 200),
      kind: typeof w.kind === 'string' ? w.kind.slice(0, 40) : 'federal',
      lastSeenActionDate: typeof w.lastSeenActionDate === 'string' ? w.lastSeenActionDate.slice(0, 40) : null
    }));

  const record = { token, platform, zip, watching, updatedAt: new Date().toISOString() };
  try {
    await kv.put(`pushdevice:${token}`, JSON.stringify(record), { expirationTtl: DEVICE_TTL_SECONDS });
  } catch (e) {
    return json({ error: { message: 'Could not save device registration.' } }, 500);
  }

  try {
    await kv.put(rateKey, JSON.stringify({ count: rateRecord.count + 1 }), { expirationTtl: COUNTER_TTL_SECONDS });
  } catch (e) { /* rate counter is best-effort */ }

  return json({ ok: true });
}

// Explicit revocation — the "turn off push" action in renderWatchingZone()
// calls this alongside revoking the OS permission, so "delete my data"
// means a real KV delete, not a client-side toggle that quietly keeps
// sending to a token nobody asked to keep.
export async function onRequestDelete({ request, env }) {
  const kv = env.DIG_KV;
  if (!kv) return json({ error: { message: 'Server is missing the DIG_KV binding.' } }, 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: { message: 'Invalid JSON body' } }, 400);
  }
  const token = body && typeof body.token === 'string' && body.token.trim();
  if (!token) return json({ error: { message: 'Missing required "token"' } }, 400);

  try {
    await kv.delete(`pushdevice:${token}`);
  } catch (e) {
    return json({ error: { message: 'Could not delete device registration.' } }, 500);
  }
  return json({ ok: true });
}
