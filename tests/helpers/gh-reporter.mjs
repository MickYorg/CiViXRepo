// Node test reporter that turns each failing test into a GitHub Actions
// error annotation. health.html reads those annotations back (via
// functions/api/health.js) to show *which* check broke and why, not just
// that a job failed. Used alongside the normal spec reporter in CI.
export default async function* ghAnnotations(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const d = event.data;
    // Skip the per-file wrapper failure; the real test failure is reported too.
    if (d.details && d.details.type === 'suite') continue;
    const err = d.details && d.details.error;
    const cause = (err && (err.cause || err)) || {};
    const msg = String(cause.message || err || 'failed').split('\n')[0].slice(0, 300);
    const clean = (s) => String(s).replace(/%/g, '%25').replace(/\r?\n/g, ' ').replace(/::/g, ': ');
    yield `::error title=${clean(d.name)}::${clean(msg)}\n`;
  }
}
