// mode.js — Citizen/Activist/Pro as a shared, platform-wide concept.
// Mirrors civics.js's pattern (self-guarding window global, no dependency
// on the host page's own CSS tokens) so renderPicker() carries its own
// scoped styling wherever it's dropped in — necessary because
// dig/index.html runs a different palette entirely (--paper/--amber only,
// no --ink/--ink-raised/--amber-ink/--amber-wash/--line at all) and a
// naive copy of builder.html's picker CSS would render broken there.
(function () {
  'use strict';
  if (window.CivixMode) return;

  var MODE_KEY = 'civix-mode';
  var PROFILE_KEY = 'civix-profile';
  var MODE_ORDER = ['citizen', 'activist', 'pro'];

  // Canonical "does this citizen actually have a manifesto" check. Mere
  // presence of the civix-profile key isn't enough — builder.html's wipe
  // flow resets P to BLANK and immediately re-saves it (to also persist a
  // freshly-issued docket token), so the key can exist with nothing real
  // in it. This is the single source of truth every page should use —
  // index.html and builder.html independently drifted on this exact
  // check (5 fields vs. 3) despite both being touched the same session.
  function hasManifesto(profile) {
    if (!profile) return false;
    return !!(
      (profile.issues && profile.issues.length) ||
      (profile.sources && profile.sources.length) ||
      (profile.actions && profile.actions.length) ||
      (profile.traits && profile.traits.length) ||
      (profile.place && profile.place.zip)
    );
  }

  function loadProfile() {
    try {
      var raw = localStorage.getItem(PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function get() {
    try {
      var m = localStorage.getItem(MODE_KEY);
      if (MODE_ORDER.indexOf(m) !== -1) return m;
    } catch (e) {}
    return hasManifesto(loadProfile()) ? 'pro' : 'citizen';
  }

  function set(mode) {
    if (MODE_ORDER.indexOf(mode) === -1) return;
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
  }

  var LABELS = {
    citizen: { emoji: '\u{1F64B}', label: 'Citizen', title: 'Swipe through a few cards. Fast, fun, free.' },
    activist: { emoji: '✊', label: 'Activist', title: 'The same form, one friendly step at a time.' },
    pro: { emoji: '\u{1F3DB}\u{FE0F}', label: 'Pro', title: 'Every section, open, all at once. For citizens who want full control.' }
  };

  var styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var tag = document.createElement('style');
    tag.textContent = [
      // Dark is the default (matches most host pages' own default),
      // with both an explicit data-theme override and a system-preference
      // fallback when the host page hasn't set one — same convention the
      // rest of the site uses, just scoped to this widget's own vars.
      '.cxm-track{--ci:#0A0F1C;--cr:#121A2C;--cl:#222C42;--ca:#E0A93F;--caw:rgba(224,169,63,.14);--cds:#8792A8;',
      'position:relative;display:flex;align-items:center;justify-content:space-between;',
      'background:var(--cr);border:1px solid var(--cl);border-radius:999px;padding:4px;',
      'font-family:"IBM Plex Mono",ui-monospace,monospace;}',
      '@media (prefers-color-scheme:light){:root:not([data-theme="dark"]) .cxm-track{--cr:#FFFFFF;--cl:#E2E0D8;--cds:#636B80;}}',
      ':root[data-theme="light"] .cxm-track{--cr:#FFFFFF;--cl:#E2E0D8;--cds:#636B80;}',
      ':root[data-theme="dark"] .cxm-track{--cr:#121A2C;--cl:#222C42;--cds:#8792A8;}',
      '.cxm-thumb{position:absolute;top:4px;bottom:4px;background:var(--caw);border:1px solid var(--ca);',
      'border-radius:999px;transition:left .28s cubic-bezier(.2,.8,.2,1),width .28s cubic-bezier(.2,.8,.2,1);pointer-events:none;}',
      '.cxm-stop{position:relative;z-index:1;flex:0 0 auto;appearance:none;background:none;border:0;',
      'display:flex;align-items:center;justify-content:center;gap:4px;padding:7px 12px;cursor:pointer;',
      'border-radius:999px;color:var(--cds);font-family:inherit;font-size:8.5px;letter-spacing:.06em;',
      'text-transform:uppercase;transition:color .15s ease;}',
      '.cxm-stop.is-on{color:var(--ca);}',
      '.cxm-emoji{font-size:14px;line-height:1;}'
    ].join('');
    document.head.appendChild(tag);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Renders the picker into `container` and wires it up. Returns
  // { refresh() } so a caller can force a re-sync (e.g. after changing
  // mode some other way) without re-rendering the whole widget.
  function renderPicker(container, opts) {
    if (!container) return null;
    injectStyle();
    opts = opts || {};
    container.innerHTML =
      '<div class="cxm-track" role="radiogroup" aria-label="Manifesto builder mode">' +
        '<div class="cxm-thumb"></div>' +
        MODE_ORDER.map(function (m) {
          var d = LABELS[m];
          return '<button type="button" class="cxm-stop" data-mode="' + m + '" role="radio" title="' + esc(d.title) + '">' +
            '<span class="cxm-emoji" aria-hidden="true">' + d.emoji + '</span>' +
            '<span class="cxm-label">' + esc(d.label) + '</span>' +
          '</button>';
        }).join('') +
      '</div>';

    var track = container.querySelector('.cxm-track');
    var thumb = container.querySelector('.cxm-thumb');
    var stops = Array.prototype.slice.call(container.querySelectorAll('.cxm-stop'));

    function apply() {
      var current = get();
      stops.forEach(function (btn) {
        var on = btn.dataset.mode === current;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-checked', String(on));
        if (on) {
          thumb.style.left = btn.offsetLeft + 'px';
          thumb.style.width = btn.offsetWidth + 'px';
        }
      });
    }

    stops.forEach(function (btn) {
      btn.addEventListener('click', function () {
        set(btn.dataset.mode);
        apply();
        if (opts.onChange) opts.onChange(btn.dataset.mode);
      });
    });

    apply();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(apply);
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(apply, 150);
    });

    return { refresh: apply };
  }

  window.CivixMode = {
    MODE_ORDER: MODE_ORDER,
    hasManifesto: hasManifesto,
    get: get,
    set: set,
    renderPicker: renderPicker
  };
})();
