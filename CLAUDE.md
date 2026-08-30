# CiViX — project context

CiViX (mycivix.com) is a civic engagement platform: build a private profile of
what you care about, match it against the municipal/state/federal calendar,
turn it into action. Built mostly through Claude chat/artifact sessions —
this file exists so a fresh Claude Code session has the context instantly.

## Current state (as of 27 Aug 2026)

No shared build system — every page is a standalone HTML file with its own
inline `<style>`/`<script>`, no bundler, no framework. That's fine for now;
see "Deliberately not yet done" below for why.

**Real, working — the core loop is wired end-to-end:**
- `index.html` — animated splash/landing page. Mobile-tuned as of 27 Aug
  (narrow-viewport overflow fixed, always-visible sticky CTA).
- `builder.html` — the "build your profile" flow (ZIP, issues/weights,
  positions, trusted sources, action authority). Its Inbox (§ 01) now has
  DIG's full focus-mode treatment: open a filed item, it's auto-placed
  under a general policy topic via `/api/dig-check`, checked against § 04's
  sources with DIG's own stance-check prompt (sharing DIG's
  `dig-results-cache` localStorage key), expandable summaries, 3-star
  rating that sets the adopted issue's priority weight.
- `calendar.html` — Federal section is real: `functions/api/calendar.js`
  pulls recent bills from congress.gov, matched client-side against the
  profile's declared issues (weighted, hand-authored synonym map). Each
  matched bill has a **Take action** button opening a modal that looks up
  the user's reps by ZIP (`functions/api/reps.js`, via the 5calls API),
  drafts a call script and email (`/api/dig-check` again, using the
  user's stated stance when they have one), offers a click-to-call `tel:`
  link and a `mailto:` draft, and an "add to calendar" `.ics` download
  using the bill's own latest legislative-action date (explicitly labeled
  as that, not a confirmed rally/event — no event-data source exists yet).
  State section is also real: `functions/api/state-bills.js` resolves the
  profile's ZIP to a state (via Zippopotam.us, free/keyless) and pulls
  matched bills from OpenStates, the same "one API covers all 50
  legislatures" role congress.gov plays federally. State cards
  deliberately have **no** Take Action button yet — `reps.js` only
  resolves federal contacts, so reusing that button would show a state
  bill's reader their federal rep. Municipal is still sample content —
  no unified public data source exists for city/county government.
- `dig/index.html` + `functions/api/dig-check.js` + `dig-stats.js` — DIG,
  an AI stance-checker across news/commentary sources. Real backend: daily
  spend cap, per-IP rate limit, anonymous usage stats.
- `send-to-civix.html` / `inbox.html` + `manifest.webmanifest` + `sw.js` —
  "Send to CiViX", an installable PWA share-target backed by a real
  Cloudflare Worker (`civix-capture.mycivix.workers.dev`, not in this
  repo) for the docket/filings API that both pages and `builder.html`'s
  Inbox read from.

**Placeholders (styled to match, no real functionality):**
- `connect.html`, `civil-dis.html`, `civix-track.html`, `analytics.html`

**Not in this repo at all:**
- PolTraPro (poltrapro.com) — separate product, own domain, linked from the
  splash. Relationship to CiViX (same family vs. unrelated) not yet decided.
- The `civix-capture` Cloudflare Worker (docket/filings backend) — separate
  Worker project, referenced by URL from `send-to-civix.html`/`inbox.html`/
  `builder.html` but its source isn't checked into this repo. (The Worker's
  own hostname, `civix-capture.mycivix.workers.dev`, is unrelated to the
  page rename below and was intentionally left as-is.)

## Required Cloudflare Pages secrets

Set per-environment (Production + Preview) in the dashboard, never in
`wrangler.toml` — see the Netlify migration note below for why a new
deployment (not just "Retry deployment") is required after adding one:

- `ANTHROPIC_API_KEY` — powers `/api/dig-check` (DIG's checks, and the
  Inbox/calendar-action AI drafting, which reuse the same endpoint).
- `CONGRESS_API_KEY` — powers `/api/calendar` (free, api.congress.gov/sign-up).
- `FIVECALLS_API_TOKEN` — powers `/api/reps` (free, 5calls.org/representatives-api/).
- `OPENSTATES_API_KEY` — powers `/api/state-bills` (free, openstates.org/api/register).

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
The old `netlify.toml` / `netlify/functions/*.js` files were confirmed
unreferenced elsewhere in the repo and deleted 27 Aug 2026 — migration is
fully closed out.

**Adding a new Pages secret needs an actual new deployment, not a
retry.** Hit this 27 Aug 2026 adding `CONGRESS_API_KEY`: saving it in the
dashboard and clicking "Retry deployment" on the latest build still left
the function reporting the var as missing, because Retry reuses that
deployment's original environment snapshot rather than the project's
current variables. An empty commit (or any new push) forces a real new
build, which does pick it up.

## Known housekeeping debt

- **Git history exists now** — `git init` happened, the repo is on GitHub
  with `main` tracking `origin/main`, and the working tree is clean as of
  25 Aug 2026 (10 commits). The old "no git history" debt is resolved.
- **Design tokens are hand-copied per page**, and have already drifted:
  `index.html`/`calendar.html`/`builder.html` share one token system (navy/
  paper/amber, Newsreader + IBM Plex Mono); `send-to-civix.html` runs a
  visibly different one (different amber, different fonts — JetBrains Mono + Source
  Serif 4). Worth extracting into one shared stylesheet all pages `<link>` to.
- `package.json` is still named `dig-selfhosted` — a leftover from before the
  folder held more than one tool.

## Deliberately not yet done

Holding off on a bundler/framework on purpose — nothing here needs
client-side routing or shared component state yet. The real trigger to
revisit that is a logged-in profile that needs to be read on more than one
page; that's genuine shared state and the point where a framework starts
paying for itself.

## The core loop — status and what's next

The splash's pitch — profile → matched to civic calendar → action you
control — is now proven end-to-end for federal, and the calendar-matching
half also covers state. The natural next moves, in roughly the order
they'd pay off, are:

- **Municipal calendar data** — the one jurisdiction still on sample
  content. No unified public API exists the way congress.gov/OpenStates
  do federally/per-state; needs its own source decision(s), likely
  per-city, before it can leave placeholder status.
- **State Take Action** — state bills match against the profile but have
  no call/email drafting yet, unlike federal. `functions/api/reps.js`
  would need to resolve state legislators too (5calls supports this via
  its `area` field — `StateUpper`/`StateLower` — reps.js currently
  filters to federal only) before this is a small extension rather than
  new infrastructure.
- **Petition and rally/event actions** — the two action types explicitly
  deferred when call/email/calendar-add were built (27 Aug 2026); each
  needs its own data source picked (no petition partner, no local-events
  feed exists yet) before it's a "wire it up" job rather than new
  infrastructure.
- **ZIP-only rep lookup is best-effort** — 5calls resolves a ZIP to a
  district, but ZIPs don't map 1:1 to congressional districts, so it can
  be wrong for a split ZIP. Precise lookup would mean asking for a full
  address, which cuts against `builder.html`'s current "we never ask for
  your address" positioning — a real tradeoff, not yet decided either way.
- **~~DIG's own source list vs. the profile's § 04 sources~~ — resolved
  29 Aug 2026.** DIG now reads and writes `P.sources` directly (the same
  `civix-profile` localStorage key `builder.html` uses) instead of its own
  separate `dig-sources` key — one shared list, no sync step. DIG's
  per-source rating also moved onto the shared source object
  (`P.sources[i].ratings[topic] = { quality: 'accurate'|'off', stars: 1-5,
  at }`), rekeyed per-topic instead of one ambiguous global value per
  source, so rating a source's coverage of one topic can no longer
  silently overwrite its rating on a different topic. `sourceTrust()` in
  both files derives a "general trust" score as the average across
  whatever topics a source has been rated on, rather than that being a
  separate manual rating to maintain. DIG's focus card also now shows
  "your stance" (read from the Manifesto's § 03, best-effort name match)
  next to "their stance" it detected, instead of relying on a single
  like/dislike to carry both "well covered" and "I agree" at once. A
  one-time migration in `builder.html`'s boot brings in anything still
  sitting in a pre-merge `dig-sources` list. DIG's header back-link now
  points at `builder.html` ("← Your Manifesto") instead of the splash.
  Not done in this pass: DIG's own UI copy still says "profile" (not yet
  renamed to "manifesto"), and the two apps don't live-sync across tabs —
  last write wins if both are open at once, same latent limitation
  `builder.html` already had with itself.
