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
  alive: t.boolean(),
});
export type VoidPlayer = SchemaType<typeof VoidPlayer>;

export const VoidState = schema({
  players: t.map(VoidPlayer),
  /** One state per tile: 0 solid, 1 cracking, 2 gone. */
  tiles: t.array("uint8"),
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
