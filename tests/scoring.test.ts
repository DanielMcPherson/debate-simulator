import { describe, it, expect } from 'vitest';
import { scoreStatement } from '../src/engine/scoring';
import { findDef } from '../src/data/cards';
import type { Card } from '../src/engine/types';

function cards(...ids: string[]): Card[] {
  return ids.map((id) => {
    const c = findDef(id);
    if (!c) throw new Error(`no card ${id}`);
    return c;
  });
}
const delta = (...ids: string[]) => scoreStatement(cards(...ids)).delta;

describe('scoring — chunk predicates', () => {
  it('praising yourself is positive', () => {
    expect(delta('s_i', 'p_deliver')).toBeGreaterThan(8); // "I deliver blue skies and happiness"
  });

  it('pandering to the audience is strongly positive', () => {
    expect(delta('s_people', 'p_love_fd')).toBeGreaterThan(8);
  });

  it('insulting the opponent helps the speaker', () => {
    expect(delta('s_opp', 'p_kick_pup')).toBeGreaterThan(4); // "My opponent kicks puppies"
  });

  it('complimenting the opponent backfires', () => {
    expect(delta('s_opp', 'p_patriot')).toBeLessThan(-8); // "My opponent is a true patriot"
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
    expect(delta('s_opp', 'p_bed_with', 'o_satan')).toBeGreaterThan(8); // in bed with Satan
    expect(delta('s_opp', 'p_destroy', 'o_freedom')).toBeGreaterThan(8); // wants to destroy freedom
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

  it('self-owns and audience-insults cost extra', () => {
    const selfOwn = delta('s_i', 'p_disgrace'); // "I am a national disgrace"
    const cleanPraise = delta('s_i', 'p_patriot'); // "I am a true patriot"
    expect(Math.abs(selfOwn)).toBeGreaterThan(Math.abs(cleanPraise)); // blunder amplified
    expect(delta('s_people', 'p_disgrace')).toBeLessThan(-20); // insulting the audience really stings
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
    expect(amped).toBeCloseTo(base * 1.5, 1);
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
