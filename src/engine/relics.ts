import type { Relic, RelicMods } from './types';

/** The empty modifier set — what a relic-less player scores under. */
export const NO_MODS: RelicMods = {};

/**
 * Flatten a relic list into one RelicMods bag. Scoring/game code consumes only the
 * merged result, never the array. Merge rules: booleans OR; additive numbers sum;
 * multiplier fields take the min (strongest protection wins — they don't stack).
 * Slice 1 grants a single relic per run, but the merge keeps multi-relic runs sound.
 */
export function mergeRelicMods(relics: Relic[] | undefined): RelicMods {
  if (!relics?.length) return NO_MODS;
  const out: RelicMods = {};
  for (const r of relics) {
    const m = r.mods;
    if (m.incomingAttackMult !== undefined)
      out.incomingAttackMult = Math.min(out.incomingAttackMult ?? m.incomingAttackMult, m.incomingAttackMult);
    if (m.blunderMult !== undefined)
      out.blunderMult = Math.min(out.blunderMult ?? m.blunderMult, m.blunderMult);
    if (m.barStart) out.barStart = (out.barStart ?? 0) + m.barStart;
    if (m.offTopicImmune) out.offTopicImmune = true;
    if (m.crowdAlwaysBoost) out.crowdAlwaysBoost = true;
  }
  return out;
}
