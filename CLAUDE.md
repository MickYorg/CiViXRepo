# CiViX — project context

CiViX (mycivix.com) is a civic engagement platform: build a private profile of
what you care about, match it against the municipal/state/federal calendar,
turn it into action. Built mostly through Claude chat/artifact sessions —
this file exists so a fresh Claude Code session has the context instantly.

## Current state (as of 24 Aug 2026)

No shared build system — every page is a standalone HTML file with its own
inline `<style>`/`<script>`, no bundler, no framework. That's fine for now;
see "Deliberately not yet done" below for why.

**Real, working:**
- `index.html` — animated splash/landing page
- `dig/index.html` + `netlify/functions/dig-check.js` + `dig-stats.js` — DIG,
  an AI stance-checker across news/commentary sources. Has a real backend:
  daily spend cap, per-IP rate limit, anonymous usage stats, all originally
  built on Netlify Functions + `@netlify/blobs`.
- `capture.html` + `manifest.webmanifest` + `sw.js` — "Send to CiViX", an
  installable PWA share-target. Client-only, `localStorage`, no backend.

**Substantial but not connected to anything:**
- `builder.html` — the "build your profile" flow, the actual core product
  mechanic (the splash's CTA points here). Doesn't yet read from DIG or
  write anywhere the placeholder pages can consume.

**Placeholders (styled to match, no real functionality):**
- `inbox.html`, `calendar.html`, `connect.html`, `civil-dis.html`,
  `civix-track.html`, `analytics.html`

**Not in this repo at all:**
- PolTraPro (poltrapro.com) — separate product, own domain, linked from the
  splash. Relationship to CiViX (same family vs. unrelated) not yet decided.

## In progress: Netlify → Cloudflare migration

The site just moved hosting from Netlify to Cloudflare. **Unresolved as of
this writing:** `netlify.toml` and `netlify/functions/*.js` are still present
and still Netlify-specific (they use `@netlify/blobs` for storage and the
Netlify Functions v2 Request/Response convention). Cloudflare Pages does NOT
run Netlify Functions automatically — it needs its own `/functions` directory
convention and a different storage backend (Workers KV or D1 instead of
Netlify Blobs).

A live check on 24 Aug 2026 showed `mycivix.com/dig/` loading, but its
community-stats panel stuck on "Loading…" — consistent with `/api/dig-check`
and `/api/dig-stats` no longer resolving post-migration. **First thing to
verify**: whether the backend functions were ported to Cloudflare Pages
Functions, or only the static files moved.

## Known housekeeping debt

- **No git history** — the project has never been under version control.
  `git init` + one commit as a checkpoint should happen before anything else
  changes. A `.gitignore` (excluding `.wrangler/`, `.DS_Store`, `node_modules/`)
  is already in the folder root, ready for this.
- **Design tokens are hand-copied per page**, and have already drifted:
  `index.html`/`calendar.html`/`builder.html` share one token system (navy/
  paper/amber, Newsreader + IBM Plex Mono); `capture.html` runs a visibly
  different one (different amber, different fonts — JetBrains Mono + Source
  Serif 4). Worth extracting into one shared stylesheet all pages `<link>` to.
- `package.json` is still named `dig-selfhosted` — a leftover from before the
  folder held more than one tool.

## Deliberately not yet done

Holding off on a bundler/framework on purpose — nothing here needs
client-side routing or shared component state yet. The real trigger to
revisit that is a logged-in profile that needs to be read on more than one
page; that's genuine shared state and the point where a framework starts
paying for itself.

## Where the MVP is actually blocked

The splash's pitch — profile → matched to civic calendar → action you
control — has every piece built as a separate, disconnected artifact.
Recommended next move: pick **one geography + one action type**, wire
`builder.html`'s output through to one real, live civic data source for that
slice, and prove the loop end-to-end before generalizing. DIG and the docket
are already independently useful and don't need to block this.
