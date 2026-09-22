// push.js — real push notifications for the watchlist, native-app only.
// Mirrors civics.js/mode.js's self-guarding-IIFE convention. No UI of its
// own — take-action.html's renderWatchingZone() owns the actual opt-in
// button/copy and calls into this for the mechanics, same separation
// mode.js already has from its own renderPicker() callers.
//
// Deliberately request-permission-on-explicit-tap only, never a cold-start
// OS prompt — both because Apple review specifically dings blind prompts
// and because an unexplained permission dialog is exactly the kind of
// friction the app is trying not to have.
(function () {
  'use strict';
  if (window.CivixPush) return;

  var TOKEN_KEY = 'civix-push-token';
  var PROFILE_KEY = 'civix-profile';

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  function plugin() {
    return isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
  }

  function loadProfile() {
    try {
      var raw = localStorage.getItem(PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function currentWatching() {
    var p = loadProfile();
    return (p && Array.isArray(p.watching)) ? p.watching.map(function (w) {
      return { key: w.key, kind: w.kind, lastSeenActionDate: w.lastSeenActionDate || null };
    }) : [];
  }

  function storedToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }

  function platform() {
    try { return window.Capacitor.getPlatform(); } catch (e) { return 'android'; }
  }

  function register(token) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
    var zip = '';
    try { zip = (loadProfile() && loadProfile().place && loadProfile().place.zip) || ''; } catch (e) {}
    return fetch('/api/push-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, platform: platform(), zip: zip, watching: currentWatching() })
    }).catch(function () { /* best-effort, same stance as every other background sync in this app */ });
  }

  var listenersWired = false;
  function wireListeners() {
    var P = plugin();
    if (!P || listenersWired) return;
    listenersWired = true;
    P.addListener('registration', function (data) {
      if (data && data.value) register(data.value);
    });
    P.addListener('registrationError', function () { /* silent — same fail-open stance as other best-effort features here */ });
    P.addListener('pushNotificationActionPerformed', function () {
      // Payloads are deliberately generic (see workers/push-scheduler) — a
      // tap always sends the citizen to their own watchlist to see what
      // actually changed, never to a deep link naming the specific bill.
      if (!/take-action\.html$/.test(location.pathname)) location.href = '/take-action.html';
    });
  }

  // Explicit, contextual opt-in — called only from a real tap on a button
  // the citizen sees and understands, never on page load.
  function requestPermission() {
    var P = plugin();
    if (!P) return Promise.resolve(false);
    wireListeners();
    return P.checkPermissions()
      .then(function (status) {
        if (status && status.receive === 'granted') return true;
        return P.requestPermissions().then(function (s) { return s && s.receive === 'granted'; });
      })
      .then(function (granted) {
        if (granted) P.register();
        return granted;
      })
      .catch(function () { return false; });
  }

  function isEnabled() {
    return !!storedToken();
  }

  // Called whenever the watchlist changes (toggleWatch()), so the
  // server-side snapshot stays current. No-op for a citizen who never
  // opted in — there's no token to resync.
  function resync() {
    var token = storedToken();
    if (!token) return Promise.resolve();
    return register(token);
  }

  // A real delete, not a local toggle: revokes the stored token server-side
  // (workers/push-scheduler stops seeing this device at all) and clears the
  // local record. Does not attempt to revoke the OS-level permission grant
  // itself — neither platform exposes an API for an app to do that; the OS
  // Settings app is the only place that can be undone, same as any app.
  function disable() {
    var token = storedToken();
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    if (!token) return Promise.resolve();
    return fetch('/api/push-register', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    }).catch(function () {});
  }

  window.CivixPush = {
    available: !!plugin(),
    isEnabled: isEnabled,
    requestPermission: requestPermission,
    resync: resync,
    disable: disable
  };
})();
