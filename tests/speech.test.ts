import { describe, it, expect } from 'vitest';
import { clipKeys, displayWords } from '../src/engine/morphology';
import type { Card } from '../src/engine/types';
import { ALL, UPGRADE_DEFS, findDef } from '../src/data/cards';
import manifest from '../voice-manifest.json';

// Voice narration: clipKeys (morphology.ts) picks, per card in a judged line, which recorded
// surface form (voice-manifest.json key) to speak. These tests lock (a) the agreement logic,
// (b) full manifest coverage of every reachable key, and (c) parity between the spoken text and
// the displayed text — the guarantee that the narrator never reads a different conjugation than
// the teleprompter shows. NOTE (c)+(b) also fail when voice-manifest.json is stale: run
// `npm run genclips` after editing cards.ts (the documented invariant, now test-enforced).

const clipText = new Map(manifest.clips.map((c) => [c.key, c.text]));

const inst = (baseId: string, n = 1): Card => {
  const def = findDef(baseId);
  if (!def) throw new Error(`no card def: ${baseId}`);
  return { ...def, id: `${def.id}#${n}` };
};
const keys = (...ids: string[]) => clipKeys(ids.map((id, i) => inst(id, i)));

describe('clipKeys — voice-clip selection per card', () => {
  it('third-singular subject picks .3sg', () => {
    expect(keys('s_opp', 'p_kick_pup')).toEqual(['s_opp', 'p_kick_pup.3sg']);
  });

  it('plural subject picks .pl', () => {
    expect(keys('s_career', 'p_kick_pup')).toEqual(['s_career', 'p_kick_pup.pl']);
  });

  it('an "I" subject picks .1sg for a copula ("I AM strong…")', () => {
    expect(keys('s_i', 'p_strong')).toEqual(['s_i', 'p_strong.1sg']);
    expect(clipText.get('p_strong.1sg')).toBe('am strong and decisive');
  });

  it('an "I" subject picks .pl for a non-copula (base-form text is identical)', () => {
    expect(keys('s_i', 'p_protect_vets')).toEqual(['s_i', 'p_protect_vets.pl']);
  });

  it('a compound subject conjugates plural — even with "I" in it', () => {
    expect(keys('s_opp', 'c_and', 's_i', 'p_strong')[3]).toBe('p_strong.pl'); // "…and I ARE strong"
  });

  it('modifier asides agree with their subject; invariant ones are single-form', () => {
    expect(keys('s_opp', 'm_ugly', 'p_kick_pup')).toEqual(['s_opp', 'm_ugly.3sg', 'p_kick_pup.3sg']);
    expect(keys('s_career', 'm_ugly', 'p_kick_pup')[1]).toBe('m_ugly.pl');
    expect(keys('s_opp', 'm_lostit', 'p_kick_pup')[1]).toBe('m_lostit');
  });

  it('connectors and finishers speak their base clip; instance suffixes are stripped', () => {
    expect(keys('s_opp', 'p_kick_pup', 'c_and', 'p_lie', 'x_believe')).toEqual([
      's_opp',
      'p_kick_pup.3sg',
      'c_and',
      'p_lie.3sg',
      'x_believe',
    ]);
  });

  it('upgraded-tier cards speak their own tier clip', () => {
    expect(keys('s_opp_t1', 'p_kick_pup')[0]).toBe('s_opp_t1');
  });

  it('speaks exactly what is displayed: null keys align with omitted display words', () => {
    const lines = [
      ['p_kick_pup'], // subjectless predicate
      ['c_and'], // lone connector
      ['s_opp', 's_i', 'p_kick_pup'], // stray second subject (word salad)
      ['s_opp', 'p_kick_pup', 'p_lie'], // run-on-ish predicate pile
    ];
    for (const ids of lines) {
      const line = ids.map((id, i) => inst(id, i));
      const ks = clipKeys(line);
      const words = displayWords(line);
      line.forEach((_, i) => expect(ks[i] === null, `${ids[i]} in [${ids}]`).toBe(words[i] === ''));
    }
  });
});

describe('clip coverage — every reachable clip key exists in voice-manifest.json', () => {
  const twoForm = (c: Card) => (c.role === 'predicate' || c.role === 'modifier') && !c.invariant;
  it('all cards covered (fails if the manifest is stale — run `npm run genclips`)', () => {
    for (const c of [...ALL, ...UPGRADE_DEFS]) {
      if (twoForm(c)) {
        expect(clipText.has(`${c.id}.3sg`), `${c.id}.3sg`).toBe(true);
        expect(clipText.has(`${c.id}.pl`), `${c.id}.pl`).toBe(true);
        expect(clipText.has(`${c.id}.1sg`), `${c.id}.1sg`).toBe(c.lead === 'be');
      } else {
        expect(clipText.has(c.id), c.id).toBe(true);
      }
    }
  });
});

describe('spoken/displayed parity — the narrator reads the conjugation the teleprompter shows', () => {
  const preds = [...ALL, ...UPGRADE_DEFS].filter((c) => c.role === 'predicate' && !c.invariant);
  // Contexts covering every agreement branch: 3rd-sing, plural, first-person-sing.
  const contexts = ['s_opp', 's_career', 's_i'];
  it('every conjugating predicate, in every agreement context', () => {
    for (const p of preds) {
      for (const subj of contexts) {
        const ids = p.open ? [subj, p.id, 'o_taxes'] : [subj, p.id];
        const line = ids.map((id, i) => inst(id, i));
        const key = clipKeys(line)[1]!;
        expect(clipText.get(key), `${key} for "${subj} + ${p.id}"`).toBe(displayWords(line)[1]);
      }
    }
  });

  it('modifier asides (clips bake the card`s own who/which hint)', () => {
    const mods = [...ALL, ...UPGRADE_DEFS].filter((c) => c.role === 'modifier' && !c.invariant);
    for (const m of mods) {
      // Pick a subject whose animacy matches the card's rel hint so display text == clip text.
      const subj = m.rel === 'which' ? 's_record' : 's_opp';
      const line = [inst(subj, 0), inst(m.id, 1), inst('p_kick_pup', 2)];
      const spoken = clipText.get(clipKeys(line)[1]!);
      const shown = displayWords(line)[1].replace(/^, /, '').replace(/,$/, ''); // strip the comma set-off
      expect(spoken, m.id).toBe(shown);
    }
  });
});
