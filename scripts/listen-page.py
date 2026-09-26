#!/usr/bin/env python3
"""Turns a listening text file (notes/*.txt) into a phone-friendly HTML page
to publish as a private Artifact: open it anywhere, Copy all, paste into a
new Apple Note, Select All, Speak (the user prefers Notes' Speak; Apple
Notes is the primary destination once scripts/to-apple-notes.sh can run).

  python3 scripts/listen-page.py notes/2026-09-25-walk-summary.txt "CiViX Walk Summary" > out.html
  (second argument: the short page name; defaults to the first line)

Conventions in the text files: first line is the title; a short line in ALL
CAPS is a section heading; blank lines separate paragraphs.
"""
import html
import re
import sys

def caps(t):
    """Title case that leaves apostrophes alone (str.title makes "We'Ve")."""
    out = " ".join(w[:1].upper() + w[1:].lower() for w in t.split())
    return re.sub(r"\bCivix\b", "CiViX", out)


src = open(sys.argv[1], encoding="utf-8").read().strip()
lines = src.splitlines()
first = lines[0].strip().rstrip(".")
title = caps(first) if first.upper() == first else first
blocks, para = [], []


def flush():
    if para:
        blocks.append(("p", " ".join(para)))
        para.clear()


for line in lines[1:]:
    s = line.strip()
    if not s:
        flush()
        continue
    if len(s) <= 80 and s.upper() == s and re.search(r"[A-Z]{3}", s):
        flush()
        blocks.append(("h2", caps(s)))
        continue
    para.append(s)
flush()

words = len(src.split())
minutes = max(1, round(words / 150))
body = "\n".join(
    f'<h2>{html.escape(t)}</h2>' if k == "h2" else f"<p>{html.escape(t)}</p>" for k, t in blocks
)
page_title = sys.argv[2] if len(sys.argv) > 2 else title[:60]

print(f"""<title>{html.escape(page_title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,600;6..72,700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {{
    --ground: #FBFAF7; --ink: #14192B; --dim: #5E6679; --amber: #8F6111; --rule: #E2E0D8; --chip: #F2EEE3;
  }}
  @media (prefers-color-scheme: dark) {{
    :root:not([data-theme="light"]) {{
      --ground: #0A0F1C; --ink: #ECEAE2; --dim: #8792A8; --amber: #E0A93F; --rule: #222C42; --chip: #121A2C;
      color-scheme: dark;
    }}
  }}
  :root[data-theme="dark"] {{
    --ground: #0A0F1C; --ink: #ECEAE2; --dim: #8792A8; --amber: #E0A93F; --rule: #222C42; --chip: #121A2C;
    color-scheme: dark;
  }}
  body {{ background: var(--ground); color: var(--ink); font-family: 'Newsreader', Georgia, serif; padding: 0 20px; }}
  main {{ max-width: 36rem; margin: 0 auto; padding-block: 36px 72px; }}
  .mark {{ font-weight: 700; font-size: 20px; letter-spacing: -0.01em; margin: 0 0 22px; }}
  .mark em {{ font-style: normal; color: var(--amber); }}
  h1 {{ font-size: clamp(28px, 7vw, 38px); line-height: 1.12; margin: 0 0 10px; text-wrap: balance; }}
  .meta {{ font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim); margin: 0 0 18px; }}
  .how {{ background: var(--chip); border-radius: 10px; padding: 12px 14px; font-size: 15px; line-height: 1.5; color: var(--dim); margin: 0 0 30px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }}
  .how button {{ font: 500 13px 'IBM Plex Mono', ui-monospace, monospace; letter-spacing: 0.04em; border: 1px solid var(--amber); color: var(--amber); background: none; border-radius: 20px; padding: 8px 14px; cursor: pointer; }}
  .how button:focus-visible {{ outline: 2px solid var(--amber); outline-offset: 2px; }}
  h2 {{ font-family: 'IBM Plex Mono', ui-monospace, monospace; font-weight: 500; font-size: 12.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--amber); margin: 34px 0 10px; padding-top: 16px; border-top: 1px solid var(--rule); }}
  p {{ font-size: 19px; line-height: 1.62; margin: 0 0 16px; }}
</style>
<main>
  <p class="mark">C<em>i</em>V<em>i</em>X</p>
  <h1>{html.escape(title)}</h1>
  <p class="meta">About {minutes} minute{'s' if minutes != 1 else ''} aloud</p>
  <div class="how">
    <button type="button" id="copy-all">Copy all</button>
    <span>then paste into a new note in Notes, Select All, and Speak.</span>
  </div>
  <article id="text">
{body}
  </article>
</main>
<script>
  document.getElementById('copy-all').addEventListener('click', async (e) => {{
    const btn = e.currentTarget;
    const text = document.querySelector('h1').innerText + '\\n\\n' + document.getElementById('text').innerText;
    try {{ await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }}
    catch (err) {{
      const r = document.createRange(); r.selectNodeContents(document.getElementById('text'));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent = 'Selected: copy it';
    }}
  }});
</script>""")
