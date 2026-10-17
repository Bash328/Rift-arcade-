// How smoothly does a remote player move for everyone else?
//
//   npx tsx loadtest/smoothness.ts [--url ws://localhost:2567] [--jitter 0|1] [--seconds 20]
//
// A "mover" bot walks in a straight line sending 30 inputs a second. With --jitter 1 it
// behaves like a phone on a bad connection: it goes quiet for a moment, then sends the
// backlog in a burst. A "watcher" bot records the mover's position every time the server
// sends a state update. A smooth player advances by about the same distance every update;
// a lurching one advances by very different amounts (or not at all, then twice as far).

import { Client } from "@colyseus/sdk";

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const url = arg("url", "ws://localhost:2567");
const jitter = arg("jitter", "0") === "1";
const seconds = Number(arg("seconds", "20"));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const client = new Client(url);
const host = await client.create("my_room", { name: "Mover", private: true, arena: "classic" });
const watcher = await client.joinById(host.roomId, { name: "Watcher" });

// The mover walks along the top edge of the classic arena: nothing to collide with.
const mover: any = host.input({ mode: "reliable" });

const seen: { t: number; x: number }[] = [];
watcher.onStateChange(() => {
  const p = (watcher.state as any).players?.get(host.sessionId);
  if (p) { seen.push({ t: performance.now(), x: p.x }); }
});

let direction = 1;
const send = () => {
  // Turn around before the wall so the mover never stops.
  const x = (host.state as any).players?.get(host.sessionId)?.x ?? 750;
  if (x > 1300) { direction = -1; } else if (x < 200) { direction = 1; }
  mover.data.moveX = direction; mover.data.moveY = 0; mover.data.jump = 0;
  mover.send();
};

if (!jitter) {
  setInterval(send, 33);
} else {
  // Hiccups: every ~1.5 s go quiet for 120-250 ms, then send the whole backlog at once.
  let quietUntil = 0;
  let owed = 0;
  let nextHiccup = performance.now() + 1500;
  setInterval(() => {
    const now = performance.now();
    if (now >= nextHiccup && quietUntil === 0) { quietUntil = now + 120 + Math.random() * 130; }
    if (quietUntil > 0) {
      owed++;
      if (now >= quietUntil) { for (let i = 0; i < owed; i++) { send(); } owed = 0; quietUntil = 0; nextHiccup = now + 1000 + Math.random() * 1000; }
      return;
    }
    send();
  }, 33);
}

await sleep(seconds * 1000);

// Distance the mover advanced between consecutive updates the watcher received.
const gaps: number[] = [];
const steps: number[] = [];
for (let i = 1; i < seen.length; i++) {
  gaps.push(seen[i].t - seen[i - 1].t);
  const dx = Math.abs(seen[i].x - seen[i - 1].x);
  if (dx < 400) { steps.push(dx); } // ignore the turnaround
}
const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)];
const mean = steps.reduce((s, v) => s + v, 0) / steps.length;
const sd = Math.sqrt(steps.reduce((s, v) => s + (v - mean) ** 2, 0) / steps.length);
const stalls = steps.filter((s) => s < mean * 0.25).length;
const lunges = steps.filter((s) => s > mean * 1.75).length;
console.log(`jitter ${jitter ? "ON " : "off"} | updates/s ${(seen.length / seconds).toFixed(1)} | gap between updates ms: median ${q(gaps, 0.5).toFixed(0)}, p95 ${q(gaps, 0.95).toFixed(0)}, max ${Math.max(...gaps).toFixed(0)}`);
console.log(`          distance per update: mean ${mean.toFixed(1)}, spread (sd) ${sd.toFixed(1)}, largest ${Math.max(...steps).toFixed(0)} | stalls ${stalls}, lunges ${lunges} of ${steps.length}`);
process.exit(0);
