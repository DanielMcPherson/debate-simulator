import type { Card, GameEvent, GameState, Move, PlayerId, PlayerState } from './types';
import { isComplete, canAppend } from './grammar';
import { scoreStatement } from './scoring';
import { renderSentence, cardLabel } from './morphology';
import { TOPICS, OPPONENTS, CROWDS, ALL, findDef, PERIOD, PERIOD_ENABLED } from '../data/cards';
import {
  buildPrivateDeck,
  buildSharedDeck,
  instances,
  makeRng,
  refill,
  shuffle,
  type Rng,
} from './deck';

export interface GameOptions {
  seed?: number;
  poolSize?: number;
  handSize?: number;
  maxRounds?: number;
  /** Force a specific opponent/crowd (otherwise chosen at random per debate). */
  opponentId?: string;
  crowdId?: string;
  /** Reward cards (base defs) carried from the run, added to the player's deck. */
  playerBonus?: Card[];
  /** Base ids the player cut from their deck via the Debate Consultant. */
  removedCards?: string[];
  /** First-debate onboarding (guaranteed first hand + simple opponent on Q1). */
  tutorial?: boolean;
}

/** Pick `n` distinct random items from `arr` using the seeded rng. */
function pickDistinct<T>(arr: T[], n: number, rng: () => number): T[] {
  const copy = arr.slice();
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  return out;
}

/** The onboarding pool for the FIRST question: a generous, randomized toolkit so the player
 * can build a "me-good AND opponent-bad (+ finisher)" combo straight from the SHARED POOL —
 * subjects + brag/attack verbs vary each game; the connector & finisher are safe because the
 * Q1 opponent (tutorialSimple) never plays them. Two of each contested type avoids a dead-end
 * if the AI grabs one. Played on the forced 'jackass' topic so the attack clause is on-topic. */
function buildTutorialPool(rng: () => number): Card[] {
  const closedPred = (sign: number) =>
    ALL.filter((c) => c.role === 'predicate' && !c.open && Math.sign(c.sentiment ?? 0) === sign);
  const blocks: Card[] = [
    ...pickDistinct(ALL.filter((c) => c.role === 'np' && c.side === 'self'), 2, rng), // brag subjects
    ...pickDistinct(ALL.filter((c) => c.role === 'np' && c.side === 'opponent'), 2, rng), // attack subjects
    ...pickDistinct(closedPred(1), 2, rng), // "me good" verbs
    ...pickDistinct(closedPred(-1), 2, rng), // "opponent bad" verbs
    findDef('c_and')!, // the connector to chain a combo (AI won't contest it on Q1)
    ...pickDistinct(ALL.filter((c) => c.role === 'intensifier'), 1, rng), // one finisher
  ];
  return shuffle(blocks, rng).flatMap((c) => instances(c, 1));
}

// The RNG lives alongside the state so a save/restore could persist it; for the
// prototype we keep a module-side map keyed by the state object.
const rngFor = new WeakMap<GameState, Rng>();

/** The game's seeded RNG (for ai.ts's gaffe rolls — keeps the AI deterministic). */
export function gameRng(state: GameState): Rng {
  return rngFor.get(state)!;
}

/** Append a structured event to the analytics/debug trail (stamped with the round).
 * Auto-attaches the acting player's available power-ups (so a log can answer "did I
 * even have a Typo when I thought I played one?"). */
function logEvent(state: GameState, t: GameEvent['t'], data: Record<string, unknown> = {}): void {
  const by = data.by as PlayerId | undefined;
  const powerups = by ? state[by].hand.filter((c) => c.role === 'powerup').map((c) => c.effect) : undefined;
  state.events.push({ t, round: state.round, ...(powerups ? { powerups } : {}), ...data });
}

function newPlayer(id: PlayerId): PlayerState {
  return { id, deck: [], hand: [], discard: [], line: [], done: false };
}

function dealRound(state: GameState): void {
  const rng = rngFor.get(state)!;
  // Each question gets ONE deal that does not replenish — scarcity is the source
  // of pressure (you may be forced to finish with a bad card).
  const tutorialQ1 = !!state.tutorial && state.round === 1;
  // Onboarding Q1: force a name-calling question so the attack clause of the taught combo is
  // on-topic (no confusing OFF-TOPIC badge), and pairs naturally ("why is your opponent…?").
  state.topic = tutorialQ1 ? TOPICS.find((t) => t.id === 'jackass') ?? TOPICS[0] : TOPICS[Math.floor(rng() * TOPICS.length)];
  state.sharedDeck = shuffle(buildSharedDeck(), rng);
  state.pool = [];
  refill(state.sharedDeck, state.pool, state.poolSize);
  // Order matters: insert the topic card FIRST (it pops a pool card to make room),
  // THEN re-assert playability last so a topic swap can't evict the only subject.
  ensurePoolHasTopic(state, state.topic.id);
  ensurePoolPlayable(state);
  capPoolFinishers(state); // at most one finisher on the board — keep the race-for-it tension
  capPoolModifiers(state); // at most two asides — don't let flavor crowd out nouns/verbs
  // Onboarding Q1: replace the pool with the randomized combo toolkit (see buildTutorialPool).
  if (tutorialQ1) state.pool = buildTutorialPool(rng);

  for (const p of [state.player, state.ai]) {
    // The opponent's private deck is tilted toward its debating style.
    const style = p.id === 'ai' ? state.opponent?.style : undefined;
    // PERSISTENT deck, built EXACTLY ONCE (the first deal, when nothing is in
    // circulation yet). Thereafter it is self-sustaining and never rebuilt:
    // unplayed hand cards return to the draw pile, and played cards (parked in
    // `discard` at resolution) reshuffle back in when the pile runs low. Minting a
    // fresh private deck each time was the duplication bug — it stacked new copies
    // of every signature card onto the leftovers (3+ "phone call" cards in a hand).
    // Power-ups consumed and cards lost to Forgot My Line never re-enter, so the
    // private deck only ever shrinks (a played Plant doesn't come back).
    if (p.deck.length === 0 && p.hand.length === 0 && p.discard.length === 0) {
      // The player's earned reward cards (fresh instances) are shuffled in too.
      const bonus = p.id === 'player' ? (state.playerBonus ?? []).flatMap((c) => instances(c, 1)) : [];
      let built = [...buildPrivateDeck(style), ...bonus];
      // Debate Consultant: the player has cut some cards from their deck (by base id).
      if (p.id === 'player' && state.removedCards?.length) {
        const cut = new Set(state.removedCards);
        built = built.filter((c) => !cut.has(c.id.split('#')[0]));
      }
      p.deck = shuffle(built, rng).map((c) => ({ ...c, priv: true }));
    } else {
      // Recycle last question's unplayed PRIVATE hand cards back into the draw pile.
      // Non-priv injections (Filibuster's bonus connectors) are one-shot — they don't
      // become permanent deck residents.
      p.deck.push(...p.hand.filter((c) => c.priv));
      // …and if that still can't fill a hand, fold the discard pile back in.
      if (p.deck.length < state.handSize && p.discard.length > 0) {
        p.deck = shuffle([...p.deck, ...p.discard], rng);
        p.discard = [];
      }
    }
    p.hand = [];
    refill(p.deck, p.hand, state.handSize);
    ensureHandHasOpener(p); // a private, can't-be-contested-away subject to start with
    // Onboarding: keep the player's FIRST hand simple — no special action cards (power-ups).
    if (tutorialQ1 && p.id === 'player' && p.hand.some((c) => c.role === 'powerup')) {
      p.deck.push(...p.hand.filter((c) => c.role === 'powerup'));
      p.hand = p.hand.filter((c) => c.role !== 'powerup');
      for (let i = p.deck.length - 1; i >= 0 && p.hand.length < state.handSize; i--) {
        if (p.deck[i].role !== 'powerup') p.hand.push(p.deck.splice(i, 1)[0]); // backfill with normal cards
      }
    }
    p.line = [];
    p.usedPeriod = false;
    p.gaffing = false;
    p.nextMultiplier = undefined;
    p.knowsOppHand = false; // Hot Mic reveal lasts only the question it's played
    p.done = false;
    p.lastReaction = undefined;
    // knowsCrowd persists for the whole debate (Plant reveals it once).
  }
  // Alternate who speaks first each question so the player doesn't always get
  // first dibs on a contested on-topic card (odd questions player, even AI).
  state.turn = state.round % 2 === 1 ? 'player' : 'ai';
  // Pick a moderator phrasing LAST (after all card deals) so it doesn't perturb
  // the deterministic deal for a given seed.
  state.question = state.topic.questions[Math.floor(rng() * state.topic.questions.length)];
  logEvent(state, 'deal', {
    topic: state.topic.id,
    question: state.question,
    crowdLoves: state.crowd?.loves, // the HIDDEN taste — recorded for analysis only
    opponent: state.opponent?.id,
    first: state.turn,
    playerHand: state.player.hand.map(cardLabel),
    aiHand: state.ai.hand.map(cardLabel),
  });
}

/**
 * Ensure the pool holds at least `n` cards matching `pred`, swapping the shortfall
 * in from the deck. Evicts from the END, skipping any `protect`ed card so filling
 * one guarantee can't void another (and so filler — objects/asides — is pushed out
 * in favour of the structural cards we actually want more of).
 */
function ensurePool(state: GameState, pred: (c: Card) => boolean, n = 1, protect?: (c: Card) => boolean): void {
  while (state.pool.filter(pred).length < n) {
    const idx = state.sharedDeck.findIndex(pred);
    if (idx === -1) return; // deck exhausted of this kind
    const card = state.sharedDeck.splice(idx, 1)[0];
    let victim = state.pool.length - 1;
    if (protect) {
      for (let i = state.pool.length - 1; i >= 0; i--) {
        if (!protect(state.pool[i])) { victim = i; break; }
      }
    }
    const removed = state.pool.splice(victim, 1)[0];
    if (removed) state.sharedDeck.push(removed);
    state.pool.unshift(card);
  }
}

const isSubjectCard = (c: Card) => c.role === 'np' && !!c.side && c.side !== 'neutral';
const isPredicateCard = (c: Card) => c.role === 'predicate';

/**
 * Guarantee the pool is comfortably *buildable*, not just barely completable: enough
 * subjects and verbs to assemble a two-clause combo from the pool, plus a connector to
 * join it. Floors (not exact counts) — a richer random draw is left alone. Structural
 * cards are protected from eviction, so the shortfall is filled by ejecting filler
 * (objects, asides, spare finishers) rather than the nouns/verbs we're short on.
 */
function ensurePoolPlayable(state: GameState): void {
  const isCompletePred = (c: Card) => c.role === 'predicate' && !c.open;
  const isConnector = (c: Card) => c.role === 'connector';
  // Never evict the on-topic card or any subject/verb/connector — those are exactly
  // what we want the pool stocked with, so eviction targets filler instead.
  const protect = (c: Card) =>
    !!(state.topic && c.topics?.includes(state.topic.id)) ||
    isSubjectCard(c) ||
    isPredicateCard(c) ||
    isConnector(c);
  // Floors scale with the (larger, no-recess) pool so two players can each build a
  // multi-clause combo from one non-replenishing deal.
  ensurePool(state, isSubjectCard, 3, protect); // ≥3 subjects → enough to open several clauses
  ensurePool(state, isCompletePred, 1, protect); // ≥1 CLOSED predicate (open preds need an object)
  ensurePool(state, isPredicateCard, 3, protect); // ≥3 verbs total → clauses can land
  ensurePool(state, isConnector, 2, protect); // ≥2 connectors so a combo chain is always reachable
}

/**
 * Guarantee a player's HAND can open a statement: at least one sided subject. The
 * pool's guaranteed subjects are CONTESTED (the speaker who goes first may take them),
 * so a private opener in hand prevents a mid-question lockout where you can't even
 * start. Pulls one from the draw pile (then the discard) and
 * returns the displaced card, so hand size is unchanged.
 */
function ensureHandHasOpener(p: PlayerState): void {
  const isSubject = (c: Card) => c.role === 'np' && !!c.side && c.side !== 'neutral';
  if (p.hand.some(isSubject)) return;
  let src = p.deck;
  let idx = src.findIndex(isSubject);
  if (idx === -1) { src = p.discard; idx = src.findIndex(isSubject); }
  if (idx === -1) return; // no subject anywhere (shouldn't happen — private decks carry subjects)
  const card = src.splice(idx, 1)[0];
  const removed = p.hand.pop();
  if (removed) p.deck.push(removed);
  p.hand.unshift(card);
}

/**
 * Cap the pool at a SINGLE finisher. A finisher is a contested prize whose value
 * grows the bigger your statement (multiplicative ×factor), so the tension is the
 * race to grab the one on the board before the opponent does. Seeing two or three
 * removes that risk entirely — so evict the extras, swapping each for a non-finisher
 * from the deck (and returning the evicted finisher to the deck).
 */
function capPoolFinishers(state: GameState): void {
  capPoolRole(state, (c) => c.role === 'intensifier', 1);
}

/**
 * Asides (modifiers) are flavorful but non-load-bearing; a pool with 3–4 of them
 * crowds out the nouns and verbs you need to build. Cap them so they stay a garnish.
 */
function capPoolModifiers(state: GameState): void {
  capPoolRole(state, (c) => c.role === 'modifier', 2);
}

/** Keep at most `max` pool cards matching `is`, swapping the excess for non-matching
 * cards from the deck (in place, so other guarantees' indices stay valid). */
function capPoolRole(state: GameState, is: (c: Card) => boolean, max: number): void {
  const idxs = state.pool.map((c, i) => (is(c) ? i : -1)).filter((i) => i >= 0);
  for (let k = idxs.length - 1; k >= max; k--) {
    const i = idxs[k]; // keep the first `max`; evict the rest
    const evicted = state.pool[i];
    // Replace with a card that is neither capped role (finisher/modifier), so cap passes can't
    // undo each other — e.g. capping modifiers must not pull a finisher back past its own cap.
    const repl = state.sharedDeck.findIndex((c) => c.role !== 'intensifier' && c.role !== 'modifier');
    if (repl === -1) {
      state.pool.splice(i, 1); // no replacement available — just drop the extra
    } else {
      state.pool[i] = state.sharedDeck.splice(repl, 1)[0];
    }
    state.sharedDeck.push(evicted);
  }
}

/** Guarantee at least one card relevant to the question's topic is in the pool. */
function ensurePoolHasTopic(state: GameState, topicId: string): void {
  if (state.pool.some((c) => c.topics?.includes(topicId))) return;
  const idx = state.sharedDeck.findIndex((c) => c.topics?.includes(topicId));
  if (idx === -1) return;
  const card = state.sharedDeck.splice(idx, 1)[0];
  const removed = state.pool.pop();
  if (removed) state.sharedDeck.push(removed);
  state.pool.unshift(card);
}

export function createGame(opts: GameOptions = {}): GameState {
  const state: GameState = {
    bar: 0,
    round: 1,
    maxRounds: opts.maxRounds ?? 8,
    sharedDeck: [],
    pool: [],
    poolSize: opts.poolSize ?? 12,
    handSize: opts.handSize ?? 4,
    player: newPlayer('player'),
    ai: newPlayer('ai'),
    turn: 'player',
    log: [],
    events: [],
  };
  const rng = makeRng(opts.seed ?? 1);
  rngFor.set(state, rng);
  // Opponent and crowd are fixed for the whole debate (crowd taste stays hidden).
  state.opponent =
    OPPONENTS.find((o) => o.id === opts.opponentId) ?? OPPONENTS[Math.floor(rng() * OPPONENTS.length)];
  state.crowd = CROWDS.find((c) => c.id === opts.crowdId) ?? CROWDS[Math.floor(rng() * CROWDS.length)];
  state.playerBonus = opts.playerBonus ?? [];
  state.removedCards = opts.removedCards ?? [];
  state.tutorial = opts.tutorial ?? false;
  dealRound(state);
  return state;
}

export function activePlayer(state: GameState): PlayerState {
  return state.turn === 'player' ? state.player : state.ai;
}

function other(id: PlayerId): PlayerId {
  return id === 'player' ? 'ai' : 'player';
}

/**
 * The line to actually judge when ending: the line with any **trailing dangling
 * connector** dropped (a period tapped to "finish", an unused "and"/"but"), or null
 * if what remains still isn't a complete sentence. We strip ONLY trailing connectors,
 * never real content — so a run-on ("opponent sucks I am great", two clauses jammed
 * with no connector) or a stranded half-clause keeps all its words and falls through
 * to lenient "confused" scoring + coaching, instead of silently scoring just the
 * first thought. The AI still never "mumbles": it only ever ends on a complete line.
 */
export function endableLine(line: Card[]): Card[] | null {
  // Never trim away a Teleprompter-Typo'd card: every jammed card must survive, so
  // sabotage sticks (an unrecovered jam → incomplete → "confused").
  let minLen = 1;
  for (let i = 0; i < line.length; i++) if (line[i].jammed) minLen = i + 1;
  // Drop a trailing dangling connector (and only that — content is never discarded).
  let end = line.length;
  while (end > minLen && line[end - 1].role === 'connector') end--;
  const trimmed = line.slice(0, end);
  return isComplete(trimmed) ? trimmed : null;
}

/**
 * Legal moves for the player whose turn it is. Building is freeform (any card,
 * any order — you may build nonsense), with two rules that create pressure:
 *  - You may only END on a complete sentence (no bailing on a safe fragment) —
 *    unless you're genuinely stuck with no playable card.
 *  - An intensifier is only playable once your sentence is already complete.
 */
export function legalMoves(state: GameState): Move[] {
  if (state.winner) return [];
  const p = activePlayer(state);
  if (p.done) return [];
  const moves: Move[] = [];
  const offer = (c: Card, from: 'pool' | 'hand') => {
    if (c.role === 'powerup') {
      moves.push({ kind: 'power', cardId: c.id }); // played, not built into the sentence
      return;
    }
    // A finisher is an END move: it's only offered when the line is already a complete
    // sentence (grammar S → INT), so playing it appends the flourish, banks the ×bonus,
    // and ends your turn. Mid-clause it's not offered (it'd be ungrammatical) — finish
    // the thought first, and the opponent may grab the contested finisher before you do.
    if (c.role === 'intensifier' && !canAppend(p.line, c)) return;
    moves.push({ kind: 'take', from, cardId: c.id });
  };
  for (const c of state.pool) offer(c, 'pool');
  for (const c of p.hand) offer(c, 'hand');
  // The period is free but limited to ONE per statement (caps you at two sentences —
  // chain conjunctions for more, and a combo). Offered only where the grammar allows
  // it to open a new clause (after a complete clause) — never on an empty/partial line.
  if (PERIOD_ENABLED && !p.usedPeriod && canAppend(p.line, PERIOD)) moves.push({ kind: 'take', from: 'period', cardId: PERIOD.id });
  // You may End any non-empty line. Ending an incomplete/ungrammatical one is
  // allowed (no soft-lock, no forced self-own) — it just scores as a muffled,
  // "confused" statement (see scoreStatement). Completing well is still better.
  if (p.line.length > 0) moves.push({ kind: 'end' });
  return moves;
}

/** Can the active player end their statement right now? */
export function canEnd(state: GameState): boolean {
  return legalMoves(state).some((m) => m.kind === 'end');
}

function resolveStatement(state: GameState, p: PlayerState): void {
  // Trim trailing junk (a dangling connector or a half-started next clause) back to
  // the last complete thought, so we judge that — not an incomplete line. If nothing
  // is complete (e.g. a bare subject), keep it as-is → lenient "confused" scoring.
  const endable = endableLine(p.line);
  if (endable) p.line = endable;
  // (A finisher, if played, is already the last token of p.line — playing it both
  // appends the flourish and ends the statement; see the intensifier branch of applyMove.)
  // The crowd's hidden taste is applied here, at resolution — the AI never sees it.
  // A Soundbite (if armed) amplifies BEFORE the cap — threaded into scoreStatement so it can't
  // bypass the statement cap (that was a knockout-blow bug). Then spend it.
  const mult = p.nextMultiplier && p.nextMultiplier !== 1 ? p.nextMultiplier : 1;
  const reaction = scoreStatement(p.line, { topicId: state.topic?.id, crowd: state.crowd, multiplier: mult });
  p.nextMultiplier = undefined;
  p.lastReaction = reaction;
  p.done = true;
  // delta is toward the speaker; the bar is +player / -ai.
  const signed = p.id === 'player' ? reaction.delta : -reaction.delta;
  state.bar = Math.max(-100, Math.min(100, state.bar + signed));
  const who = p.id === 'player' ? 'You' : (state.opponent?.name ?? 'Opponent');
  state.log.push(`${who}: "${renderSentence(p.line)}" → ${reaction.label} (${signed >= 0 ? '+' : ''}${Math.round(signed * 10) / 10})`);
  logEvent(state, 'resolve', {
    by: p.id,
    text: renderSentence(p.line),
    cards: p.line.map((c) => c.id),
    delta: reaction.delta, // toward the SPEAKER (+ = good for them), matches `label`
    label: reaction.label,
    grammatical: reaction.grammatical,
    combo: reaction.combo?.kind,
    gaffe: p.id === 'ai' ? !!p.gaffing : undefined,
    bar: Math.round(state.bar), // resulting audience bar (+player / −ai)
  });
  // A flustered opponent that actually flubbed reacts (the lightweight stand-in for
  // the embarrassed-face / inner-monologue we'll add with graphics).
  if (p.id === 'ai' && p.gaffing && reaction.delta < 0) {
    const name = state.opponent?.name ?? 'Your opponent';
    const tell = GAFFE_TELLS[Math.floor(rngFor.get(state)!() * GAFFE_TELLS.length)];
    state.log.push(tell.replace('%n', name));
  }
  p.gaffing = false;
  // Park the judged statement's PRIVATE cards for recycling next question. Shared-pool
  // cards (subjects/objects/connectors/finishers) and the virtual period are rebuilt
  // each question, so they're not collected. dealRound clears p.line afterward.
  p.discard.push(...p.line.filter((c) => c.priv));
}

const GAFFE_TELLS = [
  '%n winces — "…did I say that out loud?"',
  '%n turns pale and loosens their collar.',
  '%n forces a panicked, sweaty smile.',
  '%n looks like they want the floor to swallow them.',
];

function endRoundIfDone(state: GameState): void {
  if (!state.player.done || !state.ai.done) return;
  // Decide a winner now, otherwise pause on the result for the player to review.
  if (state.bar >= 100) state.winner = 'player';
  else if (state.bar <= -100) state.winner = 'ai';
  else if (state.round >= state.maxRounds) {
    state.winner = state.bar > 0 ? 'player' : state.bar < 0 ? 'ai' : 'tie';
  } else {
    state.awaitingNext = true; // hold on the reveal until nextQuestion() is called
  }
  if (state.winner) logEvent(state, 'win', { winner: state.winner, bar: Math.round(state.bar) });
}

/** Advance to the next question after the result has been shown. */
export function nextQuestion(state: GameState): GameState {
  if (!state.awaitingNext || state.winner) return state;
  state.awaitingNext = false;
  state.round += 1;
  dealRound(state);
  return state;
}

/** Advance the turn after a move: hand to the other player if they're still building. */
function advanceTurn(state: GameState): void {
  const cur = state.turn;
  if (!state[other(cur)].done) {
    state.turn = other(cur);
  }
  // else current player keeps going until they also end.
}

/**
 * Find the pool card that, swapped in for the victim's LAST card (Teleprompter
 * Typo replaces, it doesn't append), makes the worst (lowest-scoring) COMPLETE
 * statement for the victim — i.e. flips their own line into a self-own ("…will
 * give everyone a puppy" → "…will destroy this country"). Returns index -1 /
 * delta +∞ when no replacement forces such a self-own (so the AI won't bother).
 * Only grammatical, complete results — never gibberish.
 */
/** Index of the last SPOKEN word (non-connector) — what Typo replaces, so a dangling
 * trailing period/"and" isn't mistaken for the opponent's last word. -1 if none. */
function lastContentIndex(line: Card[]): number {
  for (let i = line.length - 1; i >= 0; i--) if (line[i].role !== 'connector') return i;
  return -1;
}

export function bestTypoJam(state: GameState, victimLine: Card[]): { index: number; delta: number } {
  const ci = lastContentIndex(victimLine);
  if (ci < 0) return { index: -1, delta: Infinity }; // nothing spoken to replace
  const base = victimLine.slice(0, ci); // replace the last spoken word (drop trailing connectors)
  let index = -1;
  let delta = Infinity;
  for (let i = 0; i < state.pool.length; i++) {
    const c = state.pool[i];
    if (!canAppend(base, c)) continue;
    const line = [...base, c];
    if (!isComplete(line)) continue; // must replace into a real statement
    const d = scoreStatement(line, { topicId: state.topic?.id }).delta; // toward the victim
    if (d < delta) {
      delta = d;
      index = i;
    }
  }
  return { index, delta };
}

/** Resolve a power-up card (consumes it; some are free, others cost the turn). */
function applyPowerup(state: GameState, p: PlayerState, move: { cardId: string; targetFrom?: 'pool' | 'hand' | 'oppHand'; targetCardId?: string }): void {
  const idx = p.hand.findIndex((c) => c.id === move.cardId && c.role === 'powerup');
  if (idx === -1) return;
  const card = p.hand[idx];
  p.hand.splice(idx, 1); // power-ups are one-shot
  logEvent(state, 'power', { by: p.id, effect: card.effect });
  let free = false;

  switch (card.effect) {
    case 'search': // draw five more cards into your hand — a FREE action
      for (let i = 0; i < 5 && p.deck.length > 0; i++) p.hand.push(p.deck.shift()!);
      free = true;
      break;
    case 'filibuster': // stock your hand with connectors to chain a big combo — FREE
      p.hand.push(...instances(findDef('c_and')!, 2), ...instances(findDef('c_therefore')!, 1));
      free = true;
      break;
    case 'soundbite': // amplify your next completed statement
      p.nextMultiplier = 1.5;
      break;
    case 'plant': // reveal the crowd's hidden taste (for the rest of the debate)
      p.knowsCrowd = true;
      break;
    case 'redeal': {
      // Call a Recess — re-deal the SHARED POOL fresh (your private hand is untouched).
      // Reshuffle the current pool back into the remaining shared deck so already-played
      // cards stay gone (no resurrecting a spent card), then refill + re-assert the same
      // curatorial guarantees dealRound uses. Costs the turn (free stays false) — exactly
      // the removed once-per-question Recess, now a one-shot drafted reward card instead of
      // a free repeatable button (which was the old player-only exploit). See cards.ts REWARDS.
      const rng = rngFor.get(state)!;
      state.sharedDeck.push(...state.pool);
      state.pool = [];
      state.sharedDeck = shuffle(state.sharedDeck, rng);
      refill(state.sharedDeck, state.pool, state.poolSize);
      if (state.topic) ensurePoolHasTopic(state, state.topic.id);
      ensurePoolPlayable(state);
      capPoolFinishers(state);
      capPoolModifiers(state);
      const who = p.id === 'player' ? 'You' : state.opponent?.name ?? 'Opponent';
      state.log.push(`${who} call a recess — the board is dealt fresh.`);
      break;
    }
    case 'hotmic': {
      // Reveal the opponent's hand (for the rest of the debate) and steal a card.
      const opp = state[other(p.id)];
      p.knowsOppHand = true;
      if (opp.hand.length > 0) {
        let steal: Card | undefined;
        if (move.targetFrom === 'oppHand' && move.targetCardId) {
          const ti = opp.hand.findIndex((c) => c.id === move.targetCardId);
          if (ti !== -1) steal = opp.hand.splice(ti, 1)[0];
        }
        if (!steal) {
          // auto (AI): grab their most valuable card — a power-up first, else the punchiest.
          const rank = (c: Card) => (c.role === 'powerup' ? 100 : Math.abs(c.sentiment ?? 0));
          let bi = 0;
          for (let i = 1; i < opp.hand.length; i++) if (rank(opp.hand[i]) > rank(opp.hand[bi])) bi = i;
          steal = opp.hand.splice(bi, 1)[0];
        }
        if (steal) {
          p.hand.push(steal);
          const who = p.id === 'player' ? 'You' : state.opponent?.name ?? 'Opponent';
          const them = p.id === 'player' ? state.opponent?.name ?? 'your opponent' : 'you';
          state.log.push(`${who} catch ${them} on a hot mic and grab "${cardLabel(steal)}"!`);
          // Flag the theft so the victim gets a must-dismiss modal (like Typo/Forgot).
          // Only the player-as-victim case surfaces a modal (the AI never sees one).
          state.lastSabotage = { victim: opp.id, by: p.id, text: cardLabel(steal), kind: 'hotmic' };
        }
      }
      break;
    }
    case 'forgot': {
      // Knock the opponent's last CONTENT card off their in-progress statement (discarded,
      // not returned). Skip any trailing connector (a dangling period/"and"/"but") — popping
      // that alone would remove nothing visible and waste the power-up. Drop the content card
      // plus any connectors that trailed it.
      const opp = state[other(p.id)];
      const idx = lastContentIndex(opp.line); // skip a trailing period/"and"/"but" (same as Typo)
      if (!opp.done && idx >= 0) {
        const dropped = opp.line[idx];
        opp.line.splice(idx); // remove the content card + any trailing dangling connectors
        state.lastSabotage = { victim: opp.id, by: p.id, text: cardLabel(dropped), kind: 'forgot' };
        logEvent(state, 'sabotage', { by: p.id, victim: opp.id, kind: 'forgot', text: cardLabel(dropped) });
        const who = p.id === 'player' ? 'You' : state.opponent?.name ?? 'Opponent';
        const them = p.id === 'player' ? state.opponent?.name ?? 'your opponent' : 'you';
        state.log.push(`${who} rattles the other podium — ${them} forgets "${cardLabel(dropped)}"!`);
      }
      break;
    }
    case 'typo': {
      // Teleprompter Typo: knock the opponent's LAST word off and swap in a card
      // you choose (or, for the AI, the one that forces the worst self-own).
      const opp = state[other(p.id)];
      if (!opp.done && opp.line.length > 0) {
        let sabotage: Card | undefined;
        if (move.targetCardId && move.targetFrom) {
          // The player picks the replacement card (from the pool or their hand).
          const src = move.targetFrom === 'pool' ? state.pool : p.hand;
          const ti = src.findIndex((c) => c.id === move.targetCardId);
          if (ti !== -1) sabotage = src.splice(ti, 1)[0];
        } else {
          // The AI auto-picks the replacement that forces the worst self-own (it
          // only chooses to play Typo when one exists — see chooseMove).
          const jam = bestTypoJam(state, opp.line);
          if (jam.index !== -1) sabotage = state.pool.splice(jam.index, 1)[0];
        }
        const ci = lastContentIndex(opp.line); // the last SPOKEN word (skip a trailing period)
        if (sabotage && ci >= 0) {
          const removed = opp.line[ci];
          opp.line.splice(ci); // drop the last spoken word + any trailing connectors
          sabotage.jammed = true; // must stick — the end-trim won't strip it (see endableLine)
          opp.line.push(sabotage);
          state.lastSabotage = { victim: opp.id, by: p.id, text: cardLabel(sabotage) };
          logEvent(state, 'sabotage', { by: p.id, victim: opp.id, kind: 'typo', text: cardLabel(sabotage), replaced: cardLabel(removed) });
          const who = p.id === 'player' ? 'You' : state.opponent?.name ?? 'Opponent';
          state.log.push(`${who} hit the teleprompter — "${cardLabel(removed)}" twists into "${cardLabel(sabotage)}"!`);
        }
      }
      break;
    }
  }
  if (!free) advanceTurn(state); // Search is free; other power-ups cost the turn
}

/** Apply a move for the player whose turn it is. Mutates and returns `state`. */
export function applyMove(state: GameState, move: Move): GameState {
  if (state.winner) return state;
  const p = activePlayer(state);
  if (p.done) return state;
  // The victim has seen the sabotage once they take their turn — clear the alert.
  if (state.lastSabotage?.victim === p.id) state.lastSabotage = undefined;

  if (move.kind === 'end') {
    resolveStatement(state, p);
    advanceTurn(state);
    endRoundIfDone(state);
    return state;
  }

  if (move.kind === 'power') {
    applyPowerup(state, p, move);
    return state;
  }

  // The free period: append a fresh copy (the PERIOD card itself is never consumed),
  // but it's limited to one per statement — mark it used.
  if (move.from === 'period') {
    if (p.usedPeriod || !canAppend(p.line, PERIOD)) return state;
    p.line.push(instances(PERIOD, 1)[0]);
    p.usedPeriod = true;
    logEvent(state, 'take', { by: p.id, from: 'period', card: PERIOD.id, text: '.', role: 'connector' });
    advanceTurn(state);
    return state;
  }

  // take from pool or hand
  const source = move.from === 'pool' ? state.pool : p.hand;
  const idx = source.findIndex((c) => c.id === move.cardId);
  if (idx === -1) return state; // stale move, ignore
  const card = source[idx];

  if (card.role === 'intensifier') {
    // A finisher ENDS the statement: only legal on a complete line (grammar S → INT).
    // Append the flourish, then resolve — there's no holding/committing.
    if (!canAppend(p.line, card)) return state; // not a valid sentence-end yet
    source.splice(idx, 1);
    p.line.push(card);
    logEvent(state, 'take', { by: p.id, from: move.from, card: card.id, text: cardLabel(card), role: card.role, finisher: true });
    resolveStatement(state, p);
    advanceTurn(state);
    endRoundIfDone(state);
    return state;
  }

  source.splice(idx, 1);
  p.line.push(card);
  logEvent(state, 'take', { by: p.id, from: move.from, card: card.id, text: cardLabel(card), role: card.role });
  // No replenishment: the pool and hands only shrink over the question.
  advanceTurn(state);
  return state;
}

/** Convenience for UI: is the active player's line a complete sentence? */
export function activeLineComplete(state: GameState): boolean {
  return isComplete(activePlayer(state).line);
}
