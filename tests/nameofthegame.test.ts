import { describe, it, expect } from 'vitest';
import { ALL, findDef, resolveTier } from '../src/data/cards';
import { isComplete } from '../src/engine/grammar';
import { isNameOfTheGame } from '../src/ui/nameOfTheGame';
import type { Card } from '../src/engine/types';

const c = (id: string, inst = 0): Card => ({ ...(findDef(id) ?? resolveTier(id.replace(/_t\d$/, ''), Number(id.slice(-1)))!), id: `${id}#${inst}` });
const judge = (ids: string[]) => {
  const line = ids.map((id, i) => c(id, i));
  return isNameOfTheGame(line, isComplete(line));
};
const aside = ALL.find((x) => x.role === 'modifier' && !x.conj)!.id;
const finisher = ALL.find((x) => x.role === 'intensifier')!.id;

describe("That's the Name of the Game! trigger", () => {
  it('fires on the classic and on any flavor of "…opponent"', () => {
    expect(judge(['s_opp', 'p_kick_pup'])).toBe(true);
    expect(judge(['s_crook_opp', 'p_kick_pup'])).toBe(true); // "My crooked, do-nothing opponent"
    expect(judge(['s_idiot_opp', 'p_kick_pup'])).toBe(true);
    expect(judge(['r_scumbag_opp', 'p_kick_pup'])).toBe(true); // "…scumbag of an opponent"
  });
  it('fires on upgraded tiers of the staple subject', () => {
    const t1 = { ...resolveTier('s_opp', 1)!, id: `${resolveTier('s_opp', 1)!.id}#0` };
    const line = [t1, c('p_kick_pup', 1)];
    expect(isNameOfTheGame(line, isComplete(line))).toBe(true);
  });
  it('allows asides and a finisher', () => {
    expect(judge(['s_opp', aside, 'p_kick_pup'])).toBe(true);
    expect(judge(['s_opp', 'p_kick_pup', finisher])).toBe(true);
    expect(judge(['s_crook_opp', aside, 'p_kick_pup', finisher])).toBe(true);
  });
  it('rejects other subjects, other verbs, and longer statements', () => {
    expect(judge(['s_opp_wife', 'p_kick_pup'])).toBe(false); // "My opponent's wife"
    expect(judge(['s_opp_donors', 'p_kick_pup'])).toBe(false);
    expect(judge(['s_opp', 'p_lie'])).toBe(false);
    expect(judge(['s_opp', 'p_kick_pup', 'c_and', 'p_lie'])).toBe(false);
    expect(judge(['s_opp'])).toBe(false);
    expect(isNameOfTheGame([c('s_opp'), c('p_kick_pup', 1)], false)).toBe(false);
  });
});
