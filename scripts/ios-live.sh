#!/usr/bin/env bash
# Switches the iOS project between the two ways it can load CiViX's pages:
#
#   scripts/ios-live.sh on    test builds (TestFlight / your phone): the app
#                             loads https://mycivix.com directly, so every
#                             push shows up on the next app launch — no
#                             rebuild, no reinstall.
#   scripts/ios-live.sh off   App Store builds: pages bundled in the app
#                             (works offline, safer for App Review).
#
# Run after `npm run cap:sync` (which rewrites the iOS config from
# capacitor.config.json, i.e. resets to "off"). Only touches the generated
# ios/App/App/capacitor.config.json; the shared config stays bundled-mode.
set -euo pipefail
cd "$(dirname "$0")/.."
CFG=ios/App/App/capacitor.config.json
MODE="${1:-}"
node -e '
const fs = require("fs");
const [cfgPath, mode] = process.argv.slice(1);
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
cfg.server = cfg.server || {};
if (mode === "on") cfg.server.url = "https://mycivix.com";
else if (mode === "off") delete cfg.server.url;
else { console.error("usage: ios-live.sh on|off"); process.exit(2); }
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, "\t") + "\n");
console.log("iOS app now loads: " + (cfg.server.url || "bundled pages"));
' "$CFG" "$MODE"
