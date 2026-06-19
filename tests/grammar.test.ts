import { describe, it, expect } from 'vitest';
import { isValidPrefix, isComplete, canAppend, parse } from '../src/engine/grammar';
import { renderSentence } from '../src/engine/morphology';
import { findDef } from '../src/data/cards';
import type { Card } from '../src/engine/types';

function cards(...ids: string[]): Card[] {
  return ids.map((id) => {
    const c = findDef(id);
    if (!c) throw new Error(`no card ${id}`);
    return c;
  });
}

describe('grammar — chunk model', () => {
  it('accepts subject + a complete predicate', () => {
    expect(isComplete(cards('s_opp', 'p_disgrace'))).toBe(true);
  });

  it('a subject alone is a valid but incomplete prefix', () => {
    expect(isValidPrefix(cards('s_opp'))).toBe(true);
    expect(isComplete(cards('s_opp'))).toBe(false);
  });

  it('must start with a subject (np), not a predicate', () => {
    expect(isValidPrefix(cards('p_kick_pup'))).toBe(false);
  });

  it('an open predicate needs an object', () => {
    expect(isComplete(cards('s_opp', 'p_bed_with'))).toBe(false);
    expect(isComplete(cards('s_opp', 'p_bed_with', 'o_satan'))).toBe(true);
  });

  it('coordinates predicates under one subject with "and"', () => {
    const line = cards('s_opp', 'p_kick_pup', 'c_and', 'p_lie');
    expect(isComplete(line)).toBe(true);
    expect(parse(line).clauses).toHaveLength(1);
    expect(parse(line).clauses[0].preds).toHaveLength(2);
  });

  it('joins independent clauses with "because"', () => {
    const line = cards('s_opp', 'p_disgrace', 'c_because', 's_people', 'p_love_fd');
    expect(isComplete(line)).toBe(true);
    expect(parse(line).clauses).toHaveLength(2);
  });

  it('treats an intensifier as a sentence-final finisher', () => {
    expect(canAppend(cards('s_opp', 'p_disgrace'), findDef('x_everyone')!)).toBe(true);
    expect(canAppend(cards('s_opp'), findDef('x_everyone')!)).toBe(false);
    expect(isComplete(cards('s_opp', 'p_disgrace', 'x_everyone'))).toBe(true);
    expect(canAppend(cards('s_opp', 'p_disgrace', 'x_everyone'), findDef('p_lie')!)).toBe(false);
  });
});

describe('morphology — predicate conjugation & casing', () => {
  it('conjugates the copula to the subject number', () => {
    expect(renderSentence(cards('s_opp', 'p_disgrace'))).toBe('My opponent is a national disgrace.');
    expect(renderSentence(cards('s_children', 'p_disgrace'))).toBe('Our children are a national disgrace.');
  });

  it('conjugates verbs by subject number/person', () => {
    expect(renderSentence(cards('s_opp', 'p_kick_pup'))).toBe('My opponent kicks puppies.');
    expect(renderSentence(cards('s_children', 'p_kick_pup'))).toBe('Our children kick puppies.');
    expect(renderSentence(cards('s_i', 'p_deliver'))).toBe('I deliver blue skies and happiness.');
  });

  it('renders a pre-verb adverb', () => {
    expect(renderSentence(cards('s_opp', 'p_eat_babies'))).toBe('My opponent secretly eats babies.');
  });

  it('fills an open predicate with its object, keeping proper nouns capitalized', () => {
    expect(renderSentence(cards('s_opp', 'p_bed_with', 'o_satan'))).toBe('My opponent is in bed with Satan.');
  });

  it('lower-cases mid-sentence noun-phrase articles across a clause join', () => {
    expect(renderSentence(cards('s_opp', 'p_kick_pup', 'c_therefore', 's_people', 'p_love_fd'))).toBe(
      'My opponent kicks puppies and therefore the American people love freedom and democracy.',
    );
  });
});
