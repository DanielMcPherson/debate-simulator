import type { Card, GameState, Move, PlayerId, PlayerState } from './types';
import { isComplete, isValidPrefix, canAppend } from './grammar';
import { scoreStatement } from './scoring';
import { renderSentence, cardLabel } from './morphology';
import { TOPICS, OPPONENTS, CROWDS, findDef } from '../data/cards';
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
}

// The RNG lives alongside the state so a save/restore could persist it; for the
// prototype we keep a module-side map keyed by the state object.
const rngFor = new WeakMap<GameState, Rng>();

const MAX_LINE = 14; // statements can't run on forever (caps combos, prevents stalls)

function newPlayer(id: PlayerId): PlayerState {
  return { id, deck: [], hand: [], line: [], done: false };
}

function dealRound(state: GameState): void {
  const rng = rngFor.get(state)!;
  // Each question gets ONE deal that does not replenish — scarcity is the source
  // of pressure (you may be forced to finish with a bad card).
  state.topic = TOPICS[Math.floor(rng() * TOPICS.length)];
  // Don't deal a regular card identical to the always-available topic phrase.
  const dup = state.topic.card.text?.toLowerCase();
  const noDup = (cards: Card[]): Card[] => (dup ? cards.filter((c) => c.text?.toLowerCase() !== dup) : cards);

  state.sharedDeck = noDup(shuffle(buildSharedDeck(), rng));
  state.pool = [];
  refill(state.sharedDeck, state.pool, state.poolSize);
  ensurePoolPlayable(state);
  ensurePoolHasTopic(state, state.topic.id);

  for (const p of [state.player, state.ai]) {
    // The opponent's private deck is tilted toward its debating style.
    const style = p.id === 'ai' ? state.opponent?.style : undefined;
    // PERSISTENT deck: built once (when empty), drawn across the whole debate.
    // It only rebuilds when too small to fill a hand — so a card you've already
    // played (e.g. Plant in the Audience) doesn't come back next question.
    if (p.deck.length < state.handSize) {
      // The player's earned reward cards (fresh instances) are shuffled in too.
      const bonus = p.id === 'player' ? (state.playerBonus ?? []).flatMap((c) => instances(c, 1)) : [];
      p.deck = shuffle([...p.deck, ...buildPrivateDeck(style), ...bonus], rng);
    }
    p.hand = [];
    refill(p.deck, p.hand, state.handSize);
    p.line = [];
    p.heldFinisher = undefined;
    p.usedRedraw = false;
    p.nextMultiplier = undefined;
    p.knowsOppHand = false; // Hot Mic reveal lasts only the question it's played
    p.done = false;
    p.lastReaction = undefined;
    // knowsCrowd persists for the whole debate (Plant reveals it once).
  }
  state.turn = 'player';
  state.passes = 0;
}

/** Swap a card matching `pred` into the pool from the deck if none is present. */
function ensurePool(state: GameState, pred: (c: Card) => boolean): void {
  if (state.pool.some(pred)) return;
  const idx = state.sharedDeck.findIndex(pred);
  if (idx === -1) return;
  const card = state.sharedDeck.splice(idx, 1)[0];
  const removed = state.pool.pop();
  if (removed) state.sharedDeck.push(removed);
  state.pool.unshift(card);
}

/**
 * Guarantee the pool can open AND finish a statement: a real (sided) subject to
 * start with, and a complete predicate to land. With those a complete statement
 * is always reachable — the pressure is a *bad* completion, not an impossible one.
 */
function ensurePoolPlayable(state: GameState): void {
  ensurePool(state, (c) => c.role === 'np' && !!c.side && c.side !== 'neutral'); // a subject
  ensurePool(state, (c) => c.role === 'predicate' && !c.open); // a complete predicate
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
    poolSize: opts.poolSize ?? 9,
    handSize: opts.handSize ?? 4,
    player: newPlayer('player'),
    ai: newPlayer('ai'),
    turn: 'player',
    log: [],
  };
  const rng = makeRng(opts.seed ?? 1);
  rngFor.set(state, rng);
  // Opponent and crowd are fixed for the whole debate (crowd taste stays hidden).
  state.opponent =
    OPPONENTS.find((o) => o.id === opts.opponentId) ?? OPPONENTS[Math.floor(rng() * OPPONENTS.length)];
  state.crowd = CROWDS.find((c) => c.id === opts.crowdId) ?? CROWDS[Math.floor(rng() * CROWDS.length)];
  state.playerBonus = opts.playerBonus ?? [];
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
  const complete = isComplete(p.line);
  const moves: Move[] = [];
  const offer = (c: { role: string; id: string }, from: 'pool' | 'hand') => {
    if (c.role === 'powerup') {
      moves.push({ kind: 'power', cardId: c.id }); // played, not built into the sentence
      return;
    }
    // A finisher can be grabbed any time, but you can only hold one (you're then
    // committed to ending with it).
    if (c.role === 'intensifier' && p.heldFinisher) return;
    moves.push({ kind: 'take', from, cardId: c.id });
  };
  for (const c of state.pool) offer(c, 'pool');
  for (const c of p.hand) offer(c, 'hand');
  // The topic phrase is always available to both players and never consumed.
  if (state.topic) moves.push({ kind: 'take', from: 'topic', cardId: state.topic.card.id });
  if (!p.usedRedraw) moves.push({ kind: 'redraw' }); // once per question, costs your turn
  // You may end when complete. Otherwise you're held to "must finish" — UNLESS the
  // statement can no longer be completed (gibberish), or it has run on too long, in
  // which case ending early takes the "confused" penalty rather than soft-locking.
  if (complete) moves.push({ kind: 'end' });
  else if (p.line.length > 0 && (p.line.length >= MAX_LINE || !canComplete(state, p))) {
    moves.push({ kind: 'end' });
  }
  // Pass to wait — allowed on an untouched (empty) or a complete statement, but
  // not mid-way through an incomplete one (you must finish what you started).
  if (complete || p.line.length === 0) moves.push({ kind: 'pass' });
  return moves;
}

/** Can the player's current line still be finished into a complete statement? */
function canComplete(state: GameState, p: PlayerState): boolean {
  const start = p.line;
  if (isComplete(start)) return true;
  if (!isValidPrefix(start)) return false; // already broken — no extension can fix it
  const reusable = state.topic ? [state.topic.card] : []; // topic card never depletes
  const consumable = [...state.pool, ...p.hand].filter((c) => c.role !== 'powerup'); // power-ups aren't tokens
  const MAX_EXT = 6;
  let budget = 4000;

  const dfs = (cur: Card[], remaining: Card[]): boolean => {
    if (budget-- <= 0) return false;
    if (isComplete(cur)) return true;
    if (cur.length - start.length >= MAX_EXT) return false;
    for (const c of reusable) {
      if (canAppend(cur, c) && dfs([...cur, c], remaining)) return true;
    }
    const seen = new Set<string>();
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const sig = `${c.role}|${c.text ?? c.id}|${c.open}`;
      if (seen.has(sig) || !canAppend(cur, c)) continue;
      seen.add(sig);
      if (dfs([...cur, c], remaining.slice(0, i).concat(remaining.slice(i + 1)))) return true;
    }
    return false;
  };
  return dfs(start, consumable);
}

/** Can the active player end their statement right now? */
export function canEnd(state: GameState): boolean {
  return legalMoves(state).some((m) => m.kind === 'end');
}

function resolveStatement(state: GameState, p: PlayerState): void {
  // A committed finisher is appended to the very end before judging.
  if (p.heldFinisher) {
    p.line.push(p.heldFinisher);
    p.heldFinisher = undefined;
  }
  // The crowd's hidden taste is applied here, at resolution — the AI never sees it.
  const reaction = scoreStatement(p.line, { topicId: state.topic?.id, crowd: state.crowd });
  // A Soundbite armed this statement: amplify, then spend it.
  if (p.nextMultiplier && p.nextMultiplier !== 1) {
    reaction.delta = Math.round(reaction.delta * p.nextMultiplier * 10) / 10;
  }
  p.nextMultiplier = undefined;
  p.lastReaction = reaction;
  p.done = true;
  // delta is toward the speaker; the bar is +player / -ai.
  const signed = p.id === 'player' ? reaction.delta : -reaction.delta;
  state.bar = Math.max(-100, Math.min(100, state.bar + signed));
  const who = p.id === 'player' ? 'You' : (state.opponent?.name ?? 'Opponent');
  state.log.push(`${who}: "${renderSentence(p.line)}" → ${reaction.label} (${signed >= 0 ? '+' : ''}${Math.round(signed * 10) / 10})`);
}

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
 * Find the pool card that, jammed onto the victim's line, COMPLETES it into the
 * worst (lowest-scoring) statement for the victim — i.e. forces a real self-own
 * (praising the opponent / a villain, insulting themselves or the crowd). Returns
 * index -1 and delta +∞ when no jam can force such a self-own (so the AI shouldn't
 * bother Typo-ing). Never produces gibberish — only grammatical completions.
 */
export function bestTypoJam(state: GameState, victimLine: Card[]): { index: number; delta: number } {
  let index = -1;
  let delta = Infinity;
  for (let i = 0; i < state.pool.length; i++) {
    const c = state.pool[i];
    if (!canAppend(victimLine, c)) continue;
    const line = [...victimLine, c];
    if (!isComplete(line)) continue; // must complete into a real statement
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
        }
      }
      break;
    }
    case 'forgot': {
      // Knock the last card off the opponent's in-progress statement (it's
      // discarded, not returned to play). Wasted if they have nothing to drop.
      const opp = state[other(p.id)];
      if (!opp.done && opp.line.length > 0) {
        const dropped = opp.line.pop()!;
        state.lastSabotage = { victim: opp.id, by: p.id, text: cardLabel(dropped), kind: 'forgot' };
        const who = p.id === 'player' ? 'You' : state.opponent?.name ?? 'Opponent';
        const them = p.id === 'player' ? state.opponent?.name ?? 'your opponent' : 'you';
        state.log.push(`${who} rattles the other podium — ${them} forgets "${cardLabel(dropped)}"!`);
      }
      break;
    }
    case 'typo': {
      // Jam a card onto the opponent's in-progress statement.
      const opp = state[other(p.id)];
      if (!opp.done) {
        let sabotage: Card | undefined;
        if (move.targetCardId && move.targetFrom) {
          // The player picks the card to jam.
          const src = move.targetFrom === 'pool' ? state.pool : p.hand;
          const ti = src.findIndex((c) => c.id === move.targetCardId);
          if (ti !== -1) sabotage = src.splice(ti, 1)[0];
        } else {
          // The AI auto-picks the jam that forces the worst self-own (it only
          // chooses to play Typo when such a jam exists — see chooseMove).
          const jam = bestTypoJam(state, opp.line);
          if (jam.index !== -1) sabotage = state.pool.splice(jam.index, 1)[0];
        }
        if (sabotage) {
          opp.line.push(sabotage);
          state.lastSabotage = { victim: opp.id, by: p.id, text: cardLabel(sabotage) };
          state.log.push(`${p.id === 'player' ? 'You' : state.opponent?.name ?? 'Opponent'} jams "${cardLabel(sabotage)}" into the other podium!`);
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
  if (move.kind !== 'pass') state.passes = 0; // any real action breaks a pass streak
  // The victim has seen the sabotage once they take their turn — clear the alert.
  if (state.lastSabotage?.victim === p.id) state.lastSabotage = undefined;

  if (move.kind === 'end') {
    resolveStatement(state, p);
    advanceTurn(state);
    endRoundIfDone(state);
    return state;
  }

  if (move.kind === 'pass') {
    if (p.line.length > 0 && !isComplete(p.line)) return state; // can't bail mid-statement
    state.passes = (state.passes ?? 0) + 1;
    // Stalemate: opponent already locked in, or both passed in a row -> resolve.
    if (state[other(p.id)].done || (state.passes ?? 0) >= 2) {
      for (const q of [state.player, state.ai]) if (!q.done) resolveStatement(state, q);
      state.passes = 0;
      endRoundIfDone(state);
    } else {
      advanceTurn(state);
    }
    return state;
  }

  if (move.kind === 'power') {
    applyPowerup(state, p, move);
    return state;
  }

  if (move.kind === 'redraw') {
    if (p.usedRedraw) return state;
    const rng = rngFor.get(state)!;
    // Reshuffle the SHARED POOL only and redraw it fresh — your private hand
    // (including any Filibuster connectors) is left untouched.
    state.sharedDeck.push(...state.pool);
    state.pool = [];
    state.sharedDeck = shuffle(state.sharedDeck, rng);
    refill(state.sharedDeck, state.pool, state.poolSize);
    ensurePoolPlayable(state);
    if (state.topic) ensurePoolHasTopic(state, state.topic.id);
    p.usedRedraw = true;
    advanceTurn(state); // costs your turn
    return state;
  }

  // Taking the topic phrase appends a copy and never depletes it.
  if (move.from === 'topic') {
    if (!state.topic) return state;
    p.line.push(instances(state.topic.card, 1)[0]);
    advanceTurn(state);
    return state;
  }

  // take from pool or hand
  const source = move.from === 'pool' ? state.pool : p.hand;
  const idx = source.findIndex((c) => c.id === move.cardId);
  if (idx === -1) return state; // stale move, ignore
  const card = source[idx];

  if (card.role === 'intensifier') {
    if (p.heldFinisher) return state; // already committed to one
    source.splice(idx, 1);
    p.heldFinisher = card; // committed — appended when you end, for better or worse
    advanceTurn(state);
    return state;
  }

  source.splice(idx, 1);
  p.line.push(card);
  // No replenishment: the pool and hands only shrink over the question.
  advanceTurn(state);
  return state;
}

/** Convenience for UI: is the active player's line a complete sentence? */
export function activeLineComplete(state: GameState): boolean {
  return isComplete(activePlayer(state).line);
}
