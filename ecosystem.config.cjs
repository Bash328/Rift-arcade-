/**
 * pm2 config for the live server: `pm2 start ecosystem.config.cjs`.
 *
 * ONE process on purpose. Colyseus rooms live in the memory of the process that
 * created them, so several copies (the template starts one per CPU core) would
 * fight over port 2567 and split players into worlds that cannot see each
 * other's rooms or room codes. Running more than one needs Redis and a proxy.
 */
module.exports = {
  apps: [{
    name: "game-server",
    script: "dist/server/server.mjs",
    time: true,
    watch: false,
    instances: 1,
    exec_mode: "fork",
    env: { NODE_ENV: "production" },
    max_memory_restart: "512M",
  }],
};
