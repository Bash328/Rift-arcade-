// Load test for Rift Arcade: rooms full of bots that steer and jump like real
// players (30 inputs a second), plus a report of what the server did.
//
//   npx tsx loadtest/arcade.ts --game my_room --rooms 5 --players 8 --seconds 30
//
// To also read the server's CPU, memory and event-loop delay, start the server
// with METRICS_TOKEN=secret and add:  --token secret
//
// Run it from a DIFFERENT machine than the server (use --url ws://your-server:2567
// --http http://your-server:2567): each bot decodes every state patch, so the
// machine running the bots can run out of CPU before the server does.

import { Client } from "@colyseus/sdk";

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const url = arg("url", "ws://localhost:2567");
const http = arg("http", url.replace(/^ws/, "http"));
const game = arg("game", "my_room"); // my_room (Cube Tag) or void_room (Voidfall)
const rooms = Number(arg("rooms", "3"));
const players = Number(arg("players", "8"));
const seconds = Number(arg("seconds", "30"));
const token = arg("token", "");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const client = new Client(url);

let bytes = 0;
let patches = 0;
let dropped = 0;
/** Bots that could not join, by the reason the network gave. */
const failedJoins = new Map<string, number>();
/** Round-trip times (ms) of the pings every bot sends every 2 seconds: the first number to climb when the server struggles. */
const pings: number[] = [];
const bots: { input: any; dir: [number, number]; jumpUntil: number }[] = [];

async function spawnBot(join: () => Promise<any>) {
  const room = await join();
  const ws = room.connection?.transport?.ws;
  ws?.addEventListener?.("message", (e: any) => {
    bytes += e.data?.byteLength ?? e.data?.length ?? 0;
    patches++;
  });
  bots.push({ input: room.input({ mode: "reliable" }), dir: [0, 0], jumpUntil: 0 });
  room.onLeave(() => { dropped++; });
  setInterval(() => { try { room.ping((ms: number) => pings.push(ms)); } catch { /* already gone */ } }, 2000);
  return room;
}

async function metrics() {
  if (!token) { return undefined; }
  const res = await fetch(`${http}/metrics`, { headers: { "x-metrics-token": token } });
  return res.ok ? res.json() as Promise<any> : undefined;
}

console.log(`Joining ${rooms} x ${players} bots (${game}) at ${url} ...`);
/** Run joins a few at a time: over a slow link one after another would take minutes. */
async function inBatches(tasks: (() => Promise<unknown>)[], size: number) {
  for (let i = 0; i < tasks.length; i += size) {
    await Promise.all(tasks.slice(i, i + size).map(async (task) => {
      try { await task(); } catch (e: any) {
        const why = String(e?.cause?.code ?? e?.code ?? e?.message ?? e);
        failedJoins.set(why, (failedJoins.get(why) ?? 0) + 1);
      }
    }));
  }
}
const hosts: (any | undefined)[] = [];
await inBatches(Array.from({ length: rooms }, (_, r) => async () => {
  hosts[r] = await spawnBot(() => client.create(game, { name: `bot${r}-0`, private: true }));
}), 8);
await inBatches(hosts.flatMap((host, r) => (host ? Array.from({ length: players - 1 }, (_, p) => async () => {
  await spawnBot(() => client.joinById(host.roomId, { name: `bot${r}-${p + 1}` }));
}) : [])), 12);
if (failedJoins.size) { console.log(`could not join: ${[...failedJoins].map(([why, n]) => `${n} x ${why}`).join(", ")}`); }
console.log(`${bots.length} bots in. Playing for ${seconds}s ...`);

await metrics(); // resets the server's event-loop window
const before = await metrics();
const started = Date.now();

const drive = setInterval(() => {
  const now = Date.now();
  for (const bot of bots) {
    if (Math.random() < 0.03) { bot.dir = [Math.round(Math.random() * 2 - 1), Math.round(Math.random() * 2 - 1)]; }
    if (Math.random() < 0.01) { bot.jumpUntil = now + 150; }
    bot.input.data.moveX = bot.dir[0];
    bot.input.data.moveY = bot.dir[1];
    bot.input.data.jump = now < bot.jumpUntil ? 1 : 0;
    bot.input.send();
  }
}, 33);

await sleep(seconds * 1000);
clearInterval(drive);
const elapsed = (Date.now() - started) / 1000;
const after = await metrics();

const kbPerBotPerSec = bytes / 1024 / bots.length / elapsed;
console.log("\n--- result ---");
console.log(`bots: ${bots.length}   duration: ${elapsed.toFixed(0)}s`);
console.log(`received per bot: ${kbPerBotPerSec.toFixed(1)} KB/s (${(patches / bots.length / elapsed).toFixed(0)} messages/s)`);
console.log(`server sends in total: ${(kbPerBotPerSec * bots.length * 8).toFixed(0)} kbit/s`);
pings.sort((a, b) => a - b);
const at = (q: number) => (pings.length ? pings[Math.min(pings.length - 1, Math.floor(pings.length * q))].toFixed(0) : "n/a");
console.log(`round trip: median ${at(0.5)} ms, p95 ${at(0.95)} ms, worst ${at(1)} ms (${pings.length} pings)   bots dropped by the server: ${dropped}`);
if (before && after) {
  const cpu = (after.cpuUserSec + after.cpuSystemSec) - (before.cpuUserSec + before.cpuSystemSec);
  console.log(`server CPU: ${cpu.toFixed(2)}s over ${elapsed.toFixed(0)}s = ${(cpu / elapsed * 100).toFixed(1)}% of one core`);
  console.log(`event-loop delay: mean ${after.eventLoopMs.mean} ms, p99 ${after.eventLoopMs.p99} ms, max ${after.eventLoopMs.max} ms`);
  console.log(`server memory: ${after.rssMB} MB RSS, ${after.heapMB} MB heap   rooms: ${after.rooms}  players: ${after.players}`);
} else {
  console.log("(pass --token and start the server with METRICS_TOKEN to see server CPU / event loop)");
}
process.exit(0);
