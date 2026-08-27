# CiViX — project context

CiViX (mycivix.com) is a civic engagement platform: build a private profile of
what you care about, match it against the municipal/state/federal calendar,
turn it into action. Built mostly through Claude chat/artifact sessions —
this file exists so a fresh Claude Code session has the context instantly.

## Current state (as of 25 Aug 2026)

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

## Netlify → Cloudflare migration — done

The site moved hosting from Netlify to Cloudflare and the backend port is
complete and verified live. `functions/api/dig-check.js` and
`functions/api/dig-stats.js` are the Cloudflare Pages Functions equivalents
of the old `netlify/functions/*.js`, using Workers KV (`DIG_KV`) instead of
`@netlify/blobs`. `wrangler.toml` scopes KV bindings explicitly per
environment (`env.preview` / `env.production`, no root-level fallback) —
an earlier attempt with a root `[[kv_namespaces]]` block plus a production
override left Production silently resolving to the preview namespace even
after a fresh deploy; explicit scoping on both sides fixed it.

Verified live 25 Aug 2026: `mycivix.com/dig/` returns 200, and
`/api/dig-stats` returns real accumulated data (sources, topics, ratings).
The old `netlify.toml` / `netlify/functions/*.js` files may still be present
in the repo as leftovers — worth confirming they're inert and safe to
delete, but they are no longer what's serving traffic.

## Known housekeeping debt

- **Git history exists now** — `git init` happened, the repo is on GitHub
  with `main` tracking `origin/main`, and the working tree is clean as of
  25 Aug 2026 (10 commits). The old "no git history" debt is resolved.
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
