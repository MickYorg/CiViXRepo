#!/usr/bin/env bash
# Copies a plain-text file into Apple Notes (folder "CiViX"), so it syncs via
# iCloud to the iPhone/iPad: open it anywhere, Select All, Speak.
#   scripts/to-apple-notes.sh notes/2026-09-25-walk-summary.txt [more files…]
# The note's title is the file's first line. Re-running with the same title
# replaces that note instead of making a duplicate.
set -euo pipefail
for f in "$@"; do
  python3 - "$f" <<'PY' | osascript -
import html, json, sys
text = open(sys.argv[1], encoding="utf-8").read().strip()
title = text.splitlines()[0].strip()[:120] or sys.argv[1]
body = "".join(f"<div>{html.escape(line) or '<br>'}</div>" for line in text.splitlines())
esc = lambda s: s.replace("\\", "\\\\").replace('"', '\\"')
print(f'''
tell application "Notes"
  set acct to default account
  if not (exists folder "CiViX" of acct) then make new folder at acct with properties {{name:"CiViX"}}
  set f to folder "CiViX" of acct
  set existing to (every note of f whose name is "{esc(title)}")
  repeat with n in existing
    delete n
  end repeat
  make new note at f with properties {{name:"{esc(title)}", body:"{esc(body)}"}}
end tell
return "saved: {esc(title)}"
''')
PY
done
