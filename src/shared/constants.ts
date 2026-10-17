/** Simulation rate in Hz. One input advances exactly one step at this rate. */
export const TICK_RATE = 30;

export const ARENA_WIDTH = 1200;
export const ARENA_HEIGHT = 900;

/** Half-extent of a player square, used for wall clamping. */
export const PLAYER_HALF = 12;

/**
 * One quarter of the layout (top-left; sim-space centers and half-extents, `h`
 * is visual height only). It is mirrored into all four quarters below, so the
 * map is fair for everyone. Rules of thumb: every block can be circled (no dead
 * ends), no gap is narrower than ~60, and the center stays open for spawns.
 */
const QUARTER = [
  { x: 230, y: 170, hw: 40, hh: 40, h: 70 },  // corner block
  { x: 400, y: 290, hw: 70, hh: 12, h: 50 },  // long wall guarding the center
  { x: 110, y: 330, hw: 12, hh: 60, h: 50 },  // wall hugging the side
  { x: 470, y: 120, hw: 20, hh: 20, h: 90 },  // pillar
  { x: 340, y: 400, hw: 20, hh: 20, h: 90 },  // pillar: slit to its mirror twin
];

export const OBSTACLES = QUARTER.flatMap((o) => [
  o,
  { ...o, x: ARENA_WIDTH - o.x },
  { ...o, y: ARENA_HEIGHT - o.y },
  { ...o, x: ARENA_WIDTH - o.x, y: ARENA_HEIGHT - o.y },
]);

/** Units per second at full stick. */
export const PLAYER_SPEED = 300;

/** Seconds a freshly tagged player can't be tagged back. */
export const TAG_COOLDOWN = 1;

/** Round length, and how long the winner banner shows before the next round. */
export const ROUND_SECONDS = 60;
export const ROUND_END_PAUSE = 5;
