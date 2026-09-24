// native-fetch.js — makes relative /api/ calls reach the real server when
// running inside the iOS app. Must load in <head>, before any page script
// fetches anything.
//
// Why: Capacitor iOS serves the bundled pages at capacitor://mycivix.com
// (WKWebView won't let an app claim the https scheme, so capacitor.config's
// iosScheme is ignored). A relative fetch('/api/...') therefore resolves to
// capacitor://mycivix.com/api/..., which Capacitor's own local file handler
// answers with bundled HTML — every Function call silently got a web page
// back instead of JSON. Rewriting those to https://mycivix.com/api/... sends
// them to Cloudflare for real; functions/api/_middleware.js allowlists the
// capacitor://mycivix.com origin for the resulting cross-origin requests.
//
// No-op everywhere else: the public website and the Android app (which runs
// at https://mycivix.com and handles /api/ in MainActivity.java) never have
// the capacitor: protocol.
(function () {
  'use strict';
  window.CIVIX_PUBLIC_ORIGIN = 'https://mycivix.com';
  if (location.protocol !== 'capacitor:' || !window.fetch) return;

  var nativeFetch = window.fetch.bind(window);

  function remote(url) {
    try {
      var u = new URL(url, location.href);
      if (u.origin === location.origin && u.pathname.indexOf('/api/') === 0) {
        return window.CIVIX_PUBLIC_ORIGIN + u.pathname + u.search;
      }
    } catch (e) {}
    return null;
  }

  window.fetch = function (input, init) {
    if (typeof input === 'string' || input instanceof URL) {
      var s = remote(String(input));
      if (s) input = s;
    } else if (input && input.url) {
      var r = remote(input.url);
      if (r) input = new Request(r, input);
    }
    return nativeFetch(input, init);
  };
})();
