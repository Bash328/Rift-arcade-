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
