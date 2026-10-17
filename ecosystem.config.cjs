const os = require("os");

/**
 * Colyseus Cloud Deployment Configuration.
 * See documentation: https://docs.colyseus.io/deployment/cloud
 */

module.exports = {
  apps: [{
    name: "game-server",
    script: "dist/server/server.mjs",
    time: true,
    watch: false,
    instances: os.cpus().length,
    exec_mode: "fork",
    env: { NODE_ENV: "production" },
    wait_ready: true,
    max_memory_restart: "512M",
  }],
};
