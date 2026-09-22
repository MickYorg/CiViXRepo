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

async function run(env) {
  const kv = env.DIG_KV;
  if (!kv) return { error: 'missing DIG_KV binding' };

  let serviceAccount = null;
  try {
    serviceAccount = env.FCM_SERVICE_ACCOUNT_JSON ? JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) : null;
  } catch (e) { /* stays null */ }
  const projectId = env.FCM_PROJECT_ID;
  if (!serviceAccount || !projectId) return { error: 'FCM not configured yet — no-op' };

  const devices = await listAllDevices(kv);
  if (!devices.length) return { devices: 0, notified: 0 };

  const federalData = await fetchJson(SITE_ORIGIN + '/api/calendar');
  const federalByKey = {};
  ((federalData && federalData.bills) || []).forEach(b => { federalByKey[watchFederalKey(b)] = b; });

  // Group by ZIP so state-bills is fetched once per distinct ZIP among all
  // devices, not once per device.
  const zips = [...new Set(devices.map(d => d.zip).filter(Boolean))];
  const stateByZip = {};
  for (const zip of zips) {
    const data = await fetchJson(SITE_ORIGIN + '/api/state-bills?zip=' + encodeURIComponent(zip));
    const byKey = {};
    ((data && data.bills) || []).forEach(b => { byKey[watchStateKey(b)] = b; });
    stateByZip[zip] = byKey;
  }

  let notifiedCount = 0;
  for (const device of devices) {
    const notifiedKey = NOTIFIED_PREFIX + device.token;
    const notified = (await kv.get(notifiedKey, { type: 'json' })) || {};
    const stateByKey = stateByZip[device.zip] || {};

    const changed = [];
    for (const w of device.watching || []) {
      const pool = w.kind === 'federal' ? federalByKey : w.kind === 'state' ? stateByKey : null;
      if (!pool) continue; // 'general' watches have no bill data to diff — same limitation the client-side checkWatchlistUpdates() already has
      const bill = pool[w.key];
      if (!bill) continue; // fell outside this fetch's recent-activity window this run
      const latest = (bill.latestAction && bill.latestAction.date) || bill.updateDate || null;
      if (!latest) continue;
      const lastNotified = notified[w.key] || w.lastSeenActionDate || null;
      if (lastNotified && latest === lastNotified) continue;
      changed.push(w.key);
      notified[w.key] = latest;
    }
    if (!changed.length) continue;

    // Deliberately generic — never names the bill/topic. See push.js and
    // push-register.js's own comments on why: this payload transits Apple's/
    // Google's infrastructure and can sit visible on a lock screen.
    const body = changed.length === 1
      ? "A bill you're watching changed status. Open CiViX to see what happened."
      : `${changed.length} bills you're watching changed status. Open CiViX to see what happened.`;

    const result = await sendPush(serviceAccount, projectId, device.token, 'CiViX watchlist update', body);
    if (result.invalidToken) {
      await kv.delete('pushdevice:' + device.token);
      await kv.delete(notifiedKey);
      continue;
    }
    if (result.ok) {
      notifiedCount++;
      await kv.put(notifiedKey, JSON.stringify(notified), { expirationTtl: NOTIFIED_TTL_SECONDS });
    }
  }

  return { devices: devices.length, notified: notifiedCount };
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
    if (url.pathname === '/run' && env.TRIGGER_SECRET && request.headers.get('X-Trigger-Secret') === env.TRIGGER_SECRET) {
      const result = await run(env);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }
};
