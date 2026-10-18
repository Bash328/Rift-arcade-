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
    // METRICS_TOKEN is read from the server's own environment (never commit it): see DEPLOY.md, "Optional settings".
    env: { NODE_ENV: "production", ...(process.env.METRICS_TOKEN ? { METRICS_TOKEN: process.env.METRICS_TOKEN } : {}) },
    max_memory_restart: "512M",
  }],
};
