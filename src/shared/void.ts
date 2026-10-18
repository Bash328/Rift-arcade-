import { PLAYER_SPEED, JUMP_SPEED, GRAVITY } from "./constants.js";

/** Voidfall: a square grid of floating tiles. Tiles crack under feet, then drop away. */
export const GRID = 9;
export const TILE = 100;
export const VOID_SIZE = GRID * TILE;
/** Tiles on one floor. */
export const CELLS = GRID * GRID;

/** Tile states (a flat array: floor after floor, each GRID*GRID row by row). */
export const SOLID = 0;
export const CRACKING = 1;
export const GONE = 2;

/** Seconds from first touch until a tile drops (classic Voidfall). */
export const CRACK_TIME = 1.2;
/** Below the lowest floor's surface by this much, a falling player is out. */
export const FALL_LIMIT = -400;
/**
 * How far below a tile top a player can still land on it. Covers the step a
 * fast fall takes in one tick, and gives a short grace for running off an edge.
 */
export const LAND_GRACE = 24;
/** Steering is mostly lost once you are really falling. */
const FALLING_CONTROL = 0.35;

// ---- Hex-A-Gone: three floors, each tile with its own break time.

/** Floors in a Hex-A-Gone round (classic Voidfall has one) and the height between their surfaces. */
export const HEX_FLOORS = 3;
export const FLOOR_GAP = 120;
/** Tile kinds: how fast a tile breaks once someone lands on it. */
export const GREEN = 0, YELLOW = 1, RED = 2;
/** Seconds to break at the top floor, per kind; and how much faster each floor down is. */
export const BREAK_BASE = [2.0, 1.2, 0.5];
export const FLOOR_SPEED = [1, 0.85, 0.7];
/** Share of green, yellow and red tiles per floor: the lower the floor, the nastier. */
export const KIND_MIX = [[0.5, 0.35, 0.15], [0.35, 0.45, 0.2], [0.2, 0.45, 0.35]];
/** After this many seconds of a Hex-A-Gone round, tiles start cracking on their own. */
export const SUDDEN_DEATH_AT = 75;

/** Seconds between sudden-death cracks, `elapsed` seconds into the round: one a second at first, then faster down to four a second. */
export const suddenDeathGap = (elapsed: number) => Math.max(0.25, 1 - 0.02 * (elapsed - SUDDEN_DEATH_AT));
export const breakTime = (floor: number, kind: number) => BREAK_BASE[kind] * FLOOR_SPEED[floor];
/** Height of a floor's surface. */
export const floorZ = (floor: number) => (floor === 0 ? 0 : -floor * FLOOR_GAP);
/** How many floors a tile array holds. */
export const floorsOf = (tiles: ArrayLike<number>) => Math.max(1, Math.round(tiles.length / CELLS));
/** Below this height a player is out, given the number of floors. */
export const fallLimit = (floors: number) => FALL_LIMIT - (floors - 1) * FLOOR_GAP;
/** Which floor a height belongs to: the nearest surface at or above it. */
export const floorOf = (z: number, floors: number) => Math.min(floors - 1, Math.max(0, Math.floor(-z / FLOOR_GAP)));

/**
 * The kind of every tile for a Hex-A-Gone round, floor after floor. The nine tiles in the middle of the top
 * floor, where everyone starts, are never red: nobody should lose to the tile they were placed on.
 */
export function dealKinds(random: () => number = Math.random): number[] {
  const kinds: number[] = [];
  for (let f = 0; f < HEX_FLOORS; f++) {
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const middle = f === 0 && Math.abs(i - (GRID - 1) / 2) <= 1 && Math.abs(j - (GRID - 1) / 2) <= 1;
        const [green, yellow] = KIND_MIX[f];
        const roll = random();
        let kind = roll < green ? GREEN : roll < green + yellow ? YELLOW : RED;
        if (middle && kind === RED) { kind = random() < 0.5 ? GREEN : YELLOW; }
        kinds.push(kind);
      }
    }
  }
  return kinds;
}

export interface VoidEntity { x: number; y: number; vx: number; vy: number; z: number; vz: number; }
export interface VoidInput { moveX: number; moveY: number; jump: number; }

/** Index of the tile under (x, y) on one floor, or -1 when off the grid. */
export function tileAt(x: number, y: number): number {
  const i = Math.floor(x / TILE);
  const j = Math.floor(y / TILE);
  return i < 0 || j < 0 || i >= GRID || j >= GRID ? -1 : j * GRID + i;
}

/** Index (in the whole tile array) of the tile an entity is standing on, or -1 if it is in the air. */
export function tileUnder(entity: VoidEntity, tiles: ArrayLike<number>): number {
  const cell = tileAt(entity.x, entity.y);
  if (cell < 0) { return -1; }
  for (let f = 0; f < floorsOf(tiles); f++) {
    if (entity.z === floorZ(f)) { const index = f * CELLS + cell; return tiles[index] < GONE ? index : -1; }
  }
  return -1;
}

/**
 * One movement step for Voidfall, run identically by the server and by the
 * client's prediction. There are no walls: you stand on a tile whose centre is
 * under you, and fall when it is gone or you step off the grid. With several
 * floors, a fall lands on the next floor down if there is a tile under you there.
 */
export function stepVoidEntity(
  entity: VoidEntity, input: VoidInput, dt: number, tiles: ArrayLike<number>,
): void {
  const floors = floorsOf(tiles);
  let dirX = input.moveX;
  let dirY = input.moveY;
  if (dirX !== 0 && dirY !== 0) {
    dirX *= Math.SQRT1_2;
    dirY *= Math.SQRT1_2;
  }

  // Falling means well below the nearest surface at or above you (standing on a lower floor is not falling).
  const falling = entity.z < floorZ(floorOf(entity.z, floors)) - LAND_GRACE;
  const control = falling ? FALLING_CONTROL : 1;
  entity.vx = dirX * PLAYER_SPEED * control;
  entity.vy = dirY * PLAYER_SPEED * control;
  entity.x += entity.vx * dt;
  entity.y += entity.vy * dt;

  const cell = tileAt(entity.x, entity.y);
  const hasFloor = (f: number) => cell >= 0 && tiles[f * CELLS + cell] < GONE;
  let onFloor = false;
  for (let f = 0; f < floors && !onFloor; f++) {
    onFloor = hasFloor(f) && entity.z <= floorZ(f) && entity.z >= floorZ(f) - LAND_GRACE;
  }

  const before = entity.z;
  let vz = entity.vz;
  if (input.jump && onFloor) { vz = JUMP_SPEED; }
  vz -= GRAVITY * dt;
  let z = before + vz * dt;
  if (vz <= 0) {
    // Land on the first surface passed through on the way down (so a fast fall cannot skip one).
    for (let f = 0; f < floors; f++) {
      if (hasFloor(f) && z <= floorZ(f) && before >= floorZ(f) - LAND_GRACE) { z = floorZ(f); vz = 0; break; }
    }
  }

  entity.z = z;
  entity.vz = vz;
}
