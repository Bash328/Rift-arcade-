/** Simulation rate in Hz. One input advances exactly one step at this rate. */
export const TICK_RATE = 30;

/** Half-extent of a player square, used for wall clamping. */
export const PLAYER_HALF = 12;

/** Jump launch speed and gravity, in units per second (and per second squared). */
export const JUMP_SPEED = 460;
export const GRAVITY = 1400;

/** The pet models players get, in join order (files are /models/animal-<name>.glb). */
export const PETS = ["fox", "cat", "dog", "bunny", "panda", "pig", "tiger", "lion", "koala", "cow", "penguin", "monkey"];

/** Units per second at full stick. */
export const PLAYER_SPEED = 300;

/** Seconds a freshly tagged player can't be tagged back. */
export const TAG_COOLDOWN = 1;

/** How long the winner banner and the arena vote show before the next round. */
export const ROUND_END_PAUSE = 12;
