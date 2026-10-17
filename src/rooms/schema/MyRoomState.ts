import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * One input frame, consumed by `Room.defineInput()`. Flat primitives only, and
 * deliberately minimal:
 *   - no `seq`  — the engine's input counter is the sequence
 *   - no `dt`   — fixed timestep: one input advances exactly one step
 *   - no time   — the SDK stamps lag-comp timing on the wire envelope
 *
 * `int8<-1 | 0 | 1>` narrows the type for your code; the room's `sanitize`
 * clamp is what actually enforces it against a modified client.
 */
export const MoveInput = schema({
  moveX: t.int8<-1 | 0 | 1>(),
  moveY: t.int8<-1 | 0 | 1>(),
  jump: t.int8<0 | 1>(),
});
export type MoveInput = SchemaType<typeof MoveInput>;

export const Player = schema({
  x: t.number(),
  y: t.number(),
  vx: t.number(),
  vy: t.number(),
  /** Height of the feet above the floor, and vertical speed. */
  z: t.number(),
  vz: t.number(),
  score: t.number(),
  name: t.string(),
  /** Cube color, 0-360. */
  hue: t.number(),
  /** Index into PETS: which animal this player is. */
  pet: t.number(),
});
export type Player = SchemaType<typeof Player>;

export const MyRoomState = schema({

  players: t.map(Player),
  /** sessionId of the player who is "it" ("" when the room is empty). */
  it: t.string(),
  /** Id of the arena being played, and the one the next round will use. */
  arena: t.string(),
  nextArena: t.string(),
  /** The host picked one arena for this room and it stays that way; otherwise it changes every round. */
  locked: t.boolean(),
  /** Whole seconds left in the round. */
  timeLeft: t.number(),
  /** Name of the last round's winner while the end banner shows, else "". */
  winner: t.string(),

});
export type MyRoomState = SchemaType<typeof MyRoomState>;
