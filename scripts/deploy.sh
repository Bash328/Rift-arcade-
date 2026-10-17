#!/usr/bin/env bash
# Update the live server: pull, build, run the PRODUCTION build under pm2, and check it.
# Run on the server, from anywhere:  bash scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
npm ci                      # exact versions from package-lock.json (the build needs the dev tools too)
npm run build               # dist/client (the website) + dist/server (the game server)

# Runs dist/server/server.mjs with NODE_ENV=production (see ecosystem.config.cjs).
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
sleep 3

echo "--- checking ---"
curl -fsS http://localhost:2567/health && echo
if curl -fsS http://localhost:2567/cube-tag/ | grep -q "@vite/client"; then
  echo "PROBLEM: the dev server is still answering on 2567. Stop whatever else is using that port."
  exit 1
fi
echo "OK: the production build is serving on port 2567."
echo "Next: point your reverse proxy at 2567 (see DEPLOY.md), then reload the site."
