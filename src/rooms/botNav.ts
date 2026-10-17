// A coarse walkable grid of one arena for the bots, so they find their way around walls
// instead of pushing straight at them. A cell is blocked by a tall obstacle (too high to
// jump), or "hop" for a low one the bot can jump onto and over.

import { PLAYER_HALF } from "../shared/constants.js";
import type { Arena } from "../shared/arenas.js";

const CELL = 25;
const FREE = 0, WALL = 1, HOP = 2;

export class Nav {
  readonly cols: number;
  readonly rows: number;
  private readonly kind: Uint8Array;

  constructor(arena: Arena) {
    this.cols = Math.ceil(arena.width / CELL);
    this.rows = Math.ceil(arena.height / CELL);
    this.kind = new Uint8Array(this.cols * this.rows);
    const jumpable = 50 / arena.gravity; // a jump clears about 68 on normal ground; 50 leaves room to land
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * CELL, y = (r + 0.5) * CELL;
        for (const o of arena.obstacles) {
          // The cube's centre needs PLAYER_HALF of room from the block's edge.
          if (Math.abs(x - o.x) < o.hw + PLAYER_HALF && Math.abs(y - o.y) < o.hh + PLAYER_HALF) {
            const i = r * this.cols + c;
            const k = o.h > jumpable ? WALL : HOP;
            if (k === WALL || this.kind[i] === FREE) { this.kind[i] = k; } // a tall block makes the cell a wall whatever else covers it
          }
        }
      }
    }
  }

  private index(x: number, y: number) {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / CELL)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(y / CELL)));
    return r * this.cols + c;
  }

  /** Steps from every cell to (x, y) over cells a bot can cross (-1 where it cannot get there). */
  distancesTo(x: number, y: number): Int16Array {
    const dist = new Int16Array(this.cols * this.rows).fill(-1);
    const queue = new Int32Array(this.cols * this.rows);
    let head = 0, tail = 0;
    const start = this.index(x, y);
    dist[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const cell = queue[head++];
      const c = cell % this.cols, r = (cell - c) / this.cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) { continue; }
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) { continue; }
          const next = nr * this.cols + nc;
          if (dist[next] !== -1 || this.kind[next] === WALL) { continue; }
          // No squeezing diagonally between two walls.
          if (dc && dr && (this.kind[r * this.cols + nc] === WALL || this.kind[nr * this.cols + c] === WALL)) { continue; }
          dist[next] = dist[cell] + 1;
          queue[tail++] = next;
        }
      }
    }
    return dist;
  }

  /**
   * The neighbouring cell to step to from (x, y): the closest to the BFS target when `closer`, otherwise the
   * one furthest from it. Returns the direction to that cell's centre and whether it is a low block to jump,
   * or null when the bot is not on the walkable grid (the caller then steers straight).
   */
  step(dist: Int16Array, x: number, y: number, closer: boolean): { vx: number; vy: number; hop: boolean } | null {
    const here = this.index(x, y);
    const now = dist[here];
    if (now < 0 || this.kind[here] === WALL) { return null; }
    if (closer && now === 0) { return null; } // in the target's own cell: the caller steers straight at it
    const c = here % this.cols, r = (here - c) / this.cols;
    let best = -1, bestDist = now;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) { continue; }
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) { continue; }
        const next = nr * this.cols + nc;
        const d = dist[next];
        if (d < 0 || this.kind[next] === WALL) { continue; }
        if (dc && dr && (this.kind[r * this.cols + nc] === WALL || this.kind[nr * this.cols + c] === WALL)) { continue; }
        if (closer ? d < bestDist : d > bestDist) { best = next; bestDist = d; }
      }
    }
    if (best < 0) { return { vx: 0, vy: 0, hop: false }; } // already there, or boxed in
    const bc = best % this.cols, br = (best - bc) / this.cols;
    // The direction to that cell (not the exact offset: a small offset would fall inside the bot's steering dead zone).
    return { vx: (bc - c) * 100, vy: (br - r) * 100, hop: this.kind[best] === HOP || this.kind[here] === HOP };
  }
}

const cache = new Map<string, Nav>();
/** One grid per arena, built the first time a bot needs it. */
export function navFor(arena: Arena): Nav {
  let nav = cache.get(arena.id);
  if (!nav) { nav = new Nav(arena); cache.set(arena.id, nav); }
  return nav;
}
