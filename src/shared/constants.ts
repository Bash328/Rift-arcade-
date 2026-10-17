/** Simulation rate in Hz. One input advances exactly one step at this rate. */
export const TICK_RATE = 30;

export const ARENA_WIDTH = 1200;
export const ARENA_HEIGHT = 900;

/** Half-extent of a player square, used for wall clamping. */
export const PLAYER_HALF = 12;

/**
 * One quarter of the layout (top-left; sim-space centers and half-extents, `h` is
 * the height of the top surface). It is mirrored into all four quarters below, so
 * the map is fair for everyone. Rules of thumb: every block can be circled (no
 * dead ends), no gap is narrower than ~60, and the center stays open for spawns.
 *
 * Heights are tuned to the jump (apex ~68): low steps and walls (<= 50) can be
 * jumped onto from the ground; the tall block and pillars (80-100) need a step.
 */
const QUARTER = [
  { x: 230, y: 170, hw: 40, hh: 40, h: 80 },  // corner block: climb it from the step below
  { x: 230, y: 275, hw: 22, hh: 22, h: 40 },  // step up to the corner block
  { x: 400, y: 290, hw: 70, hh: 12, h: 45 },  // long wall guarding the center
  { x: 110, y: 330, hw: 12, hh: 60, h: 45 },  // wall hugging the side
  { x: 470, y: 120, hw: 20, hh: 20, h: 100 }, // tall pillar
  { x: 470, y: 205, hw: 22, hh: 22, h: 50 },  // step up to that pillar
  { x: 340, y: 400, hw: 20, hh: 20, h: 100 }, // tall pillar: slit to its mirror twin
  { x: 430, y: 380, hw: 22, hh: 22, h: 50 },  // step up to that pillar
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
export const ROUND_SECONDS = 60;
export const ROUND_END_PAUSE = 5;
