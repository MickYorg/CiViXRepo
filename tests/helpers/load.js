// Loads CiViX's real client code into Node for testing — no copies, no
// build step. The site is hand-written HTML with inline <script>s, so two
// loaders:
//   loadScript('digest.js', env)    — run a standalone client .js file in a
//                                     sandbox with a fake window/fetch/etc.
//   extractFunction('builder.html', 'parseAIJSON')
//                                   — pull one named function's source out
//                                     of a page and compile just that.
// If a function is renamed or moved, extractFunction throws, and the test
// fails loudly instead of silently testing nothing.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

// env: { fetch, location: {protocol, href, origin, pathname}, globals }
function loadScript(file, env = {}) {
  const href = (env.location && env.location.href) || 'https://mycivix.com/';
  const u = new URL(href);
  const location = Object.assign({ href, origin: u.origin, protocol: u.protocol, pathname: u.pathname, search: u.search }, env.location || {});
  const window = {
    location,
    localStorage: memoryStorage(),
    fetch: env.fetch || (async () => { throw new Error('fetch not stubbed'); }),
    console,
    setTimeout, clearTimeout,
    URL, Request: globalThis.Request, Response: globalThis.Response,
  };
  window.window = window;
  window.self = window;
  Object.assign(window, env.globals || {});
  const ctx = vm.createContext(window);
  vm.runInContext(read(file), ctx, { filename: file });
  return window;
}

// Finds `function <name>(` in a file and returns the compiled function.
// Brace-matches the body, skipping over strings, template literals,
// regex-free enough for the small pure helpers this is used on.
function extractFunction(file, name, deps = {}) {
  const src = read(file);
  const start = src.search(new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`));
  if (start === -1) throw new Error(`${name} not found in ${file} — renamed or moved?`);
  let i = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  let quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    // A regex literal (e.g. /^```json/) can contain quotes and braces, so
    // skip it whole. It's a regex, not division, when the last non-space
    // character before it is an operator or opening punctuation.
    if (c === '/') {
      let p = i - 1;
      while (p > 0 && /\s/.test(src[p])) p--;
      if (/[(,=:[!&|?{};+\-*%<>~^]/.test(src[p]) || /\breturn$/.test(src.slice(Math.max(0, p - 6), p + 1))) {
        let inClass = false;
        for (i++; i < src.length; i++) {
          if (src[i] === '\\') { i++; continue; }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) break;
        }
        continue;
      }
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) break;
  }
  const fnSrc = src.slice(start, i + 1);
  const ctx = vm.createContext(Object.assign({ console }, deps));
  return vm.runInContext(`(${fnSrc})`, ctx, { filename: `${file}#${name}` });
}

// A fetch stub from a route table: { '/api/calendar': body | (url, init) => body }.
// Returns 404 for anything unlisted, and records every URL it was asked for.
function routeFetch(routes) {
  const calls = [];
  const fn = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response('{"error":{"message":"not stubbed"}}', { status: 404 });
    const val = typeof routes[key] === 'function' ? await routes[key](url, init) : routes[key];
    if (val instanceof Response) return val;
    return new Response(JSON.stringify(val), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

module.exports = { ROOT, read, loadScript, extractFunction, routeFetch };
