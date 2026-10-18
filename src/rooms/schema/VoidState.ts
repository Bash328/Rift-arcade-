import { schema, t, type SchemaType } from "@colyseus/schema";

export const VoidPlayer = schema({
  x: t.number(),
  y: t.number(),
  vx: t.number(),
  vy: t.number(),
  z: t.number(),
  vz: t.number(),
  name: t.string(),
  hue: t.number(),
  /** Index into PETS: which animal this player is. */
  pet: t.number(),
  alive: t.boolean(),
  /** Pressed Ready while the winner card waits for the next round (bots are always ready then). */
  ready: t.boolean(),
});
export type VoidPlayer = SchemaType<typeof VoidPlayer>;

export const VoidState = schema({
  players: t.map(VoidPlayer),
  /** One state per tile: 0 solid, 1 cracking, 2 gone. Floor after floor: 81 tiles in classic, 243 in Hex-A-Gone. */
  tiles: t.array("uint8"),
  /** Hex-A-Gone only: how fast each tile breaks (0 green, 1 yellow, 2 red), same order as `tiles`. Empty in classic. */
  kinds: t.array("uint8"),
  /** The mode being played (see shared/voidModes.ts), the one the next round will use, and a counter that goes up every round. */
  mode: t.string(),
  nextMode: t.string(),
  round: t.number(),
  /** The host picked one mode for this room and it stays that way; otherwise it changes every round. */
  modeLocked: t.boolean(),
  /** Whole seconds until the next round starts while the winner banner shows, else 0. */
  nextIn: t.number(),
  /** "waiting" | "countdown" | "playing" | "over" */
  phase: t.string(),
  /** Whole seconds left in the countdown. */
  countdown: t.number(),
  /** Players still standing. */
  alive: t.number(),
  /** Name of the last round's winner while the end banner shows. */
  winner: t.string(),
});
export type VoidState = SchemaType<typeof VoidState>;
