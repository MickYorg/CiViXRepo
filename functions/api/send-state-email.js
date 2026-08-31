// Cloudflare Pages Function — actually sends a constituent email to a
// state legislator via Resend. This is the one real "one button and it
// lands" send in the app: OpenStates gives a genuine recipient address
// for state legislators (unlike Congress — see reps.js/calendar.js's
// notes on why federal stays copy-and-paste), so there's something real
// to send to.
//
// Security: never trusts a client-supplied recipient address. `to` is
// re-derived server-side from `repId` by re-running the exact same
// ZIP -> legislator lookup /api/state-reps exposes to the picker —
// otherwise this endpoint would be an open relay any caller could use
// to blast CiViX's sending reputation at arbitrary addresses.
//
// Privacy: nothing in the request body (name, address, email, message
// text) is written to KV or logged anywhere — this function only ever
// touches KV for the rate-limit counters below. A citizen's identity
// lives in their own browser's localStorage (civix-profile.identity)
// and passes through this one request only at the moment they actually
// send — never stored server-side, never shared, never sold.

import { resolveStateReps } from '../_lib/openstates-people.js';

const COUNTER_TTL_SECONDS = 60 * 60 * 24 * 2;
function todayKey() { return new Date().toISOString().slice(0, 10); }

export async function onRequestPost({ request, env }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return json({ error: { message: 'Server is missing RESEND_API_KEY — set it in the Cloudflare Pages project env vars.' } }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: { message: 'Invalid JSON body' } }, 400);
  }

  const zip = String(body.zip || '').trim();
  const repId = String(body.repId || '').trim();
  const subject = String(body.subject || '').trim().slice(0, 200);
  const message = String(body.message || '').trim().slice(0, 4000);
  const senderName = String(body.senderName || '').trim().slice(0, 200);
  const senderAddress = String(body.senderAddress || '').trim().slice(0, 300);
  const senderEmail = String(body.senderEmail || '').trim().slice(0, 200);

  if (!/^\d{5}$/.test(zip) || !repId || !subject || !message || !senderName || !senderAddress) {
    return json({ error: { message: 'Missing required field(s).' } }, 400);
  }

  const kv = env.DIG_KV;
  const day = todayKey();
  // Kept well under Resend's 100/day free-tier ceiling so CiViX's own
  // testing and other traffic never gets crowded out by this endpoint.
  const dailyLimitTotal = Number(env.EMAIL_DAILY_LIMIT || 80);
  const dailyLimitPerIp = Number(env.EMAIL_DAILY_LIMIT_PER_IP || 5);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const totalKey = `emailcount:${day}`;
  const ipKey = `emailcount:${day}:${ip}`;

  let totalCount = 0, ipCount = 0;
  if (kv) {
    try { totalCount = ((await kv.get(totalKey, { type: 'json' })) || { count: 0 }).count; } catch (e) {}
    try { ipCount = ((await kv.get(ipKey, { type: 'json' })) || { count: 0 }).count; } catch (e) {}
  }
  if (totalCount >= dailyLimitTotal) {
    return json({ error: { message: "CiViX has hit its shared daily sending limit — try again tomorrow, or use Copy in the meantime." } }, 429);
  }
  if (ipCount >= dailyLimitPerIp) {
    return json({ error: { message: `Daily limit of ${dailyLimitPerIp} sends reached for this visitor — resets at UTC midnight.` } }, 429);
  }

  let reps;
  try {
    ({ reps } = await resolveStateReps(zip, env));
  } catch (e) {
    return json({ error: { message: e.message || 'Could not look up representatives for that ZIP' } }, e.status || 502);
  }
  const rep = reps.find(r => r.id === repId);
  if (!rep || !rep.email) {
    return json({ error: { message: 'No email address on file for that representative.' } }, 404);
  }

  const text = `${message}\n\n—\n${senderName}\n${senderAddress}${senderEmail ? '\n' + senderEmail : ''}\n\nSent via CiViX (mycivix.com), a constituent's civic-engagement tool.`;

  let resendRes;
  try {
    resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: env.EMAIL_FROM || 'CiViX <noreply@mycivix.com>',
        to: [rep.email],
        subject,
        text,
        reply_to: senderEmail || undefined
      })
    });
  } catch (e) {
    return json({ error: { message: 'Could not reach the email service' } }, 502);
  }
  if (!resendRes.ok) {
    let msg = `Email service returned HTTP ${resendRes.status}`;
    try { const b = await resendRes.json(); if (b.message) msg = b.message; } catch (e) {}
    return json({ error: { message: msg } }, 502);
  }
  const result = await resendRes.json();

  if (kv) {
    try { await kv.put(totalKey, JSON.stringify({ count: totalCount + 1 }), { expirationTtl: COUNTER_TTL_SECONDS }); } catch (e) {}
    try { await kv.put(ipKey, JSON.stringify({ count: ipCount + 1 }), { expirationTtl: COUNTER_TTL_SECONDS }); } catch (e) {}
  }

  return json({ ok: true, id: result.id || null, sentTo: rep.name });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
