import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  defineServer,
  defineRoom,
  monitor,
  playground,
  createRouter,
  createEndpoint,
  LobbyRoom,
} from "colyseus";

/**
 * Import your Room files
 */
import { MyRoom } from "./rooms/MyRoom.js";
import { VoidRoom } from "./rooms/VoidRoom.js";

const server = defineServer({

  /**
   * Define your room handlers:
   */
  rooms: {
    my_room: defineRoom(MyRoom).enableRealtimeListing(),
    void_room: defineRoom(VoidRoom).enableRealtimeListing(),
    lobby: defineRoom(LobbyRoom),
  },

  /**
   * Experimental: Define API routes. Built-in integration with the "playground" and SDK.
   *
   * Usage from SDK:
   *   client.http.get("/api/hello").then((response) => {})
   *
   */
  routes: createRouter({
    api_hello: createEndpoint("/api/hello", { method: "GET" }, async (ctx) => {
      return { message: "Hello World" };
    }),
  }),

  /**
   * Bind your custom express routes here:
   * Read more: https://expressjs.com/en/starter/basic-routing.html
   */
  express: (app) => {

    app.get("/hi", (req, res) => {
      res.send("It's time to kick ass and chew bubblegum!");
    });

    /**
     * Use @colyseus/monitor
     * If you expose it in production, make sure to protect it with a password:
     * https://docs.colyseus.io/tools/monitoring#password-protection
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/monitor", monitor());
    }

    /**
     * Use @colyseus/playground
     * (It is not recommended to expose this route in a production environment)
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/playground", playground());
    }

    /**
     * In production, serve the built website (`npm run build` -> dist/client) from
     * this same server. In development Vite serves it instead, unbuilt - about 9 MB
     * of separate files for a game page, which is why it must not run live.
     */
    if (process.env.NODE_ENV === "production") {
      const here = dirname(fileURLToPath(import.meta.url));
      const clientDir = [resolve(here, "../client"), resolve(here, "../../client")]
        .find((dir) => existsSync(resolve(dir, "index.html")));
      if (clientDir) {
        app.use(express.static(clientDir, {
          setHeaders(res, file) {
            const path = file.split("\\").join("/"); // Windows paths use backslashes
            if (path.includes("/assets/")) { res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); }
            else if (["/models/", "/sfx/", "/fx/", "/icons/"].some((dir) => path.includes(dir))) { res.setHeader("Cache-Control", "public, max-age=86400"); }
            else { res.setHeader("Cache-Control", "no-cache"); } // pages: always check for a new version
          },
        }));
      } else {
        console.warn("No built client found next to the server; run `npm run build`.");
      }
    }
  }
});

export default server;

/** Named export read by the `colyseus/vite` plugin's `serverEntry`. */
export { server };
