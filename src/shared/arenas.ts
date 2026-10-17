// Cube Tag arenas. Each one is plain data that both the server and the browser
// read: the layout, how the physics feel, and the colours. Add an arena by adding
// an entry to ARENAS; the tests check that every layout is playable.

export interface Obstacle {
  /** Centre and half-extents on the floor (sim x, y), and the height of the top surface. */
  x: number; y: number; hw: number; hh: number; h: number;
}

export interface ArenaTheme {
  /** Glowing edge of blocks and pillars. */
  edge: number;
  /** Glowing edge of long walls and the rim around the arena. */
  rim: number;
  /** Floor grid lines. */
  grid: number;
  /** The floating slab, and the dark body of blocks. */
  slab: number;
  block: number;
  /** Distance fog colour. */
  fog: number;
  /** Surface painted over the floor; plain neon grid when absent. */
  floor?: "moon" | "ice";
  /** Optional lighting overrides; omitted = the purple neon default. */
  sky?: [string, string, string];
  hemi?: [number, number, number];
  sun?: [number, number];
  bloom?: number;
}

export interface Arena {
  id: string;
  name: string;
  /** One line shown to players. */
  blurb: string;
  width: number;
  height: number;
  /** Players start spread on a ring this far from the middle; keep it free of obstacles. */
  spawnRadius: number;
  obstacles: Obstacle[];
  /** Multiplies gravity and jump speed. */
  gravity: number;
  jump: number;
  /**
   * How long (seconds) velocity takes to follow the controls. 0 = instantly, like
   * normal ground; larger = slippery, you keep sliding.
   */
  slide: number;
  roundSeconds: number;
  theme: ArenaTheme;
}

/** Layouts are designed for one quarter (top-left) and mirrored into all four, so every spot is fair. */
function mirrored(quarter: Obstacle[], width: number, height: number): Obstacle[] {
  return quarter.flatMap((o) => [
    o,
    { ...o, x: width - o.x },
    { ...o, y: height - o.y },
    { ...o, x: width - o.x, y: height - o.y },
  ]);
}

const W = 1500;
const H = 1125;

/**
 * Jump height is about 68 on normal gravity: walls and steps of 50 or less can be
 * jumped onto from the ground, and taller blocks need a step first.
 */
const CLASSIC: Arena = {
  id: "classic",
  name: "Neon Grid",
  blurb: "The original: cover to dodge around and steps to climb.",
  width: W, height: H, spawnRadius: 170,
  gravity: 1, jump: 1, slide: 0, roundSeconds: 90,
  theme: { edge: 0x00e5ff, rim: 0xff2bd6, grid: 0x00b8d9, slab: 0x0b0b1a, block: 0x16102b, fog: 0x120826 },
  obstacles: mirrored([
    { x: 290, y: 210, hw: 45, hh: 45, h: 80 },   // corner fortress: climb it from the step below
    { x: 290, y: 330, hw: 24, hh: 24, h: 40 },   // step up to the fortress
    { x: 500, y: 362, hw: 80, hh: 12, h: 45 },   // long wall guarding the middle
    { x: 140, y: 400, hw: 12, hh: 70, h: 45 },   // wall hugging the side
    { x: 590, y: 140, hw: 22, hh: 22, h: 100 },  // tall pillar
    { x: 590, y: 240, hw: 24, hh: 24, h: 50 },   // step up to that pillar
    { x: 420, y: 490, hw: 22, hh: 22, h: 100 },  // tall pillar, with a wide gap to its mirror twin
    { x: 530, y: 470, hw: 24, hh: 24, h: 50 },   // step up to that pillar
    { x: 650, y: 60, hw: 60, hh: 12, h: 45 },    // wall along the top edge: a lane to dash through
    { x: 80, y: 150, hw: 30, hh: 30, h: 60 },    // corner cover
    { x: 330, y: 500, hw: 25, hh: 25, h: 60 },   // cover between the walls
    { x: 660, y: 350, hw: 28, hh: 28, h: 70 },   // tower near the middle, reached from the step beside it
  ], W, H),
};

/** Gravity is under half, so a jump goes about 2.5x as high and floats for ~1.5 seconds. */
const MOON: Arena = {
  id: "moon",
  name: "Moon Dunes",
  blurb: "Low gravity: leap across the map and perch on tall mesas.",
  width: W, height: H, spawnRadius: 170,
  gravity: 0.45, jump: 1, slide: 0, roundSeconds: 90,
  theme: { edge: 0xb98cff, rim: 0xffb23f, grid: 0x7a5cff, slab: 0x0d0a22, block: 0x6b6878, fog: 0x07070d, floor: "moon",
    sky: ["#000005", "#02020a", "#0a0a14"], hemi: [0x9aa0b4, 0x1a1a22, 0.6], sun: [0xfff6e8, 3] },
  obstacles: mirrored([
    { x: 240, y: 220, hw: 70, hh: 70, h: 110 },  // wide mesa: reachable from the ground
    { x: 240, y: 420, hw: 26, hh: 26, h: 240 },  // spire: needs a hop from a mesa first
    { x: 520, y: 150, hw: 60, hh: 60, h: 140 },  // high mesa
    { x: 520, y: 380, hw: 70, hh: 50, h: 100 },  // low mesa
    { x: 120, y: 500, hw: 50, hh: 30, h: 60 },   // dune
    { x: 360, y: 70, hw: 50, hh: 25, h: 60 },    // dune along the top edge
    { x: 680, y: 260, hw: 24, hh: 24, h: 200 },  // spire near the middle
  ], W, H),
};

/** Tall walls (100) cannot be jumped; low walls (45) can, so they are shortcuts and hurdles. */
const MAZE: Arena = {
  id: "maze",
  name: "The Maze",
  blurb: "Tall walls to hide behind, low walls to vault, corners to ambush.",
  width: W, height: H, spawnRadius: 170,
  gravity: 1, jump: 1, slide: 0, roundSeconds: 90,
  theme: { edge: 0x2dff8f, rim: 0xffd23f, grid: 0x1fa86a, slab: 0x061410, block: 0x0e2218, fog: 0x04140e },
  obstacles: mirrored([
    { x: 330, y: 140, hw: 230, hh: 12, h: 100 }, // top rail
    { x: 140, y: 390, hw: 12, hh: 150, h: 100 }, // left rail
    { x: 420, y: 300, hw: 160, hh: 12, h: 100 }, // inner rail
    { x: 280, y: 450, hw: 12, hh: 90, h: 100 },  // inner post
    { x: 500, y: 470, hw: 60, hh: 12, h: 100 },  // wall guarding the middle
    { x: 640, y: 170, hw: 12, hh: 50, h: 100 },  // top divider
    { x: 660, y: 330, hw: 12, hh: 50, h: 45 },   // low wall: vault it
    { x: 300, y: 225, hw: 100, hh: 12, h: 45 },  // low wall: a hurdle between corridors
  ], W, H),
};

/** Velocity takes ~0.4 seconds to follow your steering: you slide, and walls stop you dead. */
const ICE: Arena = {
  id: "ice",
  name: "Ice Rink",
  blurb: "Slippery floor: commit to every turn and use the walls to stop.",
  width: W, height: H, spawnRadius: 170,
  gravity: 1, jump: 1, slide: 0.4, roundSeconds: 90,
  theme: { edge: 0x9fe9ff, rim: 0xffffff, grid: 0x6fd0ff, slab: 0x0a1a2e, block: 0x8fd0f2, fog: 0x4f7ea3, floor: "ice",
    sky: ["#071a33", "#1b4a73", "#9fd0ea"], hemi: [0xbfe6ff, 0x405870, 0.5], sun: [0xdff3ff, 0.9], bloom: 1.2 },
  obstacles: mirrored([
    { x: 250, y: 230, hw: 40, hh: 40, h: 70 },
    { x: 560, y: 160, hw: 26, hh: 26, h: 70 },
    { x: 150, y: 470, hw: 26, hh: 26, h: 70 },
    { x: 470, y: 430, hw: 55, hh: 24, h: 50 },
    { x: 80, y: 260, hw: 20, hh: 60, h: 50 },
    { x: 360, y: 90, hw: 50, hh: 14, h: 45 },
    { x: 680, y: 300, hw: 24, hh: 50, h: 50 },
  ], W, H),
};

export const ARENAS: Arena[] = [CLASSIC, MOON, MAZE, ICE];
export const ARENA_BY_ID: Record<string, Arena> = Object.fromEntries(ARENAS.map((a) => [a.id, a]));

/** The arena for an id from the network, falling back to the classic one. */
export const arenaOf = (id: string | undefined): Arena => (id && ARENA_BY_ID[id]) || CLASSIC;
