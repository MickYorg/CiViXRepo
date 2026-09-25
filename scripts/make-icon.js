// Renders the CiViX app icon: the splash page's wordmark ("CiViX" in
// Newsreader bold — C, V, X in the splash's off-white, both i's in amber)
// on the splash's navy. Rendered by the Chrome already on this Mac so the
// real web font is used (librsvg can't load Google Fonts), then the
// platform icon sets are generated from it:
//
//   node scripts/make-icon.js && npx capacitor-assets generate --ios --android
//
// Writes assets/icon.png (iOS + fallback: wordmark on navy),
// assets/icon-foreground.png (Android adaptive foreground: wordmark on
// transparent, inside the adaptive-icon safe zone),
// assets/icon-background.png (plain navy) and assets/splash(-dark).png
// (launch screen: the wordmark, smaller, on navy). The first-pass geometric icon
// (amber ring + check) lives in git history.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const INK = '#0A0F1C';      // splash --ink (dark theme)
const PAPER = '#ECEAE2';    // splash --paper: the wordmark's C, V, X
const AMBER = '#E0A93F';    // splash --amber-ink: the i's
const OUT = path.resolve(__dirname, '..', 'assets');
const SIZE = 1024;

// widthShare: how much of the canvas width the wordmark spans.
function page({ background, widthShare, size = SIZE }) {
  return `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,700&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${background}; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; }
  .mark { font-family: 'Newsreader', serif; font-weight: 700; letter-spacing: -0.01em;
          color: ${PAPER}; white-space: nowrap; line-height: 1; font-size: 100px;
          /* optical centering: serif cap height sits a touch high */
          transform: translateY(12%); }
  .mark em { font-style: normal; color: ${AMBER}; }
</style></head><body>
<div class="mark" id="m">C<em>i</em>V<em>i</em>X</div>
<script>
  document.fonts.ready.then(() => {
    const m = document.getElementById('m');
    m.style.fontSize = (100 * ${size * widthShare} / m.getBoundingClientRect().width) + 'px';
  });
</script></body></html>`;
}

function render(name, opts, transparent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'civix-icon-'));
  const html = path.join(dir, 'icon.html');
  fs.writeFileSync(html, page(opts));
  const out = path.join(OUT, name);
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${opts.size || SIZE},${opts.size || SIZE}`, '--virtual-time-budget=10000',
    ...(transparent ? ['--default-background-color=00000000'] : []),
    `--screenshot=${out}`, 'file://' + html,
  ], { stdio: 'ignore' });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('wrote', path.relative(process.cwd(), out));
}

// iOS masks the square to a rounded rect; 76% width keeps the X clear of it.
render('icon.png', { background: INK, widthShare: 0.76 });
// Android adaptive icons crop to a circle/squircle inside the middle ~66%.
render('icon-foreground.png', { background: 'transparent', widthShare: 0.56 }, true);
render('icon-background.png', { background: INK, widthShare: 0 });
// Launch screen: the same wordmark, smaller, centered on navy.
render('splash.png', { background: INK, widthShare: 0.3, size: 2732 });
render('splash-dark.png', { background: INK, widthShare: 0.3, size: 2732 });
