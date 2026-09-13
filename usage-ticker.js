// Shared across dig/index.html, take-action.html, and builder.html (via
// <script src="usage-ticker.js">, same "genuinely shared client file"
// pattern as civics.js/digest.js/mode.js — no build system to bundle a
// component any other way). Finds a #usage-ticker element already present
// on the page and fills it with a celebratory line built from real,
// anonymous, aggregate counts (functions.dig_check/dig_debate,
// actionsTotal, manifestos) from /api/platform-stats — a positive signal
// that citizens are actually using the platform, and, via the per-function
// breakdown, a rough read on which functions people find worth using.
// Nice-to-have only: on any fetch/parse failure the ticker element is just
// left empty, same "stats never block or error visibly" stance
// platform-stats.js itself already takes.
(function () {
  function fmt(n) {
    return (n || 0).toLocaleString();
  }

  function render(el, stats) {
    const checks = (stats.functions && stats.functions.dig_check) || 0;
    const talkingPoints = (stats.functions && stats.functions.dig_debate) || 0;
    const actions = stats.actionsTotal || 0;
    const manifestos = stats.manifestos || 0;
    const total = checks + talkingPoints + actions + manifestos;

    if (total === 0) {
      el.innerHTML = `<span class="usage-ticker-emoji">🎉</span><span class="usage-ticker-text">Be part of the first wave of citizens using CiViX — your activity here becomes the platform's very first stats.</span>`;
      return;
    }

    const parts = [];
    if (checks) parts.push(`<strong>${fmt(checks)}</strong> checks run`);
    if (talkingPoints) parts.push(`<strong>${fmt(talkingPoints)}</strong> talking points pulled`);
    if (actions) parts.push(`<strong>${fmt(actions)}</strong> actions taken`);
    if (manifestos) parts.push(`<strong>${fmt(manifestos)}</strong> manifestos built`);

    el.innerHTML = `<span class="usage-ticker-emoji">🎉</span><span class="usage-ticker-text">${parts.join(' · ')}<span class="usage-ticker-tagline"> — citizens are putting CiViX to work</span></span>`;
  }

  async function init() {
    const el = document.getElementById('usage-ticker');
    if (!el) return;
    try {
      const res = await fetch('/api/platform-stats');
      if (!res.ok) return;
      const stats = await res.json();
      render(el, stats);
      el.classList.add('usage-ticker-ready');
    } catch (e) {
      // nice-to-have only — leave the ticker empty rather than show an error
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
