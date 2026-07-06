import type { Card, Clause, Role, SentenceStructure } from './types';

// Chunk grammar. A statement is a subject noun phrase followed by chunky
// predicates; predicates may share a subject ONLY when joined by "and", or open new
// clauses (joined by "because"/"and therefore"/"but"/"so"…). Open predicates take an
// object. Validity/completeness drive the AI; the player builds freeform and the
// audience judges the result.
//
//   TOP   -> S | S INT
//   S     -> CLAUSE | S CCAND CLAUSE | S CJOIN CLAUSE | S CBEC CLAUSE | S CPERIOD CLAUSE
//   CLAUSE-> SUBJ PREDS | SUBJ MODS PREDS
//   SUBJ  -> NP | SUBJ CCAND NP | SUBJ MODS CCAND NP   (compound subject)
//   PREDS -> PRED | PREDS CCAND PRED
//   PRED  -> PC | PO OBJ           (PC = closed predicate, PO = open predicate)
//   OBJ   -> NP | OBJ CCAND NP                          (compound object)
//
// ONLY plain "and" (CCAND) coordinates BARE PREDICATES under a shared, elided subject
// ("My opponent kicks puppies and eats babies" — one clause, one subject). Every OTHER
// conjunction — CJOIN ("and therefore"/"but"/"so"/"which is why"/…), CBEC ("because") and
// CPERIOD (period) — is CLAUSE-ONLY: it can only open a NEW clause and so always needs its
// own subject. That's the whole difference between CCAND and CJOIN now: CJOIN appears only
// in the S rule (clause-join), never in PREDS, so "…kicks puppies but eats babies" (bare
// predicate after "but", no new subject) is ungrammatical — a human would say "…but I
// protect them" (a full clause), and it stops the AI emitting weird elided fragments like
// "…is a hero but kicks puppies". "because" subordinating a full clause is the same rule.
// Plain "and" (ONLY "and") ALSO coordinates noun phrases: a compound subject ("Satan and
// the lobbyists want to silence free speech") or a compound object ("…wants to destroy
// Main Street and our children"); the segmenter disambiguates object-coordination from a
// new clause by lookahead (an NP followed by its own predicate/modifier opens a clause).

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
      // 'and' coordinates predicates (CCAND); everything else is clause-only. 'period'
      // and 'because' are CPERIOD / CBEC; the rest — and therefore / but / so / … — are
      // CJOIN. CJOIN joins full clauses but (unlike CCAND) can NOT coordinate bare
      // predicates under a shared subject — each side needs its own subject.
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
  CLAUSE: [['SUBJ', 'PREDS'], ['SUBJ', 'MODS', 'PREDS']],
  // "and" coordinates noun phrases into compound subjects/objects. The SUBJ MODS CCAND NP
  // rule lets an aside sit mid-compound ("Satan, who is shady, and the lobbyists want…").
  SUBJ: [['NP'], ['SUBJ', 'CCAND', 'NP'], ['SUBJ', 'MODS', 'CCAND', 'NP']],
  MODS: [['MOD'], ['MODS', 'MOD']],
  // ONLY CCAND ("and") coordinates bare predicates under a shared subject; CJOIN
  // ("and therefore"/"but"/"so"/…) is clause-only (S rule), so it needs its own subject.
  PREDS: [['PRED'], ['PREDS', 'CCAND', 'PRED']],
  PRED: [['PC'], ['PO', 'OBJ']],
  OBJ: [['NP'], ['OBJ', 'CCAND', 'NP']],
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

/** An extra NP coordinated onto a subject/object slot (`connIdx` = its "and" token;
 * absent when a stray NP was jammed on with no connector — lenient intent-reading). */
interface SegCoord {
  npIdx: number;
  connIdx?: number;
}

interface SegPred {
  predIdx: number;
  objIdx?: number;
  /** Extra objects coordinated with "and" ("…destroy Main Street AND OUR CHILDREN"). */
  coObj?: SegCoord[];
  /** The connector coordinating this predicate with the prior one in the clause
   * (undefined for a clause's first predicate). */
  joinedBy?: Conj;
  /** Token index of that coordinating connector (for inline combo chips). */
  connIdx?: number;
}

interface Seg {
  subjectIdx?: number;
  /** Extra subjects coordinated with "and" ("Satan AND THE LOBBYISTS want…"). */
  coSubj?: SegCoord[];
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
  // An "and" that coordinates noun phrases: the next NP extends the compound
  // subject/object instead of opening a new clause.
  let coordNext: { into: 'subj' | 'obj'; connIdx: number } | null = null;
  const push = () => {
    if (started) clauses.push(cur);
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.role) {
      case 'np':
        if (coordNext) {
          if (coordNext.into === 'subj') {
            (cur.coSubj ??= []).push({ npIdx: i, connIdx: coordNext.connIdx });
            roleAt[i] = 'subject';
          } else {
            (cur.preds[cur.preds.length - 1].coObj ??= []).push({ npIdx: i, connIdx: coordNext.connIdx });
            roleAt[i] = 'object';
          }
          coordNext = null;
        } else if (open) {
          open.objIdx = i;
          roleAt[i] = 'object';
          open = null;
        } else if (cur.subjectIdx === undefined && cur.preds.length === 0) {
          cur.subjectIdx = i;
          roleAt[i] = 'subject';
          started = true;
        } else {
          // Stray NP (no "and" before it — that's handled by coordNext above): keep the
          // lenient nearest-noun reading — attach as object to the last predicate, or
          // replace the subject. NOT read as a compound: a connector-less jam is a parse
          // artifact, and treating it as "you named the crowd" would let the blunder
          // punch-through hammer word salad that never earned it.
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
          // Only "and" elides a shared subject; every other conjunction opens a new clause.
          if (conj !== 'and' || (next && next.role === 'np')) {
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
        // Plain "and" followed by a noun phrase may coordinate NPs rather than open a
        // new clause: pre-predicate it extends the SUBJECT ("Satan AND the lobbyists
        // want…"); after an open predicate's object it extends the OBJECT ("…destroy
        // Main Street AND our children") — unless that NP starts a clause of its own
        // (it's followed by its own predicate/modifier: "…and our children suffer").
        if (conj === 'and' && next && next.role === 'np') {
          if (cur.subjectIdx !== undefined && cur.preds.length === 0) {
            coordNext = { into: 'subj', connIdx: i };
            break;
          }
          const last = cur.preds[cur.preds.length - 1];
          const after = tokens[i + 2];
          const opensClause = !!after && (after.role === 'predicate' || after.role === 'modifier');
          if (last && last.objIdx !== undefined && !opensClause) {
            coordNext = { into: 'obj', connIdx: i };
            break;
          }
        }
        // ONLY plain "and" coordinates a bare predicate under a shared, elided subject;
        // every other conjunction (period / because / but / and therefore / so / …) is a
        // hard clause boundary — always a new clause, always needing its own subject. An
        // "and" opens a new clause only when a fresh subject follows; otherwise it elides.
        if (conj !== 'and' || (next && next.role === 'np')) {
          push();
          cur = { mods: [], preds: [], joinedBy: conj, connIdx: i };
          started = false;
          pendingConn = undefined;
          pendingConnIdx = undefined;
        } else {
          // Subject elided ("…and eats babies").
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
  const co = (xs?: SegCoord[]) =>
    xs?.map((x) => ({ card: tokens[x.npIdx], idx: x.npIdx, connIdx: x.connIdx }));
  const clauses: Clause[] = segmentDetailed(tokens).clauses.map((s) => ({
    subject: s.subjectIdx !== undefined ? tokens[s.subjectIdx] : undefined,
    subjectIdx: s.subjectIdx,
    coSubjects: co(s.coSubj),
    mods: s.mods.length ? s.mods.map((i) => tokens[i]) : undefined,
    modIdxs: s.mods.length ? s.mods.slice() : undefined,
    joinedByPrev: s.joinedBy,
    connIdx: s.connIdx,
    preds: s.preds.map((p) => ({
      card: tokens[p.predIdx],
      predIdx: p.predIdx,
      object: p.objIdx !== undefined ? tokens[p.objIdx] : undefined,
      objIdx: p.objIdx,
      coObjects: co(p.coObj),
      joinedBy: p.joinedBy,
      connIdx: p.connIdx,
    })),
  }));
  return { clauses };
}
