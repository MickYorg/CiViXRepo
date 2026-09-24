#!/usr/bin/env bash
# Builds a live-site test build of the iOS app and uploads it to TestFlight,
# so it installs over the air (TestFlight app on the phone) — no cable.
# Only needed when native code/config changes; web fixes reach test builds
# on their own, since they load https://mycivix.com (scripts/ios-live.sh).
#
# One-time setup (App Store Connect → Users and Access → Integrations →
# App Store Connect API → Team Keys, role "App Manager"): download the .p8
# to ~/.civix-asc/AuthKey_<KEYID>.p8 and create ~/.civix-asc/config with
#   ASC_KEY_ID=<key id>
#   ASC_ISSUER_ID=<issuer id>
# (chmod 600 both). Never commit these.
set -euo pipefail
cd "$(dirname "$0")/.."
source ~/.civix-asc/config
KEY="$HOME/.civix-asc/AuthKey_${ASC_KEY_ID}.p8"
[ -f "$KEY" ] || { echo "missing $KEY — see the setup notes at the top of this script"; exit 1; }

OUT="${TMPDIR:-/tmp}/civix-testflight"
rm -rf "$OUT" && mkdir -p "$OUT"
BUILD_NUMBER=$(date -u +%Y%m%d%H%M)   # always increasing, as App Store Connect requires

npm run cap:sync >/dev/null
scripts/ios-live.sh on

AUTH=(-allowProvisioningUpdates
  -authenticationKeyPath "$KEY"
  -authenticationKeyID "$ASC_KEY_ID"
  -authenticationKeyIssuerID "$ASC_ISSUER_ID")

echo "▸ archiving build $BUILD_NUMBER"
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/App.xcarchive" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" "${AUTH[@]}" archive | grep -E "ARCHIVE (SUCCEEDED|FAILED)|error:"

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>22Q786NFKQ</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

echo "▸ uploading to App Store Connect"
xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -exportPath "$OUT/export" "${AUTH[@]}" \
  | grep -E "EXPORT (SUCCEEDED|FAILED)|Upload|error:"

# Leave the working copy in bundled mode, the safe default.
scripts/ios-live.sh off
echo "✓ build $BUILD_NUMBER uploaded — it appears in TestFlight after Apple's processing (usually 5-15 min)"
