#!/usr/bin/env node
// phone-check.js — renders CiViX's pages at real iPhone sizes and flags the
// layout problems that have kept coming back on the phone: content wider
// than the screen (sideways scroll / clipped text), text too small to read,
// and tap targets too small to hit. Run it after any visual change:
//
//   npm run phone-check                 # all pages, all phones
//   npm run phone-check -- builder      # pages whose name contains "builder"
//   npm run phone-check -- --laptop     # also a MacBook-size reference shot
//
// Serves this repo's files locally (so it checks what you're about to ship,
// not what's live) and proxies /api/* to https://mycivix.com so pages fill
// with real data. Uses the Chrome already installed on this Mac over the
// DevTools protocol — no Puppeteer/Playwright download. Chrome's mobile
// emulation isn't WKWebView, so this catches layout/sizing regressions, not
// every iOS quirk; a final look on the Simulator or a real iPhone still
// matters for anything native (safe areas, the bottom nav, keyboard).
//
// Screenshots + report land in phone-check-out/ (gitignored). Exits 1 if
// any page scrolls sideways, or if any page has more tiny text / small tap
// targets than tests/phone-baseline.json allows (the ratchet: pages can
// improve, never regress). `--update-baseline` accepts the current counts.
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'phone-check-out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8787;
const CDP_PORT = 9229 + Math.floor(Math.random() * 500);

// Smallest current iPhone, the common size, and the largest.
const PHONES = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-16', width: 393, height: 852 },
  { name: 'iphone-16-pro-max', width: 440, height: 956 },
];
// --laptop adds a MacBook-sized reference shot, for comparing what a page
// is meant to look like against how it lands on the phone.
const LAPTOP = { name: 'laptop', width: 1440, height: 900, laptop: true };

// Thresholds. 12px is the smallest body/label text that stays comfortably
// readable at arm's length on a phone; 11px is tolerated for tiny mono
// eyebrow labels, anything below is flagged. 40px matches the lower end of
// Apple's 44pt tap-target guidance with a little slack for inline links.
const MIN_FONT = 11;
const MIN_TAP = 40;

// state: 'new' = brand-new citizen (empty storage); otherwise a /dev/ persona.
// wait: ms to let animations/fetches settle before the shot.
const PAGES = [
  // The splash's amendment sequence resolves ~7.4s in and auto-advances to
  // the builder ~4.5s after that, so 9.5s lands on the finished screen.
  { name: 'splash-new', url: '/index.html', state: 'new', wait: 9500 },
  { name: 'splash-returning', url: '/index.html', state: 'medium', wait: 9500 },
  { name: 'builder-new', url: '/builder.html', state: 'new', wait: 3000 },
  { name: 'builder-citizen', url: '/builder.html', state: 'medium', mode: 'citizen', wait: 3000 },
  { name: 'builder-pro', url: '/builder.html', state: 'wonk', mode: 'pro', wait: 3000 },
  { name: 'take-action', url: '/take-action.html', state: 'medium', wait: 9000 },
  // Calendar's plan is cached for 24h per manifesto after its first (~40s)
  // generation, so repeat runs render the full plan within a few seconds.
  { name: 'calendar', url: '/calendar.html', state: 'medium', wait: 7000 },
  { name: 'dig', url: '/dig/index.html', state: 'medium', wait: 3000 },
  { name: 'send-to-civix', url: '/send-to-civix.html', state: 'medium', wait: 3000 },
  { name: 'analytics', url: '/analytics.html', state: 'medium', wait: 3000 },
  { name: 'health', url: '/health.html', state: 'new', wait: 3000 },
  { name: 'civix101', url: '/civix101.html', state: 'new', wait: 1500 },
];

// Pull the /dev/ persona fixtures straight out of dev/index.html so there's
// one source of truth for "what a realistic manifesto looks like."
function loadPersonas() {
  const src = fs.readFileSync(path.join(ROOT, 'dev/index.html'), 'utf8');
  const start = src.indexOf('{', src.indexOf('var PERSONAS ='));
  let depth = 0, i = start;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  const daysAgo = (n) => Date.now() - n * 86400000;
  return new Function('daysAgo', 'return ' + src.slice(start, i + 1))(daysAgo);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) {
        const up = https.request('https://mycivix.com' + req.url, {
          method: req.method,
          headers: { 'content-type': req.headers['content-type'] || 'application/json', 'user-agent': 'civix-phone-check' },
        }, (r) => { res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || '' }); r.pipe(res); });
        up.on('error', () => { res.writeHead(500); res.end('{}'); });
        req.pipe(up);
        return;
      }
      let p = decodeURIComponent(req.url.split('?')[0]);
      // An empty page on this origin to seed localStorage from (an empty
      // 404 would become Chrome's own error page, on a different origin).
      if (p === '/phone-check-blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html>'); return; }
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'civix-phone-check-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`, ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank',
  ], { stdio: 'ignore' });
  // Up to 30s: GitHub's CI machines can take well over 10s to start Chrome.
  for (let i = 0; i < 150; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return { proc, profile, wsUrl: page.webSocketDebuggerUrl };
    } catch (e) {}
    await sleep(200);
  }
  throw new Error('Chrome did not start — set CHROME_PATH if it lives elsewhere');
}

function connect(wsUrl) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, fail } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
      }
    };
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((ok, fail) => {
        const n = ++id;
        pending.set(n, { ok, fail });
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Storage has to be seeded on the localhost origin, so wait until the
// blank page has actually committed (not still about:blank or the last page).
async function waitForOrigin(cdp) {
  for (let i = 0; i < 40; i++) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    if (String(result.value).endsWith('/phone-check-blank')) return;
    await sleep(100);
  }
  throw new Error('blank seeding page never loaded');
}

// Runs inside the page. Returns overflow offenders, small text, small taps.
function audit(minFont, minTap) {
  const vw = document.documentElement.clientWidth;
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.classList.length) s += '.' + [...el.classList].slice(0, 2).join('.');
    const t = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return t ? `${s} "${t}"` : s;
  };
  // An element only really overflows if nothing between it and the page
  // clips or scrolls it (a horizontal chip scroller is fine, by design).
  // Also skips anything inside a fixed-position overlay (e.g. the civics
  // popup mid-animation): it can't make the page scroll sideways.
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const o = cs.overflowX;
      if (o === 'hidden' || o === 'auto' || o === 'scroll' || o === 'clip' || cs.position === 'fixed') return true;
    }
    return false;
  };
  const overflow = [];
  // Problems are counted per *kind* of element (tag + classes), not per
  // element, so a page showing 3 bills vs 7 bills today doesn't change the
  // count; one example of each is kept for the report.
  const smallText = new Map(), smallTap = new Map();
  const kind = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : [...el.classList].sort().map((c) => '.' + c).join(''));
  const note = (map, key, example) => { if (!map.has(key)) map.set(key, example); };
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el) || el.closest('.cxs-nav')) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !clipped(el) && getComputedStyle(el).position !== 'fixed') {
      overflow.push(`${label(el)} spans ${Math.round(r.left)}–${Math.round(r.right)}px (screen is ${vw}px)`);
    }
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasOwnText) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < minFont) note(smallText, `${kind(el)} at ${fs}px`, label(el));
    }
    if (el.matches('button, a.btn, [role=button], select, input:not([type=hidden]), .chip')) {
      if (r.height < minTap && r.width < 200) note(smallTap, `${kind(el)} ${Math.round(r.height)}px tall`, label(el));
    }
  }
  const uniq = (a) => [...new Set(a)];
  // Keep the outermost offenders only — children of an overflowing box are noise.
  return {
    pageWidth: document.documentElement.scrollWidth, viewport: vw,
    overflow: uniq(overflow).slice(0, 12),
    smallText: [...smallText].map(([k, ex]) => `${k} — e.g. ${ex}`),
    smallTap: [...smallTap].map(([k, ex]) => `${k} — e.g. ${ex}`),
  };
}

async function shoot(cdp, page, phone, personas) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: phone.width, height: phone.height, deviceScaleFactor: phone.laptop ? 1 : 2, mobile: !phone.laptop,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !phone.laptop, maxTouchPoints: 5 });
  if (!phone.laptop) await cdp.send('Network.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  // Seed storage from a blank page on the same origin, then load the target.
  await cdp.send('Page.navigate', { url: `http://localhost:${PORT}/phone-check-blank` });
  await waitForOrigin(cdp);
  const profile = page.state === 'new' ? null : personas[page.state];
  const mode = page.mode || (page.state === 'wonk' ? 'pro' : page.state === 'new' ? '' : 'activist');
  await cdp.send('Runtime.evaluate', {
    expression: `localStorage.clear();
      ${profile ? `localStorage.setItem('civix-profile', ${JSON.stringify(JSON.stringify(profile))});` : ''}
      ${mode ? `localStorage.setItem('civix-mode', '${mode}');` : ''}
      ${page.state !== 'new' ? `localStorage.setItem('civix-splash-seen', String(Date.now())); localStorage.setItem('civix-splash-visits', '3');` : ''}`,
  });
  await cdp.send('Page.navigate', { url: `http://localhost:${PORT}${page.url}` });
  await sleep(page.wait);
  if (profile) {
    const { result: seeded } = await cdp.send('Runtime.evaluate', {
      expression: "(JSON.parse(localStorage.getItem('civix-profile') || '{}').issues || []).length", returnByValue: true,
    });
    if (!seeded.value) console.warn(`  ! ${page.name}: test manifesto didn't stick`);
  }

  const { result } = await cdp.send('Runtime.evaluate', {
    expression: `(${audit.toString()})(${MIN_FONT}, ${MIN_TAP})`, returnByValue: true,
  });
  const base = path.join(OUT, `${page.name}--${phone.name}`);
  const top = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(base + '.png', Buffer.from(top.data, 'base64'));
  const full = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: true });
  fs.writeFileSync(base + '--full.jpg', Buffer.from(full.data, 'base64'));
  return result.value;
}

(async () => {
  const args = process.argv.slice(2);
  const filter = args.find((a) => !a.startsWith('--'));
  const phones = args.includes('--laptop') ? [...PHONES, LAPTOP] : PHONES;
  const pages = PAGES.filter((p) => !filter || p.name.includes(filter));
  fs.mkdirSync(OUT, { recursive: true });
  const personas = loadPersonas();
  const server = await serve();
  const chrome = await launchChrome();
  const cdp = await connect(chrome.wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  // Test runs load pages as brand-new citizens; never let them create real
  // Send to CiViX dockets (or file anything) on the production capture server.
  await cdp.send('Network.setBlockedURLs', { urls: ['*civix-capture.mycivix.workers.dev/api/docket*', '*civix-capture.mycivix.workers.dev/api/filing*'] });

  const report = [];
  let sideways = 0;
  try {
    for (const page of pages) {
      for (const phone of phones) {
        const r = await shoot(cdp, page, phone, personas);
        const bad = !phone.laptop && r.pageWidth > r.viewport + 1;
        if (bad) {
          sideways++;
          if (process.env.GITHUB_ACTIONS) console.log(`::error title=Phone layout: ${page.name}@${phone.name}::page scrolls sideways (${r.pageWidth}px wide on a ${r.viewport}px screen)`);
        }
        report.push({ page: page.name, phone: phone.name, ...r });
        console.log(`${bad ? '✗' : '✓'} ${page.name} @ ${phone.name}: ` +
          `${bad ? `SCROLLS SIDEWAYS (${r.pageWidth}px on a ${r.viewport}px screen), ` : ''}` +
          `${r.overflow.length} overflowing, ${r.smallText.length} tiny-text, ${r.smallTap.length} small-tap`);
      }
    }
  } finally {
    cdp.close();
    chrome.proc.kill();
    await new Promise((r) => chrome.proc.once("exit", r));
    server.close();
    fs.rmSync(chrome.profile, { recursive: true, force: true });
  }

  const lines = ['# Phone check', '', `Run ${new Date().toISOString()}`, ''];
  for (const r of report) {
    lines.push(`## ${r.page} @ ${r.phone}`, '');
    if (r.pageWidth > r.viewport + 1) lines.push(`**Scrolls sideways:** ${r.pageWidth}px wide on a ${r.viewport}px screen`, '');
    for (const [k, title] of [['overflow', 'Wider than the screen'], ['smallText', `Text under ${MIN_FONT}px`], ['smallTap', `Tap targets under ${MIN_TAP}px`]]) {
      if (r[k].length) lines.push(`${title}:`, ...r[k].map((x) => `- ${x}`), '');
    }
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'));
  console.log(`\nScreenshots + report: ${path.relative(process.cwd(), OUT)}/`);

  // Ratchet: tests/phone-baseline.json records how many tiny-text /
  // small-tap problems each page had when last accepted. A page may get
  // better, never worse. `--update-baseline` accepts the current numbers
  // (do that deliberately, after looking at the screenshots).
  const baselinePath = path.join(ROOT, 'tests', 'phone-baseline.json');
  let baseline = {};
  try { baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')); } catch (e) {}
  let worse = 0;
  for (const r of report) {
    if (r.phone === 'laptop') continue;
    const key = `${r.page}@${r.phone}`;
    const now = { smallText: r.smallText.length, smallTap: r.smallTap.length };
    const was = baseline[key];
    if (args.includes('--update-baseline')) { baseline[key] = now; continue; }
    if (!was) { console.log(`  (no baseline yet for ${key})`); continue; }
    for (const k of ['smallText', 'smallTap']) {
      if (now[k] > was[k]) {
        worse++;
        console.log(`✗ ${key}: ${k} got worse (${was[k]} → ${now[k]}) — see phone-check-out/report.md`);
        if (process.env.GITHUB_ACTIONS) console.log(`::error title=Phone layout: ${key}::${k === 'smallText' ? 'more text too small to read' : 'more tap targets too small'} (${was[k]} → ${now[k]})`);
      }
    }
  }
  if (args.includes('--update-baseline')) {
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
    console.log('Baseline updated: tests/phone-baseline.json');
  }
  process.exit(sideways || worse ? 1 : 0);
})().catch((e) => {
  console.error(e);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=Phone layout check crashed::${String(e && e.message || e).replace(/\r?\n/g, ' ')}`);
  process.exit(2);
});
