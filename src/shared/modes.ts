// Cube Tag game modes. Each round is one mode on one arena; plain data that both the
// server (rules) and the browser (names, the intro banner) read.

export interface Mode {
  id: string;
  name: string;
  /** One line shown when the round starts. */
  blurb: string;
  /** Round length in seconds; omitted = the arena's own length. */
  seconds?: number;
  /** The mode is skipped in the rotation when fewer players than this are in the room. */
  minPlayers: number;
}

export const MODES: Mode[] = [
  { id: "tag", name: "Cube Tag", blurb: "Don't be IT. Every second you are free scores a point.", minPlayers: 2 },
  { id: "orbs", name: "Orb Rush", blurb: "Grab the glowing orbs. Gold ones are worth 3, and some sit on blocks.", seconds: 60, minPlayers: 1 },
  { id: "infect", name: "Infection", blurb: "The red cube spreads by touch. Stay clean as long as you can.", seconds: 75, minPlayers: 3 },
  { id: "hill", name: "King of the Hill", blurb: "Hold the glowing ring on your own to score. It moves every 20 seconds.", seconds: 75, minPlayers: 2 },
];

export const MODE_BY_ID: Record<string, Mode> = Object.fromEntries(MODES.map((m) => [m.id, m]));

/** The mode for an id from the network, falling back to Cube Tag. */
// hasOwn: an id like "constructor" from the network must not find something on the prototype.
export const modeOf = (id: string | undefined): Mode => (id && Object.hasOwn(MODE_BY_ID, id) ? MODE_BY_ID[id] : MODES[0]);

/** King of the Hill: ring size and how often it moves. */
export const ZONE_RADIUS = 110;
export const ZONE_MOVE_SECONDS = 20;

/** Orb Rush: how close (flat distance) and how level (height difference) a player must be to pick an orb up. */
export const ORB_REACH = 26;
export const ORB_HEIGHT = 30;
