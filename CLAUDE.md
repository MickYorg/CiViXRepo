# CiViX — project briefing

CiViX (mycivix.com) is a civic engagement platform: a citizen builds a
private **manifesto** of what they care about, CiViX matches it against the
municipal/state/federal calendar, and turns it into action they control.
Web app plus an iOS/Android app (Capacitor wrapper around the same pages).

This file is the short, current briefing. The full dated history of every
decision and fix (why things are the way they are) is in
**`docs/history.md`** — search it before re-deciding something, don't load
it whole.

## The bar

- The citizen's two core promises: CiViX genuinely **gets to know them**, and
  **advocates effectively** for them. The quality bar is "richer than just
  Googling the bill," not "no bugs."
- **"Never shared, never sold"** and a frictionless, encouraging feel are
  engineering constraints, not copy (e.g. push text never names the bill;
  no analytics SDKs; opt-outs are real server deletes).
- Copy says **citizen** (not user) and **manifesto** (not profile).
- Verify what the citizen actually sees (live, on a phone when it's a
  phone bug), not just that intermediate steps work.

## Testing — do this, every change

- `npm test` — offline regression tests (seconds): real `digest.js`, page
  functions (extracted from the HTML by `tests/helpers/load.js`),
  `functions/_lib`, and checks that hand-synced copies still match.
  **Every bug fix gets a test in `tests/unit/`.**
- `npm run test:layout` — `scripts/phone-check.js`: every page at iPhone
  SE/16/Pro Max with real data; fails on sideways scroll or if a page gets
  worse than `tests/phone-baseline.json` (a ratchet). Look at the
  screenshots in `phone-check-out/`; `-- --laptop` adds a MacBook
  reference; `--update-baseline` only after looking. Phone-width rules that
  apply to every page go in the shared **`phone.css`**; the standard header
  (CiViX left, mode switch centered, theme toggle right, one line, every
  page) is **`topbar.css`**. Don't restyle the header per page.
- `npm run test:live` — production smoke checks (no AI spend, no email).
- `.githooks/pre-push` runs tests before every push (layout too when pages
  changed). New clone: `git config core.hooksPath .githooks`.
  `.github/workflows/tests.yml` runs everything on push and nightly 7:17am ET
  against production; GitHub emails on failure.
- Changing how a **cached** value is derived (an AI prompt, a status rule)?
  Bump its cache key's version in the same change.
- Small fixes: commit and push without asking. Big/epic work: confirm the
  plan first.

## Map

**Pages** (hand-written HTML, inline `<style>`/`<script>`, no bundler, no
framework — deliberately, until there's real cross-page shared state):
- `index.html` — splash; animated "amendment" sequence, auto-advances to
  the builder.
- `builder.html` — builds the manifesto. Citizen mode = swipe deck
  (headlines, "it's complicated" drilldowns, freeform "anything else on
  your mind?"); Activist = guided steps; Pro = every section open (Inbox,
  issues, positions, sources, actions, export/import). Citizen's
  "Start over from scratch" resets the manifesto.
- `take-action.html` — top 3 ("focus zone") + municipal/state/federal
  detail; take-action modals draft calls/emails; state legislators get a
  real one-button email send (Resend); watchlist.
- `calendar.html` — multi-year strategy (`/api/strategic-plan`) plus
  hand-written contingency playbooks.
- `dig/index.html` — DIG: stance-by-source checker, DEBATE talking points.
- `send-to-civix.html` — Send to CiViX (share target + per-docket email).
- `analytics.html` — real anonymous platform stats (+ labeled sample data).
- Placeholders: `connect.html`, `civil-dis.html`, `civix-track.html`.
- `dev/index.html` — web-only persona switcher (not in the app).

**Shared client JS:** `digest.js` (top-3 engine, bill matching),
`mode.js` (Citizen/Activist/Pro), `civics.js` (teachable-moment popups;
paused on builder), `usage-ticker.js`, `app-shell.js` (native tab bar, link
handling, back button — native only), `native-fetch.js` (iOS `/api` fix,
must load in `<head>`), `push.js`. Manifesto lives in `localStorage`
`civix-profile`.

**Backend:** Cloudflare Pages Functions in `functions/api/*` (KV `DIG_KV`),
shared helpers in `functions/_lib/`. AI calls go through `dig-check.js`
(tag each call with a `feature`), `plain-summary.js`, `strategic-plan.js`;
spend tracked per feature (`_lib/token-stats.js`). Never return
502/504/52x from a Function (Cloudflare replaces the body); use 500.
Debug live Functions with `wrangler pages deployment tail <id> --project-name mycivix`.

**Workers:** `workers/civix-capture/` (Send to CiViX docket backend, D1,
inbound email; deployed bundle recovered 24 Sep 2026 — `npx wrangler deploy`
from that folder) and `workers/push-scheduler/` (hourly watchlist diff →
FCM push; manual run: `POST /run` with `X-Trigger-Secret` from
`~/.civix-push-trigger-secret`).

**Worker-to-Worker calls must use a service binding** (`[[services]]` in
wrangler.toml, `env.X.fetch`): fetching another Worker's workers.dev URL on
the same account returns 404 (error 1042). That silently broke every
"CiViX dug in" push until 26 Sep 2026. The capture Worker's `dig.pushed`
field records each push attempt's outcome.

**Hand-synced copies (tests enforce them):** `SYNONYMS` and loose-word
stoplists in `digest.js` / `functions/_lib/bill-matching.js` /
`builder.html`; issue taxonomy `builder.html` CATALOG ↔
`functions/_lib/issue-taxonomy.js`; headline boildown prompt in
`builder.html` ↔ `functions/api/headlines-batch.js`.

## Secrets (Cloudflare Pages, Production + Preview; new secret needs a new deploy, not "Retry")

`ANTHROPIC_API_KEY` (create with **no expiration**, **scoped to the
workspace**), `CONGRESS_API_KEY`, `FIVECALLS_API_TOKEN`,
`OPENSTATES_API_KEY`, `RESEND_API_KEY` (mycivix.com verified in Resend),
`GNEWS_API_KEY`, `UNSPLASH_ACCESS_KEY`. Firebase client configs
(`android/app/google-services.json`, `ios/App/App/GoogleService-Info.plist`)
are gitignored — public repo — re-download from the Firebase console
(project `civix-deb58`).

## Native app

- `npm run cap:sync` builds `www/` (`scripts/build-www.sh`) and syncs both
  platforms. Bundle IDs: iOS **`com.mycivix.ios`** (`com.mycivix.app` was
  taken), Android `com.mycivix.app`. Apple Team `22Q786NFKQ`. The user has
  paid Apple Developer and Google Play accounts; **Apple-only testing for
  now** (no Android device yet).
- iOS pages load at **`capacitor://mycivix.com`**, not https: relative
  `/api/` calls are rewritten by `native-fetch.js`; both the API middleware
  and the capture Worker allow that origin; `target=_blank` internal links
  are opened in place by `app-shell.js` (else iOS hands `capacitor://` to
  another app — it launched AAA's). Android serves at `https://mycivix.com`
  and passes `/api/*` through in `MainActivity.java`.
- Install on the user's iPhone (connected): build with `xcodebuild
  -workspace ios/App/App.xcworkspace -scheme App -destination
  'generic/platform=iOS' -allowProvisioningUpdates build`, then `xcrun
  devicectl device install app --device <id> <App.app>`. Simulator: same
  with `-sdk iphonesimulator`, `xcrun simctl install/launch`. Real device
  console: `xcrun devicectl device process launch --console …`.
- This Mac is Intel: Xcode 26.6 (last universal), Homebrew via the
  pre-arm64-check installer commit, CocoaPods on `ruby@3.3`, JDK 21 at
  `~/jdks/jdk-21.0.12.1+1` for Android builds. Details in history.
- Push: Android verified end to end; iOS wired (APNs key in Firebase) but
  delivery not yet verified on a device.

## Working with this user

- **Every listening text goes three places.** The user listens with Apple
  Notes' Speak (not Safari's Listen to Page), so Notes is primary:
  `scripts/to-apple-notes.sh <file>` puts it in Notes → CiViX (needs the
  Mac's one-time Automation permission; if it times out, the prompt is
  waiting on the Mac). As the bridge when that can't run, publish a private
  page with `python3 scripts/listen-page.py <file> "<name>"` (Copy all →
  paste into a note → Speak) and send a push. And always `notes/` (below).
- **`notes/` is the one place for every listening text** (gitignored, never
  shipped). Every summary/plan text file goes there, and the scheduled
  briefs (published in the cloud as private pages) get copied into
  `notes/briefs/` as plain text: at the start of each session, list the
  user's artifacts titled "CiViX … brief", and save any not yet in
  `notes/briefs/` as `YYYY-MM-DD-<daily|weekly|quarterly>-<frame>.txt`.

- Often off-grid on a boat (solar, slow internet): flag big downloads and
  long builds first. Starts sessions with `civix` (shell function:
  `claude --continue --remote-control`; `civix new` for a fresh one).
- Never embed other sites in the app; share out via the OS share sheet.
- Never silently drop what a citizen typed; show added / skipped / why.
- Classify freeform input specificity-first; keep the citizen's words.
- No party emoji (🎉) in celebration UI.
- Dev tools snapshot and restore real data rather than overwrite it.

## Open work (priority order)

1. **Streamlining — done 24 Sep 2026.** `civix` startup command;
   regression suite + pre-push + CI; Health page (`health.html`, reads
   GitHub from the browser); TestFlight (`npm run ios:testflight`; app
   6815834665, listing name "mccivix", internal group "Me" gets every
   build; test builds load the live site via `scripts/ios-live.sh`); the
   **nightly investigator** routine (claude.ai/code/routines/trig_01FkooSzXG33WVpyozqdqWon,
   7:45am ET, after the 7:17am CI run: all green → stops; failures → root cause + fix + test on a
   `nightly/<date>` branch and PR, never main); and listening **briefs**
   (daily 8:05am ET except Monday, weekly Monday, quarterly on the 1st of
   Jan/Apr/Jul/Oct: rotating creative formats, delivered as a private page
   plus a push to the phone; routines "CiViX daily/weekly/quarterly
   brief"). Still to build: the App
   Store half of hybrid live updates (bundled pages + a self-hosted
   update channel).
2. **App Store MVP, remaining phases:** audit of the "advocating
   effectively" half (federal reps lookup, docket classification,
   municipal events still unaudited); Privacy Policy + Terms pages (none
   exist); store metadata and privacy questionnaires; Play internal
   testing (needs an Android device); submission. Ship free, no monetization UI at first.
3. **Known gaps:** federal "Send it" ends in copy+paste (no congressional
   email source; no CAPTCHA-bypassing form submission, ever); municipal
   covers 8 Legistar cities; ZIP→district is best-effort; small 9-10px
   labels remain on builder Pro and analytics (the layout baseline allows
   them; improve and ratchet down); the test persona's top 3 showed an
   MQ-9 drone bill tagged "Housing affordability" (loose-match false
   positive, untraced); `DIG_DAILY_BUDGET_USD` still $20 while per-IP
   limit rose to 100.
4. **Roadmap, not started:** DIG-light inside the Citizen flow,
   Citizen → Activist graduation, CiViX Coin spending, donations /
   sponsorships, Pro/Org mockup, "Hey CiViX" voice (on-device only),
   more beyond-legislative sources (Federal Register, regulations.gov).
   International decided against for now (if revisited: Canada first,
   via a jurisdiction-adapter interface).
