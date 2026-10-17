# Deploying Rift Arcade

The live site must run the **production build**, not `npm start` / `vite`. The dev
server sends a game page as ~26 files and **~9 MB** (three.js alone is 5.8 MB, uncompressed);
the production build is ~0.9 MB (~250 KB compressed). It also names files with a fixed
hash, so a phone or an installed home-screen app never ends up holding half-old files.

## One-time switch (the pm2 app is called `game-server`)

Today `pm2 restart game-server` restarts the **dev server**, because that is what the app was
created to run (`npm start`). Switch it once:

    cd /root/game-server
    git pull
    npm ci
    npm run build
    pm2 delete game-server
    pm2 start ecosystem.config.cjs      # same name, now runs dist/server/server.mjs in production
    pm2 save

## Deploy (every time after that)

    cd /root/game-server
    bash scripts/deploy.sh

or by hand: `git pull && npm ci && npm run build && pm2 restart game-server --update-env`.
Note `pm2 restart game-server` alone is not enough: the site only changes after `npm run build`.

## Reverse proxy (Caddy)

The production server listens on **port 2567** (fixed by the build tool). Your proxy
should forward to it, and should compress responses:

    rift-arcade.online, www.rift-arcade.online {
        encode zstd gzip
        reverse_proxy localhost:2567
    }

Caddy proxies WebSockets automatically. Then `sudo systemctl reload caddy`.

## Check it worked

    curl -s https://rift-arcade.online/cube-tag/ | grep -c "@vite/client"    # must print 0
    curl -sI https://rift-arcade.online/cube-tag/ | grep -i content-encoding  # gzip or zstd
    curl -s https://rift-arcade.online/health                                 # {"ok":true}

## Home-screen app

After the first production deploy, delete the Rift Arcade icon from the home screen and add
it again (Share, then Add to Home Screen). That clears any half-old files the app cached
from the dev server.

## Optional settings (environment variables for pm2)

- `ALLOWED_ORIGINS="https://rift-arcade.online,https://www.rift-arcade.online"` - refuse game
  connections opened from other websites. Leave unset to allow all.
- `METRICS_TOKEN=some-long-secret` - turns on `/metrics` (CPU, memory, event-loop delay,
  rooms, players). Send it as the `x-metrics-token` header. Off by default.

Set them in `ecosystem.config.cjs` under `env`, then `pm2 startOrReload ecosystem.config.cjs --update-env`.

## Measuring

- Phone or desktop: add `?debug` to a game's address (`/cube-tag/?debug`) for frame time,
  draw calls, triangles and GPU objects.
- Server capacity (run from a different machine than the server):

      npx tsx loadtest/arcade.ts --url ws://YOUR-SERVER:2567 --http http://YOUR-SERVER:2567 \
        --game my_room --rooms 5 --players 8 --seconds 30 --token YOUR_METRICS_TOKEN
