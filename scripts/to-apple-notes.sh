#!/usr/bin/env bash
# Copies a plain-text file into Apple Notes (folder "CiViX"), so it syncs via
# iCloud to the iPhone/iPad: open it anywhere, Select All, Speak.
#   scripts/to-apple-notes.sh notes/2026-09-25-walk-summary.txt [more files…]
# The note's title is YYYYMMDD (from a YYYY-MM-DD in the file name, else
# today) plus the file's first line. Notes stack: nothing is replaced or
# deleted, so every day's text stays (archiving old ones comes later).
set -euo pipefail
for f in "$@"; do
  python3 - "$f" <<'PY' | osascript -
import datetime, html, json, os, re, sys
text = open(sys.argv[1], encoding="utf-8").read().strip()
m = re.search(r"(\d{4})-(\d{2})-(\d{2})", os.path.basename(sys.argv[1]))
stamp = "".join(m.groups()) if m else datetime.date.today().strftime("%Y%m%d")
title = (stamp + " " + (text.splitlines()[0].strip() or sys.argv[1]))[:120]
body = "".join(f"<div>{html.escape(line) or '<br>'}</div>" for line in text.splitlines())
esc = lambda s: s.replace("\\", "\\\\").replace('"', '\\"')
print(f'''
tell application "Notes"
  set acct to default account
  if not (exists folder "CiViX" of acct) then make new folder at acct with properties {{name:"CiViX"}}
  set f to folder "CiViX" of acct
  make new note at f with properties {{name:"{esc(title)}", body:"{esc(body)}"}}
end tell
return "saved: {esc(title)}"
''')
PY
done
