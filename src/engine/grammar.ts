import type { Card, Clause, Role, SentenceStructure } from './types';

// Chunk grammar. A statement is a subject noun phrase followed by chunky
// predicates; predicates may share a subject (joined by "and") or open new
// clauses (joined by "because"/"and therefore"/"but"). Open predicates take an
// object. Validity/completeness drive the AI; the player builds freeform and the
// audience judges the result.
//
//   TOP   -> S | S INT
//   S     -> CLAUSE | S CCAND CLAUSE | S CJOIN CLAUSE | S CBEC CLAUSE | S CPERIOD CLAUSE
//   CLAUSE-> NP PREDS
//   PREDS -> PRED | PREDS CCAND PRED | PREDS CJOIN PRED
//   PRED  -> PC | PO NP            (PC = closed predicate, PO = open predicate)
//
// A coordinating conjunction (CCAND "and", or CJOIN "and therefore"/"but") followed by a
// new subject (NP) opens a new clause; followed by a predicate it coordinates within the
// clause, sharing the subject ("the swamp eats crayons and therefore will destroy this
// country"). A *period* (CPERIOD) and *"because"* (CBEC) are clause-only: they can ONLY
// open a new clause and so always need their own subject — "because" subordinates a full
// clause and can't elide the subject ("…a jackass because *they* want to raise taxes"), so
// it never strings bare predicates into fragments (CBEC is absent from the PREDS rules).

type Term = 'NP' | 'MOD' | 'PC' | 'PO' | 'CCAND' | 'CJOIN' | 'CBEC' | 'CPERIOD' | 'INT';
const TERMS = new Set<Term>(['NP', 'MOD', 'PC', 'PO', 'CCAND', 'CJOIN', 'CBEC', 'CPERIOD', 'INT']);

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
      // 'and' coordinates predicates (CCAND); 'period' and 'because' only join full
      // clauses (CPERIOD / CBEC — each needs its own subject); the rest — and therefore
      // / but — are CJOIN (can both join clauses and coordinate predicates under a
      // shared subject).
      if (card.conj === 'and') return 'CCAND';
      if (card.conj === 'period') return 'CPERIOD';
      if (card.conj === 'because') return 'CBEC';
      return 'CJOIN';
    case 'intensifier':
      return 'INT';
    case 'powerup':
      return 'INT'; // never placed in the line; value is irrelevant
  }
}
/** Connector term implied by a card's `conj` (shared by real connectors & dual-role asides). */
function connTerm(conj: NonNullable<Card['conj']>): Term {
  return conj === 'and' ? 'CCAND' : conj === 'period' ? 'CPERIOD' : conj === 'because' ? 'CBEC' : 'CJOIN';
}

function termsAt(card: Card): Term[] {
  const terms = rolesOf(card).map((r) => termOfRole(r, card));
  // A dual-role parenthetical (a modifier authored with a `conj`) can ALSO act as a
  // coordinating conjunction mid-line: "…fight a bear, and I'm not making this up, my
  // opponent naps…". The Earley chart tries both readings; the segmenter picks by position.
  if (card.conj && card.role !== 'connector') {
    const t = connTerm(card.conj);
    if (!terms.includes(t)) terms.push(t);
  }
  return terms;
}

const GRAMMAR: Record<string, string[][]> = {
  TOP: [['S'], ['S', 'INT']],
  S: [['CLAUSE'], ['S', 'CCAND', 'CLAUSE'], ['S', 'CJOIN', 'CLAUSE'], ['S', 'CBEC', 'CLAUSE'], ['S', 'CPERIOD', 'CLAUSE']],
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

/**
 * Index of the first token where the line stops being a valid prefix of any
 * grammatical sentence — i.e. exactly where parsing breaks (a stray second subject,
 * a `because` with no subject after it, word salad). Returns -1 if the whole line is
 * still a valid prefix (merely unfinished, not wrong). Drives the resolution "???"
 * highlight on a confused statement.
 */
export function firstInvalidIndex(tokens: Card[]): number {
  const sets = setsOf(tokens);
  for (let i = 0; i < tokens.length; i++) {
    if (!analyze(sets.slice(0, i + 1)).valid) return i;
  }
  return -1;
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
        // A dual-role parenthetical (a `conj` modifier) used PAST the subject-aside slot
        // (the clause already has predicates) acts as a coordinating conjunction — exactly
        // like the 'connector' case below. Otherwise it's a normal post-nominal subject aside.
        if (t.conj && cur.preds.length > 0) {
          roleAt[i] = 'conn';
          open = null;
          const conj = t.conj;
          const next = tokens[i + 1];
          if (conj === 'because' || (next && next.role === 'np')) {
            push();
            cur = { mods: [], preds: [], joinedBy: conj, connIdx: i };
            started = false;
            pendingConn = undefined;
            pendingConnIdx = undefined;
          } else {
            pendingConn = conj;
            pendingConnIdx = i;
          }
        } else {
          roleAt[i] = 'mod';
          open = null;
          cur.mods.push(i);
          started = true;
        }
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
        // A period and "because" are hard clause boundaries (always a new clause, always
        // needing their own subject). A coordinating conjunction opens a new clause only
        // when a fresh subject follows; otherwise it coordinates the next predicate under
        // the shared subject.
        if (conj === 'period' || conj === 'because' || (next && next.role === 'np')) {
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
