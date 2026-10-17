import { PLAYER_SPEED, JUMP_SPEED, GRAVITY } from "./constants.js";

/** Voidfall: a square grid of floating tiles. Tiles crack under feet, then drop away. */
export const GRID = 9;
export const TILE = 100;
export const VOID_SIZE = GRID * TILE;

/** Tile states (a flat GRID*GRID array, row by row). */
export const SOLID = 0;
export const CRACKING = 1;
export const GONE = 2;

/** Seconds from first touch until a tile drops. */
export const CRACK_TIME = 1.2;
/** Below this height a falling player is out. */
export const FALL_LIMIT = -400;
/**
 * How far below a tile top a player can still land on it. Covers the step a
 * fast fall takes in one tick, and gives a short grace for running off an edge.
 */
export const LAND_GRACE = 24;
/** Steering is mostly lost once you are really falling. */
const FALLING_CONTROL = 0.35;

export interface VoidEntity { x: number; y: number; vx: number; vy: number; z: number; vz: number; }
export interface VoidInput { moveX: number; moveY: number; jump: number; }

/** Index of the tile under (x, y), or -1 when off the grid. */
export function tileAt(x: number, y: number): number {
  const i = Math.floor(x / TILE);
  const j = Math.floor(y / TILE);
  return i < 0 || j < 0 || i >= GRID || j >= GRID ? -1 : j * GRID + i;
}

/**
 * One movement step for Voidfall, run identically by the server and by the
 * client's prediction. There are no walls: you stand on a tile whose centre is
 * under you, and fall when it is gone or you step off the grid.
 */
export function stepVoidEntity(
  entity: VoidEntity, input: VoidInput, dt: number, tiles: ArrayLike<number>,
): void {
  let dirX = input.moveX;
  let dirY = input.moveY;
  if (dirX !== 0 && dirY !== 0) {
    dirX *= Math.SQRT1_2;
    dirY *= Math.SQRT1_2;
  }

  const control = entity.z < -LAND_GRACE ? FALLING_CONTROL : 1;
  entity.vx = dirX * PLAYER_SPEED * control;
  entity.vy = dirY * PLAYER_SPEED * control;
  entity.x += entity.vx * dt;
  entity.y += entity.vy * dt;

  const idx = tileAt(entity.x, entity.y);
  const hasFloor = idx >= 0 && tiles[idx] !== GONE;
  const onFloor = hasFloor && entity.z <= 0 && entity.z >= -LAND_GRACE;

  let vz = entity.vz;
  if (input.jump && onFloor) { vz = JUMP_SPEED; }
  vz -= GRAVITY * dt;
  let z = entity.z + vz * dt;
  if (hasFloor && vz <= 0 && z <= 0 && z >= -LAND_GRACE) { z = 0; vz = 0; }

  entity.z = z;
  entity.vz = vz;
}
