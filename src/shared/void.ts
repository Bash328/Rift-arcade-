import { PLAYER_SPEED, JUMP_SPEED, GRAVITY } from "./constants.js";

/**
 * Voidfall: floating tiles that crack under feet, then drop away.
 *
 * Classic Voidfall is one floor of a 9 x 9 square grid (81 tiles). Hex-A-Gone is three floors of hexagons
 * (9 across, 10 down, every other row shifted half a tile: 90 per floor, 270 in all). A tile array tells which
 * it is by its length, so the server, the phones' prediction and the bots all share one set of functions.
 */
export const GRID = 9;
export const TILE = 100;
export const VOID_SIZE = GRID * TILE;
/** Tiles on one square floor. */
export const CELLS = GRID * GRID;

/** Hexagon floors (pointy side up, 100 wide from flat side to flat side, odd rows shifted half a tile). */
export const HEX_COLS = 9;
export const HEX_ROWS = 10;
export const HEX_CELLS = HEX_COLS * HEX_ROWS;
/** Distance from a hexagon's middle to a corner, and between rows. */
export const HEX_R = TILE / Math.sqrt(3);
const HEX_ROW_H = HEX_R * 1.5;
/** The middle of a hexagon floor, where players start. */
export const HEX_CENTRE: [number, number] = [(HEX_COLS * TILE + TILE / 2) / 2, (HEX_R * 2 + (HEX_ROWS - 1) * HEX_ROW_H) / 2];

/** Tile states (a flat array: floor after floor). */
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

/**
 * Floors in a Hex-A-Gone round (classic Voidfall has one) and the height between their surfaces. It is more than the
 * camera's height above the player, so after dropping to the next floor the floor you left is out of sight.
 */
export const HEX_FLOORS = 3;
export const FLOOR_GAP = 520;
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

// ---- Block Party: one square floor painted in four colours; a colour is called and every other tile drops.

/** Colours (and symbols) on the floor. */
export const PARTY_COLOURS = 4;
/** Seconds the called colour is shown before the other tiles drop: 1.2 every round (the start and the step are here to tune). */
export const PARTY_CALL_START = 1.2;
export const PARTY_CALL_STEP = 0;
export const PARTY_CALL_MIN = 1.2;
export const partyCallTime = (round: number) => Math.max(PARTY_CALL_MIN, PARTY_CALL_START - PARTY_CALL_STEP * (round - 1));
/** How long the floor stays gone, and how long the new floor is shown before the next colour is called. */
export const PARTY_DROP_TIME = 2.0;
export const PARTY_RESET_TIME = 1.0;
/** The tiles of the other colours start flashing this many seconds before the drop. */
export const PARTY_WARN = 0.8;
/**
 * After the countdown reaches zero the drop waits this long, so a slow connection (a phone that shows you on the tile
 * a little before the server does) does not cost you it.
 */
export const PARTY_GRACE = 0.2;
/** Fewest called-colour tiles that always stay safe, however many are marked to crack. */
export const PARTY_MIN_SAFE = 3;
/**
 * From call 6 a growing share of the called colour cracks too (10% more each call, up to 85%), so a game cannot go on for
 * ever. Those tiles flash from the moment the colour is called, so you can pick one that is not cracking.
 */
export const partyExtraDrop = (round: number) => (round <= 5 ? 0 : Math.min(0.85, 0.1 * (round - 5)));
/** A new floor: every colour on about a quarter of the tiles, shuffled. */
export function dealParty(random: () => number = Math.random): number[] {
  const kinds = Array.from({ length: CELLS }, (_, i) => i % PARTY_COLOURS);
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  return kinds;
}

// ---- Boards: where the tiles are

/** The layout of one floor: how to find a tile from a position, where a tile is, and which tiles touch it. */
export interface Board {
  /** Tiles on one floor. */
  per: number;
  /** The tile under (x, y), or -1 when off the floor. */
  at(x: number, y: number): number;
  /** The middle of a tile. */
  centre(i: number): [number, number];
  /** Tiles that touch this one (8 on a square floor, 6 on a hexagon floor). */
  neighbours(i: number): readonly number[];
  /** Straight jumps over one missing tile: [tile landed on, tile jumped over]. */
  jumps(i: number): readonly [number, number][];
  /** The middle of the whole floor. */
  middle: [number, number];
}

/** Index of the tile under (x, y) on a square floor, or -1 when off the grid. */
export function tileAt(x: number, y: number): number {
  const i = Math.floor(x / TILE);
  const j = Math.floor(y / TILE);
  return i < 0 || j < 0 || i >= GRID || j >= GRID ? -1 : j * GRID + i;
}

/** Index of the hexagon under (x, y), or -1 when off the floor (nearest hexagon middle, by cube rounding). */
export function hexAt(x: number, y: number): number {
  const px = x - TILE / 2, py = y - HEX_R;
  const q = px / TILE - py / (3 * HEX_R);
  const r = (2 * py) / (3 * HEX_R);
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(-q - r);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs + q + r);
  if (dq > dr && dq > ds) { rq = -rr - rs; } else if (dr > ds) { rr = -rq - rs; }
  const col = rq + (rr - (rr & 1)) / 2;
  return rr < 0 || rr >= HEX_ROWS || col < 0 || col >= HEX_COLS ? -1 : rr * HEX_COLS + col;
}

export function hexCentre(i: number): [number, number] {
  const col = i % HEX_COLS, row = Math.floor(i / HEX_COLS);
  return [(col + 0.5 + (row & 1) * 0.5) * TILE, HEX_R + row * HEX_ROW_H];
}

const HEX_DIRS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const HEX_NEIGHBOURS: number[][] = Array.from({ length: HEX_CELLS }, (_, i) => {
  const col = i % HEX_COLS, row = Math.floor(i / HEX_COLS);
  const q = col - (row - (row & 1)) / 2;
  const out: number[] = [];
  for (const [dq, dr] of HEX_DIRS) {
    const nr = row + dr, nq = q + dq;
    const nc = nq + (nr - (nr & 1)) / 2;
    if (nr >= 0 && nr < HEX_ROWS && nc >= 0 && nc < HEX_COLS) { out.push(nr * HEX_COLS + nc); }
  }
  return out;
});
// Along a row only: the other directions are not on a line a stick can steer.
const HEX_JUMPS: [number, number][][] = Array.from({ length: HEX_CELLS }, (_, i) => {
  const col = i % HEX_COLS;
  const out: [number, number][] = [];
  if (col + 2 < HEX_COLS) { out.push([i + 2, i + 1]); }
  if (col - 2 >= 0) { out.push([i - 2, i - 1]); }
  return out;
});

const SQUARE_NEIGHBOURS: number[][] = Array.from({ length: CELLS }, (_, i) => {
  const cx = i % GRID, cy = Math.floor(i / GRID);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if ((dx || dy) && x >= 0 && y >= 0 && x < GRID && y < GRID) { out.push(y * GRID + x); }
    }
  }
  return out;
});
const SQUARE_JUMPS: [number, number][][] = Array.from({ length: CELLS }, (_, i) => {
  const cx = i % GRID, cy = Math.floor(i / GRID);
  const out: [number, number][] = [];
  for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
    const x = cx + dx, y = cy + dy;
    if (x >= 0 && y >= 0 && x < GRID && y < GRID) { out.push([y * GRID + x, (cy + dy / 2) * GRID + cx + dx / 2]); }
  }
  return out;
});

export const SQUARE_BOARD: Board = {
  per: CELLS,
  at: tileAt,
  centre: (i) => [((i % GRID) + 0.5) * TILE, (Math.floor(i / GRID) + 0.5) * TILE],
  neighbours: (i) => SQUARE_NEIGHBOURS[i],
  jumps: (i) => SQUARE_JUMPS[i],
  middle: [VOID_SIZE / 2, VOID_SIZE / 2],
};
export const HEX_BOARD: Board = {
  per: HEX_CELLS,
  at: hexAt,
  centre: hexCentre,
  neighbours: (i) => HEX_NEIGHBOURS[i],
  jumps: (i) => HEX_JUMPS[i],
  middle: HEX_CENTRE,
};

/** The layout a tile array uses: 81 tiles is classic Voidfall, anything else is hexagon floors. */
export const boardOf = (tiles: ArrayLike<number>): Board => (tiles.length === CELLS ? SQUARE_BOARD : HEX_BOARD);
/** How many floors a tile array holds. */
export const floorsOf = (tiles: ArrayLike<number>) => (tiles.length === CELLS ? 1 : Math.max(1, Math.round(tiles.length / HEX_CELLS)));
/** Below this height a player is out, given the number of floors. */
export const fallLimit = (floors: number) => FALL_LIMIT - (floors - 1) * FLOOR_GAP;
/** Which floor a height belongs to: the nearest surface at or above it. */
export const floorOf = (z: number, floors: number) => Math.min(floors - 1, Math.max(0, Math.floor(-z / FLOOR_GAP)));

/**
 * The kind of every tile for a Hex-A-Gone round, floor after floor. The tiles in the middle of the top floor,
 * where everyone starts, are never red: nobody should lose to the tile they were placed on.
 */
export function dealKinds(random: () => number = Math.random): number[] {
  const kinds: number[] = [];
  for (let f = 0; f < HEX_FLOORS; f++) {
    for (let i = 0; i < HEX_CELLS; i++) {
      const [cx, cy] = hexCentre(i);
      const middle = f === 0 && Math.hypot(cx - HEX_CENTRE[0], cy - HEX_CENTRE[1]) < 170;
      const [green, yellow] = KIND_MIX[f];
      const roll = random();
      let kind = roll < green ? GREEN : roll < green + yellow ? YELLOW : RED;
      if (middle && kind === RED) { kind = random() < 0.5 ? GREEN : YELLOW; }
      kinds.push(kind);
    }
  }
  return kinds;
}

export interface VoidEntity { x: number; y: number; vx: number; vy: number; z: number; vz: number; }
export interface VoidInput { moveX: number; moveY: number; jump: number; }

/** Index (in the whole tile array) of the tile an entity is standing on, or -1 if it is in the air. */
export function tileUnder(entity: VoidEntity, tiles: ArrayLike<number>): number {
  const board = boardOf(tiles);
  const cell = board.at(entity.x, entity.y);
  if (cell < 0) { return -1; }
  for (let f = 0; f < floorsOf(tiles); f++) {
    if (entity.z === floorZ(f)) { const index = f * board.per + cell; return tiles[index] < GONE ? index : -1; }
  }
  return -1;
}

/**
 * One movement step for Voidfall, run identically by the server and by the
 * client's prediction. There are no walls: you stand on a tile whose centre is
 * under you, and fall when it is gone or you step off the floor. With several
 * floors, a fall lands on the next floor down if there is a tile under you there.
 */
export function stepVoidEntity(
  entity: VoidEntity, input: VoidInput, dt: number, tiles: ArrayLike<number>,
): void {
  const board = boardOf(tiles);
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

  const cell = board.at(entity.x, entity.y);
  const hasFloor = (f: number) => cell >= 0 && tiles[f * board.per + cell] < GONE;
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
