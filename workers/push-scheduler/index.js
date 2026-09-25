// Standalone Cloudflare Worker — NOT a Pages Function. Cron Triggers are a
// Workers-only primitive; Cloudflare Pages Functions can't schedule
// themselves, so this is a sibling project bound to the same DIG_KV
// namespace as the main mycivix Pages project, reading the pushdevice:*
// records functions/api/push-register.js writes.
//
// Diffs each registered device's watched federal/state bills against the
// same live endpoints take-action.html itself calls, using its own
// server-side "have I already notified this device about this exact
// change" record — deliberately NOT the client's WATCH_UPDATES behavior
// (which, once flagged, stays flagged forever), since re-notifying every
// hour for the same unread change would be spam.
import { sendPush } from './fcm.js';

const NOTIFIED_PREFIX = 'pushnotified:'; // per-device map: watch key -> lastNotifiedActionDate
const NOTIFIED_TTL_SECONDS = 60 * 60 * 24 * 60;
const SITE_ORIGIN = 'https://mycivix.com';

function watchFederalKey(bill) {
  return 'federal:' + bill.congress + ':' + bill.type + bill.number;
}
function watchStateKey(bill) {
  return 'state:' + (bill.session || '') + ':' + (bill.identifier || '');
}

// 'federal:119:HR9694' -> { congress: '119', type: 'hr', number: '9694' }
export function parseFederalWatchKey(key) {
  const m = /^federal:(\d+):([A-Za-z]+)(\d+)$/.exec(key || '');
  return m ? { congress: m[1], type: m[2].toLowerCase(), number: m[3] } : null;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function listAllDevices(kv) {
  const devices = [];
  let cursor;
  for (;;) {
    const page = await kv.list({ prefix: 'pushdevice:', cursor });
    for (const k of page.keys) {
      const rec = await kv.get(k.name, { type: 'json' });
      if (rec) devices.push(rec);
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return devices;
}

// deps are injectable for tests (tests/unit/push-scheduler.test.js):
// { fetchJson, send } default to the real network calls.
export async function run(env, opts = {}) {
  const kv = env.DIG_KV;
  if (!kv) return { error: 'missing DIG_KV binding' };
  const getJson = opts.fetchJson || fetchJson;
  const send = opts.send || sendPush;

  let serviceAccount = null;
  try {
    serviceAccount = env.FCM_SERVICE_ACCOUNT_JSON ? JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) : null;
  } catch (e) { /* stays null */ }
  const projectId = env.FCM_PROJECT_ID;
  if (!serviceAccount || !projectId) return { error: 'FCM not configured yet — no-op' };

  const devices = opts.devices || await listAllDevices(kv);
  if (!devices.length) return { devices: 0, notified: 0 };

  const federalData = await getJson(SITE_ORIGIN + '/api/calendar');
  const federalByKey = {};
  ((federalData && federalData.bills) || []).forEach(b => { federalByKey[watchFederalKey(b)] = b; });

  // 25 Sep 2026: a watched federal bill outside /api/calendar's ~100 most
  // recently touched bills (e.g. one the citizen named themselves, like
  // H.R.9694) could never alert. Look each missing one up directly, once per
  // run no matter how many devices watch it.
  const missing = new Set();
  devices.forEach(d => (d.watching || []).forEach(w => {
    if (w.kind === 'federal' && !federalByKey[w.key] && parseFederalWatchKey(w.key)) missing.add(w.key);
  }));
  for (const key of missing) {
    const c = parseFederalWatchKey(key);
    const data = await getJson(`${SITE_ORIGIN}/api/bill-lookup?type=${c.type}&number=${c.number}&congress=${c.congress}`);
    if (data && data.bill) federalByKey[key] = data.bill;
  }

  // Group by ZIP so state-bills is fetched once per distinct ZIP among all
  // devices, not once per device.
  const zips = [...new Set(devices.map(d => d.zip).filter(Boolean))];
  const stateByZip = {};
  for (const zip of zips) {
    const data = await getJson(SITE_ORIGIN + '/api/state-bills?zip=' + encodeURIComponent(zip));
    const byKey = {};
    ((data && data.bills) || []).forEach(b => { byKey[watchStateKey(b)] = b; });
    stateByZip[zip] = byKey;
  }

  let notifiedCount = 0;
  const results = [];
  for (const device of devices) {
    const notifiedKey = NOTIFIED_PREFIX + device.token;
    const notified = (await kv.get(notifiedKey, { type: 'json' })) || {};
    const stateByKey = stateByZip[device.zip] || {};

    const changed = [];
    for (const w of device.watching || []) {
      const pool = w.kind === 'federal' ? federalByKey : w.kind === 'state' ? stateByKey : null;
      if (!pool) continue; // 'general' watches have no bill data to diff — same limitation the client-side checkWatchlistUpdates() already has
      const bill = pool[w.key];
      if (!bill) continue; // not found this run (state bills outside the recent window, or a lookup hiccup)
      const latest = (bill.latestAction && bill.latestAction.date) || bill.updateDate || null;
      if (!latest) continue;
      const lastNotified = notified[w.key] || w.lastSeenActionDate || null;
      if (lastNotified && latest === lastNotified) continue;
      changed.push(w.key);
      notified[w.key] = latest;
    }
    if (!changed.length) { results.push({ changed: 0 }); continue; }

    // Deliberately generic — never names the bill/topic. See push.js and
    // push-register.js's own comments on why: this payload transits Apple's/
    // Google's infrastructure and can sit visible on a lock screen.
    const body = changed.length === 1
      ? "A bill you're watching changed status. Open CiViX to see what happened."
      : `${changed.length} bills you're watching changed status. Open CiViX to see what happened.`;

    const result = await send(serviceAccount, projectId, device.token, 'CiViX watchlist update', body);
    if (result.invalidToken) {
      await kv.delete('pushdevice:' + device.token);
      await kv.delete(notifiedKey);
      results.push({ changed: changed.length, sent: false, invalidToken: true });
      continue;
    }
    if (result.ok) {
      notifiedCount++;
      await kv.put(notifiedKey, JSON.stringify(notified), { expirationTtl: NOTIFIED_TTL_SECONDS });
    }
    results.push({ changed: changed.length, sent: !!result.ok });
  }

  return { devices: devices.length, notified: notifiedCount, results };
}

// First-time confirmation (25 Sep 2026): the moment a citizen turns alerts
// on, push.js asks for one immediate, generic alert so they see what one
// looks like and know it works. Once per device, ever (pushwelcomed:*), and
// never names a bill, same lock-screen rule as every other alert.
const WELCOME_TITLE = 'CiViX alerts are on';
const WELCOME_BODY = "When a bill you're watching changes, you'll get a note like this. Tap it to see what moved.";
export async function welcome(env, token, opts = {}) {
  const kv = env.DIG_KV;
  const send = opts.send || sendPush;
  const device = token && await kv.get('pushdevice:' + token, { type: 'json' });
  if (!device) return { status: 404, body: { error: { message: 'Device not registered.' } } };
  const flag = 'pushwelcomed:' + token;
  if (await kv.get(flag)) return { status: 200, body: { sent: false, already: true } };
  let serviceAccount = null;
  try { serviceAccount = env.FCM_SERVICE_ACCOUNT_JSON ? JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) : null; } catch (e) {}
  if (!serviceAccount || !env.FCM_PROJECT_ID) return { status: 500, body: { error: { message: 'Alerts are not configured on the server.' } } };
  const result = await send(serviceAccount, env.FCM_PROJECT_ID, token, WELCOME_TITLE, WELCOME_BODY);
  if (result.ok) await kv.put(flag, '1', { expirationTtl: 60 * 60 * 24 * 365 });
  return { status: result.ok ? 200 : 500, body: { sent: !!result.ok } };
}

// "Simulate an update" (test builds only; see take-action.html's
// pushRowHtml()): the app first rewinds one watched bill's
// lastSeenActionDate and re-registers, then calls this. Clearing the
// device's "already notified" record and running the real diff for just
// this device sends a real push through the real pipeline. Needs no
// secret: it only acts on the device whose token the caller already holds
// (the token is its identity, same as push-register.js), and is capped
// per device per day.
const SIMULATE_DAILY_LIMIT = 20;
export async function simulate(env, token, opts = {}) {
  const kv = env.DIG_KV;
  const device = token && await kv.get('pushdevice:' + token, { type: 'json' });
  if (!device) return { status: 404, body: { error: { message: 'This device isn\u2019t registered for alerts yet — turn on alerts first.' } } };
  const day = new Date().toISOString().slice(0, 10);
  const rateKey = `pushsim:${token.slice(-24)}:${day}`;
  const count = Number(await kv.get(rateKey)) || 0;
  if (count >= SIMULATE_DAILY_LIMIT) return { status: 429, body: { error: { message: 'Daily limit of test alerts reached.' } } };
  await kv.put(rateKey, String(count + 1), { expirationTtl: 60 * 60 * 48 });
  await kv.delete(NOTIFIED_PREFIX + token);
  const result = await run(env, { ...opts, devices: [device] });
  return { status: 200, body: result };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  // Manual trigger, for real end-to-end verification during Phase 3
  // (see the plan's verification section) without waiting up to an hour
  // for the real cron. Gated by a shared secret so this can't be poked by
  // anyone who finds the Worker's URL.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/simulate' || url.pathname === '/welcome') {
      const origin = request.headers.get('Origin') || '';
      const cors = ['https://mycivix.com', 'capacitor://mycivix.com'].includes(origin)
        ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' }
        : {};
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return new Response('not found', { status: 404 });
      let token = '';
      try { token = String((await request.json()).token || '').slice(0, 4096); } catch (e) {}
      const { status, body } = url.pathname === '/welcome' ? await welcome(env, token) : await simulate(env, token);
      return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/run' && env.TRIGGER_SECRET && request.headers.get('X-Trigger-Secret') === env.TRIGGER_SECRET) {
      const result = await run(env);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }
};
