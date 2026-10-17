import { PLAYER_HALF, PLAYER_SPEED, JUMP_SPEED, GRAVITY } from "./constants.js";
import type { Arena, Obstacle } from "./arenas.js";

/**
 * Structural types on purpose: the same step runs on a server Schema instance
 * and on the client reconciler's plain predicted copy, with no schema runtime
 * involved in the simulation.
 */
export interface EntityState { x: number; y: number; vx: number; vy: number; z: number; vz: number; }
export interface MoveInputLike { moveX: number; moveY: number; jump: number; }

const clamp = (value: number, min: number, max: number) =>
  (value < min ? min : value > max ? max : value);

const overlaps = (o: Obstacle, x: number, y: number) =>
  Math.abs(x - o.x) < o.hw + PLAYER_HALF && Math.abs(y - o.y) < o.hh + PLAYER_HALF;

/** A surface blocks walking only while the player's feet (z) are below its top. */
const blockedAt = (arena: Arena, x: number, y: number, z: number) =>
  arena.obstacles.some((o) => overlaps(o, x, y) && z < o.h);

/** Height of the highest surface under the player's footprint (0 = the floor). */
export const floorAt = (arena: Arena, x: number, y: number) =>
  arena.obstacles.reduce((top, o) => (overlaps(o, x, y) && o.h > top ? o.h : top), 0);

/**
 * The single movement step, run identically by the server (once per received
 * input) and by the client reconciler (predict, then replay on rollback). The
 * arena sets how it feels: gravity, jump strength, and how slippery the floor is.
 *
 * Pure function of (state, input, dt, arena): no clocks, no randomness, no reads
 * outside its arguments. That is the whole contract - break it and the client's
 * prediction drifts from the server every time.
 */
export function stepEntity(entity: EntityState, input: MoveInputLike, dt: number, arena: Arena): void {
  let dirX = input.moveX;
  let dirY = input.moveY;

  // Normalize the diagonal, so it isn't faster than a straight line.
  if (dirX !== 0 && dirY !== 0) {
    dirX *= Math.SQRT1_2;
    dirY *= Math.SQRT1_2;
  }

  // Velocity follows the controls: at once on normal ground, gradually on ice.
  const follow = arena.slide === 0 ? 1 : 1 - Math.exp(-dt / arena.slide);
  const wantVx = dirX * PLAYER_SPEED;
  const wantVy = dirY * PLAYER_SPEED;
  let vx = follow === 1 ? wantVx : entity.vx + (wantVx - entity.vx) * follow;
  let vy = follow === 1 ? wantVy : entity.vy + (wantVy - entity.vy) * follow;

  const wantX = entity.x + vx * dt;
  const wantY = entity.y + vy * dt;

  // Axis-separated, so a player slides along a pillar face instead of sticking.
  const clampedX = clamp(wantX, PLAYER_HALF, arena.width - PLAYER_HALF);
  const x = blockedAt(arena, clampedX, entity.y, entity.z) ? entity.x : clampedX;
  const clampedY = clamp(wantY, PLAYER_HALF, arena.height - PLAYER_HALF);
  const y = blockedAt(arena, x, clampedY, entity.z) ? entity.y : clampedY;

  // Hitting a wall or pillar also kills the velocity heading into it, so the
  // reconciler replays the same stop the server did.
  if (x !== wantX) { vx = 0; }
  if (y !== wantY) { vy = 0; }

  // Vertical: jump only from a surface, then gravity; land on the highest surface
  // under the new position (the floor, a step, a block top).
  const floor = floorAt(arena, x, y);
  let vz = entity.vz;
  if (input.jump && entity.z <= floor) { vz = JUMP_SPEED * arena.jump; }
  vz -= GRAVITY * arena.gravity * dt;
  let z = entity.z + vz * dt;
  if (z <= floor) { z = floor; vz = 0; }

  entity.x = x;
  entity.y = y;
  entity.vx = vx;
  entity.vy = vy;
  entity.z = z;
  entity.vz = vz;
}
