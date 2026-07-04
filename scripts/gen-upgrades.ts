import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Card } from '../src/engine/types';
import { cardLabel } from '../src/engine/morphology';
import {
  SIG_BRAG,
  SIG_ATTACK,
  SIG_PANDER,
  SIG_NPS,
  REWARDS,
  UPGRADES,
  UPGRADE_DEFS,
  findDef,
} from '../src/data/cards';
import { buildPrivateDeck } from '../src/engine/deck';

// Generates UPGRADE_PATHS.md — a designer-facing review doc of every upgrade chain
// (Punch Up the Zingers), with stats, plus a coverage report of which upgradeable
// deck cards have NO authored path yet. Run `npm run upgrades` after editing the
// UPGRADES chains in cards.ts so it never drifts.

/** Compact power readout — this doc is for the DESIGNER, so stats are welcome here
 * (unlike the playtester-facing CARDS.md). */
function stats(c: Card): string {
  const parts: string[] = [];
  if (c.sentiment !== undefined) parts.push(`${c.sentiment > 0 ? '+' : ''}${c.sentiment}`);
  if (c.affinity !== undefined || c.deed !== undefined) parts.push(`open: deed ${c.deed ?? 0}, affinity ${c.affinity ?? 0}`);
  if (c.intensity) parts.push(`×${c.intensity}`);
  if (c.ceiling) parts.push(`cap +${c.ceiling}`);
  return parts.join(', ');
}

/** Walk a chain from an ORIGINAL base id: [base, t1, t2, …]. */
function walk(origId: string): Card[] {
  const out: Card[] = [findDef(origId)!];
  let id = origId;
  while (UPGRADES[id]) {
    out.push(UPGRADES[id]);
    id = UPGRADES[id].id;
  }
  return out;
}

function chainMd(origId: string): string {
  const [base, ...tiers] = walk(origId);
  const lines = [`- **${cardLabel(base)}** (${stats(base)})`];
  for (const t of tiers) {
    lines.push(`  - ${'➕'.repeat(t.tier ?? 1)} ${cardLabel(t)} (${stats(t)})`);
  }
  return lines.join('\n');
}

// Chain ORIGINS = UPGRADES keys that are not themselves upgraded defs.
const upgradedIds = new Set(UPGRADE_DEFS.map((c) => c.id));
const origins = Object.keys(UPGRADES).filter((id) => !upgradedIds.has(id));
const originSet = new Set(origins);

const inGroup = (group: Card[]) => origins.filter((id) => group.some((c) => c.id === id));
const section = (ids: string[]) => ids.map(chainMd).join('\n');

const sigPredIds = new Set([...SIG_BRAG, ...SIG_ATTACK, ...SIG_PANDER].map((c) => c.id));
const sigNpIds = new Set(SIG_NPS.map((c) => c.id));
const rewardIds = new Set(REWARDS.map((c) => c.id));
const subsIds = origins.filter((id) => !sigPredIds.has(id) && !sigNpIds.has(id) && !rewardIds.has(id));

// Coverage: player-deck sentence cards (default private deck + all REWARDS) that could
// carry a chain but don't. Connectors/finishers/power-ups are skipped BY DESIGN (a conj
// multiplier bump or +0.1 factor has no funnier text — against the north star).
const UPGRADEABLE_ROLES = new Set(['np', 'predicate', 'modifier']);
const deckBaseIds = [...new Set(buildPrivateDeck(undefined).map((c) => c.id.split('#')[0]))];
const candidates = [...deckBaseIds.map((id) => findDef(id)!), ...REWARDS];
const uncovered = candidates.filter((c) => UPGRADEABLE_ROLES.has(c.role) && !originSet.has(c.id));
const skippedByDesign = candidates.filter((c) => !UPGRADEABLE_ROLES.has(c.role));

const md = `# Upgrade paths — "Punch Up the Zingers"

*Auto-generated from \`src/data/cards.ts\` — do not edit by hand. Regenerate with \`npm run upgrades\`.*

Every chain is **linear** (no branching): base → ➕ tier 1 → ➕➕ tier 2. Most cards have
ONE authored tier so far; flagship chains go two deep. Reward-tier cards get one extra
tier on top of their already-premium stats — the "draft it, then punch it up into a
super-card" arc. Stat curve: signature predicates ±3 → ±4 (cap +4) → ±5 (cap +6);
signature subjects ×1.3 → ×1.6 (cap +3) → ×1.9 (cap +5); rewards ±4 → ±5 (cap +6).

**Chains: ${origins.length} · upgraded defs: ${UPGRADE_DEFS.length} · two-tier chains: ${origins.filter((id) => walk(id).length > 2).length}**

## Signature brags
${section(inGroup(SIG_BRAG))}

## Signature attacks
${section(inGroup(SIG_ATTACK))}

## Signature pander
${section(inGroup(SIG_PANDER))}

## Signature subjects & objects
${section(inGroup(SIG_NPS))}

## Default-deck staples (the four \`subs\` cards)
${section(subsIds)}

## Reward cards (one extra tier → super-card)
${section(origins.filter((id) => rewardIds.has(id)))}

---

## Coverage — no upgrade path yet (${uncovered.length} cards)

Player-deck sentence cards (default deck + rewards) that could carry a chain but don't.
Candidates for the next authoring pass:

${uncovered.map((c) => `- ${cardLabel(c)} *(${c.role}, ${stats(c) || '—'})*`).join('\n')}

## Skipped by design (${skippedByDesign.length} cards)

Connectors, finishers, and power-ups don't upgrade: a multiplier bump with no funnier
text is against the design north star.
`;

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'UPGRADE_PATHS.md');
writeFileSync(outPath, md);
console.log(`Wrote ${outPath}`);
