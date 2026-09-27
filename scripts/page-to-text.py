#!/usr/bin/env python3
"""Turns a listening page made by scripts/listen-page.py (e.g. a cloud brief
saved with the Artifact tool) back into its plain text, for notes/briefs/.
  python3 scripts/page-to-text.py saved/index.html > notes/briefs/<date>-<kind>-<frame>.txt"""
import html
import re
import sys

src = open(sys.argv[1], encoding="utf-8").read()
title = re.search(r"<h1>(.*?)</h1>", src, re.S)
art = re.search(r'<article id="text">(.*?)</article>', src, re.S)
out = [html.unescape(title.group(1)).upper() if title else ""]
for tag, body in re.findall(r"<(h2|p)>(.*?)</\1>", art.group(1) if art else "", re.S):
    text = html.unescape(re.sub(r"<[^>]+>", "", body)).strip()
    out += ["", "", text.upper()] if tag == "h2" else ["", text]
print("\n".join(out).strip() + "\n")
