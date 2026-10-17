// Cube Tag game modes. Each round is one mode on one arena; plain data that both the
// server (rules) and the browser (names, the intro banner) read.

export interface Mode {
  id: string;
  name: string;
  /** One line shown when the round starts. */
  blurb: string;
  /** The full explanation shown when someone joins a room. */
  rules: string;
  /** Round length in seconds; omitted = the arena's own length. */
  seconds?: number;
  /** The mode is skipped in the rotation when fewer players than this are in the room. */
  minPlayers: number;
}

export const MODES: Mode[] = [
  {
    id: "tag", name: "Cube Tag", minPlayers: 2,
    blurb: "Don't be IT. Every second you are free scores a point.",
    rules: "One cube is IT, glowing red. Touch another player to pass it on. Every second you are not IT scores a point, and the highest score when the clock runs out wins. Jump onto blocks to get out of reach.",
  },
  {
    id: "orbs", name: "Orb Rush", seconds: 60, minPlayers: 1,
    blurb: "Grab the glowing orbs. Gold ones are worth 3, and some sit on blocks.",
    rules: "Glowing orbs appear around the arena. Run into one to score: blue is 1 point, gold is 3. Some float over low blocks, so jump up for them. The most points when the clock runs out wins.",
  },
  {
    id: "infect", name: "Infection", seconds: 75, minPlayers: 3,
    blurb: "The red cube spreads by touch. Stay clean as long as you can.",
    rules: "One cube starts red. Touch a clean player and they turn red too. Players who are still clean score every second. The round ends when everyone is red, and the most points wins.",
  },
];

export const MODE_BY_ID: Record<string, Mode> = Object.fromEntries(MODES.map((m) => [m.id, m]));

/** The mode for an id from the network, falling back to Cube Tag. */
// hasOwn: an id like "constructor" from the network must not find something on the prototype.
export const modeOf = (id: string | undefined): Mode => (id && Object.hasOwn(MODE_BY_ID, id) ? MODE_BY_ID[id] : MODES[0]);

/** Orb Rush: how close (flat distance) and how level (height difference) a player must be to pick an orb up. */
export const ORB_REACH = 26;
export const ORB_HEIGHT = 30;
