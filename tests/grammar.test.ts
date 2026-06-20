import { describe, it, expect } from 'vitest';
import { isValidPrefix, isComplete, canAppend, parse } from '../src/engine/grammar';
import { renderSentence } from '../src/engine/morphology';
import { findDef, PERIOD } from '../src/data/cards';
import type { Card } from '../src/engine/types';

function cards(...ids: string[]): Card[] {
  return ids.map((id) => {
    if (id === 'c_period') return PERIOD;
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

  it('lets a clause-join connector share the subject (elided) like "and"', () => {
    // "My opponent kicks puppies and therefore lies" — no repeated subject
    const line = cards('s_opp', 'p_kick_pup', 'c_therefore', 'p_lie');
    expect(isComplete(line)).toBe(true);
    const clauses = parse(line).clauses;
    expect(clauses).toHaveLength(1); // one clause, shared subject
    expect(clauses[0].preds).toHaveLength(2);
    expect(clauses[0].preds[1].joinedBy).toBe('and therefore'); // real connector recorded
  });

  it('joins independent clauses with "because"', () => {
    const line = cards('s_opp', 'p_disgrace', 'c_because', 's_people', 'p_love_fd');
    expect(isComplete(line)).toBe(true);
    expect(parse(line).clauses).toHaveLength(2);
  });

  it('the free period joins two clauses; bare adjacency does not', () => {
    const withPeriod = cards('s_opp', 'p_kick_pup', 'c_period', 's_i', 'p_patriot');
    expect(isComplete(withPeriod)).toBe(true);
    const clauses = parse(withPeriod).clauses;
    expect(clauses).toHaveLength(2);
    expect(clauses[1].joinedByPrev).toBe('period');
    // …but two complete clauses smashed together with no connector are nonsense.
    expect(isComplete(cards('s_opp', 'p_kick_pup', 's_i', 'p_patriot'))).toBe(false);
  });

  it('a period demands a new subject — it cannot string bare predicates into fragments', () => {
    // "My opponent kicks puppies. lies." — a period followed by a subjectless
    // predicate is a fragment, NOT a complete statement (unlike "and"/"and therefore").
    expect(isComplete(cards('s_opp', 'p_kick_pup', 'c_period', 'p_lie'))).toBe(false);
    // with its own subject it's fine
    expect(isComplete(cards('s_opp', 'p_kick_pup', 'c_period', 's_i', 'p_patriot'))).toBe(true);
  });

  it('"but" opens a new clause and records itself as the join', () => {
    const line = cards('s_opp', 'p_kick_pup', 'c_but', 's_i', 'p_patriot');
    expect(isComplete(line)).toBe(true);
    const clauses = parse(line).clauses;
    expect(clauses).toHaveLength(2);
    expect(clauses[1].joinedByPrev).toBe('but');
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

  it('renders a period as sentence punctuation and capitalizes the next sentence', () => {
    expect(renderSentence(cards('s_opp', 'p_kick_pup', 'c_period', 's_people', 'p_love_fd'))).toBe(
      'My opponent kicks puppies. The American people love freedom and democracy.',
    );
  });
});
