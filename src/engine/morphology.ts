import type { Card, Person, GramNumber } from './types';
import { segmentDetailed } from './grammar';

// Inflection: predicate cards store a leading verb lemma (+ optional adverb and
// trailing text); we conjugate the verb to agree with the clause's subject so
// "My opponent kicks puppies" / "Our children kick puppies" both read right.
// Invariant predicates (modal/negated phrasings) are used verbatim.

function inflectCopula(person: Person, number: GramNumber): string {
  if (person === 1 && number === 'sing') return 'am';
  if (number === 'plural' || person === 2) return 'are';
  return 'is';
}

const IRREGULAR_3SG: Record<string, string> = { have: 'has', do: 'does', go: 'goes' };

function add3sg(lemma: string): string {
  if (IRREGULAR_3SG[lemma]) return IRREGULAR_3SG[lemma];
  if (/(s|x|z|ch|sh)$/.test(lemma)) return lemma + 'es';
  if (/[^aeiou]y$/.test(lemma)) return lemma.slice(0, -1) + 'ies';
  return lemma + 's';
}

function inflectVerb(lemma: string, person: Person, number: GramNumber): string {
  return person === 3 && number === 'sing' ? add3sg(lemma) : lemma;
}

/** Render a predicate phrase (without its object) for a given subject agreement. */
export function predicateText(card: Card, person: Person, number: GramNumber): string {
  if (card.invariant) return card.text ?? '';
  const verb = card.lead === 'be' ? inflectCopula(person, number) : inflectVerb(card.lead ?? '', person, number);
  return [card.pre, verb, card.post].filter(Boolean).join(' ');
}

/** A standalone display label for a card (predicates shown in 3rd-person singular). */
export function cardLabel(card: Card): string {
  if (card.role === 'predicate') {
    const base = predicateText(card, 3, 'sing');
    return card.open ? `${base} …` : base;
  }
  return card.text ?? '';
}

/**
 * Render the (possibly partial) statement to display strings: predicates agree
 * with their clause subject, the first word is capitalized, and mid-sentence
 * noun-phrase articles ("My"/"The") are lower-cased (but "I" is preserved).
 */
export function displayWords(line: Card[]): string[] {
  const { clauses, roleAt } = segmentDetailed(line);
  const words = line.map((c) => c.text ?? '');

  for (const clause of clauses) {
    const subj = clause.subjectIdx !== undefined ? line[clause.subjectIdx] : undefined;
    const person: Person = subj?.person ?? 3;
    const number: GramNumber = subj?.number ?? 'sing';
    for (const p of clause.preds) words[p.predIdx] = predicateText(line[p.predIdx], person, number);
  }

  for (let i = 0; i < line.length; i++) {
    const isNp = roleAt[i] === 'subject' || roleAt[i] === 'object';
    if (i > 0 && isNp && words[i] !== 'I' && !line[i].proper) {
      words[i] = words[i].charAt(0).toLowerCase() + words[i].slice(1);
    }
  }
  if (words.length > 0) words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words;
}

/** Join a realized statement into a display sentence. */
export function renderSentence(line: Card[]): string {
  const words = displayWords(line).filter(Boolean);
  if (words.length === 0) return '';
  return words.join(' ').replace(/\s+/g, ' ').trim() + '.';
}
