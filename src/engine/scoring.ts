import type { Card, Category, Crowd, PhraseHit, PredInstance, Reaction, ReactionLabel, SentenceStructure, Side } from './types';
import { firstInvalidIndex, isComplete, isValidPrefix, parse } from './grammar';
import { renderSentence } from './morphology';

// Deterministic audience-reaction scoring. `delta` is signed TOWARD THE SPEAKER:
// positive = good for whoever said it. Each predicate carries a polarity P; the
// subject decides who it lands on and what CATEGORY the play is.

// SCALE is deliberately small relative to the ±35 cap: a single strong clause
// lands around a third of the cap, leaving headroom for stacking and combos to
// climb. (If one clause nearly caps, every line saturates and combos lose their
// edge — see the worked examples in tests/scoring.test.ts.)
const SCALE = 2.5;
// An incomplete/ungrammatical line isn't a hard zero — we read its partial intent
// but muffle it (×CONFUSION_DAMPEN) and cap the swing (±CONFUSION_CAP), so rambling
// scores mild + a coaching note rather than locking the player out.
const CONFUSION_DAMPEN = 0.5;
const CONFUSION_CAP = 8;
// Incoherence has a MILD, scaling cost: a genuinely ungrammatical line (not merely an
// unfinished-but-valid prefix) puzzles the crowd, and the more of it is salad the more it
// stings — so mashing cards is never free (you can't dodge a blunder by piling errors after
// it, and pure gibberish nets mildly negative, never ~0). Capped small — a single misordered
// card (often a misclick after the pool shifts) costs almost nothing.
const BAFFLE_BASE = 1.5; // cost of one stray/misordered token
const BAFFLE_STEP = 1.0; // extra cost per additional salad token
const BAFFLE_CAP = 6; // ceiling — even a total word salad stays only mildly negative
const BAFFLE_STROKE = 4; // ≥ this many salad tokens earns the "had a stroke?" flavor
const STATEMENT_CAP = 35;
const INTENSIFIED_CAP = 50;
// Headliners: powerful cards and long combo-chains raise the per-line cap (added to
// both clamps below, shifting them up together so the finisher's room is preserved).
// Bounded so a single statement can't become a knockout (soft ≤50, hard ≤65).
const HEADROOM_MAX = 15;
const CHAIN_STEP = 3; // headroom per combo junction — rewards chaining, not raw piling
const COMBO_MIN = 3; // min |delta| for a clause to be combo-eligible (≈ SCALE)
const COMBO_AND = 1.25; // 'and' reinforce combo
const COMBO_LOGIC = 1.3; // 'because' / 'and therefore' — joining logically scores better
const COMBO_BUT = 1.4; // 'but' pivot combo (them-bad → us-good), the strongest
// Diminishing returns for clauses NOT bound into a combo (e.g. period-joined):
// strongest clause full, each extra worth much less. The tail is short on purpose
// so piling unrelated sentences flattens fast (asymptote ≈ 1.45× the best clause)
// while a real combo multiplies past it.
const DECAY = [1.0, 0.3, 0.1, 0.04, 0.02];
const BUT_MITIGATE = 1.1; // softened blunder mult when a 'but' deflection follows a self-own
// Off-topic is a MULTIPLICATIVE penalty (not flat), so a big statement can't
// cheaply ignore the question to chase the crowd — the bigger the off-topic play,
// the more it loses. Applied to positive totals only (a bomb is already a bomb).
const OFF_TOPIC_MULT = 0.75;
// Rambling: past RAMBLE_LIMIT simple (non-combo) sentences, each extra one HURTS,
// to teach "be concise / combo with connectors" rather than pile single sentences.
const RAMBLE_LIMIT = 3;
const RAMBLE_STEP = 2.5;
const BLUNDER_MULT = 1.6; // self-owns and audience-insults hurt extra

/**
 * A subject's EFFECTIVE side for scoring. A "thing" noun (side 'neutral') is
 * never inert: it plays as a crowd-beloved cause (sentiment ≥ 0 → audience, so
 * praising it pleases the crowd and trashing it is a blunder) or as a shared
 * villain (sentiment < 0 → opponent, so bashing it lands like an attack and
 * praising it backfires). So "I firmly support the economy" / "the swamp is a
 * disgrace" both score and react to the crowd — nothing is a dead, neutral play.
 */
function effectiveSide(subject?: Card): Side {
  const side = subject?.side ?? 'neutral';
  if (side !== 'neutral') return side;
  return (subject?.sentiment ?? 0) < 0 ? 'opponent' : 'audience';
}

/** How a clause's subject maps to a scorebar effect (sign + weight × intensity). */
function targetFor(subject?: Card): { sign: number; weight: number } {
  const k = subject?.intensity ?? 1; // loaded subjects amplify their clause
  const side = effectiveSide(subject);
  if (side === 'opponent') return { sign: -1, weight: 1.0 * k };
  if (side === 'audience') return { sign: +1, weight: 1.3 * k };
  return { sign: +1, weight: 1.0 * k }; // self
}

/** The three categories a player aims for (and a crowd may love). */
const GOOD = new Set<Category>(['praise_self', 'attack_opp', 'pander_aud']);

function predP(p: PredInstance): number {
  const c = p.card;
  if (c.open) return (c.deed ?? 0) + (c.affinity ?? 0) * (p.object?.sentiment ?? 0);
  return c.sentiment ?? 0;
}

function predCategory(side: Side, P: number): Category {
  if (Math.abs(P) < 0.01) return 'neutral';
  if (side === 'self') return P > 0 ? 'praise_self' : 'self_own';
  if (side === 'opponent') return P < 0 ? 'attack_opp' : 'boost_opp';
  if (side === 'audience') return P > 0 ? 'pander_aud' : 'insult_aud';
  return 'neutral';
}

interface Contrib {
  delta: number; // signed toward the speaker
  category: Category;
  side: Side;
  /** Base id of the predicate (instance suffix stripped) — for distinctness. */
  predBase: string;
  /** Connector immediately preceding this contribution (undefined = first). */
  joinedByPrev?: NonNullable<Card['conj']>;
  /** Token index of that connector — marks the junction word for an inline chip. */
  connIdx?: number;
  /** A blunder-direction modifier aside (self-own / audience-insult / opponent-boost):
   * scored at full strength OUTSIDE the combo/decay machinery so same-clause praise
   * can't quietly net it away. (Good-direction modifiers fold into the clause instead.) */
  aside?: boolean;
  /** Token indices for highlighting this phrase in the resolution animation. */
  subjectIdx?: number;
  predIdx?: number;
  objIdx?: number;
  modIdxs?: number[];
  /** Set in scoreStatement when this contribution got the hidden-crowd boost. */
  crowdFavorite?: boolean;
}

/** Inclusive word-index span covering a contribution's tokens (for the highlight glow). */
function spanOf(c: Contrib): [number, number] | undefined {
  const idxs = [c.subjectIdx, c.predIdx, c.objIdx, ...(c.modIdxs ?? [])].filter(
    (n): n is number => n !== undefined,
  );
  return idxs.length ? [Math.min(...idxs), Math.max(...idxs)] : undefined;
}

function contributions(structure: SentenceStructure): Contrib[] {
  const out: Contrib[] = [];
  structure.clauses.forEach((clause) => {
    const side: Side = effectiveSide(clause.subject);
    const t = targetFor(clause.subject);
    // Signed delta + category for a polarity P on this clause's subject — shared by
    // predicates and modifier asides, so misuse blunders the same way for both.
    const signed = (P: number): { delta: number; category: Category } => {
      const category = predCategory(side, P);
      let delta = t.sign * P * t.weight * SCALE;
      // Blunders sting extra: owning yourself or insulting the audience.
      if (category === 'self_own' || category === 'insult_aud') delta *= BLUNDER_MULT;
      return { delta, category };
    };

    // Split the clause's modifier asides by direction:
    //  - GOOD ones (help the clause: attack an opponent, praise yourself/the crowd) FOLD
    //    into the clause's first contribution — they intensify it and ride any combo.
    //  - BLUNDER ones (self-own / audience-insult / opponent-boost) are scored SEPARATELY
    //    at full strength (`aside`), so same-clause praise can't quietly net them away —
    //    calling the crowd ugly should sting even if you pander in the same breath.
    let goodModDelta = 0;
    const asides: Contrib[] = [];
    let goodModCat: Category = 'neutral';
    (clause.mods ?? []).forEach((m, mi) => {
      const { delta, category } = signed(m.sentiment ?? 0);
      const modIdx = clause.modIdxs?.[mi];
      if (delta > 0) {
        goodModDelta += delta;
        goodModCat = category;
      } else {
        asides.push({
          delta, category, side, predBase: m.id.split('#')[0], aside: true,
          subjectIdx: clause.subjectIdx, predIdx: modIdx, modIdxs: modIdx !== undefined ? [modIdx] : undefined,
        });
      }
    });

    const clauseContribs: Contrib[] = clause.preds.map((p, pi) => {
      const { delta, category } = signed(predP(p));
      // The connector before this contribution: within a clause it's the
      // predicate's coordinating connector; for a clause's first predicate it's
      // the clause-join from the previous clause.
      const joinedByPrev = pi > 0 ? p.joinedBy : clause.joinedByPrev;
      const connIdx = pi > 0 ? p.connIdx : clause.connIdx;
      return {
        delta, category, side, predBase: p.card.id.split('#')[0], joinedByPrev, connIdx,
        subjectIdx: clause.subjectIdx, predIdx: p.predIdx, objIdx: p.objIdx,
      };
    });

    if (clauseContribs.length > 0) {
      // Fold good-direction asides into the clause's first contribution to INTENSIFY it — but
      // ONLY when that contribution is itself good. A good aside must not rescue a blunder:
      // bragging "who is winning by every metric" doesn't undo "I secretly eat babies" — a
      // self-own stays a self-own (else the gaffe scores positive; see scoring.test.ts).
      if (clauseContribs[0].delta > 0) clauseContribs[0].delta += goodModDelta;
    } else if (goodModDelta !== 0) {
      // A subject + good modifier with no predicate (a stall): keep the partial intent so
      // the lenient "confused" path still reads it.
      out.push({
        delta: goodModDelta, category: goodModCat, side, predBase: 'mod',
        joinedByPrev: clause.joinedByPrev, connIdx: clause.connIdx,
        subjectIdx: clause.subjectIdx, predIdx: clause.modIdxs?.[0], modIdxs: clause.modIdxs,
      });
    }
    out.push(...clauseContribs, ...asides);
  });
  return out;
}

/** The statement's dominant "good" category (what kind of play it mainly is). */
export function dominantCategory(line: Card[]): Category {
  let best: Category = 'neutral';
  let bestVal = 0;
  for (const c of contributions(parse(line))) {
    if (GOOD.has(c.category) && c.delta > bestVal) {
      bestVal = c.delta;
      best = c.category;
    }
  }
  return best;
}

function labelFor(delta: number): ReactionLabel {
  if (delta > 12) return 'cheers';
  if (delta >= 4) return 'approve';
  if (delta > -4) return 'neutral';
  if (delta > -12) return 'disapprove';
  return 'boos';
}

type Tier = 'reinforce' | 'logic' | 'pivot' | 'none';

function tierOf(conj?: NonNullable<Card['conj']>): Tier {
  if (conj === 'and') return 'reinforce';
  if (conj === 'because' || conj === 'and therefore') return 'logic';
  if (conj === 'but') return 'pivot';
  return 'none'; // 'period' or no connector — legal, but no combo
}

const TIER_MULT: Record<'reinforce' | 'logic' | 'pivot', number> = {
  reinforce: COMBO_AND,
  logic: COMBO_LOGIC,
  pivot: COMBO_BUT,
};
const TIER_KIND: Record<'reinforce' | 'logic' | 'pivot', 'and' | 'logic' | 'but'> = {
  reinforce: 'and',
  logic: 'logic',
  pivot: 'but',
};

const isGood = (c: Contrib) => c.delta > 0;
const isSelfOwn = (c: Contrib) => c.category === 'self_own' || c.category === 'insult_aud';
const isStrong = (c: Contrib) => Math.abs(c.delta) >= COMBO_MIN;
const distinct = (a: Contrib, b: Contrib) => a.side !== b.side || a.predBase !== b.predBase;

/** Strongest clause full, each extra worth progressively less (period stacking). */
function decayAggregate(deltas: number[]): number {
  return deltas
    .slice()
    .sort((a, b) => Math.abs(b) - Math.abs(a))
    .reduce((sum, d, i) => sum + d * (DECAY[i] ?? DECAY[DECAY.length - 1]), 0);
}

interface Aggregated {
  total: number;
  combo?: { kind: 'and' | 'logic' | 'but'; mult: number };
  /** A 'but' deflected a self-own → read as confusion, not outrage, when net negative. */
  mitigated: boolean;
  /** How many simple (non-combo) sentences the line stacked — drives the ramble penalty. */
  residualCount: number;
  /** Each connector token that formed a combo, tagged with its own tier (so the UI
   * can paint a chip on that exact junction word). */
  chips: { tokenIdx: number; kind: 'and' | 'logic' | 'but' }[];
}

/**
 * Connector-fit combo scoring. Contributions joined by a correctly-used
 * conjunction bind into a combo group (summed full, then multiplied); a 'but'
 * after a self-own *mitigates* it; everything else stacks with diminishing
 * returns. See the scoring spec for the worked examples this realizes.
 */
function aggregate(cs: Contrib[]): Aggregated {
  const n = cs.length;
  if (n === 0) return { total: 0, mitigated: false, residualCount: 0, chips: [] };

  const used = new Array<boolean>(n).fill(false); // consumed by a 'but' mitigation
  let mitigatedTotal = 0;
  let mitigated = false;

  // Step C — 'but' deflection: "I kick puppies but my opponent eats babies".
  // Soften the self-own's blunder and pair it with the deflecting good clause.
  for (let i = 1; i < n; i++) {
    if (used[i] || used[i - 1]) continue;
    if (cs[i].joinedByPrev === 'but' && isSelfOwn(cs[i - 1]) && isGood(cs[i])) {
      const softened = (cs[i - 1].delta / BLUNDER_MULT) * BUT_MITIGATE;
      mitigatedTotal += softened + cs[i].delta;
      used[i - 1] = used[i] = true;
      mitigated = true;
    }
  }

  // Step A/B — bind consecutive contributions into combo groups.
  const bonds: (Tier | null)[] = new Array(n).fill(null); // bonds[i] joins i-1 & i
  for (let i = 1; i < n; i++) {
    if (used[i] || used[i - 1]) continue;
    const a = cs[i - 1];
    const b = cs[i];
    if (!isStrong(a) || !isStrong(b)) continue;
    const tier = tierOf(b.joinedByPrev);
    if (tier === 'reinforce' || tier === 'logic') {
      if (isGood(a) && isGood(b) && distinct(a, b)) bonds[i] = tier;
    } else if (tier === 'pivot') {
      // pivot-praise: them-bad → us-good (both help you, different sides)
      if (isGood(a) && isGood(b) && a.side !== b.side) bonds[i] = tier;
    }
  }

  let comboTotal = 0;
  let best: { kind: 'and' | 'logic' | 'but'; mult: number } | undefined;
  const inGroup = new Array<boolean>(n).fill(false);
  for (let i = 1; i < n; i++) {
    if (bonds[i] === null) continue;
    // Walk the maximal run of contributions chained by bonds starting here.
    const start = i - 1;
    let end = i;
    let topTier: 'reinforce' | 'logic' | 'pivot' = bonds[i] as 'reinforce' | 'logic' | 'pivot';
    while (end + 1 < n && bonds[end + 1] !== null) {
      end++;
      const t = bonds[end] as 'reinforce' | 'logic' | 'pivot';
      if (TIER_MULT[t] > TIER_MULT[topTier]) topTier = t;
    }
    let sum = 0;
    for (let j = start; j <= end; j++) {
      sum += cs[j].delta;
      inGroup[j] = true;
    }
    const mult = TIER_MULT[topTier];
    comboTotal += sum * mult;
    if (!best || mult > best.mult) best = { kind: TIER_KIND[topTier], mult };
    i = end; // skip past this group
  }

  // Residual — singletons & period-joined clauses stack with diminishing returns.
  const residual = cs.filter((_, i) => !used[i] && !inGroup[i]).map((c) => c.delta);
  const total = comboTotal + decayAggregate(residual) + mitigatedTotal;

  // A chip per connector that formed a combo, each tagged with ITS OWN tier (so
  // "A and B because C" paints the "and" as COMBO and the "because" as CHAIN).
  const chips: Aggregated['chips'] = [];
  for (let i = 1; i < n; i++) {
    const t = bonds[i];
    if (t === null || t === 'none') continue;
    const idx = cs[i].connIdx;
    if (idx !== undefined) chips.push({ tokenIdx: idx, kind: TIER_KIND[t] });
  }
  return { total, combo: best, mitigated, residualCount: residual.length, chips };
}

export interface ScoreOptions {
  topicId?: string;
  /** The crowd's hidden taste — applied only at resolution, never by the AI. */
  crowd?: Crowd;
}

export function scoreStatement(line: Card[], opts: ScoreOptions = {}): Reaction {
  if (!isComplete(line)) {
    // Lenient: read whatever coherent intent the partial line has, muffled, with a
    // coaching note. A bare fragment nets ~0 (a wasted, mumbled turn); a half-formed
    // jab leans mildly +/-. Never a soft-lock or a forced self-own.
    //
    // EXCEPT — an egregious BLUNDER (self-own / audience-insult / opponent-boost) PUNCHES
    // THROUGH the muffle at full strength: you can't ramble your way out of insulting the
    // crowd or owning yourself, even in word salad. Only the *rest* of the salad is dampened
    // + capped; the blunder lands at its real (already ×1.6) value.
    const contribs = contributions(parse(line));
    // Only a GENUINE, attributable blunder punches through — one with an explicit subject.
    // A negative predicate orphaned by a missing subject defaults to the audience side, but
    // that's a garble artifact, not a real crowd insult, so it stays muffled (don't hammer a
    // fumbled long statement for an insult the player never made).
    const isBlunder = (c: Contrib) =>
      (c.category === 'self_own' || c.category === 'insult_aud' || c.category === 'boost_opp') &&
      c.subjectIdx !== undefined;
    const bad = firstInvalidIndex(line); // where parsing actually broke (−1 if just unfinished)
    const blunderTotal = contribs.filter(isBlunder).reduce((s, c) => s + c.delta, 0); // ≤ 0
    let rest = aggregate(contribs.filter((c) => !isBlunder(c))).total * CONFUSION_DAMPEN;
    rest = Math.max(-CONFUSION_CAP, Math.min(CONFUSION_CAP, rest));
    // As in the full path: an audience insult anywhere poisons the (muffled) positives too.
    if (rest > 0 && contribs.some((c) => c.category === 'insult_aud')) rest = 0;
    // The more scrambled the line, the less positive "drift" the crowd actually catches: scale
    // the muffled UPSIDE by how much parsed before the break (a line that's salad from the start
    // keeps almost none of the intent the greedy parser scraped out of the jumble). Downside is
    // never softened this way — a blunder is a blunder.
    if (rest > 0 && bad >= 0) rest *= bad / line.length;
    // Bafflement penalty: only when the line is genuinely ungrammatical (bad ≥ 0), scaled by how
    // many tokens are salad. An unfinished-but-valid line (bad < 0) is a mumble, not a baffler —
    // it pays nothing. So gibberish nets mildly NEGATIVE, while a near-miss costs almost nothing.
    const stray = bad >= 0 ? line.length - bad : 0; // tokens from the break onward
    const baffle = bad >= 0 ? -Math.min(BAFFLE_CAP, BAFFLE_BASE + BAFFLE_STEP * (stray - 1)) : 0;
    let total = Math.max(-STATEMENT_CAP, Math.min(STATEMENT_CAP, blunderTotal + rest + baffle));
    total = Math.round(total * 10) / 10;
    const confusedSpan: [number, number] | undefined = bad >= 0 ? [bad, line.length - 1] : undefined;
    return { delta: total, label: 'confused', detail: confusedDetail(line, total, stray), grammatical: false, runOn: looksRunOn(line), confusedSpan };
  }

  // The crowd's hidden taste amplifies your single BEST on-taste contribution.
  // (Only the best one — the crowd gets excited once by a line they love;
  // repeating the same pander five times doesn't compound, so monotonous piling
  // can't farm the boost. A combo containing the matched clause still multiplies
  // the boosted value, rewarding skillful crowd-reading.)
  let crowdPleased = false;
  const contribs = contributions(parse(line));
  if (opts.crowd) {
    let bestIdx = -1;
    let bestMag = 0;
    contribs.forEach((c, i) => {
      if (c.category === opts.crowd!.loves && Math.abs(c.delta) > bestMag) {
        bestMag = Math.abs(c.delta);
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) {
      crowdPleased = true;
      contribs[bestIdx] = { ...contribs[bestIdx], delta: contribs[bestIdx].delta * opts.crowd.boost, crowdFavorite: true };
    }
  }

  const audienceInsulted = contribs.some((c) => c.category === 'insult_aud');
  const selfOwnAside = contribs.some((c) => c.aside && c.category === 'self_own');
  // Insulting the crowd poisons the whole statement: an offended audience won't credit
  // any of your positive plays — pandering or compliments later in the line can't buy it
  // back. So zero the positives and let the insult stand.
  const scored = audienceInsulted ? contribs.map((c) => (c.delta > 0 ? { ...c, delta: 0 } : c)) : contribs;

  // Combos/decay run over the clause contributions; blunder-direction asides are added at
  // full strength on top (no combo, no diminishing returns).
  const agg = aggregate(scored.filter((c) => !c.aside));
  const asideDelta = scored.filter((c) => c.aside).reduce((s, c) => s + c.delta, 0);
  let total = agg.total + asideDelta;
  // Rambling: too many simple sentences with no combos — each extra one hurts.
  const rambling = agg.residualCount > RAMBLE_LIMIT;
  if (rambling) total -= RAMBLE_STEP * (agg.residualCount - RAMBLE_LIMIT);
  // Headliners: powerful cards (`ceiling`) and combo-chaining (`agg.chips`, one per combo
  // junction — NOT raw card count, so piling earns nothing) raise both caps together.
  const cardCeil = line.reduce((s, c) => s + (c.ceiling ?? 0), 0);
  const headroom = Math.min(HEADROOM_MAX, cardCeil + CHAIN_STEP * agg.chips.length);
  const softCap = STATEMENT_CAP + headroom;
  const hardCap = INTENSIFIED_CAP + headroom;
  total = Math.max(-softCap, Math.min(softCap, total));

  const factor = line.reduce((f, c) => (c.role === 'intensifier' ? f * (c.factor ?? 1) : f), 1);
  total *= factor;

  // Off-topic shrinks a good statement (can't out-pander the question); a bomb is
  // already a bomb, so leave non-positive totals alone.
  const dodged = !!opts.topicId && !line.some((c) => c.topics?.includes(opts.topicId!));
  if (dodged && total > 0) total *= OFF_TOPIC_MULT;

  total = Math.max(-hardCap, Math.min(hardCap, total));
  total = Math.round(total * 10) / 10;
  // A 'but' that deflected a self-own reads as confusion, not outrage — and so does
  // calling YOURSELF ugly: a muddled self-insult confuses the crowd rather than enraging it.
  let label = agg.mitigated && total < 0 ? 'confused' : labelFor(total);
  if (selfOwnAside && total <= 0) label = 'confused';

  let note = dodged ? ' (and dodged the question!)' : '';
  if (audienceInsulted && total < 0) note += ' You insulted the crowd — no amount of pandering wins them back.';
  if (rambling) note += ' The crowd starts to nod off — be concise, or chain combos with connectors.';
  // Subtle tell: a big reaction the crowd specially loved hints at their taste.
  if (crowdPleased && total >= 12) note += ' This crowd is especially fired up by that.';
  else if (crowdPleased && total <= -12) note += ' (Somehow that landed even harder than usual.)';

  // Per-phrase breakdown for the resolution animation — built from the final (crowd-/
  // poison-adjusted) contributions so categories, spans and effective magnitudes match
  // what actually counted. Inert (neutral) phrases are dropped — nothing to show.
  const breakdown: PhraseHit[] = scored
    .filter((c) => c.category !== 'neutral')
    .map((c) => ({
      category: c.category,
      delta: c.delta,
      tokenIdx: c.predIdx ?? c.subjectIdx ?? 0,
      span: spanOf(c),
      aside: c.aside || undefined,
      crowdFavorite: c.crowdFavorite || undefined,
    }));

  return {
    delta: total,
    label,
    detail: `${renderSentence(line)} — ${describe(label, total)}${note}`,
    grammatical: true,
    combo: agg.combo,
    comboChips: agg.chips.length ? agg.chips : undefined,
    breakdown: breakdown.length ? breakdown : undefined,
    offTopic: dodged || undefined,
    rambling: rambling || undefined,
    audienceInsulted: audienceInsulted || undefined,
    crowdFavorite: crowdPleased || undefined,
    mitigated: agg.mitigated || undefined,
  };
}

/**
 * A run-on: two (or more) complete thoughts jammed together with no connector,
 * e.g. "My opponent sucks I am great". Detected by a clean split into two complete
 * sentences. Distinct from a half-finished line (needs an ending) or word salad.
 */
function looksRunOn(line: Card[]): boolean {
  for (let i = 1; i < line.length; i++) {
    if (isComplete(line.slice(0, i)) && isComplete(line.slice(i))) return true;
  }
  return false;
}

/** Flavor for an incomplete/ungrammatical statement — coaching, deterministic by shape. */
function confusedDetail(line: Card[], total: number, stray = 0): string {
  // Shapes: a run-on needs punctuation/a connector; a valid-but-unfinished line needs an
  // ending; a deeply scrambled line ("had a stroke?"); anything else is jumbled word salad.
  let lead: string;
  if (looksRunOn(line)) {
    lead = 'the crowd can’t tell where one thought ends and the next begins — you slammed two thoughts together at full speed. Make one clear point, or use “and” to chain them into a combo';
  } else if (isValidPrefix(line)) {
    lead = 'the audience leans in for the rest of that sentence… and you just stop — land the thought before you drop the mic';
  } else if (stray >= BAFFLE_STROKE) {
    lead = 'everyone is utterly baffled by your word salad — the audience wonders aloud if you’ve just had a stroke. Try your words in an order a human would actually say';
  } else {
    lead = 'the crowd blinks, then mutters — that came out as word salad. Try your words in an order a human would actually say';
  }
  const gist = total > 1 ? ` (they caught your drift anyway, +${total})` : total < -1 ? ` (and somehow it still landed badly, ${total})` : '';
  return `${renderSentence(line)} — ${lead}.${gist}`;
}

function describe(label: ReactionLabel, delta: number): string {
  const mag = Math.abs(delta).toFixed(1);
  switch (label) {
    case 'cheers':
      return `the crowd roars in approval (+${mag}).`;
    case 'approve':
      return `the audience nods along (+${mag}).`;
    case 'neutral':
      return `a polite, muted reaction (${delta >= 0 ? '+' : ''}${delta}).`;
    case 'disapprove':
      return `the room turns against you (${mag} lost).`;
    case 'boos':
      return `boos rain down from the crowd (${mag} lost).`;
    case 'confused':
      return 'confused murmuring.';
  }
}
