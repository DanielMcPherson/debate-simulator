import { describe, it, expect } from 'vitest';
import { scoreStatement } from '../src/engine/scoring';
import { createGame, applyMove, bestTypoJam } from '../src/engine/game';
import { mergeRelicMods, NO_MODS } from '../src/engine/relics';
import { plan } from '../src/engine/ai';
import { ALL, RELICS, findRelic, findDef, PERIOD } from '../src/data/cards';
import type { Card, RelicMods } from '../src/engine/types';

function cards(...ids: string[]): Card[] {
  return ids.map((id) => {
    if (id === 'c_period') return PERIOD;
    const c = findDef(id);
    if (!c) throw new Error(`no card ${id}`);
    return c;
  });
}
const mods = (id: string): RelicMods => findRelic(id)!.mods;

describe('relics — catalog integrity', () => {
  const KNOWN_MODS: (keyof RelicMods)[] = ['incomingAttackMult', 'barStart', 'offTopicImmune', 'crowdAlwaysBoost', 'blunderMult'];

  it('ids are unique and findRelic roundtrips', () => {
    expect(new Set(RELICS.map((r) => r.id)).size).toBe(RELICS.length);
    for (const r of RELICS) expect(findRelic(r.id)).toBe(r);
    expect(findRelic('nope')).toBeUndefined();
  });

  it('every relic carries only known mod fields, plus a face', () => {
    for (const r of RELICS) {
      expect(Object.keys(r.mods).length, `${r.id} does nothing`).toBeGreaterThan(0);
      for (const k of Object.keys(r.mods)) expect(KNOWN_MODS, `${r.id} unknown mod ${k}`).toContain(k);
      expect(r.icon.length, `${r.id} icon`).toBeGreaterThan(0);
      expect(r.name.length, `${r.id} name`).toBeGreaterThan(0);
      expect(r.blurb.length, `${r.id} blurb`).toBeGreaterThan(0);
    }
  });

  it('relics are NOT cards — no id collides with the lexicon, none resolvable via findDef', () => {
    for (const r of RELICS) {
      expect(ALL.some((c) => c.id === r.id), `${r.id} collides with a card`).toBe(false);
      expect(findDef(r.id), `${r.id} leaked into findDef`).toBeUndefined();
    }
  });

  it('mergeRelicMods: booleans OR, additive sum, multipliers take the strongest', () => {
    expect(mergeRelicMods(undefined)).toBe(NO_MODS);
    expect(mergeRelicMods([])).toBe(NO_MODS);
    const merged = mergeRelicMods(RELICS); // all five at once
    expect(merged.incomingAttackMult).toBe(0.5);
    expect(merged.blunderMult).toBe(1.3);
    expect(merged.barStart).toBe(10);
    expect(merged.offTopicImmune).toBe(true);
    expect(merged.crowdAlwaysBoost).toBe(true);
  });
});

describe('relics — engine threading', () => {
  it('The Incumbent tilts the starting bar; relic-less games start at 0', () => {
    expect(createGame({ seed: 3, relics: ['incumbent'] }).bar).toBe(10);
    expect(createGame({ seed: 3 }).bar).toBe(0);
    expect(createGame({ seed: 3, relics: ['teflon'] }).bar).toBe(0);
  });

  it('resolves ids onto state.relics, ignoring unknown ids', () => {
    const g = createGame({ seed: 3, relics: ['teflon', 'bogus'] });
    expect(g.relics?.map((r) => r.id)).toEqual(['teflon']);
  });

  it('the deal event records the player relics (analytics)', () => {
    const g = createGame({ seed: 3, relics: ['darling'] });
    const deal = g.events.find((e) => e.t === 'deal') as { relics?: string[] };
    expect(deal.relics).toEqual(['darling']);
    const bare = createGame({ seed: 3 }).events.find((e) => e.t === 'deal') as { relics?: string[] };
    expect(bare.relics).toBeUndefined();
  });

  it('determinism: same seed + relics ⇒ identical event trails', () => {
    const a = createGame({ seed: 7, relics: ['incumbent', 'teflon'] });
    const b = createGame({ seed: 7, relics: ['incumbent', 'teflon'] });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.bar).toBe(b.bar);
  });
});

describe('relics — Teflon Don (incomingAttackMult)', () => {
  const attack = cards('s_opp', 'p_kick_pup');

  it('halves an attack on the holder, at the contribution level (FX ≡ bar)', () => {
    const base = scoreStatement(attack);
    const damped = scoreStatement(attack, { defenderMods: mods('teflon') });
    expect(damped.delta).toBeCloseTo(base.delta * 0.5, 1);
    // The breakdown the FX animates matches the damped total — no bar/FX divergence.
    expect(damped.breakdown![0].delta).toBeCloseTo(base.breakdown![0].delta * 0.5, 5);
  });

  it('leaves brags and panders untouched (only attack_opp is damped)', () => {
    const brag = cards('s_i', 'p_patriot');
    expect(scoreStatement(brag, { defenderMods: mods('teflon') }).delta).toBe(scoreStatement(brag).delta);
  });

  it('applies at a real AI resolution (defenderMods threaded in game.ts)', () => {
    const play = (relics?: string[]) => {
      const g = createGame({ seed: 11, opponentId: 'blowhard', crowdId: 'flattery', relics });
      g.turn = 'ai';
      g.ai.line = cards('s_opp', 'p_kick_pup');
      applyMove(g, { kind: 'end' });
      return g.ai.lastReaction!.delta;
    };
    expect(play(['teflon'])).toBeCloseTo(play() * 0.5, 1);
  });
});

describe('relics — Spin Doctor (blunderMult)', () => {
  it('softens a self-own from ×1.6 to ×1.3', () => {
    const selfOwn = cards('s_i', 'p_disgrace');
    const base = scoreStatement(selfOwn).delta;
    const spun = scoreStatement(selfOwn, { mods: mods('spindoc') }).delta;
    expect(spun).toBeCloseTo((base * 1.3) / 1.6, 1);
  });

  it('softens an audience insult too', () => {
    const insult = cards('s_people', 'p_disgrace');
    expect(scoreStatement(insult, { mods: mods('spindoc') }).delta).toBeGreaterThan(scoreStatement(insult).delta);
  });

  it('softens the confused-path blunder punch-through', () => {
    // A genuine attributable self-own stranded in an ungrammatical line still punches
    // through the muffle — but a Spin Doctor holder's punches through more gently.
    const salad = cards('s_i', 'p_disgrace', 's_opp');
    const base = scoreStatement(salad);
    const spun = scoreStatement(salad, { mods: mods('spindoc') });
    expect(base.grammatical).toBe(false);
    expect(spun.delta).toBeGreaterThan(base.delta);
    expect(spun.delta).toBeLessThan(0);
  });
});

describe('relics — Media Darling (offTopicImmune)', () => {
  it('removes the dodge penalty AND the OFF-TOPIC flag', () => {
    const line = cards('s_i', 'p_patriot'); // no topic tags
    const free = scoreStatement(line).delta;
    expect(scoreStatement(line, { topicId: 'economy' }).delta).toBeLessThan(free);
    const immune = scoreStatement(line, { topicId: 'economy', mods: mods('darling') });
    expect(immune.delta).toBe(free);
    expect(immune.offTopic).toBeUndefined();
    expect(immune.detail).not.toContain('dodged');
  });
});

describe('relics — Base Rally (crowdAlwaysBoost)', () => {
  const brag = cards('s_i', 'p_patriot');
  const offTaste = { id: 'c', loves: 'attack_opp', boost: 1.5 } as const;
  const onTaste = { id: 'c', loves: 'praise_self', boost: 1.5 } as const;

  it('boosts the best positive contribution when the crowd taste found nothing', () => {
    const cold = scoreStatement(brag, { crowd: offTaste });
    const rallied = scoreStatement(brag, { crowd: offTaste, mods: mods('baserally') });
    expect(rallied.delta).toBeGreaterThan(cold.delta);
    expect(rallied.crowdFavorite).toBe(true);
    expect(cold.crowdFavorite).toBeUndefined();
  });

  it('never double-boosts on top of a real taste match', () => {
    const matched = scoreStatement(brag, { crowd: onTaste }).delta;
    expect(scoreStatement(brag, { crowd: onTaste, mods: mods('baserally') }).delta).toBe(matched);
  });

  it('never amplifies a blunder (nothing positive to cheer)', () => {
    const selfOwn = cards('s_i', 'p_disgrace');
    const base = scoreStatement(selfOwn, { crowd: offTaste }).delta;
    expect(scoreStatement(selfOwn, { crowd: offTaste, mods: mods('baserally') }).delta).toBe(base);
  });

  it('does nothing without a crowd (resolution-only, AI stays blind)', () => {
    expect(scoreStatement(brag, { mods: mods('baserally') }).delta).toBe(scoreStatement(brag).delta);
  });
});

describe('relics — AI awareness (public passives; crowd stays hidden)', () => {
  it("plan() devalues attacks into a Teflon player", () => {
    const line = cards('s_opp', 'p_kick_pup'); // already complete; no extension needed
    const naive = plan(line, [], {})!;
    const aware = plan(line, [], { defenderMods: mods('teflon') })!;
    expect(aware.delta).toBeCloseTo(naive.delta * 0.5, 1);
  });

  it('bestTypoJam forecasts the jam under the victim relics (Spin Doctor shrinks it)', () => {
    const jamFor = (relics?: string[]) => {
      const g = createGame({ seed: 5, crowdId: 'flattery', relics });
      g.player.line = cards('s_i', 'p_patriot'); // "I am a true patriot" — jam the predicate
      g.pool = cards('p_disgrace'); // the only replacement: a forced self-own
      return bestTypoJam(g, g.player.line);
    };
    const naive = jamFor();
    const spun = jamFor(['spindoc']);
    expect(naive.index).toBe(0);
    expect(spun.index).toBe(0);
    expect(spun.delta).toBeGreaterThan(naive.delta); // the holder self-owns less than the raw jam suggests
    expect(spun.delta).toBeLessThan(0);
  });
});
