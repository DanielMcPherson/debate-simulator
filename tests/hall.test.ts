import { describe, it, expect } from 'vitest';
import { toggleStar, keepTopLines, type Star } from '../src/ui/hall';

const star = (key: string, delta = 10): Star => ({ key, text: key, by: 'you', speaker: 'You', opponent: 'X', delta, label: 'approve', debate: 1, q: 1, at: 0 });

describe('hall of fame', () => {
  it('toggles a star on and off by key', () => {
    const [on, starred] = toggleStar([], star('a'));
    expect(starred).toBe(true);
    expect(on.map((s) => s.key)).toEqual(['a']);
    const [off, still] = toggleStar(on, star('a'));
    expect(still).toBe(false);
    expect(off).toEqual([]);
  });
  it('keeps only the best positive lines, no duplicates', () => {
    let top: Star[] = [];
    for (const [k, d] of [['a', 5], ['b', -8], ['c', 20], ['d', 12], ['e', 9], ['c', 20]] as const) top = keepTopLines(top, star(k, d));
    expect(top.map((s) => s.key)).toEqual(['c', 'd', 'e']);
  });
});
