# CiViX — project context

CiViX (mycivix.com) is a civic engagement platform: build a private profile of
what you care about, match it against the municipal/state/federal calendar,
turn it into action. Built mostly through Claude chat/artifact sessions —
this file exists so a fresh Claude Code session has the context instantly.

## Current state (as of 2 Sep 2026)

No shared build system — every page is a standalone HTML file with its own
inline `<style>`/`<script>`, no bundler, no framework. That's fine for now;
see "Deliberately not yet done" below for why.

**Real, working — the core loop is wired end-to-end:**
- `index.html` — animated splash/landing page. Mobile-tuned as of 27 Aug
  (narrow-viewport overflow fixed, always-visible sticky CTA). As of 31
  Aug 2026, once the amendment sequence actually plays out (not on Skip,
  not on a same-day return visit that jumps straight to the resolved
  state) it auto-advances into `builder.html` ~4.5s after resolving,
  scheduled through the same `at()`/`timers` mechanism the sequence
  itself uses so Replay's `reset()` cancels a pending auto-advance for
  free. Also pings `/api/headlines-batch` fire-and-forget on every load
  purely to keep builder.html's headline-swipe deck pre-warmed (see
  below) — never reads the response.
- `builder.html` — the "build your profile" flow (ZIP, issues/weights,
  positions, trusted sources, action authority). Its Inbox (§ 01) now has
  DIG's full focus-mode treatment: open a filed item, it's auto-placed
  under a general policy topic via `/api/dig-check`, checked against § 04's
  sources with DIG's own stance-check prompt (sharing DIG's
  `dig-results-cache` localStorage key), expandable summaries, 3-star
  rating that sets the adopted issue's priority weight. Citizen mode's
  welcome card leads with swiping through 5 real news headlines
  (`/api/headlines`, a pluggable source-adapter registry, GNews wired up
  today) instead of trait/category cards — the original 30-second
  archetype quiz is still there, demoted to a quiet second option below
  (headlines shipped 31 Aug 2026 as the secondary path and was promoted
  to primary the same day once it proved out). As of 2 Sep 2026 the
  welcome card also auto-advances into the headline deck on its own —
  a 3.8s read-then-act window (the same `AUTO_DISMISS_MS` civics.js's
  fact popups already use, so it's a timing rhythm a citizen's been
  trained on elsewhere in the app), then the card dissolves (1s fade)
  and `startHeadlineMode()` fires, same as tapping the button directly.
  Picking either button on the card cancels the timer. This pairs with
  a real fade-in/fade-out across the splash → builder hand-off itself
  (`index.html`'s `goToBuilder()` now fades the body out over 0.5s before
  navigating; `builder.html` starts at `opacity:0` and fades in over
  0.5s on arrival) — previously a bare `location.href` swap with no
  transition at all, which the citizen flagged as "abrupt." Also fixed
  the same day: `.citizen-privacy-note` had no bottom margin, so the
  welcome card sat jammed right up against the "Private & secure" line
  on laptop-width viewports. Each headline is
  boiled down via `/api/dig-check` into a topic on CiViX's own fixed issue
  taxonomy (so it matches cleanly against `digest.js`'s existing
  SYNONYMS), a one-sentence talking point, and a search query for a real
  stock photo (`/api/headline-image`, Unsplash's Search Photos API,
  cached in KV, photographer credit shown under the image per Unsplash's
  API guidelines). This replaced an earlier OpenAI `gpt-image-1`
  generation attempt (31 Aug 2026) — the citizen explicitly wanted real
  photos from a public source, not AI-generated illustrations, and search
  is free where generation had a real per-image cost. **2 Sep 2026**: the
  talking point stopped being a neutral "what's at stake" summary — the
  citizen pointed out an ambiguous, hard-to-react-to headline isn't
  swipeable in any meaningful sense, since it's unclear what agreeing or
  disagreeing would even mean. The boildown prompt (both copies — see the
  sync note on `boildownHeadline()` in builder.html and `boildownPrompt()`
  in `functions/api/headlines-batch.js`) now asks for a genuine,
  opinionated position statement instead, with an explicit instruction to
  zoom out to the broader policy area rather than force a confusing stance
  from tangled/ambiguous specifics. "It's complicated" (unchanged) stays
  the deliberate way out for anything still genuinely nuanced. A
  swiped-right headline now also writes that talking point onto the
  adopted issue's `stance` field (`resolveCitizenCard()`), same as typing
  one into the "more-priorities" card already did — previously the stance
  a citizen was actually reacting to was discarded, only the bare topic
  survived the swipe. The "it's complicated" drilldown facet prompt
  (`buildDrilldownCards()`) got the same position-statement treatment for
  consistency, since its facets share this exact code path. A
  swiped-right headline adopts
  its topic as a priority exactly like a swiped issue card, so it flows
  straight into the same zip → done → take-action.html hand-off the quiz
  path already ends at (see 2 Sep 2026 note below — the done card no
  longer shows the top-3 digest inline itself) — no separate
  "propose actions" logic needed. The query sent to `/api/headlines`
  already biases toward a citizen's existing top 2 priorities when they
  have any (a first step toward "the manifesto should influence the
  headlines"); a brand-new citizen just gets the general national feed.
  Every swipeable card in Citizen mode (trait/category/issue/action/
  headline alike — the only true swipe-deck UI in the app; DIG's and the
  Inbox's own "focus mode" card browsers are prev/next paging, not this)
  also got a third, deliberately smaller "it's complicated" button between
  skip and yes. Tapping it defers the current card to the end of the deck
  and inserts 3 AI-drafted facets of that same topic (`/api/dig-check`,
  text-only — no generated image, to keep cost/latency down for what's
  meant to be a frequent tap) to react to individually; swiping right on
  any of them adopts its topic as a priority the same way a headline card
  does, so agreeing with more facets is a citizen's own way of signaling
  how much a topic matters without a slider. As of 31 Aug 2026, a
  drilldown card can no longer be drilled into again — the user flagged
  the real risk of an unbounded "complicated on a complicated on a
  complicated" spiral with no natural end. Tapping "it's complicated" on
  a drilldown card now opens a "give mercy" screen (`showDrilldownMercy()`)
  instead of generating 3 more facets: type freeform "how do you feel
  about this" text (added as a priority with that text as its `stance`,
  same as the "anything else on your mind?" card), or "Not sure — ask me
  again later," which defers it into a new `P.backlog` array
  (`deferToBacklog()`) instead of just discarding it. `buildBacklogCards()`
  pulls a capped batch (3) of deferred facets back into
  `startCitizenMode()`'s topping-up deck — "sprinkle into another round
  of manifesto refinement" — consumed from the backlog either way
  (adopted, skipped, or deferred yet again) so it can't grow unbounded
  even if a citizen keeps punting on the same facet. This same drilldown mechanic
  now also has a cold-start entry point (`startSeededDrilldown()`,
  triggered by `?drilldown=<topic>&stance=<for|against>` on boot): take-action.html's
  action modal links here once a citizen declares a For/Against position
  on a bill, so "go deeper on this" doesn't need its own swipe-card UI
  duplicated in take-action.html — it hands off to the exact same deck,
  seeded with the bill and stance so the 3 facets build on the position
  already stated instead of re-litigating it. The trait deck (`TRAITS`)
  also gained two "posture" cards (31 Aug 2026) — "Direct action" ("We're
  never going to vote our way out of this") and "Incrementalist" ("Don't
  let the perfect be the enemy of the good") — a different axis from the
  existing circumstance traits (renter/parent/veteran/etc.): not what a
  citizen IS, but how they think change happens. `TRAIT_HINTS` deliberately
  skips them (theory of change isn't correlated with any issue category);
  instead `TRAIT_ACTION_HINTS` + `actionBoost()` (mirroring
  `categoryBoost()`) move the ACTION cards they imply to the front of the
  action deck — Direct action promotes attend/testify/share, Incrementalist
  promotes call/email/comment. As of 31 Aug 2026 the whole
  headline pipeline (fetch -> boildown -> photo) is also pre-warmed:
  `functions/api/headlines-batch.js` builds a ready 5-card batch server-
  side (reusing `/api/dig-check` and `/api/headline-image` via internal
  same-origin fetches, not duplicated logic) and caches it in KV,
  stale-while-revalidate — any GET returns whatever's cached instantly and
  kicks off a background rebuild via `waitUntil()` if it's past its
  1-hour freshness window, so the caller that trips the rebuild isn't the
  one who waits on it. `index.html` fire-and-forget pings this endpoint on
  every load purely to be that background trigger ("ready by the first
  splash load of the hour"), never reading its response.
  `startHeadlineMode()` tries this batch first — a warm hit skips the
  live pipeline entirely with no loading flash and no civics popup (the
  initial paint is `quiet:true` specifically so an instant hit never
  shows a wait-filler for a wait that barely happened) — and only falls
  back to the live multi-step pipeline (unchanged) on a miss. GNews-
  fetching (`fetchGNews`) and the issue taxonomy list both now live in
  `functions/_lib/` (`gnews.js`, `issue-taxonomy.js`) so `/api/headlines`
  and `/api/headlines-batch` share one implementation instead of two
  copies drifting apart — `issue-taxonomy.js` is a manually-kept-in-sync
  copy of builder.html's `CATALOG` (client JS and server Functions can't
  share a module today), flagged in its own file comment. A brand-new
  citizen (no `P.issues` yet, so no search query) used to always pull
  GNews's `category=nation` top-headlines — the same narrow slice every
  time, refreshed hourly by the pre-warm batch but never actually
  varied. `gnews.js`'s `fetchGNews()` now rotates through six
  civically-relevant categories (nation, world, business, science,
  health, environment) keyed off the current UTC hour (31 Aug 2026,
  citizen asked for "new/refreshed headlines for the initial manifesto
  build") — same one-request-per-fetch budget, real variety over time
  instead of a frozen feed. The "done" card's top-3
  digest also got a "pop" pass (31 Aug 2026): each entry now shows a rank
  badge (#1 visibly stronger — amber border/background, not just a bigger
  number), a template-built "why this matches you" line naming the actual
  matched priorities (no extra AI call — built from data `buildTopDigest`
  already returns), and stronger CTA copy ("Make your voice heard" +
  "~2 min — CiViX drafts the call or email for you" for federal entries
  specifically, since that's the only kind with real assisted drafting
  today — state/docket keep honest, unembellished copy). **Reverted 2 Sep
  2026** — see the "done card simplified" note further down: the citizen
  complained the done card was "getting heavy," so the whole inline digest
  (rank badges, why-lines, per-entry CTAs — `digestEntryHtml()`,
  `digestWhyHtml()`, `loadCitizenDigest()`, all deleted) came back out.
  builder.html no longer calls `digest.js`/`buildTopDigest()` at all —
  that reveal now lives solely on take-action.html — so builder.html
  dropped its `<script src="digest.js">` include too.
- `take-action.html` — **renamed from `calendar.html` 2 Sep 2026** (file,
  browser tab `<title>`, `<h1>`, and every internal link/href/comment
  across `index.html`/`builder.html`/`digest.js` moved with it in the
  same pass — see `filenames-match-user-facing-names` in memory). The
  citizen asked to "rebrand everything that is currently calendar to
  Take Action" — the page's H1 and the splash's own nav button (§03,
  "get engaged") both now read **"Take Action"** instead of "Calendar."
  Deliberately scoped to the page's own branding, not the domain concept
  underneath it: `functions/api/calendar.js` (the congress.gov bill
  fetcher) keeps its name — it's genuinely fetching a legislative
  calendar, distinct from what this page is now called — and the real
  "add to calendar" `.ics`-download feature below is untouched for the
  same reason. A root `_redirects` file (new, 2 Sep 2026 — this is the
  first entry in it) 301s `/calendar.html` and `/calendar` to
  `/take-action.html`, since alpha testers may already have the old URL
  bookmarked or linked and this is a real, in-use app now, not just
  `/dev/personas` housekeeping. Federal section is real: `functions/api/calendar.js`
  pulls recent bills from congress.gov, matched client-side against the
  profile's declared issues (weighted, hand-authored synonym map). Each
  matched bill has a **Take action** button opening a modal that looks up
  the user's reps by ZIP (`functions/api/reps.js`, via the 5calls API),
  drafts a call script and email (`/api/dig-check` again), offers a
  click-to-call `tel:` link, and an "add to calendar" `.ics` download
  using the bill's own latest legislative-action date (explicitly labeled
  as that, not a confirmed rally/event — no event-data source exists
  yet). The email side dropped its `mailto:` link (31 Aug 2026) — 5calls'
  rep data never included an email address to begin with (Congress
  doesn't publish direct staff addresses for constituent mail), so the
  link had no recipient and was a dead end, worse on mobile browser-based
  webmail with no mail-app handler registered at all. Replaced with
  "Copy email" as the primary action plus an "Open contact form ↗" link
  to the rep's own official site (`rep.url`, from 5calls) — that's how
  offices actually take constituent email. `functions/api/calendar.js`
  also now re-sorts its results by `latestAction`'s own date (31 Aug
  2026) rather than trusting congress.gov's `sort=updateDate+desc` as a
  proxy for it — that field gets bumped by any metadata change (a
  cosponsor added, a text version republished), not just real legislative
  action, so a bill could lead the list looking recent while the action
  actually shown was months stale. As of 31 Aug 2026 the modal leads with an
  explicit **For/Against toggle** instead of silently inferring a
  direction from free-text stance (which, especially early on, a citizen
  often hasn't set — the old behavior could hand over a script arguing a
  side they don't hold, at exactly the moment they're least equipped to
  notice). Both directions' call+email drafts are generated per-lean and
  cached in `ACTIVE.drafts.for`/`ACTIVE.drafts.against`, so switching
  sides once both have been seen is instant, not a re-draft; the first
  generation still costs one AI call pair, same as before. Toggling also
  writes `lean: 'for'|'against'` onto every matching `P.issues` entry
  (`updateManifestoLean()`) — separate from the free-text `stance` field,
  which stays whatever nuance the citizen wrote there — so this is often
  the first time an early-manifesto citizen has stated a real direction
  on a priority they only named in passing while swiping. The modal's
  initial lean prefers an issue's already-known `lean` if one exists,
  else defaults to "for". A "Want to go deeper on this?" link hands off
  to builder.html's seeded-drilldown deck (see above), stance-aware.
  As of 31 Aug 2026 the page also leads with a **focus zone** — the top-3
  digest (same `buildTopDigest()` engine as builder.html's) rendered at
  the very top of the page, before any municipal/state/federal detail.
  This replaced the previous layout where the top-3 concept didn't exist
  on this page at all and a citizen had to scroll past all three
  sections' full lists to find anything actionable ("if I didn't know to
  scroll down you'd have lost me right there" — the exact complaint this
  fixes). The federal entry's card gets a **Take action now** button that
  opens the take-action modal directly (`openActionModalFor(bill, hits)`,
  split out of `openActionModal(idx)` so it doesn't need the entry to
  already be present in the detailed Federal list's own `CURRENT` array —
  `digest.js`'s `billEntry()` now carries the full bill object precisely
  so this works). State/docket entries fall back to their normal
  `actionHref` link, same limitation as the detailed lists (state has no
  take-action flow yet). The municipal/state/federal detail itself is now
  a collapsed `<details>` ("See everything"), open by default only when
  arriving via `?focus=<issue-id>` (a different intent — "show me this
  one issue's filtered detail" — than the focus zone's general top-3).
  As of 31 Aug 2026, once expanded, each of Municipal/State/Federal is
  its own independently-collapsible nested `<details>`
  (`.section-details`) instead of one long undifferentiated wall — a
  live "N shown" badge (`setSectionCount()`) stays visible in the
  `<summary>` even while a section is folded away, so collapsing noise
  doesn't also hide whether there's anything worth reopening it for.

  **General advocacy modal, also 31 Aug 2026**: digest.js's
  `buildTopDigest()` now synthesizes a `kind: 'general'` entry for a
  citizen's own high-conviction priority (`weight === 3` *and* a written
  `stance` — the signal for "typed in deliberately," e.g. via the
  "anything else on your mind?" card) that has zero matches in the
  federal/state/docket pool, scored to always rank first — a citizen who
  bothered to type something in their own words shouldn't see it go
  nowhere just because no bill happens to touch it yet. Its "Start
  making noise" CTA opens `openGeneralAdvocacyModal()` (take-action.html) —
  the same rep-lookup + AI-drafted call/email as the bill-specific
  modal, minus everything that assumes a bill exists: no For/Against (no
  bill to be for or against), no ICS date, one draft instead of two
  per-lean, drafted straight from the citizen's own stance text.
  Deliberately a separate code path from `openActionModalFor()` rather
  than threading `bill: null` through the bill-specific rendering.
  Reachable from take-action.html's focus zone directly
  (`data-focus-general-action`) or via `?general=<issue-name>` (what
  builder.html's digest links to, since it can't call take-action.html's
  JS across pages).
  Citizen mode's bill cards (31 Aug 2026) now lead with a plain-language
  synopsis (`digest.js`'s `plainSummarize`, already shared with
  builder.html's digest) instead of the official bill title — the title
  collapses into a small `<details>` disclosure — and matched priorities
  render as named links back into `builder.html?focus=<issue-id>` (§03,
  scrolled to and briefly highlighted) instead of a bare "matches N"
  count. **2 Sep 2026: extended to every mode and every list on the
  page** — the citizen expected this everywhere, not just Citizen mode.
  `renderCard()` (federal) and `renderStateCard()` (state, also reused
  by municipal) no longer branch on mode at all for this: every card
  leads with the synopsis (`.card-synopsis`, renamed off `.citizen-*`)
  and collapses the official name behind `.title-details`, an ambiguous
  or hard-to-parse official title included — Activist/Pro previously got
  the plain-language rewrite too (`enhancePlainSummaries()` always
  fetched it) but had it buried in the card body below the raw legalese
  title instead of leading with it. The **focus zone itself** (the top-3
  "results reveal," the very first thing on the page) got the same
  treatment in `focusEntryHtml()` — it was leading with `e.title` (the
  raw `bill.title`) above the already-plain `e.summary` the whole time,
  the same mismatch in the page's most prominent spot. Scoped to
  federal/state/municipal entries only (`e.title` is real legalese there,
  via `digest.js`'s shared `billEntry()`); `general`/`docket` entries
  keep their original layout since `e.title` is already plain there (a
  citizen's own priority name or filing title) — nothing official to
  hide. Every card (all three detailed lists, all three modes, plus the
  focus zone) also gained a **"Send to DIG ↗"** link (`digUrl()`, new,
  mirrors builder.html's Inbox's own `digUrl()`/`?topic=` convention
  exactly) — pre-fills DIG's topic field with the bill/priority title,
  never auto-runs the check, so it's free to offer everywhere.
  State section is also real: `functions/api/state-bills.js` resolves the
  profile's ZIP to a state (via Zippopotam.us, free/keyless) and pulls
  matched bills from OpenStates, the same "one API covers all 50
  legislatures" role congress.gov plays federally.

  **State Take Action is real, including a genuine one-button send (31
  Aug 2026)** — the citizen pushed on "do we have info needed to do 1
  button press email my rep?" for federal specifically. The honest
  answer for federal stayed no (see the "Send it" entry above: no real
  recipient email from 5calls, and most official contact forms run
  CAPTCHA/bot-detection that auto-submission would have to defeat — a
  line that isn't getting crossed regardless of authorization). But
  checking OpenStates' actual schema turned up something federal doesn't
  have: state legislators' `Person` object carries a real, often-
  published `email` field. That's a genuine recipient, which is what a
  real send needs and federal doesn't have.
  - `functions/_lib/openstates-people.js` — shared resolver: ZIP →
    lat/lng (Zippopotam, cached under `zipgeo:<zip>`) → OpenStates'
    `/people.geo?lat=&lng=` (which returns both state legislators *and*
    members of Congress for a point — filtered here to
    `jurisdiction.classification === 'state'` only, so federal
    representation stays on 5calls as its one canonical source rather
    than growing a second, divergent one). Returns `{id, name, party,
    chamber, chamberLabel, district, email, phone, url}` per legislator.
  - `functions/api/state-reps.js` — thin `GET ?zip=` wrapper around the
    resolver, for the frontend's rep picker.
  - `functions/api/send-state-email.js` — the actual send, via Resend.
    Never trusts a client-supplied recipient: `to` is re-derived
    server-side from `repId` by re-running the same resolver, so this
    can't become an open relay to arbitrary addresses. Rate-limited two
    ways (global daily cap under Resend's free-tier ceiling, plus a
    per-IP daily cap), mirroring dig-check.js's existing counter
    pattern. Nothing in the request — name, address, email, message
    text — is written to KV or logged; the only thing this function
    persists is the rate-limit counters.
  - take-action.html: state bill cards get a real **Take action** button
    (`STATE_ACTIVE`, `openStateActionModal()`/`renderStateActionCard()`,
    mirroring the federal/general modals' architecture). A citizen's
    name + mailing address (+ optional email, so the office can reply to
    an actual person) are collected **contextually**, inline, the first
    time a real send is about to happen — not upfront in the manifesto,
    per the citizen's explicit "permit required on a case-by-case basis"
    framing — and stored only in `civix-profile.identity`
    (localStorage). This is a deliberate, one-time reversal of the
    "we never ask for your address" stance noted elsewhere in this file,
    scoped narrowly to state-legislator email and gated by real,
    visible consent: the compose view always shows exactly who it's
    addressed to ("To: `<rep email>`") right next to the Send button, so
    each send is its own explicit act, and "forget my info" clears the
    stored identity outright. Identity leaves the browser exactly once
    per send, in the POST to `/api/send-state-email` — never persisted
    server-side (see that file's own comment). On success the modal
    shows a genuine "✓ Sent to `<rep>`'s office" — accurate this time,
    unlike federal's "Send it," because it really was relayed by email.
    A "Copy instead" fallback stays available for anyone who'd rather
    not use the real-send path. State bills also gained the same watch
    toggle and "Beyond email" (petition/rally/organize) section as
    federal/general, via the shared `toggleWatch()`/`checkWatchlistUpdates()`
    machinery (now generalized to take a `kind`/`keyFn` pair instead of
    being federal-only).
  - **New required secret**: `RESEND_API_KEY` (see "Required Cloudflare
    Pages secrets" below) — needs mycivix.com verified as a sending
    domain in Resend's dashboard (DNS records added at the registrar,
    something only the account holder can do) before real sends work;
    without it the endpoint fails cleanly with a clear server-side
    error, verified locally.
  Municipal is now real for a curated
  list of cities (31 Aug 2026): `functions/api/municipal.js` resolves the
  profile's ZIP to a city (Zippopotam.us, same as state) and, for any city
  confirmed to run Legistar (Granicus' legislative platform — hundreds of
  cities do, but it's per-city, no unified API), pulls real matters from
  its free/keyless Web API. Live today: Boston, Seattle, Baltimore,
  Nashville, Phoenix, Charlotte NC, St. Paul, Pittsburgh — verified
  individually, not assumed (several bigger cities, e.g. NYC/Philly, are
  on Legistar but require a per-jurisdiction token so were left out; SF/
  San Antonio/Miami-Dade/Denver returned stale or sandbox data and were
  also left out). A ZIP outside the list gets an honest "not covered yet"
  message instead of fake sample content. Grow `CITY_CLIENTS` in
  `municipal.js` one verified city at a time. No Take Action button yet,
  same reasoning as State. Legistar has no "public comment open" flag and
  no direct public URL field on a Matter (constructed from the known
  `{client}.legistar.com/LegislationDetail.aspx?ID=...` pattern instead).
  As of 31 Aug 2026, `municipal.js` also pulls Legistar's `Events`
  endpoint (upcoming town halls, council sessions, committee hearings —
  real "show up" opportunities, the first piece of "beyond legislative"
  content in the app) alongside `Matters`, filtered to today-forward,
  ordered soonest-first. Deliberately **not** matched/scored against a
  citizen's priorities the way bills are — an Event has no policy-topic
  text worth keyword-matching (`EventBodyName` is just "City Council" or
  "Planning Commission"), so take-action.html renders it as a plain
  chronological "what's coming up in your city" list instead
  (`renderMunicipalEvents()`, `#municipal-events`, right below the
  Matters list). Best-effort and independent of the Matters fetch — a
  citizen still sees matched legislation even if the Events endpoint
  hiccups. Verified live against Boston: real upcoming meetings with
  correct dates/times/locations, working links to both the meeting page
  and its agenda PDF.

  **"Beyond legislative" roadmap** (31 Aug 2026, user asked for rallies/
  demonstrations/town halls/hearings/speeches/press conferences,
  regulatory comment periods, elections/ballot measures, executive
  actions, and local non-legislative decisions — local meetings via
  Legistar Events, above, is the first of these shipped). Remaining,
  roughly in order of feasibility:
  - **Executive actions** — Federal Register has a solid, free, well-
    documented API (executive orders, presidential documents),
    comparable effort to the congress.gov integration.
  - **Regulatory comment periods** — regulations.gov has a comparable
    free federal API.
  - **Elections & ballot measures** — needs source research first; the
    obvious free option (Google's Civic Information API) has had parts
    deprecated, so confirm what's actually still live before committing.
  - **Rallies/demonstrations/speeches/press conferences** — no
    structured public API tracks these comprehensively. Most likely
    path is piggybacking on the existing GNews headline pipeline rather
    than a dedicated source, and coverage would be inherently spottier
    than the structured-data sources above.

  **Jurisdiction lean, 31 Aug 2026**: the citizen asked for CiViX to
  ascertain "the citizen's lean on municipal, state, federal" during
  manifesto seeding and refine it further from real actions taken, not
  just ask once and forget. `builder.html` gained a one-time swipe card
  (`jurisdiction-lean` type, "Where do you want your voice heard most?" —
  City Hall / state capitol / Washington, or "They all matter equally to
  me") inserted right after the ZIP card in every deck-construction path
  (firstPass quiz, topping-up, headline deck, seeded-drilldown), gated by
  `jurisdictionLeanCard()` so it's asked exactly once per profile —
  `setJurisdictionLean()` writes `P.jurisdictionLean = {municipal, state,
  federal}` (default weight 1 each, chosen level bumped to 3; all stay 1
  on skip). This is also what finally pulled municipal into the top-3
  digest: `digest.js`'s `buildTopDigest()` never fetched municipal at all
  before today (only federal/state/docket) — it now calls the new
  `fetchMunicipalBills()` alongside the others and applies
  `P.jurisdictionLean` as a score multiplier across all three bill-derived
  kinds (`general`/`docket` entries are left alone — the lean is about
  which level of government, not about typed-in priorities or filings).
  The lean also refines itself from real behavior, not just the one-time
  card: `take-action.html`'s `bumpJurisdictionLean()` nudges the relevant
  level up by 0.5 every time a citizen actually takes action through it —
  `openActionModalFor()`/`openGeneralAdvocacyModal()` bump `'federal'`,
  and (since 31 Aug 2026, once state gained its own real take-action
  flow — see "State Take Action is real" below) `openStateActionModal()`
  bumps `'state'`. Municipal still has no take-action flow, so nothing
  bumps that level yet.
- `civics.js` — the shared "teachable moment" popup (word-of-the-day
  facts + quote-matching quizzes), included on every page. As of 31 Aug
  2026, a `fact` card auto-dissolves on its own ~3.8s after showing
  (manual "Got it"/backdrop-click still skip it immediately) — it's pure
  information, no interaction needed, so it shouldn't require a click to
  go away. The fade-out itself is a full 1s (`DISMISS_ANIM_MS`, same
  path for manual and auto dismiss) rather than the original 0.35s snap —
  it needs to visibly dissolve, not just vanish, so the citizen's eye
  eases back into whatever was underneath instead of the card just
  disappearing. The interactive quiz card deliberately does NOT auto-dismiss.
  New `CivicsEngine.showDuringWait()` entry point shows a fact (never the
  quiz) specifically to fill a real network/AI wait elsewhere in the app —
  still respects the existing cooldown (so it won't stack a second popup
  right after an ambient one), but skips the random show-chance gate since
  the caller already knows a wait is genuinely happening. Wired into:
  builder.html's headline-swipe loading, its "it's complicated" drilldown
  loading, its top-3 digest loading, take-action.html's action-modal rep
  lookup/drafting, and municipal's live fetch. `FACTS` gained six new
  entries (31 Aug 2026, citizen asked for "info cards on electoral
  college and convention of states and a few of the more obscure
  aspects" of the system): Electoral College, Article V convention
  (worded around the actual constitutional mechanism — "Convention of
  States" is one modern campaign's name for triggering it, noted as such
  rather than treated as the official term, to keep the card neutral),
  faithless elector, gerrymander, and cloture.
- `dig/index.html` + `functions/api/dig-check.js` + `dig-stats.js` — DIG,
  an AI stance-checker across news/commentary sources. Real backend: daily
  spend cap, per-IP rate limit, anonymous usage stats.
- `send-to-civix.html` / `inbox.html` + `manifest.webmanifest` + `sw.js` —
  "Send to CiViX", an installable PWA share-target backed by a real
  Cloudflare Worker (`civix-capture.mycivix.workers.dev`, not in this
  repo) for the docket/filings API that both pages and `builder.html`'s
  Inbox read from. It also has a second, install-free path (the `.addr`
  panel): a real per-docket email address a citizen can save as a
  contact and then Share → Mail to from literally any app, no PWA
  install required — this is the one actually worth promoting as "clear
  and easy," since PWA share-target requires an install nothing in the
  app currently prompts for. As of 31 Aug 2026 the page also leads with
  a `.value-note` explaining *why* to do this (there was previously zero
  explanatory copy anywhere on this page, just mechanism).

  A first attempt at surfacing this in builder.html's Citizen mode (a
  `.citizen-send-note` callout tacked onto the bottom of the "done" card,
  below the top-3 digest) turned out to be exactly the "feels bolted-on,
  after the fact" problem it was trying to fix, per live user testing the
  same day — found by name via a fresh, from-scratch Citizen-mode run.
  Replaced with a real guided step: every path through Citizen mode
  (headline swipe, the 30-second quiz, topping-up, and take-action.html's
  seeded-drilldown handoff) now inserts a `{ type: 'more-priorities' }`
  card right before `done` — "Anything else on your mind?" — offering
  freeform text (classified onto the issue taxonomy the same way a
  headline is, via `classifyFreeformPriority()`, and written into both
  `addIssue()` *and* that issue's `stance` field, since typed text is
  itself a stance) alongside the real Send to CiViX handoff, in context,
  instead of a footnote after the reveal. The done card's own CTAs were
  also rebalanced once the digest could be the single, undistracted
  focus: "See everything" demoted from primary to secondary styling, and
  a `.citizen-digest-nudge` line ("Pick one above and go — most take
  under 5 minutes") added once real results load, actively pushing
  toward acting on one of the top 3 rather than just displaying them.
  **Reverted 2 Sep 2026** along with the rest of the inline digest — the
  done card's link into take-action.html (relabeled **"Take Action"**,
  see below) is primary-styled again, since it's once more the card's
  single next step rather than one option next to a digest already doing
  the convincing.

  **Watchdog mockup: watchlist, one-tap send, "beyond calls & email," 31
  Aug 2026** — the citizen asked for CiViX to prove out its "personal
  advocate" pitch: "you say the word, I fire off this email and it
  lands... I watch the topic and remind and alert... they will not slip
  something through in the middle of the night without you knowing."
  Explicitly asked to mock up the flow now and build it out fully later.
  Shipped honestly rather than as a pure mock where it could be: a real
  persisted **watchlist** (`P.watching`, `toggleWatch()`/`findWatch()`)
  reachable via a "🐕 Watch this bill/topic" toggle in both the bill-
  specific and general-advocacy action modals, surfaced in a new
  "Watching" panel above the collapsed detail sections. There's no
  accounts system, notification backend, or scheduled job in this
  architecture, so real push alerts aren't buildable today — but
  `checkWatchlistUpdates()` does a **real** comparison (not a mock)
  against `/api/calendar`'s own recent-activity fetch, which the page
  already runs on every load: if a watched bill's `latestAction` date
  has moved since it was added to the watchlist, a "🔔 Updated since you
  started watching" badge shows in the panel. Every piece of copy says
  "flags changes when you visit," never "alerted" or "sent" — the gap
  between what's real (persisted list + return-visit diffing) and what's
  still aspirational (real-time push) is deliberate and stated plainly,
  not glossed over. Similarly, **"Send it"** replaces the old two-step
  "Copy email" + "Open contact form" pair with one button
  (`fireOff()`) that does both — copies the draft and opens the rep's
  contact form in one tap — but the button copy still says "Copied —
  paste it in," not "Sent": 5calls never returns a real recipient email
  address to send to, and auto-submitting a third-party government
  contact form on a citizen's behalf isn't something to do invisibly.
  Full one-tap *delivery* would need either a real recipient address
  (offices don't publish one) or scripted form-submission (fragile,
  and not something to build without the citizen watching it happen) —
  flagged here as unsolved, not silently declared done. A new **"Beyond
  calls & email"** section in both modals hands off to real external
  tools instead of fabricating CiViX's own data for action types it
  explicitly deferred before (see "Petition and rally/event actions" in
  "The core loop" below): a Change.org search link and a Mobilize.us
  search link, both prefilled with the bill title or topic, plus an
  "Organize your own meeting" toggle that expands a short, genuinely
  useful static checklist (space, notice period, RSVP, inviting the
  rep's office, following up in writing) rather than pretending to have
  event data CiViX doesn't have.

  **Fixed a real dead end, also 31 Aug 2026**: this page's own "Adopt"
  button used to just PATCH the filing's server-side `state` straight to
  `'adopted'` — the *exact* field builder.html's real Inbox flow
  (`adoptFiling()`) uses to mean "this became an actual manifesto
  priority." But this button had no access to the manifesto and never
  called `addIssue()`; it only flipped the flag. Net effect: both
  builder.html's Inbox (`loadInbox()` filters to `state === 'docket'`)
  and `digest.js`'s docket matching (`fetchDocketItems()`, same filter)
  stopped seeing the item — "Adopt" silently made a filing invisible to
  every real downstream use, with no confirmation, no link back into the
  app, nothing. Fixed by replacing the button with a real link
  (`builder.html?openInbox=<filing-id>`) straight into that item's Inbox
  focus mode — the actual Prioritize/Push-to-actions/Strike decision —
  instead of a fake local toggle. builder.html's boot sequence gained a
  matching `?openInbox=` handler (forces Pro mode, since Inbox lives in
  the `.shell` Citizen mode hides; polls briefly for `INBOX` to load
  before opening focus mode, since it's populated asynchronously). The
  "Adopted" tab and its underlying state value are unchanged and still
  meaningful — they just can no longer be set directly from this page,
  only by actually going through the real flow.

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
- `OPENSTATES_API_KEY` — powers `/api/state-bills` and `/api/state-reps`
  (free, openstates.org/api/register).
- `RESEND_API_KEY` — powers `/api/send-state-email`, the real one-button
  state-legislator send (free tier, 100/day — resend.com). **Also
  requires mycivix.com to be added and verified as a sending domain in
  Resend's dashboard** (DNS records added at the domain registrar) before
  real sends succeed — an API key alone isn't enough here, unlike every
  other secret in this list. Optional tuning vars: `EMAIL_DAILY_LIMIT`
  (default 80, headroom under Resend's 100/day cap), `EMAIL_DAILY_LIMIT_PER_IP`
  (default 5), `EMAIL_FROM` (default `CiViX <noreply@mycivix.com>`).
- `GNEWS_API_KEY` — powers `/api/headlines` for builder.html's headline-
  swipe path (free tier, 100 req/day, allows production use — gnews.io).
- `UNSPLASH_ACCESS_KEY` — powers `/api/headline-image`, finding a real
  stock photo for each swiped headline via Unsplash's Search Photos API
  (free — unsplash.com/oauth/applications, register an app to get an
  Access Key). Free/demo tier caps at 50 requests/hour; apply for
  Unsplash's Production tier once real traffic needs more. Optional
  tuning var: `PHOTO_DAILY_LIMIT_PER_IP` (default 40, protects the shared
  hourly quota from one visitor).

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
  `index.html`/`take-action.html`/`builder.html` share one token system (navy/
  paper/amber, Newsreader + IBM Plex Mono); `send-to-civix.html` runs a
  visibly different one (different amber, different fonts — JetBrains Mono + Source
  Serif 4). Worth extracting into one shared stylesheet all pages `<link>` to.
- `package.json` is still named `dig-selfhosted` — a leftover from before the
  folder held more than one tool.
- **`civix-profile.token` vs. `civix.token` desync — fixed going forward,
  31 Aug 2026** (found 30 Aug 2026 while verifying the digest's Send-to-
  CiViX integration against the live site). `builder.html`/`digest.js`
  mint/read a docket token off `civix-profile.token`; `send-to-civix.html`
  minted/read its own, completely separate `civix.token` — the two were
  independently generated, so they could diverge (confirmed live in the
  user's own browser). Net effect: a citizen's real Send-to-CiViX filings
  wouldn't surface in the "top 3" digest unless the two tokens happened to
  match. Fixed by having each page's token-read path check the other's
  storage location first and adopt it if present (`ensureDrop()` in
  builder.html; `readToken()` in send-to-civix.html), rather than always
  minting independently — whichever page runs first mints the real token,
  the other adopts it. **Forward-looking only**: a citizen who already has
  two diverged tokens from before this fix isn't retroactively merged —
  the two dockets may already hold different server-side items, and
  there's no merge endpoint in the (out-of-repo) Worker to reconcile them.
  If the user has already hit this on their own device, it needs manual
  reconciliation (e.g. clearing one of the two stored tokens), not
  something to do to their real data without asking first.

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

- **Municipal calendar data — no longer sample content, but only for 8
  cities so far** (Boston, Seattle, Baltimore, Nashville, Phoenix,
  Charlotte NC, St. Paul, Pittsburgh — see `functions/api/municipal.js`).
  No unified public API exists the way congress.gov/OpenStates do
  federally/per-state; Legistar covers this list but is per-city, so
  growing coverage means verifying and adding one city's client slug at a
  time, not a single source swap.
- **~~State Take Action~~ — resolved 31 Aug 2026.** State bills now have
  a real Take Action modal with drafting *and* a genuine one-button send
  (via OpenStates' legislator `email` field + Resend) — see the
  "State Take Action is real" entry above. Built via a new OpenStates
  geo lookup (`functions/_lib/openstates-people.js`) rather than
  extending reps.js's federal-only 5calls data, since 5calls doesn't
  cover state legislators at all today.
- **Petition and rally/event actions — partially real as of 31 Aug
  2026.** The action modals' new "Beyond calls & email" section (see
  take-action.html's entry above) hands off to Change.org/Mobilize.us
  search links today rather than CiViX's own data — real external
  tools, not fake results, but still not a curated petition partner or
  a local-events feed of CiViX's own. That remains the real gap here.
- **Real-time watch alerts** — take-action.html's new watchlist (see
  entry above) does honest return-visit change detection against the
  federal calendar's own fetch, but there's no accounts system,
  notification backend, or scheduled job to actually push an alert to a
  citizen who isn't on the page. Building that is a real infrastructure
  project (accounts, a job runner, an email/push channel), not a small
  extension — the "mock it up now" scope stopped short of it on purpose.
- **Federal "Send it" still ends in a copy+paste, not a real send** —
  take-action.html's `fireOff()` (see entry above) removed a manual step but
  not the fundamental blocker: 5calls has no real recipient email address
  to send to, and CiViX won't auto-submit third-party government contact
  forms (most run CAPTCHA/bot-detection) on a citizen's behalf. This is
  now a real, permanent asymmetry rather than a temporary gap: state
  gained a genuine one-button send on 31 Aug 2026 (OpenStates publishes
  real legislator emails; Congress doesn't), and federal likely never
  will unless a public source of real congressional staff emails
  appears — solving it via scripted form-filling isn't happening,
  CAPTCHA-bypass is off the table regardless of authorization.
- **ZIP-only rep lookup is best-effort** — 5calls resolves a ZIP to a
  district, but ZIPs don't map 1:1 to congressional districts, so it can
  be wrong for a split ZIP. Precise lookup would mean asking for a full
  address; `builder.html`'s manifesto itself still never asks (still
  ZIP-only there) — the 31 Aug 2026 state-email feature asks for a
  mailing address, but narrowly, contextually in take-action.html's state
  action modal, only from someone about to actually send, and stored
  local-only (see "State Take Action is real" above). Whether to also
  use that address to sharpen federal district resolution is a separate
  decision not made here — today it's used only for signing state
  emails, nothing else.
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
