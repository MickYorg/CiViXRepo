// One-off script (not part of any build pipeline) that renders a first-pass
// CiViX app icon from plain SVG using sharp/librsvg, already a transitive
// dependency of @capacitor/assets. Geometric, no text/fonts, so it stays
// legible at small sizes and avoids any font-availability issues at render
// time. Swap assets/icon.png (and re-run @capacitor/assets) for real brand
// art later — nothing downstream needs to change.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const INK = '#0A0F1C';
const AMBER = '#E0A93F';

// Solid navy square — the base icon and the Android adaptive-icon background.
const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="${INK}"/>
</svg>`;

// Amber ring (a civic seal / coin, echoing CiViX Coin) with a checkmark cut
// through the middle (echoing "take a stand, get heard"). Pure geometry.
function markSvg(size, cx, cy, scale) {
  const r = 300 * scale;
  const ringWidth = 70 * scale;
  const checkStroke = 70 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${AMBER}" stroke-width="${ringWidth}"/>
    <path d="M ${cx - 150 * scale} ${cy + 10 * scale} L ${cx - 40 * scale} ${cy + 130 * scale} L ${cx + 170 * scale} ${cy - 140 * scale}"
      fill="none" stroke="${AMBER}" stroke-width="${checkStroke}" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

const outDir = path.join(__dirname, '..', 'assets');

async function main() {
  // Full icon: navy background + centered mark (for iOS / legacy Android / store listing).
  const bg = sharp(Buffer.from(bgSvg));
  const mark = Buffer.from(markSvg(1024, 512, 512, 1));
  await bg.clone().composite([{ input: mark, top: 0, left: 0 }]).png().toFile(path.join(outDir, 'icon.png'));

  // Adaptive icon halves — foreground mark is scaled down and kept within
  // the ~66% safe zone Android's adaptive-icon mask actually shows.
  await sharp(Buffer.from(bgSvg)).png().toFile(path.join(outDir, 'icon-background.png'));
  const fgTransparent = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    ${markSvg(1024, 512, 512, 0.62).replace(/^<svg[^>]*>|<\/svg>$/g, '')}
  </svg>`;
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(fgTransparent), top: 0, left: 0 }])
    .png().toFile(path.join(outDir, 'icon-foreground.png'));

  // Splash — same mark, smaller, centered on a full-bleed navy field.
  const splashSize = 2732;
  const splashBg = `<svg xmlns="http://www.w3.org/2000/svg" width="${splashSize}" height="${splashSize}"><rect width="${splashSize}" height="${splashSize}" fill="${INK}"/></svg>`;
  const splashMark = Buffer.from(markSvg(splashSize, splashSize / 2, splashSize / 2, 1));
  await sharp(Buffer.from(splashBg)).composite([{ input: splashMark, top: 0, left: 0 }]).png().toFile(path.join(outDir, 'splash.png'));

  console.log('Icon assets written to', outDir);
}

main().catch(e => { console.error(e); process.exit(1); });
