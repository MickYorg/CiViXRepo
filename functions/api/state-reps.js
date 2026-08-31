// Cloudflare Pages Function — state legislator lookup, the state-level
// counterpart to reps.js (federal). Unlike 5calls' federal data, OpenStates
// often has a real, published email address for state legislators — see
// resolveStateReps() in functions/_lib/openstates-people.js for how a ZIP
// resolves to legislators, and why federal representation stays on its
// own separate source rather than merging into this one.

import { resolveStateReps } from '../_lib/openstates-people.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const zip = (url.searchParams.get('zip') || '').trim();
  if (!/^\d{5}$/.test(zip)) {
    return json({ error: { message: 'Missing or invalid "zip" query param' } }, 400);
  }

  try {
    const { reps, state } = await resolveStateReps(zip, env);
    return json({ reps, state });
  } catch (e) {
    return json({ error: { message: e.message || 'Lookup failed' } }, e.status || 502);
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
