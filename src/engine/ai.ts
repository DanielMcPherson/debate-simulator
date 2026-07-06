import type { Card, Category, DebateStyle, GameState, Move, NervousTrigger, RelicMods } from './types';
import { canAppend, isComplete, rolesOf } from './grammar';
import { scoreStatement, dominantCategory } from './scoring';
import { bestTypoJam, gameRng, playerRelicMods } from './game';
import { PERIOD, PERIOD_ENABLED } from '../data/cards';

const STYLE_CATEGORY: Record<DebateStyle, Category> = {
  brag: 'praise_self',
  attack: 'attack_opp',
  pander: 'pander_aud',
};
const STYLE_BONUS = 10; // pronounced lean toward the opponent's signature style

// The opponent "brain". Each turn it searches the grammatical completions it can
// still reach from its committed line using the cards currently available
// (hand + pool), scores each with the real scoring engine, and steps toward the
// best one. Because it re-plans every turn, theft from the shared pool simply
// changes what's reachable and it adapts — falling back to the next-best line.

type Source = 'pool' | 'hand' | 'period';
interface Avail {
  card: Card;
  source: Source;
}

export interface PlanResult {
  /** Cards to append, in order, beyond the current line (empty = stop here). */
  ext: Avail[];
  /** Score of the resulting statement, toward the speaker, minus theft risk. */
  value: number;
  /** Raw audience delta of the resulting statement (no risk penalty). */
  delta: number;
}

interface PlanOptions {
  maxExtend?: number; // cap on tokens added this plan
  nodeBudget?: number; // search cap (anti-blowup)
  riskPenalty?: number; // per pool-sourced card; biases toward safer / earlier grabs
  topicId?: string; // the question's topic, so plans prefer staying on-topic
  styleCategory?: Category; // the opponent's style — plans of this kind get a bonus
  // 'best' (default) maximizes score; 'gaffe' deliberately flubs — picks the
  // WORST self-own it can muster (most-negative delta), kept short and punchy, so
  // it's a clear, funny howler ("I secretly eat babies") rather than a mushy
  // barely-negative muddle. Returns null if no self-own is reachable.
  // 'confess' (Under Oath) minimizes delta over ALL completions — unlike 'gaffe'
  // it never rejects a positive line (on a weird self-own-less board it degrades
  // to the least-good statement instead of returning null) and prefers the
  // LONGEST line among equally-damaging ones: a compelled confession should be a
  // long, spectacular unburdening, not a punchy slip.
  objective?: 'best' | 'gaffe' | 'confess';
  // Relic mods are PUBLIC passives (unlike the crowd, which stays hidden from the AI):
  // `mods` = the SPEAKER's own relics, `defenderMods` = the listener's (Teflon damping).
  // Without them the AI would over-value attacks into a Teflon player and mis-price
  // sabotage forecasts.
  mods?: RelicMods;
  defenderMods?: RelicMods;
}

/**
 * Find the best reachable completion from `line` using `avail` cards.
 * Returns null if no complete sentence is reachable (and the line isn't already
 * complete).
 */
export function plan(line: Card[], avail: Avail[], opts: PlanOptions = {}): PlanResult | null {
  const maxExtend = opts.maxExtend ?? 6;
  const riskPenalty = opts.riskPenalty ?? 0.3;
  let budget = opts.nodeBudget ?? 6000;

  let best: PlanResult | null = null;

  const evaluate = (full: Card[], ext: Avail[]): PlanResult => {
    const delta = scoreStatement(full, { topicId: opts.topicId, mods: opts.mods, defenderMods: opts.defenderMods }).delta; // NOTE: no crowd — AI is blind
    const poolUsed = ext.reduce((n, a) => n + (a.source === 'pool' ? 1 : 0), 0);
    const styleBonus = opts.styleCategory && dominantCategory(full) === opts.styleCategory ? STYLE_BONUS : 0;
    return { ext: ext.slice(), value: delta - riskPenalty * poolUsed + styleBonus, delta };
  };

  const gaffe = opts.objective === 'gaffe';
  const confess = opts.objective === 'confess';
  const consider = (r: PlanResult) => {
    if (confess) {
      // Most damaging first (raw delta, like 'gaffe' — no style/risk shaping);
      // tie-break the LONGER extension (the eloquent confession), then first-found.
      if (!best || r.delta < best.delta || (r.delta === best.delta && r.ext.length > best.ext.length)) best = r;
      return;
    }
    if (gaffe) {
      if (r.delta >= 0) return; // not a flub — a gaffe must be a net self-own
      // SHORTEST self-own (a punchy "I secretly eat babies", and it stops there rather
      // than piling on); tie-break the most-negative among equally short ones.
      if (!best || r.ext.length < best.ext.length || (r.ext.length === best.ext.length && r.delta < best.delta)) best = r;
      return;
    }
    if (
      !best ||
      r.value > best.value ||
      // tie-break: prefer the shorter (less theft-exposed) statement
      (r.value === best.value && r.ext.length < best.ext.length)
    ) {
      best = r;
    }
  };

  const dfs = (ext: Avail[], remaining: Avail[]) => {
    if (budget-- <= 0) return;
    const full = ext.length ? [...line, ...ext.map((a) => a.card)] : line;
    if (isComplete(full)) consider(evaluate(full, ext));
    if (ext.length >= maxExtend) return;

    // Instances of the same card are interchangeable — try one per base id.
    // (Predicates have no `text`, so dedup by base id, not text.)
    const seen = new Set<string>();
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[i];
      const sig = `${a.card.id.split('#')[0]}|${a.source}`;
      if (seen.has(sig)) continue;
      if (!canAppend(full, a.card)) continue;
      seen.add(sig);
      const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
      dfs([...ext, a], rest);
    }
  };

  dfs([], avail);
  return best;
}

/** Build the availability list for the AI from pool + hand + the topic card. */
function availFor(state: GameState): Avail[] {
  const a: Avail[] = [];
  // Power-ups aren't sentence tokens. A finisher is only reachable when the line is a
  // complete sentence (the grammar gates it), and playing it ends the statement — the
  // DFS already appends it as a terminal flourish via canAppend, so no special handling.
  const usable = (c: Card) => c.role !== 'powerup';
  for (const c of state.pool) if (usable(c)) a.push({ card: c, source: 'pool' });
  for (const c of state.ai.hand) if (usable(c)) a.push({ card: c, source: 'hand' });
  if (PERIOD_ENABLED && !state.ai.usedPeriod) a.push({ card: PERIOD, source: 'period' }); // free, one per statement (gated off with the period experiment)
  return a;
}

export interface AiOptions {
  /**
   * Cap on tokens the AI plans ahead. Lower => shorter, human-scale statements
   * and fewer giant combos, so the AI is beatable by a player who chains their
   * own combos. Default 4 (about one solid clause).
   */
  maxExtend?: number;
  /** This statement is a flub — build toward a self-own instead of the best line.
   * Set by `aiTurn` from the opponent's nerves; default false (optimal play). */
  gaffing?: boolean;
  /** Hold back the mean power-ups (Typo/Forgot/Hot Mic) — nervous rookies don't
   * sabotage. Set by `aiTurn`; default false. */
  restrainPower?: boolean;
  /** Under Oath: compelled to build the most self-damaging statement reachable
   * ('confess' plan). Overrides gaffing/style AND all power-up play — a compelled
   * opponent can't Search/Typo its way out. Set by `aiTurn` from `state.ai.underOath`. */
  compelled?: boolean;
  /** Onboarding (Q1 of the first debate): play a clean single subject–verb, no combo,
   * no finisher, no gaffe/blunder — so the player's hint-driven combo clearly wins. */
  tutorialSimple?: boolean;
}

/**
 * Decide the AI's move this turn. Guarantees: never plays toward gibberish
 * (every take stays on a path to a grammatical sentence), never ends on an
 * incomplete line by choice, and never settles for a bland line when a stronger
 * reachable one exists.
 */
export function chooseMove(state: GameState, opts: AiOptions = {}): Move {
  const line = state.ai.line;
  const avail = availFor(state);
  const maxExtend = opts.maxExtend ?? 4;
  const styleCategory = state.opponent ? STYLE_CATEGORY[state.opponent.style] : undefined;
  // The player's relics are public passives — the AI plans its OWN lines against them
  // as defenderMods (a Teflon player devalues its attacks, so it organically pivots).
  const dm = playerRelicMods(state);
  // A compelled speaker never wants the 'best' plan — skip the wasted search.
  const best = opts.compelled ? null : plan(line, avail, { maxExtend, topicId: state.topic?.id, styleCategory, defenderMods: dm });

  // UNDER OATH: compelled to confess — build the most self-damaging completion
  // reachable (checked FIRST; overrides everything, including power-up escapes).
  // If no completion is reachable at all ('confess' null ⟺ 'best' null — same
  // DFS reachability), fall through to the best-prefix fallback at the bottom.
  if (opts.compelled) {
    const confession = plan(line, avail, { maxExtend, topicId: state.topic?.id, objective: 'confess', defenderMods: dm });
    if (confession) {
      if (confession.ext.length > 0) return { kind: 'take', from: confession.ext[0].source, cardId: confession.ext[0].card.id };
      if (isComplete(line)) return { kind: 'end' }; // the confession is out — commit to it
    }
  }

  // ONBOARDING (Q1): play a clean single subject–verb — no connectors, no finisher, no
  // sabotage — so the player's hint-driven combo clearly out-scores it. The plan maximizes
  // delta, so it naturally picks a positive attack/brag (never a self-own/audience insult).
  if (opts.tutorialSimple) {
    // As soon as the line is a complete clause, STOP — keep it a short subject–verb (the AI
    // re-plans every turn, so without this it would greedily pile on modifiers forever).
    if (isComplete(line)) return { kind: 'end' };
    // Build toward the best single clause: no connectors, no modifier asides, no finisher.
    const simpleAvail = avail.filter(
      (a) => a.card.role !== 'connector' && a.card.role !== 'intensifier' && a.card.role !== 'modifier',
    );
    const p = plan(line, simpleAvail, { maxExtend: Math.min(2, maxExtend), topicId: state.topic?.id, styleCategory, defenderMods: dm });
    if (p && p.ext.length > 0) return { kind: 'take', from: p.ext[0].source, cardId: p.ext[0].card.id };
    if (best && best.ext.length > 0) return { kind: 'take', from: best.ext[0].source, cardId: best.ext[0].card.id };
    return { kind: 'end' };
  }

  // GAFFE: a flustered opponent flubs its statement. Build toward the least-bad
  // self-own (allow a touch more depth so a good setup can precede the blunder).
  // If no self-own is reachable from here, fall through to normal play.
  if (opts.gaffing && !opts.compelled) {
    const flub = plan(line, avail, { maxExtend, topicId: state.topic?.id, objective: 'gaffe', defenderMods: dm });
    if (flub) {
      if (flub.ext.length > 0) return { kind: 'take', from: flub.ext[0].source, cardId: flub.ext[0].card.id };
      if (isComplete(line)) return { kind: 'end' }; // gaffe is complete — commit to it
    }
  }

  // Power-ups (simple heuristics; the AI ignores Plant — it's blind to the crowd).
  // Nervous rookies hold back the mean ones (restrainPower) and don't soundbite a gaffe.
  // A compelled (Under Oath) speaker plays NO power-ups — it's mid-confession, and the
  // Search branch below would otherwise fire whenever no completion is reachable.
  const power = (e: string) => (opts.compelled ? undefined : state.ai.hand.find((c) => c.role === 'powerup' && c.effect === e));
  const typo = power('typo');
  // Only Typo when it can force the player into a genuine self-own (not random gibberish).
  if (!opts.restrainPower && typo && !state.player.done && bestTypoJam(state, state.player.line).delta < 0) {
    return { kind: 'power', cardId: typo.id };
  }
  // Forgot My Line: knock the player's last card off to wreck a strong line
  // they're sitting on (a complete, high-scoring statement) or a long combo.
  const forgot = power('forgot');
  if (!opts.restrainPower && forgot && !state.player.done && state.player.line.length > 0) {
    const pl = state.player.line;
    // Scoring the PLAYER's line → their own relic mods apply (still no crowd).
    const strong = isComplete(pl) && scoreStatement(pl, { topicId: state.topic?.id, mods: dm }).delta >= 4;
    const bigCombo = pl.length >= 4;
    if (strong || bigCombo) return { kind: 'power', cardId: forgot.id };
  }
  const hotmic = power('hotmic');
  // (effect !== 'oath': the player holding Under Oath alone is not steal bait — the AI
  // can't use it, and stealing the scripted story card would delete it from the run.)
  if (!opts.restrainPower && hotmic && state.player.hand.some((c) => c.role === 'powerup' && c.effect !== 'oath')) {
    return { kind: 'power', cardId: hotmic.id }; // steal the player's power-up (auto-target)
  }
  const search = power('search');
  if (search && line.length === 0 && (!best || best.delta < 2.5)) {
    return { kind: 'power', cardId: search.id }; // draw into a better hand
  }

  if (best && best.ext.length === 0) {
    // Stopping here is the best option and the line is complete.
    return { kind: 'end' };
  }

  if (best && best.ext.length > 0) {
    const next = best.ext[0];
    return { kind: 'take', from: next.source, cardId: next.card.id };
  }

  // No completion reachable. Keep building toward the longest valid prefix if we
  // can; otherwise end (and eat the "confused" penalty) rather than soft-lock.
  const legal = avail.filter((a) => canAppend(line, a.card));
  if (legal.length > 0) {
    // Prefer a card that opens the most future room: subjects first when empty,
    // then by punchiness.
    legal.sort((x, y) => extendScore(line, y) - extendScore(line, x));
    const pick = legal[0];
    return { kind: 'take', from: pick.source, cardId: pick.card.id };
  }
  if (line.length > 0) return { kind: 'end' };
  // Truly nothing to do (empty line, no legal card) — shouldn't happen with a
  // stocked pool, but end defensively.
  return { kind: 'end' };
}

// --- nerves & gaffes --------------------------------------------------------

const NERVOUS_STEP = 0.3; // gaffe-chance bump per active "nervous" trigger
const NERVOUS_MIN = 12; // only a strong player statement (a cheer) rattles an opponent

/**
 * Extra gaffe chance from the player having just rattled this opponent. The
 * opponent is flustered by its `nervousOf` triggers — but only by a *strong*
 * statement, and only when the player has actually spoken this question. This is
 * the opponent's hidden tell for the player to discover.
 */
function nervousBonus(state: GameState): number {
  const opp = state.opponent;
  if (!opp?.nervousOf?.length || !state.player.done) return 0;
  if (Math.abs(state.player.lastReaction?.delta ?? 0) < NERVOUS_MIN) return 0;
  const cat = dominantCategory(state.player.line);
  const trig: NervousTrigger | null =
    cat === 'attack_opp' ? 'attacked' : cat === 'pander_aud' ? 'pander' : cat === 'praise_self' ? 'self_brag' : null;
  return trig && opp.nervousOf.includes(trig) ? NERVOUS_STEP : 0;
}

/**
 * The RNG-aware entry point for the AI's turn (use this from the UI, not
 * chooseMove directly). When a statement starts, it rolls — using the game's
 * seeded RNG — whether the opponent flubs this one, based on its `gaffeChance`
 * plus how rattled it is. Nervous rookies also hold back their mean power-ups.
 */
export function aiTurn(state: GameState, opts: AiOptions = {}): Move {
  const opp = state.opponent;
  const simple = !!state.tutorial && state.round === 1; // onboarding: never gaffe on Q1
  // Under Oath overrides nerves entirely — skip the roll so it can't overwrite the
  // compulsion (this also bypasses the boss's gaffeChance 0: the oath, not luck, forces
  // the confession — the whole point of the card).
  const compelled = !!state.ai.underOath;
  if (opp && !compelled && state.ai.line.length === 0) {
    const chance = Math.min(0.95, (opp.gaffeChance ?? 0) + nervousBonus(state));
    state.ai.gaffing = !simple && chance > 0 && gameRng(state)() < chance;
  }
  const restrainPower = (opp?.gaffeChance ?? 0) >= 0.25;
  return chooseMove(state, { maxExtend: opts.maxExtend, gaffing: state.ai.gaffing, restrainPower, tutorialSimple: simple && !compelled, compelled });
}

/** Heuristic for the fallback branch: how promising is appending this card? */
function extendScore(line: Card[], a: Avail): number {
  const roles = rolesOf(a.card);
  if (line.length === 0) return roles.includes('np') ? 10 : -10; // must open with a subject
  let s = 0;
  if (roles.includes('predicate')) s += 3 + Math.abs(a.card.sentiment ?? 0);
  if (roles.includes('modifier')) s += 2 + Math.abs(a.card.sentiment ?? 0); // an aside on the subject
  if (roles.includes('np')) s += Math.abs(a.card.sentiment ?? 0);
  return s;
}
