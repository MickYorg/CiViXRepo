# DIG — self-hosted build

(Renamed from "Wire Desk." Files, API routes, local-storage keys, and the
server-side Netlify Blobs store names were all renamed to match — see
"Upgrading from Wire Desk" below if you're redeploying over an existing
site.)

This is the Netlify-ready version of DIG. It's the same tool as the
claude.ai artifact, with changes needed to run outside of claude.ai:

- **Storage**: swaps claude.ai's `window.storage` for plain browser
  `localStorage`. Source profiles are still private per-device — they just
  live in the visitor's own browser instead of Anthropic's artifact storage.
- **API calls**: the frontend no longer calls `api.anthropic.com` directly
  (browsers can't safely hold a secret key). Instead it calls
  `/api/dig-check`, a Netlify serverless function
  (`netlify/functions/dig-check.js`) that holds your real Anthropic API
  key server-side and proxies the request.
- **Daily spend cap**: the function tracks actual spend (from the token and
  web-search counts each Anthropic response reports) in Netlify Blobs, a
  built-in key-value store — no external database needed. Once the running
  total for the current UTC day hits **$20**, further checks are rejected
  with a clear "daily budget reached" message until the counter resets at
  UTC midnight.
- **Per-visitor daily cap**: on top of the shared budget, each visitor (by
  IP) is capped at **30 checks/day**, also tracked in Blobs so it survives
  restarts and deploys. This stops one person from burning through the
  whole shared budget alone. It resets at UTC midnight per IP.

## Deploy steps

1. **Get an Anthropic API key** (if you don't have one): console.anthropic.com
   → Settings → API Keys → Create Key. Make sure billing is set up — this key
   is billed per request, separate from your claude.ai usage.

2. **Push this folder to your Netlify site** (same flow you used for Ball
   Swap — drag-and-drop the folder in the Netlify dashboard, or connect a git
   repo and push these files).

3. **Set the environment variable**: in Netlify → Site settings →
   Environment variables, add:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your key from step 1

4. **Deploy.** Netlify will pick up `netlify.toml`, install `@netlify/blobs`
   from `package.json`, detect the function in `netlify/functions/`, and
   serve `index.html` at your site root.

5. **Test it**: open the live URL, build a source profile, run a stance
   check. Open your browser's Network tab and confirm you only ever see
   requests to `/api/dig-check` — never to `api.anthropic.com` and
   never with your key visible.

## Cost note

Every stance check fans out one API call per source in your list, and each
of those calls can now run **up to 6 web searches** (previously effectively
1) — the model was given room to search from a few different angles
(a source's own outlet, then guest appearances on other podcasts/shows)
before giving up on a source, since independent commentators who mainly
show up as guests elsewhere were coming back "no coverage found" too
often with a single search. It won't always use all 6 — most checks still
resolve in 1-2 — but the ceiling being higher means the same check can now
cost more for sources that need the extra digging. The function estimates
real cost per request from Anthropic's own token/search usage numbers
using Sonnet 5 pricing ($2/$10 per million input/output tokens, $10 per
1,000 web searches) and stops new checks once the day's running total hits
**$20 UTC**. Adjust the cap by setting a `DIG_DAILY_BUDGET_USD` environment
variable in Netlify (same place as `ANTHROPIC_API_KEY`) — e.g. set it to
`10` for a tighter cap.

Two things worth knowing about the cap:
- It's a **soft** limit — Netlify Blobs isn't a hard transactional lock, so
  under heavy concurrent traffic a handful of requests could land right
  around the cap before it kicks in. Fine for a personal/feedback-stage
  tool; not meant as a hard financial guarantee.
- If pricing changes, update `PRICE_PER_MTOK_INPUT`,
  `PRICE_PER_MTOK_OUTPUT`, and `PRICE_PER_1000_WEB_SEARCHES` at the top of
  `netlify/functions/dig-check.js` — check
  https://platform.claude.com/docs/en/about-claude/pricing for current
  rates. The `max_uses: 6` search ceiling is set on the `web_search` tool
  in the same file, next to those pricing constants, if you want to raise
  or lower it.

Adjust the per-visitor cap the same way, via a `DIG_DAILY_LIMIT_PER_IP`
environment variable (default 30). Since it's IP-based rather than
account-based, visitors sharing a network (office wifi, a school, a VPN)
share one counter — worth keeping in mind if your audience skews that way.

## Community stats

A second function, `netlify/functions/dig-stats.js`, tracks fully
anonymous, aggregate usage — no code changes needed, it just needs the same
`@netlify/blobs` dependency already in `package.json`. It records three
counters, all keyed only by a name string (never a device, IP, or account):

- **sources** — how many times each source name has entered someone's
  local profile (onboarding picks, custom adds, settings-panel adds)
- **topics** — how many times each topic string has been checked
- **ratings** — aggregate 👍/👎 and 5-star totals per source, submitted
  from the results "Focus mode" view

This is disclosed to visitors in the onboarding privacy note, and the
numbers themselves are visible to everyone in-app via the **STATS** button
— nothing here is hidden or admin-only. The intent is a live check on
whether the curated pick-lists in `ONBOARD_CATEGORIES` (in `index.html`)
track what people actually add and trust, independent of the published
bias/reliability rankings those lists lean on.

Entries are capped at 500 per counter (trimmed to the top entries by
activity) so the store can't grow unbounded under spam or abuse — same
soft-limit caveat as the spend cap above applies here: Netlify Blobs isn't
a hard transactional lock, so counts are a very close approximation, not
a perfectly exact tally.

If STATS ever shows "Could not load stats right now," two things to check:
- Confirm `dig-stats.js` is sitting in `netlify/functions/` in your actual
  deploy — check the **Functions** tab in your Netlify dashboard and
  confirm both `dig-check` and `dig-stats` are listed. If one's missing,
  that's almost always the whole bug.
- The function itself now fails safe: `dig-stats.js` wraps its entire
  handler in a try/catch, so even a Blobs init hiccup returns an
  empty-but-valid response (STATS shows "No data yet") instead of an
  unhandled 500. If you're still seeing the error after confirming the
  function is deployed, check your Netlify function logs for the actual
  exception — the fail-safe means the frontend error message alone won't
  tell you the underlying cause anymore, so the logs are the next place to
  look.

## Adding a source: the FIND button

Next to the hint field (onboarding's custom-add row, and each row in the
SOURCES editor) is a **🔍 FIND** button. Type a name, click it, and it
calls `/api/dig-check` (same endpoint, same budget/rate-limit caps
as a stance check — just one extra call) asking the model to search for
that source's primary site, channel, or handle, then fills the hint field
automatically. No new backend needed. If it can't find a confident match,
the field is left for manual entry.

## Result caching (per topic, 24h)

Results are cached client-side per `(topic, source)` pair for 24 hours.
Re-running the same topic, or adding/renaming one source, only fires fresh
API calls for the sources that don't already have a fresh cached result —
everything else renders instantly from cache with a **"· cached"** tag and
a **RECHECK** button if you want to force a refresh on just that one.
Explicit RETRY/RECHECK always bypasses the cache.

## PROFILE panel

A third header button alongside SOURCES/STATS. Shows a plain-language
summary of what's stored on-device (sources saved, topics checked, results
cached), a list of recently-checked topics (each removable, or clear all
at once), and a **DELETE EVERYTHING ON THIS DEVICE** button — wipes
sources, ratings, cache, and history, then drops back into onboarding.
Everything here is `localStorage`-only, same as the rest of the profile.

Checked topics also power a **recent-topics row** of quick-repeat chips
under the topic input — clicking one reruns that topic (usually free,
since it's likely still cached).

## Trending-topics chyron

When the topic box is empty, its placeholder rotates through ten short
topic phrases — fade out, swap, fade in, every 5 seconds. Pressing Enter
or CHECK with nothing typed runs whatever's currently showing. The list
itself is fetched once via `/api/dig-check` (asking the model to
search and return today's most-discussed topics as a JSON array) and
cached on-device for 24h, so it's at most one extra call per visitor per
day — not one per page load. A small static fallback list keeps the
ticker working if that fetch ever fails or the budget cap is hit.

## Randomize sources

The **🎲 surprise me — one per category** button (onboarding, next to
"skip") picks one random source from each category, saves that as your
profile, jumps straight into the app, and gives the topic box a brief
amber pulse so the next step is obvious.

## Results view: table, focus mode, and debate points

- **Read more** — each result card shows a 1-2 line preview with a
  collapse/expand toggle for the full text.
- **Table view** — the CARDS/TABLE toggle above the results switches to a
  Source / Stance / Key-points table, with each source's summary broken
  into bullet points.
- **Focus mode** — the ⛶ FOCUS MODE button brings up one source at a time,
  full-card, swipeable (touch or arrow keys) between sources. Each card has
  👍/👎, a 5-star rating, and a **DEBATE** button that fetches 4-6
  talking points in that source's own framing (one extra `/api/dig-check`
  call per source, cached per topic+source so it's only fetched once).
  Likes/stars are also disclosed and roll into the anonymous ratings
  counters above; the underlying like/star *choice itself* stays local to
  the visitor's device — only the aggregate tally is shared.

## Upgrading from Wire Desk

If you're redeploying this over an existing "Wire Desk" site:

- **Function files**: rename them in your repo — `wire-desk-check.js` →
  `dig-check.js`, `wire-desk-stats.js` → `dig-stats.js` — both still under
  `netlify/functions/`. Deleting the old files matters here, not just
  adding the new ones, or you'll end up with both old and new routes live.
- **Environment variables**: if you'd customized `WIRE_DESK_DAILY_BUDGET_USD`
  or `WIRE_DESK_DAILY_LIMIT_PER_IP`, add the same values under the new
  names (`DIG_DAILY_BUDGET_USD`, `DIG_DAILY_LIMIT_PER_IP`) in Netlify →
  Environment variables. The old names are just unused now, not an error —
  nothing will warn you if you forget, it'll just silently fall back to
  the defaults ($20/day, 30 checks per visitor).
- **Server-side counters reset**: the Netlify Blobs store names changed
  too (`dig-usage`, `dig-rate-limits`, `dig-stats`), so today's spend
  tracker, per-visitor rate limits, and the accumulated community stats
  (most-added sources, most-checked topics, ratings) all start over from
  zero on first deploy. This is a one-time reset, not an ongoing behavior.
- **Visitors' local profiles are unaffected**: the frontend migrates
  anyone with a profile saved under the old `wire-desk-*` browser-storage
  keys to the new `dig-*` ones automatically on their next visit — sources,
  ratings, cached results, and topic history all carry over. No action
  needed on your end for this part.

