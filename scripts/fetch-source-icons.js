#!/usr/bin/env node
// Downloads each Source Map outlet's own icon once and stores it in
// assets/source-icons/<slug>.png (96x96), so the page never loads images
// from Google or the outlets themselves (viewers' browsing stays private).
// Tries the outlet's high-resolution home-screen icon first, then Google's
// favicon service (fetched from here, once, not by viewers).
//   node scripts/fetch-source-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'source-icons');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

// Sources whose DIG hint isn't a web address.
const DOMAINS = {
  'Breaking Points': 'breakingpoints.com',
  'Glenn Greenwald': 'greenwald.substack.com',
  'Matt Taibbi': 'racket.news',
  'Timcast IRL': 'timcast.com',
  'The Young Turks': 'tyt.com',
  'Public': 'public.news',
  'Pod Save America': 'crooked.com',
  'Jimmy Dore': 'jimmydore.com',
  'Marketplace': 'marketplace.org',
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function sources() {
  const src = fs.readFileSync(path.join(ROOT, 'sources-map.html'), 'utf8');
  return [...src.matchAll(/name: "([^"]+)", hint: "([^"]+)"/g)].map(([, name, hint]) => {
    const m = /([a-z0-9-]+\.)+[a-z]{2,}/i.exec(hint);
    return { name, domain: DOMAINS[name] || (m ? m[0].replace(/\/.*/, '') : null) };
  }).concat(Object.keys(DOMAINS).filter((n) => n === 'Marketplace').map((n) => ({ name: n, domain: DOMAINS[n] })));
}

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const type = r.headers.get('content-type') || '';
  if (!/image|octet-stream/.test(type)) throw new Error('not an image: ' + type);
  return Buffer.from(await r.arrayBuffer());
}

async function toPng(buf) {
  const img = sharp(buf, { density: 300 });
  const meta = await img.metadata();
  if (!meta.width || meta.width < 32) throw new Error('too small');
  return img.resize(96, 96, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = [];
  for (const s of sources()) {
    if (!s.domain) { report.push(`- ${s.name}: no web address`); continue; }
    const tries = [
      [`https://${s.domain}/apple-touch-icon.png`, 'own icon'],
      [`https://${s.domain}/apple-touch-icon-precomposed.png`, 'own icon'],
      [`https://www.google.com/s2/favicons?domain=${s.domain}&sz=128`, 'site favicon'],
    ];
    let done = false;
    for (const [url, how] of tries) {
      try {
        const png = await toPng(await get(url));
        fs.writeFileSync(path.join(OUT, slug(s.name) + '.png'), png);
        report.push(`- ${s.name}: ${how} (${s.domain})`);
        done = true;
        break;
      } catch (e) { /* next */ }
    }
    if (!done) report.push(`- ${s.name}: none found (${s.domain})`);
  }
  console.log(report.join('\n'));
})();
