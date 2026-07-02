import { describe, it, expect } from 'vitest';
import { scoreStatement } from '../src/engine/scoring';
import { findDef, PERIOD } from '../src/data/cards';
import type { Card } from '../src/engine/types';

function cards(...ids: string[]): Card[] {
  return ids.map((id) => {
    if (id === 'c_period') return PERIOD; // the free virtual connector (not in any deck)
    const c = findDef(id);
    if (!c) throw new Error(`no card ${id}`);
    return c;
  });
}
const delta = (...ids: string[]) => scoreStatement(cards(...ids)).delta;
const combo = (...ids: string[]) => scoreStatement(cards(...ids)).combo;

describe('scoring — chunk predicates', () => {
  it('praising yourself is positive', () => {
    expect(delta('s_i', 'p_deliver')).toBeGreaterThan(4); // "I deliver blue skies and happiness"
  });

  it('pandering to the audience is strongly positive', () => {
    expect(delta('s_people', 'p_free_icecream')).toBeGreaterThan(8); // a +3 pander on the crowd (×1.3 weight)
  });

  it('insulting the opponent helps the speaker', () => {
    expect(delta('s_opp', 'p_kick_pup')).toBeGreaterThan(4); // "My opponent kicks puppies"
  });

  it('complimenting the opponent backfires', () => {
    expect(delta('s_opp', 'p_patriot')).toBeLessThan(-4); // "My opponent is a true patriot"
  });

  it('insulting yourself is negative', () => {
    expect(delta('s_i', 'p_disgrace')).toBeLessThan(-6); // self-own of a standard (−2) insult
  });

  it('insulting the audience is a large negative', () => {
    // audience weight (1.3) makes the same insult land harder on the crowd than on yourself
    expect(delta('s_people', 'p_disgrace')).toBeLessThan(delta('s_i', 'p_disgrace'));
    expect(delta('s_people', 'p_disgrace')).toBeLessThan(-9);
  });

  it('ungrammatical/incomplete input is confused', () => {
    const r = scoreStatement(cards('s_opp'));
    expect(r.label).toBe('confused');
    expect(r.grammatical).toBe(false);
  });

  it('open predicate: associating the opponent with evil helps you', () => {
    expect(delta('s_opp', 'p_bed_with', 'o_satan')).toBeGreaterThan(4); // in bed with Satan
    expect(delta('s_opp', 'p_destroy', 'o_freedom')).toBeGreaterThan(4); // wants to destroy freedom
  });

  it('open predicate: the object flips the meaning', () => {
    // "wants to destroy the swamp" makes the opponent look GOOD -> bad for you
    expect(delta('s_opp', 'p_destroy', 'o_swamp')).toBeLessThan(0);
  });

  it('a coherent combo amplifies', () => {
    const combo = delta('s_opp', 'p_kick_pup', 'c_and', 'p_lie');
    expect(combo).toBeGreaterThan(delta('s_opp', 'p_kick_pup'));
    expect(combo).toBeGreaterThan(12);
  });
});

describe('scoring — heroes & villains (neutral subjects)', () => {
  it('bashing a villain pleases the crowd', () => {
    expect(delta('o_lobbyists', 'p_disgrace')).toBeGreaterThan(4); // shady lobbyists are a disgrace
    expect(delta('o_swamp', 'p_cant_trust')).toBeGreaterThan(0);
  });

  it('praising a villain backfires', () => {
    expect(delta('o_satan', 'p_patriot')).toBeLessThan(0); // "Satan is a true patriot"
  });

  it('no "thing" noun is inert: championing a cause scores AND reacts to the crowd', () => {
    // A positive thematic noun plays as an applause line, not a dead neutral.
    const base = delta('o_freedom', 'p_free_icecream'); // a +3 promise pinned on a beloved cause
    expect(base).toBeGreaterThan(8); // on par with praising the audience, not a weak 0.6 play
    const loved = scoreStatement(cards('o_freedom', 'p_free_icecream'), {
      crowd: { id: 'c', loves: 'pander_aud', boost: 1.5 },
    }).delta;
    expect(loved).toBeGreaterThan(base); // a patriot-loving crowd cheers it
    // …and trashing a beloved cause is a blunder, not a shrug.
    expect(delta('o_freedom', 'p_disgrace')).toBeLessThan(-10);
  });

  it('self-owns and audience-insults cost extra', () => {
    const selfOwn = delta('s_i', 'p_disgrace'); // "I am a national disgrace"
    const cleanPraise = delta('s_i', 'p_patriot'); // "I am a true patriot"
    expect(Math.abs(selfOwn)).toBeGreaterThan(Math.abs(cleanPraise)); // blunder amplified
    expect(delta('s_people', 'p_disgrace')).toBeLessThan(-10); // insulting the audience really stings
  });

  it('a loaded subject amplifies the clause (effectiveness scale)', () => {
    const plain = delta('s_opp', 'p_kick_pup'); // "My opponent kicks puppies"
    const loaded = delta('s_idiot_opp', 'p_kick_pup'); // intensity 1.3
    expect(loaded).toBeGreaterThan(plain);
  });

  it('reward cards hit harder than common ones', () => {
    expect(Math.abs(delta('s_opp', 'r_lizard'))).toBeGreaterThan(Math.abs(delta('s_opp', 'p_disgrace')));
  });
});

describe('scoring — intensifiers & topics', () => {
  it('an intensifier amplifies a good statement', () => {
    const base = delta('s_i', 'p_patriot');
    const amped = delta('s_i', 'p_patriot', 'x_everyone');
    expect(amped).toBeCloseTo(base * 1.5, 0); // ±0.5 — the engine rounds to 1 decimal
  });

  it('an intensifier amplifies a self-own too (worse)', () => {
    expect(delta('s_i', 'p_disgrace', 'x_guarantee')).toBeLessThan(delta('s_i', 'p_disgrace'));
  });

  it('dodging the question costs you (same statement, on vs off topic)', () => {
    const offTopic = cards('s_i', 'p_patriot'); // no topic tag
    expect(scoreStatement(offTopic, { topicId: 'economy' }).delta).toBeLessThan(
      scoreStatement(offTopic).delta,
    );
    expect(scoreStatement(offTopic, { topicId: 'economy' }).detail).toContain('dodged');
  });

  it('staying on topic incurs no dodge penalty', () => {
    const onTopic = cards('s_opp', 'p_raise_taxes'); // economy topic
    expect(scoreStatement(onTopic, { topicId: 'economy' }).delta).toBe(scoreStatement(onTopic).delta);
  });
});

describe('scoring — periods, conjunctions & combos', () => {
  // Reference clause deltas with the cards used below: opp+kick ≈ 10, i+patriot ≈ 15.
  it('a period helps, but stacks with diminishing returns (never doubles)', () => {
    const one = delta('s_opp', 'p_kick_pup');
    const second = delta('s_i', 'p_patriot');
    const two = delta('s_opp', 'p_kick_pup', 'c_period', 's_i', 'p_patriot');
    expect(two).toBeGreaterThan(one); // an extra sentence is never wasted
    expect(two).toBeLessThan(one + second); // …but worth less than the full second clause
  });

  it('periods earn no combo', () => {
    expect(combo('s_opp', 'p_kick_pup', 'c_period', 's_i', 'p_patriot')).toBeUndefined();
  });

  it('a correct "and" combos and beats the same clauses period-joined', () => {
    const r = scoreStatement(cards('s_opp', 'p_kick_pup', 'c_and', 's_i', 'p_patriot'));
    expect(r.combo?.kind).toBe('and');
    expect(r.delta).toBeGreaterThan(delta('s_opp', 'p_kick_pup', 'c_period', 's_i', 'p_patriot'));
  });

  it('a correct "but" pivot is the strongest combo (but > and)', () => {
    const but = scoreStatement(cards('s_opp', 'p_kick_pup', 'c_but', 's_i', 'p_patriot'));
    const and = delta('s_opp', 'p_kick_pup', 'c_and', 's_i', 'p_patriot');
    expect(but.combo?.kind).toBe('but');
    expect(but.delta).toBeGreaterThan(and);
  });

  it('comboChips mark each combo-forming connector token, tagged with its own tier', () => {
    // "My opponent kicks puppies AND the people love freedom BECAUSE I am a patriot"
    // tokens:    0 s_opp  1 p_kick_pup  2 c_and  3 s_people  4 p_love_fd  5 c_because  6 s_i  7 p_patriot
    const r = scoreStatement(cards('s_opp', 'p_kick_pup', 'c_and', 's_people', 'p_love_fd', 'c_because', 's_i', 'p_patriot'));
    expect(r.comboChips).toEqual([
      { tokenIdx: 2, kind: 'and' },
      { tokenIdx: 5, kind: 'logic' },
    ]);
  });

  it('a misused connector paints no chip', () => {
    const r = scoreStatement(cards('s_opp', 'p_kick_pup', 'c_but', 's_opp', 'p_lie')); // same side — no pivot
    expect(r.comboChips).toBeUndefined();
  });

  it('a misused "but" (no pivot, same side) just fizzles — no combo, no penalty', () => {
    const misused = scoreStatement(cards('s_opp', 'p_kick_pup', 'c_but', 's_opp', 'p_lie'));
    const period = delta('s_opp', 'p_kick_pup', 'c_period', 's_opp', 'p_lie');
    expect(misused.combo).toBeUndefined();
    expect(misused.delta).toBeCloseTo(period, 5); // scores exactly like a period join
  });

  it('repeating the same point does not combo (distinctness required)', () => {
    expect(combo('s_opp', 'p_kick_pup', 'c_and', 's_opp', 'p_kick_pup')).toBeUndefined();
    // a sweep across distinct registers far outscores hammering one point
    const sweep = delta('s_opp', 'p_kick_pup', 'c_and', 's_i', 'p_patriot', 'c_and', 's_people', 'p_love_fd');
    const hammer = delta('s_opp', 'p_kick_pup', 'c_period', 's_opp', 'p_kick_pup', 'c_period', 's_opp', 'p_kick_pup');
    expect(sweep).toBeGreaterThan(hammer);
  });

  it('a tight combo beats a longer pile of single sentences (the headroom fix)', () => {
    // 3-clause sweep combo vs a 5-sentence period pile of strong clauses.
    const combo = delta('s_opp', 'p_kick_pup', 'c_and', 's_i', 'p_patriot', 'c_and', 's_people', 'p_love_fd');
    const pile = delta(
      's_opp', 'p_kick_pup', 'c_period', 's_i', 'p_patriot', 'c_period', 's_people', 'p_love_fd',
      'c_period', 's_admin', 'p_deliver', 'c_period', 's_record', 'p_patriot',
    );
    expect(combo).toBeGreaterThan(pile + 5); // a clear margin, not a cap-flattened tie
  });

  it('rambling: piling simple sentences past the limit hurts (combos are exempt)', () => {
    const three = delta('s_people', 'p_love_fd', 'c_period', 's_opp', 'p_kick_pup', 'c_period', 's_nation', 'p_patriot');
    const four = delta('s_people', 'p_love_fd', 'c_period', 's_opp', 'p_kick_pup', 'c_period', 's_nation', 'p_patriot', 'c_period', 's_i', 'p_deliver');
    expect(four).toBeLessThan(three); // a 4th simple sentence drops the score
    const r = scoreStatement(cards('s_people', 'p_love_fd', 'c_period', 's_opp', 'p_kick_pup', 'c_period', 's_nation', 'p_patriot', 'c_period', 's_i', 'p_deliver'));
    expect(r.detail).toContain('nod off');
    // a long COMBO is not rambling — it's exempt from the penalty
    const combo = delta('s_opp', 'p_kick_pup', 'c_and', 's_i', 'p_patriot', 'c_and', 's_people', 'p_love_fd', 'c_and', 's_nation', 'p_strong');
    expect(combo).toBeGreaterThan(four);
  });

  it('off-topic is a multiplicative penalty: a bigger statement loses more', () => {
    const onTopicLike = cards('s_people', 'p_love_fd'); // p_love_fd is tagged 'freedom'
    const off = scoreStatement(onTopicLike, { topicId: 'economy' }).delta; // dodges economy
    const on = scoreStatement(onTopicLike, { topicId: 'freedom' }).delta; // addresses freedom
    expect(off).toBeCloseTo(on * 0.75, 0); // off-topic keeps ~75% (engine rounds to 1 dp)
    expect(off).toBeLessThan(on);
  });

  it('a single strong clause stays well under the cap (leaves room to combo)', () => {
    // If one clause nearly caps, every line saturates and combos lose their edge.
    expect(delta('s_people', 'p_love_fd')).toBeLessThan(20); // STATEMENT_CAP is 35
  });

  it("the crowd's boost rewards the best on-taste line once, not monotonous repetition", () => {
    const crowd = { id: 'p', loves: 'pander_aud' as const, boost: 1.5 };
    const one = scoreStatement(cards('s_people', 'p_love_fd'), { crowd }).delta;
    const five = scoreStatement(
      cards('s_people', 'p_love_fd', 'c_period', 's_people', 'p_love_fd', 'c_period',
        's_people', 'p_love_fd', 'c_period', 's_people', 'p_love_fd', 'c_period', 's_people', 'p_love_fd'),
      { crowd },
    ).delta;
    // Repeating the same pander 5× must not multiply the crowd bonus 5×.
    expect(five).toBeLessThan(one * 1.5);
  });

  it('an elided clause-join ("and therefore" with no repeated subject) still combos', () => {
    // "My opponent kicks puppies and therefore lies" — shared subject, logic tier
    expect(combo('s_opp', 'p_kick_pup', 'c_therefore', 'p_lie')?.kind).toBe('logic');
  });

  it('a "but" digs out of a self-own better than a period — and reads as confusion', () => {
    // A strong self-own (−3) vs a mild jab (−1) — the self-own dominates, so even the 'but' pivot
    // stays net-negative (a heavier attack would flip it positive, which is the point of the pivot).
    const alone = delta('s_i', 'p_eat_babies'); // a self-own
    const period = delta('s_i', 'p_eat_babies', 'c_period', 's_opp', 'p_weak');
    const but = scoreStatement(cards('s_i', 'p_eat_babies', 'c_but', 's_opp', 'p_weak'));
    expect(period).toBeGreaterThan(alone); // a tacked-on jab softens it a little
    expect(but.delta).toBeGreaterThan(period); // a "but" pivot softens it more
    expect(but.delta).toBeLessThan(0); // …but it's still a net loss
    expect(but.label).toBe('confused'); // outrage → a confused shrug
  });
});

describe('scoring — headliners (per-card + chain ceiling)', () => {
  // Powerful REWARD cards carry `ceiling`, and each combo junction adds headroom, so a long
  // or powerful line breaks past the base ±35 cap (and finisher ±50) — bounded at +15 headroom
  // (soft ≤50 / hard ≤65) so no single statement is a knockout. See scoring.ts HEADROOM_MAX.

  it('ceiling cards let a strong combo break the old ±35 base cap', () => {
    // "My opponent wants to cancel Christmas … and is secretly a lizard person … and has never
    // told the truth" — three ±4 headliner attacks (ceiling 4 each) bound into one combo.
    const d = delta('s_opp', 'r_christmas', 'c_and', 'r_lizard', 'c_and', 'r_never_truth');
    expect(d).toBeGreaterThan(35); // would have clamped to 35 before headliners
    expect(d).toBeLessThanOrEqual(50); // …but still within the soft cap
  });

  it('a finisher on a ceiling line breaks the old ±50 hard cap', () => {
    const d = delta('s_opp', 'r_christmas', 'c_and', 'r_lizard', 'c_and', 'r_never_truth', 'x_guarantee');
    expect(d).toBeGreaterThan(50); // ×factor on a 35+ base used to re-clamp at 50
    expect(d).toBeLessThanOrEqual(65); // bounded by the hard cap
  });

  it('combo-chaining alone raises the cap for a plain (no-ceiling) deck', () => {
    // A long plain combo + finisher: chain headroom (one per junction) lifts it past the old 50.
    const d = delta('s_opp', 'p_kick_pup', 'c_and', 'p_tollbooth', 'c_and', 'p_lie', 'c_and', 'p_disgrace', 'c_and', 'p_jackass', 'x_guarantee');
    expect(d).toBeGreaterThan(50);
  });

  it('headroom is bounded: soft cap never exceeds 50, hard cap never exceeds 65', () => {
    // Pile far more ceiling than +15 of headroom; the soft cap still clamps at 50.
    const soft = delta('s_opp', 'r_goldtoilet', 'c_and', 'r_lizard', 'c_and', 'r_never_truth', 'c_and', 'r_popupads', 'c_and', 'r_christmas');
    expect(soft).toBe(50);
    // …and with a finisher on top, the hard cap clamps at 65.
    const hard = delta('s_opp', 'r_goldtoilet', 'c_and', 'r_lizard', 'c_and', 'r_never_truth', 'c_and', 'r_popupads', 'x_guarantee');
    expect(hard).toBe(65);
  });

  it('sub-cap statements are unchanged (raising a clamp cannot move a value below it)', () => {
    expect(delta('s_i', 'p_deliver')).toBe(5); // single clause (p_deliver retiered 3→2, 2026-07)
    expect(delta('s_opp', 'p_lie', 'c_and', 'p_raise_taxes')).toBe(12.5); // simple 1-combo of two −2 attacks
  });

  it('ceiling cards do NOT lift the confused/ungrammatical path', () => {
    // Two headliner predicates with no verb structure → scrambled; still capped at ±35, tiny.
    const r = scoreStatement(cards('r_christmas', 'r_lizard', 's_opp'));
    expect(r.label).toBe('confused');
    expect(Math.abs(r.delta)).toBeLessThanOrEqual(35);
  });
});

describe('scoring — modifier asides', () => {
  it('a correct modifier intensifies its clause', () => {
    // "My opponent's wife, who is ugly, eats babies" > "…eats babies"
    expect(delta('s_opp_wife', 'm_ugly', 'p_eat_babies')).toBeGreaterThan(delta('s_opp_wife', 'p_eat_babies'));
  });

  it('a misused modifier (praising your opponent) drags the clause down', () => {
    // "My opponent, who is a treasure, is a disgrace" scores worse than the plain attack.
    expect(delta('s_opp', 'm_treasure', 'p_disgrace')).toBeLessThan(delta('s_opp', 'p_disgrace'));
  });

  it('a self-applied insult modifier is a blunder', () => {
    expect(delta('s_i', 'm_ugly', 'p_patriot')).toBeLessThan(delta('s_i', 'p_patriot'));
  });

  it('good asides do NOT rescue a self-own predicate (a gaffe stays a gaffe)', () => {
    // "I, who am winning, which is a triumph, secretly eat babies" must stay clearly negative —
    // bragging modifiers can't flip a self-own positive.
    const r = scoreStatement(cards('s_i', 'm_winning', 'm_triumph', 'p_eat_babies'));
    expect(r.delta).toBeLessThan(-4);
    expect(r.delta).toBeLessThanOrEqual(delta('s_i', 'p_eat_babies')); // no better than the bare self-own
  });

  it('a modifier folds into the clause and still rides a combo', () => {
    const withMod = scoreStatement(cards('s_opp', 'm_crook', 'p_kick_pup', 'c_and', 's_i', 'p_patriot'));
    expect(withMod.combo?.kind).toBe('and'); // the combo still forms
    expect(withMod.delta).toBeGreaterThan(delta('s_opp', 'p_kick_pup', 'c_and', 's_i', 'p_patriot')); // and it's bigger
  });

  it('a modifier alone forms no combo (no connector)', () => {
    expect(combo('s_opp_wife', 'm_ugly', 'p_eat_babies')).toBeUndefined();
  });

  it('stalling on a modifier scores lenient "confused"', () => {
    const r = scoreStatement(cards('s_opp_wife', 'm_ugly'));
    expect(r.label).toBe('confused');
    expect(r.grammatical).toBe(false);
  });

  it('an egregious blunder punches through the "confused" muffle (you can\'t ramble it away)', () => {
    // p_bed_with is an OPEN predicate with no object → the line is incomplete (confused),
    // but the audience-insult aside still lands at full strength.
    const r = scoreStatement(cards('s_people', 'm_ugly', 'p_bed_with'));
    expect(r.label).toBe('confused');
    expect(r.grammatical).toBe(false);
    expect(r.delta).toBeLessThan(-8); // beyond the ±8 muffle cap — the insult is not dampened away
    // a self-own in word salad punches through too (full −8, vs the ~−4 the old muffle gave)
    expect(scoreStatement(cards('s_i', 'm_ugly', 'p_bed_with')).delta).toBeLessThanOrEqual(-8);
    // but a confused line with NO blunder stays muffled within the ±8 cap
    const benign = scoreStatement(cards('s_opp', 'p_bed_with')); // attack-ish, but incomplete
    expect(benign.label).toBe('confused');
    expect(Math.abs(benign.delta)).toBeLessThanOrEqual(8);
  });

  it('incoherence has a mild, scaling cost — gibberish is never free, a near-miss barely stings', () => {
    // A truly baffling word salad: scrambled from the start, so the crowd catches no "drift"
    // and it nets MILDLY negative (not the ~0 a greedy parse would otherwise scrape out).
    const salad = scoreStatement(cards('s_people', 's_opp', 'p_disgrace', 'm_ugly', 'p_kick_pup', 'p_lie', 's_i', 'o_satan'));
    expect(salad.label).toBe('confused');
    expect(salad.delta).toBeLessThan(0);
    expect(salad.delta).toBeGreaterThanOrEqual(-10); // mild, not catastrophic
    // An honest UNFINISHED line (a valid prefix, just not landed) pays nothing — it's a mumble.
    expect(Math.abs(scoreStatement(cards('s_opp')).delta)).toBeLessThanOrEqual(1);
    // A near-miss (one stray card, e.g. a misclick after the pool shifted) is barely punished —
    // the crowd still catches the drift of the part that parsed.
    const nearMiss = scoreStatement(cards('s_opp', 'p_disgrace', 's_i'));
    expect(nearMiss.delta).toBeGreaterThan(salad.delta); // less bad than a full salad
    expect(nearMiss.delta).toBeGreaterThan(-2);
  });

  it('insulting the crowd dominates pandering in the same clause (not easily forgiven)', () => {
    // "The American people, who are ugly, love freedom" — the insult stands, pandering suppressed.
    const mix = scoreStatement(cards('s_people', 'm_ugly', 'p_love_fd'));
    expect(mix.delta).toBeLessThan(-8); // clearly negative, not a near-zero wash
    expect(mix.label).not.toBe('approve');
    // …but still less harsh than calling them ugly AND saying they kick puppies.
    expect(mix.delta).toBeGreaterThan(delta('s_people', 'm_ugly', 'p_kick_pup'));
  });

  it('pandering later in the statement cannot buy back a crowd insult', () => {
    // pander, THEN insult the crowd in a second clause — still a net loss.
    expect(delta('s_people', 'p_love_fd', 'c_and', 's_people', 'm_ugly', 'p_kick_pup')).toBeLessThan(0);
  });

  it('calling YOURSELF ugly reads as confused and dulls the brag', () => {
    const r = scoreStatement(cards('s_genius', 'm_ugly', 'p_cut_taxes'));
    expect(r.label).toBe('confused'); // a muddled self-insult, not outrage
    expect(r.delta).toBeLessThan(delta('s_genius', 'p_cut_taxes')); // dulled below the clean brag
  });
});

describe('scoring — noun-phrase coordination ("and" between NPs)', () => {
  it('a compound subject lands the predicate on each villain — stronger than one, weaker than two', () => {
    // "Satan and shady lobbyists want to silence free speech" — the flagship player example
    const single = delta('o_satan', 'p_silence');
    const compound = delta('o_satan', 'c_and', 'o_lobbyists', 'p_silence');
    expect(scoreStatement(cards('o_satan', 'c_and', 'o_lobbyists', 'p_silence')).grammatical).toBe(true);
    expect(compound).toBeGreaterThan(single);
    // Same side + same predicate → the extras decay-stack; naming more villains is
    // a bump, never a 2× farm (drawing a second verb still beats listing nouns).
    expect(compound).toBeLessThan(2 * single);
  });

  it('distinct-side compound subjects genuinely combo on the "and" junction', () => {
    // "I and the American people are true patriots" — self-praise + pander, both good
    const r = scoreStatement(cards('s_i', 'c_and', 's_people', 'p_patriot'));
    expect(r.combo).toEqual({ kind: 'and', mult: 1.25 });
    expect(r.comboChips).toEqual([{ tokenIdx: 1, kind: 'and' }]); // the chip sits on the "and"
  });

  it('a compound object scores each object by its own sentiment — bump, not farm', () => {
    // "My opponent wants to destroy Main Street and our children"
    const single = delta('s_opp', 'p_destroy', 'o_mainstreet');
    const compound = delta('s_opp', 'p_destroy', 'o_mainstreet', 'c_and', 's_children');
    expect(scoreStatement(cards('s_opp', 'p_destroy', 'o_mainstreet', 'c_and', 's_children')).grammatical).toBe(true);
    expect(compound).toBeGreaterThan(single);
    expect(compound).toBeLessThan(2 * single);
  });

  it('naming the crowd inside a compound subject still insults them', () => {
    // "My opponent and our children kick puppies" — the attack half doesn't excuse it
    const r = scoreStatement(cards('s_opp', 'c_and', 's_children', 'p_kick_pup'));
    expect(r.audienceInsulted).toBe(true);
    expect(r.delta).toBeLessThan(0);
  });

  it('a long villain list is one sentence, not rambling', () => {
    const r = scoreStatement(cards('o_satan', 'c_and', 'o_lobbyists', 'c_and', 'o_swamp', 'c_and', 'o_inflation', 'p_silence'));
    expect(r.grammatical).toBe(true);
    expect(r.rambling).toBeUndefined();
    expect(r.delta).toBeGreaterThan(delta('o_satan', 'p_silence')); // still a (flattening) bump
  });
});

describe('scoring — hidden crowd preference', () => {
  it('a crowd amplifies statements of the type it loves', () => {
    const line = cards('s_opp', 'p_kick_pup'); // an attack on the opponent
    const base = scoreStatement(line).delta;
    const loved = scoreStatement(line, { crowd: { id: 'b', loves: 'attack_opp', boost: 1.5 } }).delta;
    expect(loved).toBeCloseTo(base * 1.5, 0); // ~×1.5 (0-digit tolerance absorbs the 0.1 rounding)
  });

  it('a crowd that loves a different type leaves the statement unchanged', () => {
    const line = cards('s_opp', 'p_kick_pup');
    expect(scoreStatement(line, { crowd: { id: 'f', loves: 'praise_self', boost: 1.5 } }).delta).toBe(
      scoreStatement(line).delta,
    );
  });
});

describe('scoring — dual-role parenthetical ("…and I\'m not making this up…")', () => {
  it('joins two clauses as a coordinating conjunction (grammatical + combos)', () => {
    // "My opponent kicks puppies, and I'm not making this up, the people love freedom"
    const line = cards('s_opp', 'p_kick_pup', 'm_notmakingup', 's_people', 'p_love_fd');
    const r = scoreStatement(line);
    expect(r.grammatical).toBe(true);
    expect(r.combo?.kind).toBe('and');
    expect(r.delta).toBeGreaterThan(delta('s_opp', 'p_kick_pup')); // beats the lone clause
  });

  it('still works as a post-nominal subject aside', () => {
    // "My opponent, and I'm not making this up, kicks puppies"
    const r = scoreStatement(cards('s_opp', 'm_notmakingup', 'p_kick_pup'));
    expect(r.grammatical).toBe(true);
    expect(r.combo).toBeUndefined(); // a single clause with an aside, not a combo
  });
});

describe('scoring — resolution breakdown & flags (UI juice)', () => {
  it('breakdown maps each phrase to its category and word span', () => {
    // 0 s_opp  1 p_kick_pup  2 c_and  3 s_i  4 p_patriot
    const r = scoreStatement(cards('s_opp', 'p_kick_pup', 'c_and', 's_i', 'p_patriot'));
    expect(r.breakdown).toBeDefined();
    const cats = r.breakdown!.map((h) => h.category);
    expect(cats).toContain('attack_opp');
    expect(cats).toContain('praise_self');
    const attack = r.breakdown!.find((h) => h.category === 'attack_opp')!;
    const brag = r.breakdown!.find((h) => h.category === 'praise_self')!;
    expect(attack.span).toEqual([0, 1]); // "My opponent kicks puppies"
    expect(brag.span).toEqual([3, 4]); // "I am a true patriot"
    expect(attack.tokenIdx).toBe(1); // anchor is the predicate word
  });

  it('off-topic sets the offTopic flag', () => {
    const r = scoreStatement(cards('s_i', 'p_patriot'), { topicId: 'economy' });
    expect(r.offTopic).toBe(true);
    expect(scoreStatement(cards('s_i', 'p_patriot')).offTopic).toBeUndefined();
  });

  it('insulting the crowd sets the audienceInsulted flag', () => {
    const r = scoreStatement(cards('s_people', 'p_disgrace')); // "The people are a disgrace"
    expect(r.audienceInsulted).toBe(true);
  });

  it('the hidden crowd boost sets crowdFavorite on the result and the loved phrase', () => {
    const r = scoreStatement(cards('s_opp', 'p_kick_pup'), {
      crowd: { id: 'b', loves: 'attack_opp', boost: 1.5 },
    });
    expect(r.crowdFavorite).toBe(true);
    expect(r.breakdown!.some((h) => h.crowdFavorite && h.category === 'attack_opp')).toBe(true);
  });

  it('a run-on (two clauses, no connector) is confused and flagged runOn', () => {
    const r = scoreStatement(cards('s_opp', 'p_kick_pup', 's_i', 'p_patriot'));
    expect(r.label).toBe('confused');
    expect(r.runOn).toBe(true);
    // a clean, complete line is never a run-on
    expect(scoreStatement(cards('s_opp', 'p_kick_pup', 'c_and', 's_i', 'p_patriot')).runOn).toBeUndefined();
  });
});
