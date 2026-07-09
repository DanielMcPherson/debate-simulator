import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Card } from '../src/engine/types';
import { cardLabel } from '../src/engine/morphology';
import {
  SUBJECTS,
  OBJECTS,
  COMMON_PRAISE,
  COMMON_INSULTS,
  SIG_BRAG,
  SIG_ATTACK,
  SIG_PANDER,
  SIG_SUBJ_BRAG,
  SIG_SUBJ_ATTACK,
  SIG_SUBJ_PANDER,
  SIG_OBJECTS,
  OPEN_PREDS,
  MODIFIERS,
  CONNECTORS,
  INTENSIFIERS,
  POWERUPS,
  REWARDS,
  UPGRADES,
} from '../src/data/cards';

// Generates CARD_CURATION.md — a strength-ordered, human-editable list of every COMMON-deck card
// and every PLAYER REWARD card, with upgrade chains shown inline. Built for Daniel to prune/edit/
// reorder by hand; a session then re-processes the edited file back into cards.ts. No point values:
// STRENGTH IS ENCODED BY ORDER (weakest → strongest within each group). Upgradable cards sit at the
// strength of their BASE card, with +/++ tiers indented beneath. The `[id]` tag on each line is only
// a re-processing handle — ignore it while reading.

// Ordering metric per role (never shown — only used to sort weak→strong within a group).
const CONN_TIER: Record<string, number> = { and: 1.25, because: 1.3, 'and therefore': 1.3, but: 1.4, period: 0 };
function strength(c: Card): number {
  switch (c.role) {
    case 'np':
      return Math.abs(c.sentiment ?? 0) * (c.intensity ?? 1);
    case 'predicate':
      return c.open ? Math.abs(c.deed ?? 0) + Math.abs(c.affinity ?? 0) : Math.abs(c.sentiment ?? 0);
    case 'modifier':
      return Math.abs(c.sentiment ?? 0);
    case 'connector':
      return CONN_TIER[c.conj ?? ''] ?? 0;
    case 'intensifier':
      return c.factor ?? 1;
    default:
      return 0; // powerups — unscored actions
  }
}

// Walk an upgrade chain: base id → UPGRADES[id] → UPGRADES[that.id] → …
function chainOf(c: Card): Card[] {
  const out: Card[] = [];
  let cur = UPGRADES[c.id];
  while (cur) {
    out.push(cur);
    cur = UPGRADES[cur.id];
  }
  return out;
}

function line(c: Card, tier = 0): string {
  const indent = tier === 0 ? '- ' : '  '.repeat(tier) + '+'.repeat(tier) + ' ';
  return `${indent}${cardLabel(c)}  ·  \`${c.id}\``;
}

function group(title: string, cards: Card[]): string {
  if (!cards.length) return '';
  const sorted = [...cards].sort((a, b) => strength(a) - strength(b));
  const body = sorted
    .map((c) => [line(c), ...chainOf(c).map((t, i) => line(t, i + 1))].join('\n'))
    .join('\n');
  return `### ${title}\n\n${body}\n`;
}

const goodThings = [...OBJECTS, ...SIG_OBJECTS].filter((c) => (c.sentiment ?? 0) >= 0);
const badThings = [...OBJECTS, ...SIG_OBJECTS].filter((c) => (c.sentiment ?? 0) < 0);

// REWARDS is a mixed pool — bucket it by role/sign the same way.
const rw = (pred: (c: Card) => boolean) => REWARDS.filter(pred);
const rwSubjects = rw((c) => c.role === 'np' && c.side !== 'neutral');
const rwThings = rw((c) => c.role === 'np' && c.side === 'neutral');
const rwGood = rw((c) => c.role === 'predicate' && !c.open && (c.sentiment ?? 0) >= 0);
const rwBad = rw((c) => c.role === 'predicate' && !c.open && (c.sentiment ?? 0) < 0);
const rwOpen = rw((c) => c.role === 'predicate' && !!c.open);
const rwMods = rw((c) => c.role === 'modifier');
const rwConn = rw((c) => c.role === 'connector');
const rwFin = rw((c) => c.role === 'intensifier');
const rwAction = rw((c) => c.role === 'powerup');

const md = `# Card curation list

*Weakest → strongest **within each group** — no point values, order encodes strength. Upgradable
cards sit at their **base** card's strength with \`+\`/\`++\` tiers indented beneath. The \`[id]\`
tag is just my re-processing handle — ignore it while reading.*

**How to edit:** delete a whole line to CUT a card (its whole upgrade chain goes with the base).
Rewrite the text to EDIT a card (keep the id). Move a line up/down to change its strength rank.
Add a bare new line (no id) for a brand-new card. I'll turn your edits back into cards.ts —
positions become the −1…−4 / +1…+4 sentiment tiers.

---

## COMMON DECK
*The default lexicon everyone plays: the contested shared pool (subjects, objects, connectors,
finishers, asides, open + stump predicates) plus your starting private deck (the signature zingers
+ power-ups). Weaker "stump" cards sort first, punchier "signature" cards later.*

## Subjects — who / what you talk about

${group('About you', [...SUBJECTS.filter((c) => c.side === 'self'), ...SIG_SUBJ_BRAG])}
${group('Your opponent', [...SUBJECTS.filter((c) => c.side === 'opponent'), ...SIG_SUBJ_ATTACK])}
${group('The crowd & country', [...SUBJECTS.filter((c) => c.side === 'audience'), ...SIG_SUBJ_PANDER])}
## Things (objects you praise or trash)

${group('Good things', goodThings)}
${group('Bad things', badThings)}
## Predicates — what someone does / is

${group('Brag / praise', [...COMMON_PRAISE, ...SIG_BRAG])}
${group('Attack / insult', [...COMMON_INSULTS, ...SIG_ATTACK])}
${group('Pander', SIG_PANDER)}
${group('Open (need a thing to point at)', OPEN_PREDS)}
## Asides (post-nominal modifiers)

${group('Asides', MODIFIERS)}
## Connectors (chain clauses / predicates)

${group('Connectors', CONNECTORS)}
## Finishers (cap a statement)

${group('Finishers', INTENSIFIERS)}
## Power-ups (one-shot actions — not scored, listed for completeness)

${group('Power-ups', POWERUPS)}
---

## PLAYER REWARD CARDS
*Earned by winning debates / achievements / the consultant — the "fun cards to hunt for". Generally
stronger than the common deck; these are where showcase cards belong.*

## Reward subjects & things

${group('Subjects (you / opponent / crowd)', rwSubjects)}
${group('Things', rwThings)}
## Reward predicates

${group('Brag / praise', rwGood)}
${group('Attack / insult', rwBad)}
${group('Open (need a thing to point at)', rwOpen)}
## Reward asides & connectors

${group('Asides', rwMods)}
${group('Connectors', rwConn)}
## Reward finishers

${group('Finishers', rwFin)}
## Reward actions

${group('Actions', rwAction)}`;

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'CARD_CURATION.md');
writeFileSync(outPath, md.replace(/\n{3,}/g, '\n\n') + '\n');
console.log(`Wrote ${outPath}`);
