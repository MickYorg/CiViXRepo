#!/bin/bash
# Puts the morning's listening texts in Apple Notes → CiViX without anyone
# asking: the CiViX Brief page (daily/weekly/quarterly, written in the cloud,
# which can't reach this Mac) and the nightly investigator's report. Runs a
# short headless Claude session; launchd starts it at 8:30am
# (scripts/com.mycivix.morning-notes.plist). Safe to re-run: anything
# already in notes/ is skipped.
#   scripts/morning-notes.sh
set -u
cd "$(dirname "$0")/.." || exit 1
mkdir -p ~/Library/Logs/civix
echo "--- $(date)"

IFS= read -r -d '' PROMPT <<'EOF'
You are filing this morning's CiViX listening texts into Apple Notes. Work only in this repo; do not change code, commit, or publish anything. Today's local date: run `date +%F`.

1. THE BRIEF. Read the artifact https://claude.ai/artifact/J5EHCohsibNjRMeadYrQgB with the Artifact tool (action read, path index.html). Its h1 says which brief it is (daily, weekly or quarterly) and its date. If that date is not today, skip this step. Otherwise name it notes/briefs/<today>-<daily|weekly|quarterly>-<frame in lowercase-hyphens, e.g. ships-log; quarterly needs no frame>.txt. If a file for today and that kind already exists in notes/briefs/, skip. Otherwise run: python3 scripts/page-to-text.py <saved index.html> > that file, then scripts/to-apple-notes.sh that file.

2. THE NIGHTLY REPORT. If notes/<today>-nightly-report.txt exists, skip. Otherwise use RemoteTrigger list_runs on trigger trig_01FkooSzXG33WVpyozqdqWon, take today's run (created today), and read its get_run_log. If there is no run today, skip. Write notes/<today>-nightly-report.txt for listening with text-to-speech: first line "CIVIX NIGHTLY INVESTIGATOR REPORT. <WEEKDAY>, <MONTH> <DAY IN WORDS>.", then a blank line, then one to three short plain paragraphs: green or not, what was checked, anything broken and what was done about it (branch or pull request). Plain prose, no markdown, numbers spelled out, say "citizen" not "user". Then run scripts/to-apple-notes.sh on it.

Reply with one line per step: filed, skipped (why), or failed (why).
EOF

~/.local/bin/claude -p "$PROMPT" --model sonnet \
  --allowedTools "Artifact" "RemoteTrigger" "ToolSearch" "Read" "Write" \
    "Bash(date:*)" "Bash(ls:*)" "Bash(python3 scripts/page-to-text.py:*)" "Bash(scripts/to-apple-notes.sh:*)"
