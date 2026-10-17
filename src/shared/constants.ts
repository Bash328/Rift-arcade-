/** Simulation rate in Hz. One input advances exactly one step at this rate. */
export const TICK_RATE = 30;

export const ARENA_WIDTH = 1500;
export const ARENA_HEIGHT = 1125;

/** Half-extent of a player square, used for wall clamping. */
export const PLAYER_HALF = 12;

/**
 * Where players start: evenly spread on a ring this far from the middle, so a
 * full room of 8 begins well apart instead of in a clump. The area inside the
 * ring (plus a cube's width) is kept free of obstacles.
 */
export const SPAWN_RADIUS = 170;

/**
 * One quarter of the layout (top-left; sim-space centers and half-extents, `h` is
 * the height of the top surface). It is mirrored into all four quarters below, so
 * the map is fair for everyone. Rules of thumb: every block can be circled (no
 * dead ends), no gap is narrower than ~40, and the middle stays open for spawns
 * (a test checks all of this).
 *
 * Heights are tuned to the jump (apex ~68): low steps and walls (<= 50) can be
 * jumped onto from the ground; taller blocks and pillars (60-100) need a step.
 * Walls are for dodging around, pillars and blocks for climbing and for getting
 * out of reach of the player who is IT.
 */
const QUARTER = [
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
];

export const OBSTACLES = QUARTER.flatMap((o) => [
  o,
  { ...o, x: ARENA_WIDTH - o.x },
  { ...o, y: ARENA_HEIGHT - o.y },
  { ...o, x: ARENA_WIDTH - o.x, y: ARENA_HEIGHT - o.y },
]);

/** Jump launch speed and gravity, in units per second (and per second squared). */
export const JUMP_SPEED = 460;
export const GRAVITY = 1400;

/** The pet models players get, in join order (files are /models/animal-<name>.glb). */
export const PETS = ["fox", "cat", "dog", "bunny", "panda", "pig", "tiger", "lion", "koala", "cow", "penguin", "monkey"];

/** Units per second at full stick. */
export const PLAYER_SPEED = 300;

/** Seconds a freshly tagged player can't be tagged back. */
export const TAG_COOLDOWN = 1;

/** Round length, and how long the winner banner shows before the next round. */
export const ROUND_SECONDS = 90;
export const ROUND_END_PAUSE = 5;
