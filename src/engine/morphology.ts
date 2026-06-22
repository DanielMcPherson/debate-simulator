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

/**
 * Render a modifier aside ("who is ugly, just very ugly") agreeing with its subject.
 * The relative pronoun follows the subject's animacy; the verb conjugates like a
 * predicate (reusing predicateText), so "the donors, who are shady" / "the
 * Constitution, which is a treasure" both read right.
 */
export function modifierText(card: Card, person: Person, number: GramNumber, animate = true): string {
  // An invariant modifier bakes its own pronoun/phrasing ("who, and I say this with love,
  // has completely lost it") — used verbatim, no relative-pronoun prefix.
  if (card.invariant) return card.text ?? '';
  const rel = animate ? 'who' : 'which';
  return `${rel} ${predicateText(card, person, number)}`;
}

/** A standalone display label for a card (predicates shown in 3rd-person singular). */
export function cardLabel(card: Card): string {
  if (card.role === 'predicate') {
    const base = predicateText(card, 3, 'sing');
    return card.open ? `${base} …` : base;
  }
  if (card.role === 'modifier') {
    // Standalone (hand/catalog): use the card's own who/which hint, 3rd-sing.
    return modifierText(card, 3, 'sing', card.rel !== 'which');
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
    // Modifier asides agree with the subject and are set off by commas.
    for (const m of clause.mods) words[m] = `, ${modifierText(line[m], person, number, subj?.animate ?? true)},`;
    for (const p of clause.preds) words[p.predIdx] = predicateText(line[p.predIdx], person, number);
  }

  // Capitalize the first word of each sentence (start, and after every period);
  // lower-case mid-sentence noun-phrase articles ("My"/"The"), but never "I".
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const lower = (w: string) => w.charAt(0).toLowerCase() + w.slice(1);
  let sentenceStart = true;
  for (let i = 0; i < line.length; i++) {
    const role = roleAt[i];
    const isNp = role === 'subject' || role === 'object';
    if (words[i] && isNp) {
      if (sentenceStart) words[i] = cap(words[i]);
      else if (words[i] !== 'I' && !line[i].proper) words[i] = lower(words[i]);
    }
    if (role === 'conn' && line[i].conj === 'period') sentenceStart = true;
    else if (words[i]) sentenceStart = false;
  }
  return words;
}

/** Join a realized statement into a display sentence. */
export function renderSentence(line: Card[]): string {
  const words = displayWords(line).filter(Boolean);
  if (words.length === 0) return '';
  // Collapse runs of spaces, then pull punctuation (a period card ".", or a modifier's
  // set-off commas) tight against the preceding word.
  let s = words.join(' ').replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1').trim();
  s = /[.!?]$/.test(s) ? s : s + '.';
  // Drop a dangling comma that ended up against the closing period (a stall on a modifier).
  return s.replace(/,(\s*[.!?])/g, '$1');
}
