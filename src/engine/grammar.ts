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
//   PREDS -> PRED | PREDS CCAND PRED
//   PRED  -> PC | PO NP            (PC = closed predicate, PO = open predicate)

type Term = 'NP' | 'PC' | 'PO' | 'CCAND' | 'CJOIN' | 'INT';
const TERMS = new Set<Term>(['NP', 'PC', 'PO', 'CCAND', 'CJOIN', 'INT']);

/** The part(s) of speech a card can play. */
export function rolesOf(card: Card): Role[] {
  return [card.role];
}

function termOfRole(r: Role, card: Card): Term {
  switch (r) {
    case 'np':
      return 'NP';
    case 'predicate':
      return card.open ? 'PO' : 'PC';
    case 'connector':
      return card.conj === 'and' ? 'CCAND' : 'CJOIN';
    case 'intensifier':
      return 'INT';
    case 'powerup':
      return 'INT'; // never placed in the line; value is irrelevant
  }
}
const termsAt = (card: Card): Term[] => rolesOf(card).map((r) => termOfRole(r, card));

const GRAMMAR: Record<string, string[][]> = {
  TOP: [['S'], ['S', 'INT']],
  S: [['CLAUSE'], ['S', 'CCAND', 'CLAUSE'], ['S', 'CJOIN', 'CLAUSE']],
  CLAUSE: [['NP', 'PREDS']],
  PREDS: [['PRED'], ['PREDS', 'CCAND', 'PRED']],
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

/** Does the connector at `i` open a new clause (vs. coordinate predicates)? */
function isClauseJoin(tokens: Card[], i: number): boolean {
  const c = tokens[i];
  if (c.conj && c.conj !== 'and') return true; // because / and therefore / but
  const next = tokens[i + 1];
  return !!next && next.role === 'np'; // "and" + a new subject => a new clause
}

export type TokenRole = 'subject' | 'object' | 'pred' | 'conn' | 'int';

interface Seg {
  subjectIdx?: number;
  preds: { predIdx: number; objIdx?: number }[];
}

export function segmentDetailed(tokens: Card[]): { clauses: Seg[]; roleAt: TokenRole[] } {
  const clauses: Seg[] = [];
  const roleAt: TokenRole[] = [];
  let cur: Seg = { preds: [] };
  let started = false;
  let open: { predIdx: number; objIdx?: number } | null = null; // predicate awaiting an object
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
      case 'predicate': {
        const p = { predIdx: i };
        cur.preds.push(p);
        roleAt[i] = 'pred';
        started = true;
        open = t.open ? p : null;
        break;
      }
      case 'connector':
        roleAt[i] = 'conn';
        open = null;
        if (isClauseJoin(tokens, i)) {
          push();
          cur = { preds: [] };
          started = false;
        }
        break;
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
    preds: s.preds.map((p) => ({
      card: tokens[p.predIdx],
      object: p.objIdx !== undefined ? tokens[p.objIdx] : undefined,
    })),
  }));
  return { clauses };
}
