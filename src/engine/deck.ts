import type { Card } from './types';
import {
  SUBJECTS,
  OBJECTS,
  COMMON_PRAISE,
  COMMON_INSULTS,
  SIG_BRAG,
  SIG_ATTACK,
  SIG_PANDER,
  SIG_SUBJ_BRAG,
  SIG_SUBJ_ATTACK,
  SIG_SUBJ_PANDER,
  SIG_OBJECTS,
  OPEN_PREDS,
  CONNECTORS,
  INTENSIFIERS,
  POWERUPS,
  findDef,
} from '../data/cards';

// Deck construction + shuffling. Decks are plain Card[] arrays of unique
// instances; a seedable RNG keeps games reproducible (and tests deterministic).

export type Rng = () => number;

/** mulberry32 — small, fast, seedable PRNG. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

let instanceCounter = 0;

/** Create `count` unique instances of a base card definition. */
export function instances(base: Card, count: number): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ ...base, id: `${base.id}#${instanceCounter++}` });
  }
  return out;
}

function byId(baseId: string): Card {
  const def = findDef(baseId);
  if (!def) throw new Error(`unknown card: ${baseId}`);
  return def;
}

const each = (cards: Card[], n = 1): Card[] => cards.flatMap((c) => instances(c, n));

/**
 * The shared (contested) deck holds the connective tissue everyone fights over —
 * subjects, objects, connectors, finishers, open predicates — plus only the
 * COMMON ("stump speech") predicates. Signature zingers are NOT here.
 */
export function buildSharedDeck(): Card[] {
  return [
    ...each(SUBJECTS),
    ...each(OBJECTS),
    ...each(CONNECTORS),
    ...each(INTENSIFIERS, 2), // contested finishers — worth fighting over
    ...each(OPEN_PREDS),
    ...each(COMMON_PRAISE),
    ...each(COMMON_INSULTS),
  ];
}

const subs = (...ids: string[]): Card[] => ids.flatMap((id) => instances(byId(id), 1));

/**
 * Private decks are a player's own SIGNATURE zingers (exclusive — never in the
 * shared pool) plus power-ups and a few subjects. An opponent's `style` makes its
 * deck mostly that archetype's signatures; the player (no style) gets a full
 * spread across all three for variety.
 */
export function buildPrivateDeck(style?: 'brag' | 'attack' | 'pander'): Card[] {
  const powerups = each(POWERUPS); // every deck carries the one-shot action cards
  switch (style) {
    case 'brag':
      return [...each(SIG_BRAG, 2), ...each(SIG_PANDER), ...each(SIG_SUBJ_BRAG), ...subs('s_i', 's_admin', 'o_freedom'), ...powerups];
    case 'attack':
      return [...each(SIG_ATTACK, 2), ...each(SIG_BRAG), ...each(SIG_SUBJ_ATTACK), ...each(SIG_OBJECTS), ...subs('s_opp', 's_career', 'o_satan'), ...powerups];
    case 'pander':
      return [...each(SIG_PANDER, 2), ...each(SIG_BRAG), ...each(SIG_SUBJ_PANDER), ...subs('s_people', 's_families', 'o_freedom'), ...powerups];
    default:
      return [
        ...each(SIG_BRAG),
        ...each(SIG_ATTACK),
        ...each(SIG_PANDER),
        ...each(SIG_SUBJ_BRAG),
        ...each(SIG_SUBJ_ATTACK),
        ...each(SIG_SUBJ_PANDER),
        ...each(SIG_OBJECTS),
        ...subs('s_opp', 's_i', 'o_satan', 'o_freedom'),
        ...powerups,
      ];
  }
}

/** Move up to `upTo - target.length` cards from the front of `deck` into `target`. */
export function refill(deck: Card[], target: Card[], upTo: number): void {
  while (target.length < upTo && deck.length > 0) {
    target.push(deck.shift()!);
  }
}
