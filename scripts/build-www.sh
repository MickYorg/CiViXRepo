#!/usr/bin/env bash
# Packages the live CiViX site into www/ for Capacitor's native shell.
# Deliberately a plain copy, not a bundler -- the site itself stays
# hand-written static HTML/CSS/JS. This script only decides what ships
# inside the native app binary vs. what stays web-only.
set -euo pipefail
cd "$(dirname "$0")/.."

rsync -a --delete \
  --exclude ".git/" \
  --exclude ".wrangler/" \
  --exclude ".claude/" \
  --exclude "node_modules/" \
  --exclude "functions/" \
  --exclude "wrangler.toml" \
  --exclude "_headers" \
  --exclude "_redirects" \
  --exclude ".assetsignore" \
  --exclude ".gitignore" \
  --exclude ".DS_Store" \
  --exclude "dev/" \
  --exclude "netlify/" \
  --exclude "ios/" \
  --exclude "android/" \
  --exclude "scripts/" \
  --exclude "www/" \
  --exclude "package.json" \
  --exclude "package-lock.json" \
  --exclude "capacitor.config.json" \
  --exclude "README.md" \
  --exclude "SETUP.md" \
  --exclude "CLAUDE.md" \
  --exclude "civix101-explainer.mp4" \
  ./ ./www/

echo "www/ built ($(du -sh www | cut -f1))"
