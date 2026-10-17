/**
 * How many buffered inputs to apply to one player this tick.
 *
 * A phone's inputs do not always arrive evenly: after a network hiccup they come in
 * a burst. Applying the whole burst in one tick makes that player lunge forward,
 * which everyone else sees as teleporting. So normally exactly one input is applied
 * per tick, which keeps movement even; only while a real backlog has built up (more
 * than two waiting) do we apply two, working the delay back down at twice the pace
 * instead of staying behind forever.
 */
export const inputBudget = (pending: number) => (pending > 2 ? 2 : 1);

/** More than this many waiting inputs is a stall the player has already moved past: the oldest are thrown away. */
export const MAX_BACKLOG = 6;
/** Steps a player may bank, and how many they earn per tick. */
const TOKEN_CAP = 3;
// ponytail: 1.1 leaves a little room to work a backlog down; the cost is that a client
// flooding inputs can move up to 10% fast. Lower it toward 1 if that ever matters.
const REFILL = 1.1;

/**
 * Per-player limit on how many inputs are applied. Without it a client that keeps
 * sending more than one input per tick keeps `inputBudget` at 2 and moves at double
 * speed; with it the long-run rate is capped at REFILL steps per tick.
 */
export class InputPacer {
  private tokens = TOKEN_CAP;

  /** How many of the `pending` inputs to throw away (oldest first), then how many of the rest to apply this tick. */
  plan(pending: number) {
    this.tokens = Math.min(TOKEN_CAP, this.tokens + REFILL);
    const drop = Math.max(0, pending - MAX_BACKLOG);
    const apply = Math.min(inputBudget(pending - drop), Math.floor(this.tokens), pending - drop);
    this.tokens -= apply;
    return { drop, apply };
  }
}
