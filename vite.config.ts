import { defineConfig } from "vite";
import { colyseus } from "colyseus/vite";

export default defineConfig(({ mode }) => ({
  build: { outDir: "dist/client" },
  environments: {
    // Multi-page client: the arcade hub at / and one folder per game. Scoped to
    // the client, because the server environment has its own entry (serverEntry).
    client: { build: { rollupOptions: { input: { hub: "index.html", cubeTag: "cube-tag/index.html" } } } },
  },
  server: { allowedHosts: ["rift-arcade.online", "www.rift-arcade.online"]},
  plugins: [
    // The plugin declares a second build environment (dist/server), so every
    // `vite build` builds both halves. `--mode client` drops it when you only
    // want the static client — e.g. deploying it separately from the server.
    // That mode also swaps which .env.* file Vite loads: .env.client, not
    // .env.production. Only matters once you add a VITE_-prefixed var.
    ...(mode === "client" ? [] : [colyseus({ serverEntry: "/src/app.config.ts" })]),
  ],
}));
