import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Card } from '../src/engine/types';
import { predicateText, modifierText, cardLabel } from '../src/engine/morphology';
import { ALL, UPGRADE_DEFS } from '../src/data/cards';

// Generates voice-manifest.json — every RENDERABLE "surface form" (speakable text) of every
// card, with a stable filename key, so voice clips can be recorded per-CHUNK (never per-statement;
// statements are combinatorial). This is the enabling step for the phased VOICE plan (see CLAUDE.md
// "Sound & the phased VOICE plan"): ElevenLabs TTS first, human VA later. It does NOT synthesize
// audio — it's a pure, deterministic manifest (mirrors gen-catalog.ts / gen-upgrades.ts). Run
// `npm run genclips` after editing cards.ts so the clip list never drifts from the deck.
//
// VOICE SCOPING DECISION (2026-07-06): the manifest is authored for a SINGLE deadpan
// moderator/announcer voice reading everyone's statements — the cost floor (~560 forms, one voice),
// fits the C-SPAN broadcast skin, and decouples voice from the growing cast (new opponents add zero
// recordings). Re-scoping to per-side voices later just means recording this same manifest N times.
//
// Two cards are EXCLUDED because they're excluded from ALL and not spoken in normal play: PERIOD
// (virtual, currently disabled) and UNDER_OATH (scripted power-up). Flip INCLUDE_SPECIAL to add
// them if they ever need clips.
const INCLUDE_SPECIAL = false;

// The two conjugations of a non-invariant predicate/modifier ("kicks/kick puppies", "is/are …").
// A predicate has no inherent agreement in isolation, so we emit both; invariant cards bake their
// own phrasing and get exactly one form. Modifiers additionally vary who/which by the SUBJECT's
// animacy in-context (up to 4 forms) — to match the ~560 target we emit only the two conjugations
// using the card's own `rel` hint for who/which; recording who/which variants (if wanted) is a
// recording-time decision, not a generator one.
type Conjugation = '3sg' | 'pl' | null;

interface ClipEntry {
  key: string; // stable clip id = card id (+ ".3sg"/".pl" for two-form cards)
  file: string; // suggested clip filename (key + .mp3)
  cardId: string; // as-authored base id
  role: Card['role'];
  tier?: number; // upgrade tier (1/2) if this is an upgrade def
  conjugation: Conjugation; // which agreement this form is, or null for single-form cards
  text: string; // the exact words to speak
}

// A predicate/modifier gets both conjugations ONLY when it isn't invariant. Key strictly on
// `invariant` (NOT `open` — open non-invariant preds still conjugate: "is/are in bed with").
function twoForm(c: Card): boolean {
  return (c.role === 'predicate' || c.role === 'modifier') && !c.invariant;
}

function surfaceForms(c: Card): { conjugation: Conjugation; text: string }[] {
  if (!twoForm(c)) return [{ conjugation: null, text: cardLabel(c) }];
  if (c.role === 'predicate') {
    return [
      { conjugation: '3sg', text: predicateText(c, 3, 'sing') },
      { conjugation: 'pl', text: predicateText(c, 3, 'plural') },
    ];
  }
  // modifier
  const animate = c.rel !== 'which';
  return [
    { conjugation: '3sg', text: modifierText(c, 3, 'sing', animate) },
    { conjugation: 'pl', text: modifierText(c, 3, 'plural', animate) },
  ];
}

const cards: Card[] = [...ALL, ...UPGRADE_DEFS];
// (INCLUDE_SPECIAL hook left for PERIOD/UNDER_OATH; import + push them here if ever needed.)

const clips: ClipEntry[] = [];
for (const c of cards) {
  for (const { conjugation, text } of surfaceForms(c)) {
    const key = conjugation ? `${c.id}.${conjugation}` : c.id;
    const entry: ClipEntry = { key, file: `${key}.mp3`, cardId: c.id, role: c.role, conjugation, text };
    if (c.tier) entry.tier = c.tier;
    clips.push(entry);
  }
}

// --- self-checks: fail loud if the deck shape drifts from the documented counts ---
const distinctCards = new Set(clips.map((e) => e.cardId)).size;
const expectedDistinct = ALL.length + UPGRADE_DEFS.length; // 278 + 153 = 431 today
if (distinctCards !== expectedDistinct)
  throw new Error(`distinct card count ${distinctCards} !== ALL(${ALL.length})+UPGRADE_DEFS(${UPGRADE_DEFS.length})=${expectedDistinct}`);
// Surface forms should sit near ~560 (CLAUDE.md); assert the two-form logic is actually firing
// rather than checking a brittle exact number — a hard floor of "more forms than cards" catches a
// silently-broken twoForm() (which would collapse everything to 1:1).
if (clips.length <= distinctCards)
  throw new Error(`surface forms ${clips.length} !> distinct cards ${distinctCards} — twoForm() likely broken`);
// Duplicate-key guard: two cards must never share a clip filename.
const dupe = clips.map((e) => e.key).find((k, i, a) => a.indexOf(k) !== i);
if (dupe) throw new Error(`duplicate clip key: ${dupe}`);

const payload = {
  generated: 'run `npm run genclips` to regenerate — do not edit by hand',
  voice: 'single deadpan moderator/announcer (see gen-clips.ts header for the scoping decision)',
  distinctCards,
  surfaceForms: clips.length,
  clips,
};

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'voice-manifest.json');
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
console.log(`Wrote ${outPath}`);
console.log(`  ${distinctCards} distinct cards → ${clips.length} surface forms`);
