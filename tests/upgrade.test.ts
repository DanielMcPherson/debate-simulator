import { describe, it, expect } from 'vitest';
import { createGame } from '../src/engine/game';
import { buildPrivateDeck, buildSharedDeck } from '../src/engine/deck';
import { ALL, REWARDS, UPGRADES, UPGRADE_DEFS, findDef, upgradeOf, resolveTier } from '../src/data/cards';
import { cardLabel } from '../src/engine/morphology';
import type { Card } from '../src/engine/types';

const base = (id: string) => id.split('#')[0];
const playerCards = (g: ReturnType<typeof createGame>) => [...g.player.deck, ...g.player.hand];
const aiCards = (g: ReturnType<typeof createGame>) => [...g.ai.deck, ...g.ai.hand];

describe('upgrades — deck build (Punch Up the Zingers)', () => {
  it('maps an upgraded card to its tier-1 def in the player deck only', () => {
    const g = createGame({ seed: 3, opponentId: 'blowhard', upgrades: { p_fight_bear: 1 } });
    const mine = playerCards(g);
    expect(mine.some((c) => base(c.id) === 'p_fight_bear')).toBe(false);
    const up = mine.filter((c) => base(c.id) === 'p_fight_bear_t1');
    expect(up).toHaveLength(1);
    expect(up[0].tier).toBe(1);
    expect(up[0].priv).toBe(true); // still a private-deck resident (recycles, never duplicates)
    // The AI plays base decks — no upgraded defs ever.
    expect(aiCards(g).some((c) => UPGRADES[base(c.id)]?.id === base(c.id) || c.tier)).toBe(false);
  });

  it('walks multi-tier chains and clamps past the chain end', () => {
    const g = createGame({ seed: 3, upgrades: { p_fight_bear: 2 } });
    const mine = playerCards(g);
    expect(mine.some((c) => base(c.id) === 'p_fight_bear_t2')).toBe(true);
    expect(mine.some((c) => base(c.id) === 'p_fight_bear' || base(c.id) === 'p_fight_bear_t1')).toBe(false);
    // resolveTier clamps: p_ban_happiness has only one authored tier.
    expect(resolveTier('p_ban_happiness', 5)!.id).toBe(upgradeOf('p_ban_happiness')!.id);
    // …and is the identity for chainless cards / tier 0.
    expect(resolveTier('p_lie', 3)!.id).toBe('p_lie');
    expect(resolveTier('p_fight_bear', 0)!.id).toBe('p_fight_bear');
  });

  it('a cut beats an upgrade — the card is gone entirely', () => {
    const g = createGame({ seed: 3, removedCards: ['p_fight_bear'], upgrades: { p_fight_bear: 1 } });
    expect(playerCards(g).some((c) => base(c.id).startsWith('p_fight_bear'))).toBe(false);
  });

  it('upgrades apply to earned reward cards (run.bonus) too', () => {
    const g = createGame({ seed: 3, playerBonus: [findDef('r_lizard')!], upgrades: { r_lizard: 1 } });
    const mine = playerCards(g);
    expect(mine.some((c) => base(c.id) === 'r_lizard_t1')).toBe(true);
    expect(mine.some((c) => base(c.id) === 'r_lizard')).toBe(false);
  });
});

describe('upgrades — chain data integrity', () => {
  const keys = Object.keys(UPGRADES);

  it('every chain key is a resolvable card and every def follows the conventions', () => {
    for (const key of keys) {
      const from = findDef(key);
      const to = UPGRADES[key];
      expect(from, `unknown upgrade key ${key}`).toBeDefined();
      expect(to.id).toMatch(/_t\d$/);
      expect(to.role, `${key} → ${to.id} changes role`).toBe(from!.role); // grammar must not notice
      expect(to.tier).toBe((from!.tier ?? 0) + 1); // +/++ badge tracks steps from the original
    }
  });

  it('chains terminate (no cycles)', () => {
    for (const key of keys) {
      let id = key;
      let steps = 0;
      while (UPGRADES[id]) {
        id = UPGRADES[id].id;
        expect(++steps).toBeLessThan(10);
      }
    }
  });

  it('power only rises along a chain (punchier text, stronger stats)', () => {
    for (const key of keys) {
      const from = findDef(key)!;
      const to = UPGRADES[key];
      expect(to.ceiling ?? 0, `${to.id} ceiling`).toBeGreaterThanOrEqual(from.ceiling ?? 0);
      if (to.role === 'predicate' && !to.open) {
        expect(Math.abs(to.sentiment ?? 0), `${to.id} sentiment`).toBeGreaterThan(Math.abs(from.sentiment ?? 0));
        expect(Math.sign(to.sentiment ?? 0), `${to.id} flipped polarity`).toBe(Math.sign(from.sentiment ?? 0));
      }
      if (to.role === 'np') {
        expect(to.side, `${to.id} switched sides`).toBe(from.side);
        expect(to.intensity ?? 1, `${to.id} intensity`).toBeGreaterThanOrEqual(from.intensity ?? 1);
      }
      if (to.role === 'modifier') {
        expect(Math.abs(to.sentiment ?? 0), `${to.id} sentiment`).toBeGreaterThanOrEqual(Math.abs(from.sentiment ?? 0));
      }
    }
  });

  it('upgraded defs never leak into decks, pools, or draft rewards', () => {
    const upgraded = new Set(UPGRADE_DEFS.map((c) => c.id));
    const leak = (cards: Card[]) => cards.filter((c) => upgraded.has(base(c.id)));
    expect(leak(ALL)).toEqual([]); // keeps them out of the tutorial pool's ALL sampling
    expect(leak(REWARDS)).toEqual([]);
    expect(leak(buildSharedDeck())).toEqual([]);
    for (const style of [undefined, 'brag', 'attack', 'pander'] as const) {
      expect(leak(buildPrivateDeck(style))).toEqual([]);
    }
    // …and every upgraded id is globally unique (no collision with an authored card).
    for (const id of upgraded) expect(ALL.some((c) => c.id === id), `${id} collides`).toBe(false);
  });

  it('every upgraded def renders a card face label', () => {
    for (const c of UPGRADE_DEFS) expect(cardLabel(c).trim().length, c.id).toBeGreaterThan(0);
  });
});
