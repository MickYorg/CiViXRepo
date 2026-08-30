# Send to CiViX — setup

## Files, all at the site root

```
/send-to-civix.html
/manifest.webmanifest
/sw.js
/icon-192.png
/icon-512.png
/icon-maskable-512.png
```

Root placement is not cosmetic. `sw.js` can only control the scope it is served
from, and the share target `action` has to sit inside the manifest's `scope`.
Put these in a subfolder and the share target silently never appears.

## One line to add to your existing pages

Add to the `<head>` of `index.html` (and any other page):

```html
<link rel="manifest" href="/manifest.webmanifest">
```

`send-to-civix.html` already links it and registers the service worker itself.

## Netlify

No functions, no environment variables, no build step. Drop the files in and
deploy. Two headers are worth setting in `netlify.toml` so the manifest is
served correctly and the worker is never cached stale:

```toml
[[headers]]
  for = "/manifest.webmanifest"
  [headers.values]
    Content-Type = "application/manifest+json"

[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "no-cache"
```

## Testing it

The share target only appears **after the app is installed**. Sequence:

1. Open the site in Chrome on Android (or desktop Chrome/Edge).
2. Menu → *Install app* / *Add to Home screen*. The in-app install bar on
   `/send-to-civix.html` fires the same prompt when the browser offers it.
3. Open any other app — news, browser, Reddit, mail — and hit share.
4. CiViX appears in the sheet. Pick it. The link lands on your docket.

To test the receiving logic without installing anything, just visit the action
URL with the params by hand:

```
/send-to-civix.html?title=Test%20item&text=some%20note&url=https://example.com/x
```

Chrome DevTools → Application → Manifest will also flag any manifest or icon
problem before you go hunting.

## Known limits of this version

- **iOS does nothing.** Safari does not implement Web Share Target, and no
  amount of manifest work changes that. iOS users have the paste field on the
  docket page as a stopgap. Closing this properly means either a Shortcut that
  POSTs to an endpoint, or a capture email address — both need a server, which
  this version deliberately does not have.
- **Local storage only.** The docket lives on one device. Clearing browser data
  clears it. Export writes `civix-docket.json` as a manual backup.
- **No content fetching.** Titles come from whatever the sharing app hands over.
  Some apps send only a bare URL, so the domain becomes the headline. Fetching
  page titles would need a server-side proxy.

## Data shape

`localStorage["civix.docket.v1"]`:

```json
{
  "seq": 3,
  "items": [
    {
      "id": "f1755...",
      "seq": 3,
      "key": "ctmirror.org/2026/08/housing-bill",
      "title": "Senate advances housing bill",
      "url": "https://www.ctmirror.org/2026/08/housing-bill?utm_source=share",
      "host": "ctmirror.org",
      "note": "",
      "at": 1755500000000,
      "repeats": 2,
      "state": "docket"
    }
  ]
}
```

`key` is the canonicalized URL — lowercased host, `www.` and tracking params
stripped, trailing slash removed — so the same article shared from two apps
lands once and increments `repeats` instead. That repeat count is a genuine
signal for the profile builder later: sending the same thing three times says
more about what you care about than any slider would.

`state` is `docket` or `adopted`. Adopted is the handoff point — that is the
array the profile builder should read when you wire it up.
