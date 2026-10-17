import { matchMaker } from "colyseus";

const MAX_ROOMS = 200;

/** Stops a flood of "create room" requests from exhausting a small server. */
export function assertRoomCapacity() {
  if (matchMaker.stats.local.roomCount >= MAX_ROOMS) {
    throw new Error("The server is full right now. Try again in a minute.");
  }
}

/** No I or O: they read as 1 and 0 when a code is shouted across a room. */
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** A free 4-letter room code. Rooms use it as their id, so players join with `joinById(code)`. */
export async function freeRoomCode(): Promise<string> {
  for (;;) {
    const code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
    if ((await matchMaker.query({ roomId: code })).length === 0) { return code; }
  }
}
