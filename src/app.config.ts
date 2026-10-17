import { existsSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
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
  matchMaker,
  WebSocketTransport,
} from "colyseus";

/**
 * Import your Room files
 */
import { MyRoom } from "./rooms/MyRoom.js";
import { VoidRoom } from "./rooms/VoidRoom.js";

/** How long the event loop is blocked: the number that tells you a room tick is too heavy. */
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

/**
 * Optional: ALLOWED_ORIGINS="https://rift-arcade.online,https://www.rift-arcade.online"
 * makes the server refuse game connections opened from any other website. Unset,
 * every origin is allowed. Connections with no Origin header (bots, load tests)
 * are not browsers and pass.
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);

const server = defineServer({

  ...(allowedOrigins.length > 0 && {
    transport: new WebSocketTransport({
      beforeUpgrade: (request, context) => {
        const origin = context.headers.get("origin");
        if (origin && !allowedOrigins.includes(origin)) { return new Response(null, { status: 403 }); }
      },
    }),
  }),

  /**
   * Define your room handlers:
   */
  rooms: {
    my_room: defineRoom(MyRoom).filterBy(["arena"]).enableRealtimeListing(),
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

    // Liveness: the process is up. Cheap on purpose, so a probe can hit it often.
    app.get("/health", (_req, res) => { res.json({ ok: true }); });

    // Numbers for monitoring. Off unless METRICS_TOKEN is set, then needs the
    // token in an `x-metrics-token` header, so it is never public by accident.
    const metricsToken = process.env.METRICS_TOKEN;
    if (metricsToken) {
      app.get("/metrics", (req, res) => {
        if (req.get("x-metrics-token") !== metricsToken) { res.status(404).end(); return; }
        const { roomCount, ccu } = matchMaker.stats.local;
        const memory = process.memoryUsage();
        const cpu = process.cpuUsage();
        const ms = (ns: number) => Math.round(ns / 1e4) / 100;
        res.json({
          uptimeSec: Math.round(process.uptime()),
          rooms: roomCount,
          players: ccu,
          rssMB: Math.round(memory.rss / 1048576),
          heapMB: Math.round(memory.heapUsed / 1048576),
          cpuUserSec: Math.round(cpu.user / 1e4) / 100,
          cpuSystemSec: Math.round(cpu.system / 1e4) / 100,
          // Event-loop delay since the last read, in milliseconds.
          eventLoopMs: { mean: ms(loopDelay.mean), p99: ms(loopDelay.percentile(99)), max: ms(loopDelay.max) },
        });
        loopDelay.reset();
      });
    }

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
        app.use((_req, res, next) => {
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
          next();
        });
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
