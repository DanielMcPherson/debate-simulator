import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Card } from '../src/engine/types';
import { cardLabel } from '../src/engine/morphology';
import {
  SUBJECTS,
  OBJECTS,
  SIG_NPS,
  COMMON_PRAISE,
  COMMON_INSULTS,
  SIG_BRAG,
  SIG_ATTACK,
  SIG_PANDER,
  OPEN_PREDS,
  MODIFIERS,
  CONNECTORS,
  INTENSIFIERS,
  POWERUPS,
  REWARDS,
  PERIOD,
} from '../src/data/cards';

// Generates CARDS.md — a phrase-only, playtester-facing catalog of every card,
// grouped by flavor. Run `npm run catalog` after editing cards.ts so it never
// drifts. Phrases are rendered via cardLabel (the same conjugation the game uses);
// no ids/scores/topics leak out — playtesters infer usage from the wording.

const phrase = (c: Card): string => cardLabel(c);
const bullets = (cards: Card[]): string => cards.map((c) => `- ${phrase(c)}`).join('\n');

// SIG_NPS mixes signature subjects (self/opponent/audience) and objects (neutral).
const sigSubjects = SIG_NPS.filter((c) => c.side !== 'neutral');
const sigObjects = SIG_NPS.filter((c) => c.side === 'neutral');

const subjectsBySide = (side: Card['side']) =>
  [...SUBJECTS, ...sigSubjects].filter((c) => c.side === side);

const goodThings = [...OBJECTS, ...sigObjects].filter((c) => (c.sentiment ?? 0) >= 0);
const badThings = [...OBJECTS, ...sigObjects].filter((c) => (c.sentiment ?? 0) < 0);

const md = `# Card catalog

*Auto-generated from \`src/data/cards.ts\` — do not edit by hand. Regenerate with \`npm run catalog\`.*

## How to suggest a new card

Just write the funny line — that's it. **Don't** worry about scoring, grammar, or
parts of speech; all of that gets sorted out when the card is added. Browse the lists
below to match the vibe and avoid duplicates, then send your lines over.

A few flavors to riff on:
- **Subjects** — who or what you're talking about ("My crooked opponent", "This great nation").
- **Things** — objects you praise or trash ("freedom and democracy", "the swamp").
- **Predicates** — what someone *does* or *is* ("kicks puppies", "is a national treasure").
  Some are *open* lines that need a thing to point at ("wants to destroy ___").
- **Finishers** — punchy taglines that cap a statement ("believe me").

Power level rises down each predicate section: *stump lines* are mild everyday
material, *signature zingers* are punchy and characterful, *reward cards* are
over-the-top. Aim a new line at whichever tier it feels like.

---

## Subjects — who / what you talk about

### About yourself
${bullets(subjectsBySide('self'))}

### About your opponent
${bullets(subjectsBySide('opponent'))}

### About the crowd & country
${bullets(subjectsBySide('audience'))}

## Things (objects you praise or trash)

### Good things
${bullets(goodThings)}

### Bad things
${bullets(badThings)}

## Predicates — what they do / are

### Stump lines — mild, everyone fights over these

#### Praise
${bullets(COMMON_PRAISE)}

#### Insults
${bullets(COMMON_INSULTS)}

### Signature zingers — punchy, deck-defining

#### Brags
${bullets(SIG_BRAG)}

#### Attacks
${bullets(SIG_ATTACK)}

#### Pander
${bullets(SIG_PANDER)}

### Open lines (need a thing to point at)
${bullets(OPEN_PREDS)}

## Modifiers (asides that beef up a clause)
*Slip one in right after a subject — "My opponent, **who is ugly, just very ugly**, eats kittens." It intensifies the clause, adds a comedic aside, and can be played as a stall before you commit to a verb. Praising the wrong target backfires.*

${bullets(MODIFIERS)}

## Connectors (chain clauses together)
${bullets(CONNECTORS)}
- ${phrase(PERIOD)}  *(a period — free, but only one per statement)*

## Finishers (cap a statement)
${bullets(INTENSIFIERS)}

## Power-ups (one-shot action cards, not part of the sentence)
${bullets(POWERUPS)}

## Reward cards — campaign-only, over-the-top
${bullets(REWARDS)}
`;

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'CARDS.md');
writeFileSync(outPath, md);
console.log(`Wrote ${outPath}`);
