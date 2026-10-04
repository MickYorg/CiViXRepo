#!/bin/bash
# Puts the morning's listening texts in Apple Notes → CiViX without anyone
# asking. launchd starts it at 8:30am (scripts/com.mycivix.morning-notes.plist).
# Safe to re-run: anything already in notes/ is skipped.
#  - Briefs: the daily/weekly/quarterly routines also commit each brief to
#    the public repo MickYorg/civix-briefs (briefs/YYYY-MM-DD-<kind>-<frame>.txt);
#    this pulls it (no Claude needed) and files any new ones.
#  - Nightly report: a short headless Claude session reads the nightly
#    investigator's run log and writes it up for listening.
#   scripts/morning-notes.sh
set -u
cd "$(dirname "$0")/.." || exit 1
mkdir -p ~/Library/Logs/civix notes/briefs
echo "--- $(date)"

BRIEFS=~/civix-briefs
if [ -d "$BRIEFS/.git" ]; then
  git -C "$BRIEFS" pull -q --ff-only || echo "briefs: pull failed"
else
  git clone -q https://github.com/MickYorg/civix-briefs.git "$BRIEFS" || echo "briefs: clone failed"
fi
for f in "$BRIEFS"/briefs/*.txt; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  [ -e "notes/briefs/$name" ] && continue
  cp "$f" "notes/briefs/$name" && scripts/to-apple-notes.sh "notes/briefs/$name"
done

IFS= read -r -d '' PROMPT <<'EOF'
You are filing this morning's CiViX nightly investigator report into Apple Notes. Work only in this repo; do not change code, commit, or publish anything. Today's local date: run `date +%F`.

If notes/<today>-nightly-report.txt exists, stop. Otherwise use RemoteTrigger list_runs on trigger trig_01FkooSzXG33WVpyozqdqWon, take today's run (created today), and read its get_run_log. If there is no run today, stop. Write notes/<today>-nightly-report.txt for listening with text-to-speech: first line "CIVIX NIGHTLY INVESTIGATOR REPORT. <WEEKDAY>, <MONTH> <DAY IN WORDS>.", then a blank line, then one to three short plain paragraphs: green or not, what was checked, anything broken and what was done about it (branch or pull request). Plain prose, no markdown, numbers spelled out, say "citizen" not "user". Then run scripts/to-apple-notes.sh on it.

Reply with one line: filed, skipped (why), or failed (why).
EOF

~/.local/bin/claude -p "$PROMPT" --model sonnet \
  --allowedTools "RemoteTrigger" "ToolSearch" "Read" "Write" \
    "Bash(date:*)" "Bash(ls:*)" "Bash(scripts/to-apple-notes.sh:*)"
