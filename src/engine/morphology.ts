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

interface SubjectAgreement {
  person: Person;
  number: GramNumber;
  animate: boolean;
}

/**
 * Per-index subject agreement for every conjugating card in the line — the single source of
 * agreement truth shared by displayWords (rendering) and clipKeys (voice-clip playback), so the
 * spoken conjugation can never drift from the displayed one.
 */
function lineAgreements(line: Card[]): {
  preds: Map<number, SubjectAgreement>;
  mods: Map<number, SubjectAgreement>;
  roleAt: ReturnType<typeof segmentDetailed>['roleAt'];
} {
  const { clauses, roleAt } = segmentDetailed(line);
  const preds = new Map<number, SubjectAgreement>();
  const mods = new Map<number, SubjectAgreement>();
  for (const clause of clauses) {
    const subjIdxs = [
      ...(clause.subjectIdx !== undefined ? [clause.subjectIdx] : []),
      ...(clause.coSubj ?? []).map((s) => s.npIdx),
    ];
    const subjs = subjIdxs.map((ix) => line[ix]);
    // A compound subject conjugates PLURAL ("Satan and the lobbyists WANT…");
    // person is the lowest present ("my opponent and I ARE…" — first person plural).
    const person: Person = subjs.length ? (Math.min(...subjs.map((c) => c.person ?? 3)) as Person) : 3;
    const number: GramNumber = subjs.length > 1 ? 'plural' : subjs[0]?.number ?? 'sing';
    // Modifier asides agree with what they follow, set off by commas: mid-compound,
    // with the nearest preceding noun ("Satan, who IS shady, and the lobbyists…");
    // after the last subject, with the whole compound (plural).
    for (const m of clause.mods) {
      const before = subjIdxs.filter((ix) => ix < m);
      const host = before.length ? line[before[before.length - 1]] : undefined;
      const mid = subjIdxs.some((ix) => ix > m); // more subjects follow this aside
      mods.set(m, {
        person: mid ? host?.person ?? 3 : person,
        number: mid ? host?.number ?? 'sing' : number,
        animate: (mid ? host?.animate : subjs[subjs.length - 1]?.animate) ?? true,
      });
    }
    for (const p of clause.preds) preds.set(p.predIdx, { person, number, animate: true });
  }
  return { preds, mods, roleAt };
}

/**
 * Render the (possibly partial) statement to display strings: predicates agree
 * with their clause subject, the first word is capitalized, and mid-sentence
 * noun-phrase articles ("My"/"The") are lower-cased (but "I" is preserved).
 */
export function displayWords(line: Card[]): string[] {
  const { preds, mods, roleAt } = lineAgreements(line);
  const words = line.map((c) => c.text ?? '');
  for (const [m, a] of mods) words[m] = `, ${modifierText(line[m], a.person, a.number, a.animate)},`;
  for (const [p, a] of preds) words[p] = predicateText(line[p], a.person, a.number);

  // A dual-role parenthetical used as a clause connector ("…, and I'm not making this up, …")
  // is set off by commas like an aside (it's not in any clause's `mods`).
  for (let i = 0; i < line.length; i++) {
    if (roleAt[i] === 'conn' && line[i].role === 'modifier' && words[i]) words[i] = `, ${words[i]},`;
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

  // Punctuate the finisher: a flowing "and …" tag gets a comma ("…Magic Eight Ball,
  // and history will prove me right"); any other finisher reads as its own emphatic
  // sentence — a period + capital ("…ever. Write that down.").
  for (let i = 0; i < line.length; i++) {
    if (roleAt[i] !== 'int' || !words[i]) continue;
    words[i] = /^and\b/i.test(words[i]) ? `, ${words[i]}` : `. ${cap(words[i])}`;
  }
  return words;
}

/**
 * The voice-clip key (voice-manifest.json `key`) each card in a judged line speaks, index-aligned
 * with the line; `null` = nothing spoken (a card displayWords also omits, e.g. an unparsed stray
 * predicate in word salad). Single-form cards (NPs, connectors, finishers, invariant
 * predicates/modifiers) speak their base clip; conjugating cards pick `.3sg`/`.pl`/`.1sg` by the
 * same clause agreement the display uses. `.1sg` exists only for copula cards ("I AM strong…") —
 * every other first-person-singular text is identical to the plural form. Note the key does NOT
 * encode a modifier's who/which (the clip bakes the card's own `rel` hint — a deliberate
 * recording-time simplification; see gen-clips.ts).
 */
export function clipKeys(line: Card[]): (string | null)[] {
  const { preds, mods } = lineAgreements(line);
  return line.map((c, i) => {
    const base = c.id.split('#')[0];
    const twoForm = (c.role === 'predicate' || c.role === 'modifier') && !c.invariant;
    if (!twoForm) return base;
    const a = preds.get(i) ?? mods.get(i);
    if (!a) return null;
    const form =
      a.person === 3 && a.number === 'sing'
        ? '3sg'
        : a.person === 1 && a.number === 'sing' && c.lead === 'be'
        ? '1sg'
        : 'pl';
    return `${base}.${form}`;
  });
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
