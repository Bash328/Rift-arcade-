// Voidfall game modes. Plain data that both the server (rules) and the browser (names, banners) read.

export interface VoidMode {
  id: string;
  name: string;
  /** One line shown when the round starts. */
  blurb: string;
  /** The full explanation shown when someone joins a room and on the winner card. */
  rules: string;
  /** The mode only comes up in the rotation when at least this many humans are in the room. */
  minHumans: number;
  /** Floors of tiles. */
  floors: number;
}

export const VOID_MODES: VoidMode[] = [
  {
    id: "classic", name: "Voidfall", minHumans: 1, floors: 1,
    blurb: "Every tile cracks the moment you land. Keep moving.",
    rules: "Every tile cracks the moment you land on it and drops away a second later, so keep moving and hop across gaps. The last player standing wins.",
  },
  {
    id: "hex", name: "Hex-A-Gone", minHumans: 2, floors: 3,
    blurb: "Three floors. Green tiles last, red ones go almost at once.",
    rules: "Three floors of tiles. A tile starts breaking when you land on it, and its colour says how fast: green about 2 seconds, yellow about 1, red almost at once. Fall through a gap and you land on the floor below, or you are out if there is no tile there. After a while tiles start cracking on their own. The last player standing wins.",
  },
];

export const VOID_MODE_BY_ID: Record<string, VoidMode> = Object.fromEntries(VOID_MODES.map((m) => [m.id, m]));

/** The mode for an id from the network, falling back to classic Voidfall. */
// hasOwn: an id like "constructor" from the network must not find something on the prototype.
export const voidModeOf = (id: string | undefined): VoidMode => (id && Object.hasOwn(VOID_MODE_BY_ID, id) ? VOID_MODE_BY_ID[id] : VOID_MODES[0]);
