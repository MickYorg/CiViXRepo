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

  // dig/index.html is the only one of the three host pages nested a
  // directory deep, so it's the only one that needs a relative-path
  // adjustment to reach the root-level dashboard.
  function analyticsHref() {
    return /\/dig\/?(index\.html)?$/.test(location.pathname) ? '../analytics.html' : 'analytics.html';
  }

  // One short line (27 Sep 2026: the multi-line stats box took too much of
  // every page). The full numbers live on the Analytics dashboard it links to.
  function injectStyle() {
    if (document.getElementById('usage-ticker-style')) return;
    const st = document.createElement('style');
    st.id = 'usage-ticker-style';
    st.textContent = '.usage-ticker.usage-ticker-ready{padding:7px 12px;font-size:14.5px;line-height:1.4;font-family:"Newsreader",Georgia,serif;' +
      'align-items:center;white-space:nowrap;overflow:hidden;}' +
      '.usage-ticker.usage-ticker-ready .usage-ticker-text{overflow:hidden;text-overflow:ellipsis;min-width:0;}' +
      '.usage-ticker.usage-ticker-ready .usage-ticker-link{margin-left:6px;}' +
      '@media (max-width:560px){.usage-ticker-nums{display:none;}}';
    document.head.appendChild(st);
  }

  function render(el, stats) {
    injectStyle();
    const actions = stats.actionsTotal || 0;
    const manifestos = stats.manifestos || 0;
    const link = `<a class="usage-ticker-link" href="${analyticsHref()}">See how &#8594;</a>`;

    if (actions + manifestos === 0) {
      el.innerHTML = `<span class="usage-ticker-emoji">📈</span><span class="usage-ticker-text">Be one of the first citizens putting CiViX to work.</span>${link}`;
      return;
    }
    const bits = [];
    if (manifestos) bits.push(`<strong>${fmt(manifestos)}</strong> manifestos`);
    if (actions) bits.push(`<strong>${fmt(actions)}</strong> actions`);
    // Numbers only where there's room; on a phone the one line is the claim + link.
    el.innerHTML = `<span class="usage-ticker-emoji">📈</span><span class="usage-ticker-text">CiViX is making a difference<span class="usage-ticker-nums">: ${bits.join(', ')}</span>.</span>${link}`;
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
