import type { Card, Category, Crowd, PredInstance, Reaction, ReactionLabel, SentenceStructure, Side } from './types';
import { isComplete, parse } from './grammar';
import { renderSentence } from './morphology';

// Deterministic audience-reaction scoring. `delta` is signed TOWARD THE SPEAKER:
// positive = good for whoever said it. Each predicate carries a polarity P; the
// subject decides who it lands on and what CATEGORY the play is.

const SCALE = 5;
const CONFUSED_PENALTY = -5;
const STATEMENT_CAP = 35;
const INTENSIFIED_CAP = 50;
const COMBO_MIN = 6;
const RAMBLE_PENALTY = 3;
const DODGE_PENALTY = 5;
const BLUNDER_MULT = 1.6; // self-owns and audience-insults hurt extra

/**
 * How a clause's subject maps to a scorebar effect. Named sides have fixed
 * weights; a NEUTRAL noun acts as a hero (sentiment ≥ 0 → praising it is good)
 * or a villain (sentiment < 0 → bashing it is good) at a solid mid-weight, so
 * "shady lobbyists are a national disgrace" actually lands.
 */
function targetFor(subject?: Card): { sign: number; weight: number } {
  const k = subject?.intensity ?? 1; // loaded subjects amplify their clause
  const side = subject?.side ?? 'neutral';
  if (side === 'self') return { sign: +1, weight: 1.0 * k };
  if (side === 'opponent') return { sign: -1, weight: 1.0 * k };
  if (side === 'audience') return { sign: +1, weight: 1.3 * k };
  return { sign: (subject?.sentiment ?? 0) < 0 ? -1 : +1, weight: 0.6 * k }; // villain vs hero
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
}

function contributions(structure: SentenceStructure): Contrib[] {
  const out: Contrib[] = [];
  for (const clause of structure.clauses) {
    const side: Side = clause.subject?.side ?? 'neutral';
    const t = targetFor(clause.subject);
    for (const p of clause.preds) {
      const P = predP(p);
      const category = predCategory(side, P);
      let delta = t.sign * P * t.weight * SCALE;
      // Blunders sting extra: owning yourself or insulting the audience.
      if (category === 'self_own' || category === 'insult_aud') delta *= BLUNDER_MULT;
      out.push({ delta, category });
    }
  }
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

export interface ScoreOptions {
  topicId?: string;
  /** The crowd's hidden taste — applied only at resolution, never by the AI. */
  crowd?: Crowd;
}

export function scoreStatement(line: Card[], opts: ScoreOptions = {}): Reaction {
  if (!isComplete(line)) {
    return {
      delta: CONFUSED_PENALTY,
      label: 'confused',
      detail: 'The audience looks confused — that was not a complete statement.',
      grammatical: false,
    };
  }

  const contribs = contributions(parse(line));
  // The crowd's hidden taste amplifies matching contributions.
  let crowdPleased = false;
  const deltas = contribs.map((c) => {
    if (opts.crowd && c.category === opts.crowd.loves) {
      crowdPleased = true;
      return c.delta * opts.crowd.boost;
    }
    return c.delta;
  });

  let total = deltas.reduce((a, b) => a + b, 0);

  if (deltas.length >= 2) {
    const sameSign = deltas.every((d) => d > 0) || deltas.every((d) => d < 0);
    const allStrong = deltas.every((d) => Math.abs(d) >= COMBO_MIN);
    if (sameSign && allStrong) total *= 1.25;
    else total -= RAMBLE_PENALTY * deltas.filter((d) => Math.abs(d) < 2).length;
  }

  total = Math.max(-STATEMENT_CAP, Math.min(STATEMENT_CAP, total));

  const factor = line.reduce((f, c) => (c.role === 'intensifier' ? f * (c.factor ?? 1) : f), 1);
  total *= factor;

  const dodged = !!opts.topicId && !line.some((c) => c.topics?.includes(opts.topicId!));
  if (dodged) total -= DODGE_PENALTY;

  total = Math.max(-INTENSIFIED_CAP, Math.min(INTENSIFIED_CAP, total));
  total = Math.round(total * 10) / 10;
  const label = labelFor(total);

  let note = dodged ? ' (and dodged the question!)' : '';
  // Subtle tell: a big reaction the crowd specially loved hints at their taste.
  if (crowdPleased && total >= 12) note += ' This crowd is especially fired up by that.';
  else if (crowdPleased && total <= -12) note += ' (Somehow that landed even harder than usual.)';

  return {
    delta: total,
    label,
    detail: `${renderSentence(line)} — ${describe(label, total)}${note}`,
    grammatical: true,
  };
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
