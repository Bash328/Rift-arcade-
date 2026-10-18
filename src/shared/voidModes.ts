// Voidfall game modes. Plain data that both the server (rules) and the browser (names, banners) read.

import { CELLS, HEX_CELLS } from "./void.js";

export interface VoidMode {
  id: string;
  name: string;
  /** One line shown when the round starts. */
  blurb: string;
  /** The full explanation shown when someone joins a room and on the winner card. */
  rules: string;
  /** The mode only comes up in the rotation when at least this many humans are in the room. */
  minHumans: number;
  /** Floors of tiles, and tiles on each (squares in classic, hexagons in Hex-A-Gone). */
  floors: number;
  cells: number;
}

export const VOID_MODES: VoidMode[] = [
  {
    id: "classic", name: "Voidfall", minHumans: 1, floors: 1, cells: CELLS,
    blurb: "Every tile cracks the moment you land. Keep moving.",
    rules: "Every tile cracks the moment you land on it and drops away a second later, so keep moving and hop across gaps. The last player standing wins.",
  },
  {
    id: "hex", name: "Hex-A-Gone", minHumans: 1, floors: 3, cells: HEX_CELLS,
    blurb: "Three floors. Green tiles last, red ones go almost at once.",
    rules: "Three floors of tiles. A tile starts breaking when you land on it, and its colour says how fast: green about 2 seconds, yellow about 1, red almost at once. Fall through a gap and you land on the floor below, or you are out if there is no tile there. After a while tiles start cracking on their own. The last player standing wins.",
  },
  {
    id: "party", name: "Block Party", minHumans: 1, floors: 1, cells: CELLS,
    blurb: "A colour is called: be standing on it when the countdown ends.",
    rules: "The floor is painted in four colours, each with its own symbol. A colour is called out and you have about a second: get onto a tile of that colour, because every other tile drops away. Only one player fits on a tile: a tile with two or more players on it drops too, so spread out. Tiles about to drop flash, and from the sixth call some tiles of the called colour crack too: they flash from the start, so pick one that is not flashing. The floor comes back in a new pattern every call. The last player standing wins.",
  },
];

/** The colours of Block Party, as shown on the tiles and in the call-out (each also has its own symbol). */
export const PARTY_LOOK = [
  { name: "BLUE", colour: 0x3a8bff, symbol: "●" },
  { name: "ORANGE", colour: 0xff9a2e, symbol: "▲" },
  { name: "PINK", colour: 0xff5ec4, symbol: "■" },
  { name: "GREEN", colour: 0x3fd06a, symbol: "★" },
];

export const VOID_MODE_BY_ID: Record<string, VoidMode> = Object.fromEntries(VOID_MODES.map((m) => [m.id, m]));

/** The mode for an id from the network, falling back to classic Voidfall. */
// hasOwn: an id like "constructor" from the network must not find something on the prototype.
export const voidModeOf = (id: string | undefined): VoidMode => (id && Object.hasOwn(VOID_MODE_BY_ID, id) ? VOID_MODE_BY_ID[id] : VOID_MODES[0]);
