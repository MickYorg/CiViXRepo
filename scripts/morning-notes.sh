#!/bin/bash
# Puts the morning's listening texts in Apple Notes → CiViX without anyone
# asking. launchd starts it at 8:30am (scripts/com.mycivix.morning-notes.plist);
# if the Mac was asleep, it runs on wake. Safe to re-run: anything already in
# notes/ is skipped.
#  - Briefs: the daily/weekly/quarterly routines commit each brief to the
#    public repo MickYorg/civix-briefs (briefs/YYYY-MM-DD-<kind>-<frame>.txt);
#    this pulls it (no Claude needed) and files any new ones.
#  - Nightly report: a short headless Claude session reads the nightly
#    investigator's run log and writes it up for listening.
# Briefs can land after 8:30 (the weekly took until 8:39 on 5 Oct 2026), so
# both are retried every 10 minutes until 11:30. If either is still missing
# then, a "problem" note says so in Notes instead of failing silently.
#   scripts/morning-notes.sh
set -u
cd "$(dirname "$0")/.." || exit 1
mkdir -p ~/Library/Logs/civix notes/briefs
echo "--- $(date)"

# One run at a time (the schedule and a manual kickstart can overlap).
LOCK=/tmp/civix-morning-notes.lock
if ! mkdir "$LOCK" 2>/dev/null; then echo "already running"; exit 0; fi
trap 'rmdir "$LOCK"' EXIT

TODAY=$(date +%F)
BRIEFS=~/civix-briefs
DEADLINE=$(date -j -f "%H:%M" "11:30" +%s)

# A brief counts as filed if notes/briefs has one for the same date and kind
# (daily/weekly/quarterly), whatever its frame is called.
brief_filed() {  # $1 = file name, e.g. 2026-10-05-weekly-friendly-debate.txt
  local key; key=$(echo "$1" | cut -d- -f1-4)
  ls notes/briefs/"$key"* >/dev/null 2>&1
}
file_briefs() {
  if [ -d "$BRIEFS/.git" ]; then
    git -C "$BRIEFS" pull -q --ff-only || echo "briefs: pull failed"
  else
    git clone -q https://github.com/MickYorg/civix-briefs.git "$BRIEFS" || echo "briefs: clone failed"
  fi
  for f in "$BRIEFS"/briefs/*.txt; do
    [ -e "$f" ] || continue
    name=$(basename "$f")
    brief_filed "$name" && continue
    cp "$f" "notes/briefs/$name" && scripts/to-apple-notes.sh "notes/briefs/$name" && echo "filed brief: $name"
  done
}
todays_brief() { ls notes/briefs/"$TODAY"-* >/dev/null 2>&1; }

IFS= read -r -d '' PROMPT <<'EOF'
You are filing this morning's CiViX nightly investigator report into Apple Notes. Work only in this repo; do not change code, commit, or publish anything. Today's local date: run `date +%F`.

If notes/<today>-nightly-report.txt exists, stop. Otherwise use RemoteTrigger list_runs on trigger trig_01FkooSzXG33WVpyozqdqWon, take today's run (created today), and read its get_run_log. If there is no run today, or it hasn't finished, stop. Write notes/<today>-nightly-report.txt for listening with text-to-speech: first line "CIVIX NIGHTLY INVESTIGATOR REPORT. <WEEKDAY>, <MONTH> <DAY IN WORDS>.", then a blank line, then one to three short plain paragraphs: green or not, what was checked, anything broken and what was done about it (branch or pull request). Plain prose, no markdown, numbers spelled out, say "citizen" not "user". Then run scripts/to-apple-notes.sh on it.

Reply with one line: filed, skipped (why), or failed (why).
EOF
NIGHTLY="notes/$TODAY-nightly-report.txt"
file_nightly() {
  ~/.local/bin/claude -p "$PROMPT" --model sonnet \
    --allowedTools "RemoteTrigger" "ToolSearch" "Read" "Write" \
      "Bash(date:*)" "Bash(ls:*)" "Bash(scripts/to-apple-notes.sh:*)"
}

while :; do
  todays_brief || file_briefs
  [ -e "$NIGHTLY" ] || file_nightly
  todays_brief && [ -e "$NIGHTLY" ] && { echo "all filed"; exit 0; }
  [ "$(date +%s)" -ge "$DEADLINE" ] && break
  sleep 600
done

# Still missing at the deadline: say so where it'll be seen.
PROBLEM="notes/$TODAY-morning-notes-problem.txt"
{
  echo "CIVIX MORNING NOTES: SOMETHING IS MISSING"
  echo
  todays_brief || echo "No brief for today reached the civix-briefs repo by eleven thirty. Open the CiViX Brief page instead, and check the brief routine's latest run for an error."
  [ -e "$NIGHTLY" ] || echo "The nightly investigator report couldn't be filed. Its run may not have happened, or the background Claude session failed; the log is in Library, Logs, civix, morning-notes.log."
} > "$PROBLEM"
scripts/to-apple-notes.sh "$PROBLEM"
echo "problem note filed"
