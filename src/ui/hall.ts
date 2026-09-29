// Hall of Fame: lines players star (☆ on the round summary). Kept per run (the end-of-run
// "greatest hits") AND across runs on the device (the all-time wall on the campaign map).
// Every star is also journaled — starred lines are the ground truth for "what's funny", so
// comparing them with what SCORED well is the best scoring/card-tuning signal we have.

export interface Star {
  /** Unique per statement: `<run start>-<debate>-<question>-<speaker>`. */
  key: string;
  text: string;
  by: 'you' | 'them';
  /** Who said it (the player's candidate name, or the opponent's). */
  speaker: string;
  /** The opponent in that debate (context on the wall). */
  opponent: string;
  delta: number;
  label: string;
  debate: number;
  q: number;
  at: number;
  /** The tester's name from the journal screen, if set. */
  who?: string;
}

export const HALL_KEY = 'mokp.hall';
/** The all-time wall keeps the newest this many. */
export const HALL_MAX = 300;

/** Add `star` if its key is absent, else remove it. Returns [new list, now starred?]. */
export function toggleStar(list: Star[], star: Star): [Star[], boolean] {
  if (list.some((s) => s.key === star.key)) return [list.filter((s) => s.key !== star.key), false];
  return [[...list, star], true];
}

/** Keep the run's `n` best POSITIVE player lines (the greatest-hits fallback when nothing was
 *  starred). A statement already present (same key) is not added twice. */
export function keepTopLines(list: Star[], line: Star, n = 3): Star[] {
  if (line.delta <= 0 || list.some((s) => s.key === line.key)) return list;
  return [...list, line].sort((a, b) => b.delta - a.delta).slice(0, n);
}
