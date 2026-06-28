import type { Card, Clause, Role, SentenceStructure } from './types';

// Chunk grammar. A statement is a subject noun phrase followed by chunky
// predicates; predicates may share a subject (joined by "and") or open new
// clauses (joined by "because"/"and therefore"/"but"). Open predicates take an
// object. Validity/completeness drive the AI; the player builds freeform and the
// audience judges the result.
//
//   TOP   -> S | S INT
//   S     -> CLAUSE | S CCAND CLAUSE | S CJOIN CLAUSE
//   CLAUSE-> NP PREDS
//   PREDS -> PRED | PREDS CCAND PRED | PREDS CJOIN PRED
//   PRED  -> PC | PO NP            (PC = closed predicate, PO = open predicate)
//
// A *conjunction* followed by a new subject (NP) opens a new clause; followed by a
// predicate it coordinates within the clause, sharing the subject ("the swamp eats
// crayons and therefore will destroy this country"). A *period* is a sentence
// boundary: it can ONLY open a new clause, and so always needs its own subject —
// it never strings bare predicates into fragments.

type Term = 'NP' | 'MOD' | 'PC' | 'PO' | 'CCAND' | 'CJOIN' | 'CPERIOD' | 'INT';
const TERMS = new Set<Term>(['NP', 'MOD', 'PC', 'PO', 'CCAND', 'CJOIN', 'CPERIOD', 'INT']);

/** The part(s) of speech a card can play. */
export function rolesOf(card: Card): Role[] {
  return [card.role];
}

function termOfRole(r: Role, card: Card): Term {
  switch (r) {
    case 'np':
      return 'NP';
    case 'modifier':
      return 'MOD';
    case 'predicate':
      return card.open ? 'PO' : 'PC';
    case 'connector':
      // 'and' coordinates predicates (CCAND); 'period' only joins full clauses
      // (CPERIOD); the rest — because / and therefore / but — are CJOIN (which can
      // both join clauses and coordinate predicates under a shared subject).
      if (card.conj === 'and') return 'CCAND';
      if (card.conj === 'period') return 'CPERIOD';
      return 'CJOIN';
    case 'intensifier':
      return 'INT';
    case 'powerup':
      return 'INT'; // never placed in the line; value is irrelevant
  }
}
const termsAt = (card: Card): Term[] => rolesOf(card).map((r) => termOfRole(r, card));

const GRAMMAR: Record<string, string[][]> = {
  TOP: [['S'], ['S', 'INT']],
  S: [['CLAUSE'], ['S', 'CCAND', 'CLAUSE'], ['S', 'CJOIN', 'CLAUSE'], ['S', 'CPERIOD', 'CLAUSE']],
  // A subject may carry one or more post-nominal modifier asides before its predicates.
  CLAUSE: [['NP', 'PREDS'], ['NP', 'MODS', 'PREDS']],
  MODS: [['MOD'], ['MODS', 'MOD']],
  PREDS: [['PRED'], ['PREDS', 'CCAND', 'PRED'], ['PREDS', 'CJOIN', 'PRED']],
  PRED: [['PC'], ['PO', 'NP']],
};

const isTerminal = (s: string): s is Term => TERMS.has(s as Term);

interface Item {
  lhs: string;
  rhs: string[];
  dot: number;
  origin: number;
}
const key = (it: Item) => `${it.lhs}:${it.rhs.join(',')}:${it.dot}:${it.origin}`;

// Validity depends only on the per-position set of possible terminals; memoize.
const analysisCache = new Map<string, { valid: boolean; complete: boolean }>();

function analyze(termSets: Term[][]): { valid: boolean; complete: boolean } {
  if (termSets.length === 0) return { valid: true, complete: false };
  const cacheKey = termSets.map((s) => s.slice().sort().join('')).join('|');
  const hit = analysisCache.get(cacheKey);
  if (hit) return hit;
  const { sets, dead } = chartOf(termSets);
  const n = termSets.length;
  const complete =
    !dead && sets[n].some((it) => it.lhs === 'TOP' && it.dot === it.rhs.length && it.origin === 0);
  const res = { valid: !dead, complete };
  analysisCache.set(cacheKey, res);
  return res;
}

const setsOf = (tokens: Card[]): Term[][] => tokens.map(termsAt);

function chartOf(termSets: Term[][]): { sets: Item[][]; dead: boolean } {
  const n = termSets.length;
  const sets: Item[][] = Array.from({ length: n + 1 }, () => []);
  const seen: Set<string>[] = Array.from({ length: n + 1 }, () => new Set());
  const add = (i: number, it: Item) => {
    const k = key(it);
    if (!seen[i].has(k)) {
      seen[i].add(k);
      sets[i].push(it);
    }
  };

  for (const rhs of GRAMMAR.TOP) add(0, { lhs: 'TOP', rhs, dot: 0, origin: 0 });

  for (let i = 0; i <= n; i++) {
    for (let q = 0; q < sets[i].length; q++) {
      const it = sets[i][q];
      const sym = it.rhs[it.dot];
      if (sym === undefined) {
        for (const p of sets[it.origin]) {
          if (p.rhs[p.dot] === it.lhs) add(i, { ...p, dot: p.dot + 1 });
        }
      } else if (isTerminal(sym)) {
        if (i < n && termSets[i].includes(sym)) add(i + 1, { ...it, dot: it.dot + 1 });
      } else {
        for (const rhs of GRAMMAR[sym]) add(i, { lhs: sym, rhs, dot: 0, origin: i });
      }
    }
    if (i < n && sets[i + 1].length === 0) return { sets, dead: true };
  }
  return { sets, dead: false };
}

/** Is `tokens` a prefix of some grammatical sentence? (Used by the AI's search.) */
export function isValidPrefix(tokens: Card[]): boolean {
  return analyze(setsOf(tokens)).valid;
}

/** Is `tokens` a complete grammatical sentence? */
export function isComplete(tokens: Card[]): boolean {
  return analyze(setsOf(tokens)).complete;
}

/** Can `card` legally extend `tokens`? (Used by the AI.) */
export function canAppend(tokens: Card[], card: Card): boolean {
  return analyze([...setsOf(tokens), termsAt(card)]).valid;
}

// --- structural segmentation for scoring & rendering -----------------------

export type TokenRole = 'subject' | 'object' | 'mod' | 'pred' | 'conn' | 'int';

type Conj = NonNullable<Card['conj']>;

interface SegPred {
  predIdx: number;
  objIdx?: number;
  /** The connector coordinating this predicate with the prior one in the clause
   * (undefined for a clause's first predicate). */
  joinedBy?: Conj;
  /** Token index of that coordinating connector (for inline combo chips). */
  connIdx?: number;
}

interface Seg {
  subjectIdx?: number;
  /** Token indices of post-nominal modifier asides on this clause's subject. */
  mods: number[];
  preds: SegPred[];
  /** The clause-joining connector that opened this clause (undefined for the first). */
  joinedBy?: Conj;
  /** Token index of that clause-joining connector (for inline combo chips). */
  connIdx?: number;
}

export function segmentDetailed(tokens: Card[]): { clauses: Seg[]; roleAt: TokenRole[] } {
  const clauses: Seg[] = [];
  const roleAt: TokenRole[] = [];
  let cur: Seg = { mods: [], preds: [] };
  let started = false;
  let open: SegPred | null = null; // predicate awaiting an object
  let pendingConn: Conj | undefined; // a connector awaiting the predicate it coordinates
  let pendingConnIdx: number | undefined; // its token index
  const push = () => {
    if (started) clauses.push(cur);
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.role) {
      case 'np':
        if (open) {
          open.objIdx = i;
          roleAt[i] = 'object';
          open = null;
        } else if (cur.subjectIdx === undefined && cur.preds.length === 0) {
          cur.subjectIdx = i;
          roleAt[i] = 'subject';
          started = true;
        } else {
          // stray NP — attach as object to the last predicate if possible
          if (cur.preds.length > 0) {
            cur.preds[cur.preds.length - 1].objIdx = i;
            roleAt[i] = 'object';
          } else {
            cur.subjectIdx = i;
            roleAt[i] = 'subject';
            started = true;
          }
        }
        break;
      case 'modifier':
        // A post-nominal aside on the current clause's subject. It takes no object
        // and never coordinates predicates, so it just attaches to the clause.
        roleAt[i] = 'mod';
        open = null;
        cur.mods.push(i);
        started = true;
        break;
      case 'predicate': {
        const p: SegPred = { predIdx: i };
        // A predicate after the clause's first one is coordinated by the pending
        // connector (plain "and", or an elided "and therefore"/"but"/etc.).
        if (cur.preds.length > 0) {
          p.joinedBy = pendingConn ?? 'and';
          p.connIdx = pendingConnIdx;
        }
        pendingConn = undefined;
        pendingConnIdx = undefined;
        cur.preds.push(p);
        roleAt[i] = 'pred';
        started = true;
        open = t.open ? p : null;
        break;
      }
      case 'connector': {
        roleAt[i] = 'conn';
        open = null;
        const conj = t.conj ?? 'and';
        const next = tokens[i + 1];
        // A period is a hard sentence boundary (always a new clause). A conjunction
        // opens a new clause only when a fresh subject follows; otherwise it
        // coordinates the next predicate under the shared subject.
        if (conj === 'period' || (next && next.role === 'np')) {
          push();
          cur = { mods: [], preds: [], joinedBy: conj, connIdx: i };
          started = false;
          pendingConn = undefined;
          pendingConnIdx = undefined;
        } else {
          // Subject elided ("…and therefore will destroy…").
          pendingConn = conj;
          pendingConnIdx = i;
        }
        break;
      }
      case 'intensifier':
        roleAt[i] = 'int';
        break;
    }
  }
  push();
  return { clauses, roleAt };
}

export function parse(tokens: Card[]): SentenceStructure {
  const clauses: Clause[] = segmentDetailed(tokens).clauses.map((s) => ({
    subject: s.subjectIdx !== undefined ? tokens[s.subjectIdx] : undefined,
    subjectIdx: s.subjectIdx,
    mods: s.mods.length ? s.mods.map((i) => tokens[i]) : undefined,
    modIdxs: s.mods.length ? s.mods.slice() : undefined,
    joinedByPrev: s.joinedBy,
    connIdx: s.connIdx,
    preds: s.preds.map((p) => ({
      card: tokens[p.predIdx],
      predIdx: p.predIdx,
      object: p.objIdx !== undefined ? tokens[p.objIdx] : undefined,
      objIdx: p.objIdx,
      joinedBy: p.joinedBy,
      connIdx: p.connIdx,
    })),
  }));
  return { clauses };
}
