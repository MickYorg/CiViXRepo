#!/usr/bin/env bash
# The daily demo clip: records the whole CiViX promise loop on the iPhone
# simulator and cuts it to about 15 seconds.
#   Safari story -> Share -> CiViX -> Send -> real background dig ->
#   "CiViX dug in" push -> tap -> the response -> first move -> the draft
# The loop itself is driven by ios/App/AppUITests/DemoLoopUITests.swift;
# this script records the screen, delivers the push when the real dig is
# done (the simulator can't receive real FCM pushes), and cuts the clip
# with scripts/demo-cut.swift (AVFoundation, no downloads).
# Uses the demo Send to CiViX address in ~/.civix-demo-token (never a
# citizen's). Costs one real dig and one draft, about 25 cents.
#   scripts/demo-loop.sh            full run (build if needed, record, cut)
# Output: notes/demo/YYYY-MM-DD-loop.mp4, plus a copy in iCloud Drive
# (CiViX Demos) so it shows up on the phone.
set -euo pipefail
cd "$(dirname "$0")/.."

SIM="${CIVIX_DEMO_SIM:-7A8A904E-D26D-4862-8744-8BBDAA3A0CB7}" # iPhone 17 Pro
DD=/tmp/civix-demo-dd
API=https://civix-capture.mycivix.workers.dev
TOKEN=$(tr -d '[:space:]' < ~/.civix-demo-token)
DAY=$(date +%F)
WORK=$(mktemp -d /tmp/civix-demo.XXXXXX)
OUT_DIR=notes/demo
mkdir -p "$OUT_DIR"
log() { echo "[$(date +%H:%M:%S)] $*"; }
now() { python3 -c 'import time; print(time.time())'; }

# Today's story: the first pre-warmed headline card with a civic topic.
ARTICLE=$(curl -s https://mycivix.com/api/headlines-batch | python3 -c '
import sys, json
cards = json.load(sys.stdin).get("cards") or []
news = ("apnews", "reuters", "npr.org", "politico", "thehill", "axios", "nbcnews", "cbsnews", "abcnews",
        "usatoday", "nytimes", "washingtonpost", "cnn.com", "foxnews", "pbs.org", "bloomberg", "wsj.com", "theguardian")
civic = [c for c in cards if c.get("topic") and c.get("article", {}).get("url")]
pick = next((c for c in civic if any(n in c["article"]["url"] for n in news)), civic[0] if civic else None)
print(pick["article"]["url"] if pick else "https://apnews.com/politics")')
log "story: $ARTICLE"

# Build (live mode: the app loads mycivix.com, so the clip shows what's live).
scripts/ios-live.sh on >/dev/null
if [ ! -d "$DD/Build/Products/Debug-iphonesimulator/App.app" ] || [ "${CIVIX_DEMO_REBUILD:-}" = 1 ]; then
  log "building"
  xcodebuild -workspace ios/App/App.xcworkspace -scheme DemoLoop \
    -destination "platform=iOS Simulator,id=$SIM" -derivedDataPath "$DD" build-for-testing -quiet
fi

xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null
open -a Simulator --args -CurrentDeviceUDID "$SIM" || true
xcrun simctl status_bar "$SIM" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 || true

BEFORE=$(curl -s -H 'Origin: https://mycivix.com' "$API/api/filings?token=$TOKEN" | python3 -c 'import sys,json; print(" ".join(i["id"] + ":" + str(i.get("repeats") or 0) for i in json.load(sys.stdin).get("items", [])))')

log "recording"
xcrun simctl io "$SIM" recordVideo --codec=h264 --force "$WORK/raw.mov" &
REC=$!
T0=$(now)
sleep 2

log "running the loop"
TEST_RUNNER_DEMO_TOKEN="$TOKEN" TEST_RUNNER_DEMO_ARTICLE_URL="$ARTICLE" \
  xcodebuild test-without-building -workspace ios/App/App.xcworkspace -scheme DemoLoop \
  -destination "platform=iOS Simulator,id=$SIM" -derivedDataPath "$DD" \
  -only-testing:AppUITests/DemoLoopUITests/testPromiseLoop > "$WORK/test.log" 2>&1 &
TEST=$!

# Wait for the shared story to arrive, then for its real dig to finish.
ID=""; T_SENT=""; T_DUG=""
for _ in $(seq 1 180); do
  sleep 2
  STATE=$(curl -s -H 'Origin: https://mycivix.com' "$API/api/filings?token=$TOKEN" | BEFORE="$BEFORE" python3 -c '
import sys, json, os
before = set(os.environ["BEFORE"].split())
# New, or a repeat share of an existing story (CiViX counts repeats on the same item).
items = [i for i in json.load(sys.stdin).get("items", []) if i["id"] + ":" + str(i.get("repeats") or 0) not in before]
print(items[0]["id"] + " " + (items[0].get("dig_state") or "new") if items else "")' || true)
  if [ -n "$STATE" ]; then
    set -- $STATE
    if [ -z "$ID" ]; then ID=$1; T_SENT=$(now); log "shared: $ID"; fi
    if [ "$2" = ready ]; then T_DUG=$(now); log "dug in"; break; fi
    if [ "$2" = error ]; then log "dig failed"; break; fi
  fi
  kill -0 "$TEST" 2>/dev/null || break
done

if [ -n "$T_DUG" ]; then
  # Give the test time to get back to the home screen (a repeat share is
  # already dug, so "dug in" can come right after the share).
  WAIT=$(python3 -c "print(max(0, 15 - ($(now) - $T_SENT)))"); sleep "$WAIT"
  cat > "$WORK/push.json" <<JSON
{"aps":{"alert":{"title":"CiViX dug in","body":"CiViX looked into what you sent. Tap to see your move."},"sound":"default"},"sent":"$ID"}
JSON
  xcrun simctl push "$SIM" com.mycivix.ios "$WORK/push.json"
  log "push delivered"
fi

wait "$TEST" && RESULT=passed || RESULT=failed
T_END=$(now)
sleep 1
kill -INT "$REC"; wait "$REC" 2>/dev/null || true
log "loop $RESULT"
[ "$RESULT" = passed ] || { tail -40 "$WORK/test.log"; echo "raw recording kept at $WORK/raw.mov"; exit 1; }

# Cut to ~15 seconds: setup sped up, the dig wait squeezed, the payoff
# (push -> response -> action) near real speed. The last seconds are the
# test tearing down (back to the home screen), so they're trimmed.
OUT="$OUT_DIR/$DAY-loop.mp4"
cp "$WORK/test.log" /tmp/civix-demo-last-test.log
swift scripts/demo-cut.swift "$WORK/raw.mov" "$OUT" \
  "$(python3 -c "print($T_SENT - $T0 + 2)")" "$(python3 -c "print($T_DUG - $T0)")" \
  "$(python3 -c "print($T_END - $T0 - 5)")" 15
log "clip: $OUT"

ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs/CiViX Demos"
mkdir -p "$ICLOUD" && cp "$OUT" "$ICLOUD/" && log "copied to iCloud Drive / CiViX Demos"
rm -rf "$WORK"
