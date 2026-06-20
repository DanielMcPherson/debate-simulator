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
    expect(delta('s_people', 'p_love_fd')).toBeGreaterThan(8);
  });

  it('insulting the opponent helps the speaker', () => {
    expect(delta('s_opp', 'p_kick_pup')).toBeGreaterThan(4); // "My opponent kicks puppies"
  });

  it('complimenting the opponent backfires', () => {
    expect(delta('s_opp', 'p_patriot')).toBeLessThan(-4); // "My opponent is a true patriot"
  });

  it('insulting yourself is negative', () => {
    expect(delta('s_i', 'p_disgrace')).toBeLessThan(-8);
  });

  it('insulting the audience is a large negative', () => {
    expect(delta('s_people', 'p_disgrace')).toBeLessThan(-12);
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
    const base = delta('o_freedom', 'p_patriot'); // "freedom and democracy is a true patriot"
    expect(base).toBeGreaterThan(8); // on par with praising the audience, not a weak 0.6 play
    const loved = scoreStatement(cards('o_freedom', 'p_patriot'), {
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
    expect(Math.abs(delta('s_opp', 'r_traitor'))).toBeGreaterThan(Math.abs(delta('s_opp', 'p_disgrace')));
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
    const alone = delta('s_i', 'p_disgrace'); // a self-own
    const period = delta('s_i', 'p_disgrace', 'c_period', 's_opp', 'p_kick_pup');
    const but = scoreStatement(cards('s_i', 'p_disgrace', 'c_but', 's_opp', 'p_kick_pup'));
    expect(period).toBeGreaterThan(alone); // a tacked-on jab softens it a little
    expect(but.delta).toBeGreaterThan(period); // a "but" pivot softens it more
    expect(but.delta).toBeLessThan(0); // …but it's still a net loss
    expect(but.label).toBe('confused'); // outrage → a confused shrug
  });
});

describe('scoring — hidden crowd preference', () => {
  it('a crowd amplifies statements of the type it loves', () => {
    const line = cards('s_opp', 'p_kick_pup'); // an attack on the opponent
    const base = scoreStatement(line).delta;
    const loved = scoreStatement(line, { crowd: { id: 'b', loves: 'attack_opp', boost: 1.5 } }).delta;
    expect(loved).toBeCloseTo(base * 1.5, 1);
  });

  it('a crowd that loves a different type leaves the statement unchanged', () => {
    const line = cards('s_opp', 'p_kick_pup');
    expect(scoreStatement(line, { crowd: { id: 'f', loves: 'praise_self', boost: 1.5 } }).delta).toBe(
      scoreStatement(line).delta,
    );
  });
});
