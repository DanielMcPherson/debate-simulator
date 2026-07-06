import { describe, it, expect } from 'vitest';
import { isValidPrefix, isComplete, canAppend, parse, firstInvalidIndex } from '../src/engine/grammar';
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

  it('a clause-join connector ("and therefore") needs its own subject — it cannot elide it like "and"', () => {
    // "My opponent kicks puppies and therefore lies" is now an ungrammatical fragment:
    // only "and" strings bare predicates under a shared subject. "and therefore" must
    // open a full new clause with its own subject.
    expect(isComplete(cards('s_opp', 'p_kick_pup', 'c_therefore', 'p_lie'))).toBe(false);
    const line = cards('s_opp', 'p_kick_pup', 'c_therefore', 's_opp', 'p_lie');
    expect(isComplete(line)).toBe(true);
    const clauses = parse(line).clauses;
    expect(clauses).toHaveLength(2); // two clauses, each with its own subject
    expect(clauses[1].joinedByPrev).toBe('and therefore'); // real connector recorded
  });

  it('joins independent clauses with "because"', () => {
    const line = cards('s_opp', 'p_disgrace', 'c_because', 's_people', 'p_love_fd');
    expect(isComplete(line)).toBe(true);
    expect(parse(line).clauses).toHaveLength(2);
  });

  it('only "and" elides a shared subject — "but"/"and therefore"/"so"/"because" are clause-only', () => {
    // "...is a disgrace <conn> lies" (bare predicate, no new subject) is ungrammatical for
    // every conjunction EXCEPT "and", which coordinates predicates under the shared subject.
    for (const conn of ['c_because', 'c_therefore', 'c_but', 'c_so', 'c_however']) {
      expect(isComplete(cards('s_opp', 'p_disgrace', conn, 'p_lie'))).toBe(false);
      expect(isValidPrefix(cards('s_opp', 'p_disgrace', conn, 'p_lie'))).toBe(false);
      // …but each is fine with its own subject (a real clause join).
      expect(isComplete(cards('s_opp', 'p_disgrace', conn, 's_people', 'p_love_fd'))).toBe(true);
    }
    // "and" is the sole exception: it still coordinates bare predicates.
    expect(isComplete(cards('s_opp', 'p_disgrace', 'c_and', 'p_lie'))).toBe(true);
  });

  it('firstInvalidIndex points at the token where parsing breaks (for the "WHAT??" highlight)', () => {
    // bare predicate after "because" — breaks at that predicate (index 3)
    expect(firstInvalidIndex(cards('s_opp', 'p_disgrace', 'c_because', 'p_lie'))).toBe(3);
    // run-on: a second subject with no connector — breaks at the second subject (index 2)
    expect(firstInvalidIndex(cards('s_opp', 'p_kick_pup', 's_i', 'p_patriot'))).toBe(2);
    // a clean, valid line never breaks
    expect(firstInvalidIndex(cards('s_opp', 'p_disgrace', 'c_and', 'p_lie'))).toBe(-1);
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

describe('grammar — noun-phrase coordination ("and" between NPs)', () => {
  it('coordinates subjects: "Satan and the lobbyists … want to silence free speech"', () => {
    const line = cards('o_satan', 'c_and', 's_opp_speechwriters', 'p_silence');
    expect(isComplete(line)).toBe(true);
    const clauses = parse(line).clauses;
    expect(clauses).toHaveLength(1); // ONE clause with a compound subject, not two
    expect(clauses[0].subject?.id).toBe('o_satan');
    expect(clauses[0].coSubjects?.map((s) => s.card.id)).toEqual(['s_opp_speechwriters']);
    expect(clauses[0].coSubjects?.[0].connIdx).toBe(1); // the "and" junction
    expect(clauses[0].preds).toHaveLength(1);
  });

  it('coordinates objects: "…wants to destroy Main Street and our children"', () => {
    const line = cards('s_opp', 'p_destroy', 'o_mainstreet', 'c_and', 's_children');
    expect(isComplete(line)).toBe(true);
    const clauses = parse(line).clauses;
    expect(clauses).toHaveLength(1);
    expect(clauses[0].preds[0].object?.id).toBe('o_mainstreet');
    expect(clauses[0].preds[0].coObjects?.map((o) => o.card.id)).toEqual(['s_children']);
  });

  it('chains three coordinated subjects', () => {
    const line = cards('o_satan', 'c_and', 'o_lobbyists', 'c_and', 'o_swamp', 'p_silence');
    expect(isComplete(line)).toBe(true);
    expect(parse(line).clauses[0].coSubjects).toHaveLength(2);
  });

  it('a compound subject alone is a valid but incomplete prefix', () => {
    expect(isValidPrefix(cards('o_satan', 'c_and', 's_opp_speechwriters'))).toBe(true);
    expect(isComplete(cards('o_satan', 'c_and', 's_opp_speechwriters'))).toBe(false);
  });

  it('an "and"-NP followed by its own predicate still opens a NEW clause (lookahead)', () => {
    // "…destroy Main Street and our children kick puppies" — children is a new subject
    const line = cards('s_opp', 'p_destroy', 'o_mainstreet', 'c_and', 's_children', 'p_kick_pup');
    expect(isComplete(line)).toBe(true);
    const clauses = parse(line).clauses;
    expect(clauses).toHaveLength(2);
    expect(clauses[0].preds[0].coObjects).toBeUndefined();
    expect(clauses[1].subject?.id).toBe('s_children');
  });

  it('only plain "and" coordinates noun phrases — but/because do not', () => {
    expect(isComplete(cards('o_satan', 'c_but', 's_opp_speechwriters', 'p_silence'))).toBe(false);
    expect(isComplete(cards('o_satan', 'c_because', 's_opp_speechwriters', 'p_silence'))).toBe(false);
  });

  it('allows a modifier aside mid-compound ("Satan, who is ugly, and the lobbyists want…")', () => {
    const line = cards('o_satan', 'm_ugly', 'c_and', 'o_lobbyists', 'p_silence');
    expect(isComplete(line)).toBe(true);
    expect(parse(line).clauses).toHaveLength(1);
  });

  it('a connector-less second NP is still a stray (no silent compound)', () => {
    // "Satan the lobbyists want…" — missing the "and"; still breaks at the second NP
    expect(firstInvalidIndex(cards('o_satan', 'o_lobbyists', 'p_silence'))).toBe(1);
  });
});

describe('morphology — noun-phrase coordination', () => {
  it('a compound subject conjugates PLURAL (the flagship player example)', () => {
    expect(renderSentence(cards('o_satan', 'c_and', 's_opp_speechwriters', 'p_silence'))).toBe(
      "Satan and the lobbyists who write my opponent's speeches want to silence free speech.",
    );
  });

  it('renders a compound object, lower-casing the mid-sentence NP', () => {
    expect(renderSentence(cards('s_opp', 'p_destroy', 'o_mainstreet', 'c_and', 's_children'))).toBe(
      'My opponent wants to destroy Main Street and our children.',
    );
  });

  it('"my opponent and I" takes first-person-plural agreement', () => {
    expect(renderSentence(cards('s_opp', 'c_and', 's_i', 'p_disgrace'))).toBe(
      'My opponent and I are a national disgrace.',
    );
  });

  it('a mid-compound aside agrees with the noun it follows, not the compound', () => {
    expect(renderSentence(cards('o_satan', 'm_ugly', 'c_and', 'o_lobbyists', 'p_silence'))).toBe(
      'Satan, who is ugly, just very ugly, and shady lobbyists want to silence free speech.',
    );
  });
});

describe('grammar — modifier asides', () => {
  it('accepts subject + modifier + predicate', () => {
    expect(isComplete(cards('s_opp_wife', 'm_ugly', 'p_eat_babies'))).toBe(true);
  });

  it('subject + modifier (no predicate yet) is a valid prefix but incomplete — the stall', () => {
    expect(isValidPrefix(cards('s_opp_wife', 'm_ugly'))).toBe(true);
    expect(isComplete(cards('s_opp_wife', 'm_ugly'))).toBe(false);
  });

  it('stacks multiple modifiers before the predicate', () => {
    const line = cards('s_opp_wife', 'm_ugly', 'm_crook', 'p_eat_babies');
    expect(isComplete(line)).toBe(true);
    expect(parse(line).clauses[0].mods).toHaveLength(2);
    expect(parse(line).clauses[0].preds).toHaveLength(1);
  });

  it('a modifier cannot lead a statement (needs a subject first)', () => {
    expect(isValidPrefix(cards('m_ugly'))).toBe(false);
  });

  it('attaches the modifier to its clause subject in the parse', () => {
    const clause = parse(cards('s_opp_wife', 'm_ugly', 'p_eat_babies')).clauses[0];
    expect(clause.mods?.[0].id).toBe('m_ugly');
  });
});

describe('morphology — modifier rendering', () => {
  it('uses "who" for an animate subject and agrees in number', () => {
    expect(renderSentence(cards('s_opp_wife', 'm_ugly', 'p_eat_babies'))).toBe(
      "My opponent's wife, who is ugly, just very ugly, secretly eats babies.",
    );
    // plural antecedent + a conjugated (non-copular) modifier verb
    expect(renderSentence(cards('s_opp_donors', 'm_liar', 'p_cant_trust'))).toBe(
      "My opponent's donors, who lie constantly, can't be trusted.",
    );
  });

  it('uses "which" for an inanimate subject', () => {
    expect(renderSentence(cards('o_constitution', 'm_treasure', 'p_defend_liberty'))).toBe(
      'The Constitution, which is frankly a national treasure, will defend our liberty.',
    );
  });

  it('renders a clean stall (modifier with no predicate)', () => {
    expect(renderSentence(cards('s_opp_wife', 'm_ugly'))).toBe(
      "My opponent's wife, who is ugly, just very ugly.",
    );
  });
});
