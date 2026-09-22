// app-shell.js — native app chrome, added only when running inside the
// Capacitor wrapper. Mirrors civics.js/mode.js's pattern (self-guarding
// window global, own scoped styling, no dependency on a host page's CSS)
// so this drops into index.html/builder.html/take-action.html/calendar.html/
// dig/index.html with a single <script> include and nothing else.
//
// Deliberately gated on Capacitor.isNativePlatform() so the exact same
// bundled HTML serves both the public mycivix.com website (untouched) and
// the native app (gets this bottom nav bar) from one copy of each page —
// no second set of pages, no build-time branching.
(function () {
  'use strict';
  if (window.CivixShell) return;
  if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) {
    window.CivixShell = { active: false };
    return;
  }

  var TABS = [
    { href: '/index.html', match: /^\/(index\.html)?$/, emoji: '\u{1F3E0}', label: 'Home' },
    { href: '/builder.html', match: /^\/builder\.html$/, emoji: '\u{1F4DD}', label: 'Manifesto' },
    { href: '/take-action.html', match: /^\/take-action\.html$/, emoji: '\u{1F4E3}', label: 'Take Action' },
    { href: '/calendar.html', match: /^\/calendar\.html$/, emoji: '\u{1F5D3}\u{FE0F}', label: 'Calendar' },
    { href: '/dig/index.html', match: /^\/dig\//, emoji: '\u{1F50D}', label: 'DIG' }
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function injectStyle() {
    var tag = document.createElement('style');
    tag.textContent = [
      '.cxs-nav{--ci:#0A0F1C;--cr:#121A2C;--cl:#222C42;--ca:#E0A93F;--cds:#8792A8;',
      'position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;',
      'background:var(--cr);border-top:1px solid var(--cl);',
      'padding-bottom:env(safe-area-inset-bottom, 0px);',
      'font-family:"IBM Plex Mono",ui-monospace,monospace;}',
      '@media (prefers-color-scheme:light){:root:not([data-theme="dark"]) .cxs-nav{--cr:#FFFFFF;--cl:#E2E0D8;--cds:#636B80;}}',
      ':root[data-theme="light"] .cxs-nav{--cr:#FFFFFF;--cl:#E2E0D8;--cds:#636B80;}',
      ':root[data-theme="dark"] .cxs-nav{--cr:#121A2C;--cl:#222C42;--cds:#8792A8;}',
      '.cxs-tab{flex:1 1 0;appearance:none;background:none;border:0;display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;gap:2px;padding:8px 4px 6px;cursor:pointer;',
      'color:var(--cds);font-family:inherit;text-decoration:none;}',
      '.cxs-tab.is-on{color:var(--ca);}',
      '.cxs-tab-emoji{font-size:18px;line-height:1;}',
      '.cxs-tab-label{font-size:9px;letter-spacing:.04em;text-transform:uppercase;}',
      'body.cxs-has-nav{padding-bottom:calc(58px + env(safe-area-inset-bottom, 0px)) !important;}'
    ].join('');
    document.head.appendChild(tag);
  }

  function currentTab() {
    var path = location.pathname;
    for (var i = 0; i < TABS.length; i++) {
      if (TABS[i].match.test(path)) return TABS[i].href;
    }
    return null;
  }

  function render() {
    injectStyle();
    document.body.classList.add('cxs-has-nav');
    var active = currentTab();
    var nav = document.createElement('nav');
    nav.className = 'cxs-nav';
    nav.setAttribute('aria-label', 'CiViX');
    nav.innerHTML = TABS.map(function (t) {
      var on = t.href === active;
      return '<a class="cxs-tab' + (on ? ' is-on' : '') + '" href="' + esc(t.href) + '">' +
        '<span class="cxs-tab-emoji" aria-hidden="true">' + t.emoji + '</span>' +
        '<span class="cxs-tab-label">' + esc(t.label) + '</span>' +
      '</a>';
    }).join('');
    document.body.appendChild(nav);
  }

  function wireBackButton() {
    try {
      var App = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (!App) return;
      App.addListener('backButton', function (data) {
        if (data && data.canGoBack) history.back();
        else App.exitApp();
      });
    } catch (e) {}
  }

  function wireStatusBar() {
    try {
      var StatusBar = window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
      if (!StatusBar) return;
      StatusBar.setBackgroundColor({ color: '#0A0F1C' });
      StatusBar.setStyle({ style: 'DARK' });
      StatusBar.setOverlaysWebView({ overlay: false });
    } catch (e) {}
  }

  function init() {
    render();
    wireBackButton();
    wireStatusBar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.CivixShell = { active: true, TABS: TABS };
})();
