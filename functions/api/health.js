// GET /api/health — the regression suite's results, for health.html.
//
// Reads what GitHub Actions already records for .github/workflows/tests.yml
// (public repo, so no secret needed; set GITHUB_TOKEN as a Pages secret only
// if the unauthenticated 60 req/hr limit ever bites). Each job's failing
// checks come from its error annotations, which tests/helpers/gh-reporter.mjs
// and scripts/phone-check.js emit.
//
// A finished run never changes, so its summary is stored in KV permanently
// and fetched from GitHub only once; the run list itself is cached briefly.
const REPO = 'MickYorg/CiViXRepo';
const WORKFLOW = 'tests.yml';
const LIST_TTL_SECONDS = 120;
const HISTORY = 30;

async function gh(env, path) {
  const headers = { 'User-Agent': 'civix-health', Accept: 'application/vnd.github+json' };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) throw new Error(`GitHub ${r.status} on ${path.split('?')[0]}`);
  return r.json();
}

const JOB_LABELS = { unit: 'Regression tests', layout: 'Phone layout', live: 'Live production checks' };

async function summarizeRun(env, run) {
  const jobs = (await gh(env, `/repos/${REPO}/actions/runs/${run.id}/jobs`)).jobs || [];
  const out = [];
  for (const j of jobs) {
    let failures = [];
    if (j.conclusion === 'failure') {
      try {
        const ann = await gh(env, `/repos/${REPO}/check-runs/${j.id}/annotations`);
        failures = ann
          .filter((a) => a.annotation_level === 'failure' && a.title)
          .map((a) => ({ title: a.title, message: a.message }))
          .slice(0, 20);
      } catch (e) { /* annotations are a nice-to-have */ }
    }
    out.push({ name: j.name, label: JOB_LABELS[j.name] || j.name, conclusion: j.conclusion, url: j.html_url, failures });
  }
  return {
    id: run.id,
    event: run.event,            // push | schedule | workflow_dispatch
    status: run.status,
    conclusion: run.conclusion,
    sha: run.head_sha.slice(0, 7),
    title: (run.display_title || '').split('\n')[0].slice(0, 90),
    at: run.run_started_at || run.created_at,
    url: run.html_url,
    jobs: out,
  };
}

export async function onRequestGet({ env }) {
  const kv = env.DIG_KV;
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  try {
    if (kv) {
      const cached = await kv.get('health:summary', 'json');
      if (cached) return json(cached);
    }
    const list = await gh(env, `/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?branch=main&per_page=${HISTORY}`);
    const runs = [];
    for (const run of list.workflow_runs || []) {
      const key = `health:run:${run.id}`;
      let summary = run.status === 'completed' && kv ? await kv.get(key, 'json') : null;
      if (!summary) {
        summary = await summarizeRun(env, run);
        if (run.status === 'completed' && kv) await kv.put(key, JSON.stringify(summary), { expirationTtl: 60 * 60 * 24 * 90 });
      }
      runs.push(summary);
    }
    const body = { repo: REPO, generatedAt: new Date().toISOString(), runs };
    if (kv) await kv.put('health:summary', JSON.stringify(body), { expirationTtl: LIST_TTL_SECONDS });
    return json(body);
  } catch (e) {
    return json({ error: { message: e.message } }, 500);
  }
}
