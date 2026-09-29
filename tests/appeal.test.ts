import { describe, it, expect } from 'vitest';
import { createGame, canAppeal, appealStatement, saveGame, loadGame, APPEAL_SHARE, APPEAL_FINE, APPEAL_SYMPATHY } from '../src/engine/game';
import { scoreStatement } from '../src/engine/scoring';
import { findDef, TOPICS } from '../src/data/cards';
import type { Card, GameState } from '../src/engine/types';

const cards = (...ids: string[]): Card[] => ids.map((id, i) => ({ ...findDef(id)!, id: `${id}#${i}` }));

/** A game paused between questions with the player's `line` just judged on `topic`. */
function judged(seed: number, topic: string, ...ids: string[]): GameState {
  const g = createGame({ seed });
  g.topic = TOPICS.find((t) => t.id === topic)!;
  g.crowd = undefined;
  g.player.line = cards(...ids);
  g.player.lastReaction = scoreStatement(g.player.line, { topicId: topic });
  g.player.done = g.ai.done = true;
  g.awaitingNext = true;
  g.bar = 0;
  return g;
}

describe('recount scoring', () => {
  it('relaxes the off-topic penalty', () => {
    const line = cards('s_i', 'p_patriot'); // no topic tag
    const judgedOff = scoreStatement(line, { topicId: 'economy' }).delta;
    expect(scoreStatement(line, { topicId: 'economy', recount: true }).delta).toBeGreaterThan(judgedOff);
  });
  it('relaxes the muffle on a run-on (two real thoughts, no connector)', () => {
    const line = cards('s_opp', 'p_kick_pup', 's_i', 'p_patriot');
    const orig = scoreStatement(line);
    expect(orig.runOn).toBe(true);
    expect(scoreStatement(line, { recount: true }).delta).toBeGreaterThan(orig.delta + 1);
  });
  it('changes nothing on a cleanly scored line — including a genuine gaffe', () => {
    for (const ids of [['s_opp', 'p_kick_pup'], ['s_i', 'p_disgrace']]) {
      const line = cards(...ids);
      expect(scoreStatement(line, { topicId: 'jackass', recount: true }).delta).toBe(scoreStatement(line, { topicId: 'jackass' }).delta);
    }
  });
});

describe('demand a recount', () => {
  it('a disputed technicality is usually overturned for 75% of the difference', () => {
    let overturned = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const g = judged(seed, 'economy', 's_i', 'p_patriot');
      const r = appealStatement(g)!;
      expect(['overturned', 'upheld']).toContain(r.outcome);
      if (r.outcome === 'overturned') {
        overturned++;
        expect(r.change).toBeCloseTo((r.recount - r.original) * APPEAL_SHARE, 1);
        expect(g.bar).toBe(r.change);
      } else expect(r.change).toBe(0);
    }
    expect(overturned).toBeGreaterThan(28);
  });
  it('a frivolous appeal is usually fined', () => {
    let fined = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = appealStatement(judged(seed, 'jackass', 's_opp', 'p_kick_pup'))!;
      expect([-APPEAL_FINE, APPEAL_SYMPATHY]).toContain(r.change);
      if (r.outcome === 'backfire') fined++;
    }
    expect(fined).toBeGreaterThan(22);
  });
  it('one per debate, and only on the between-questions pause', () => {
    const g = judged(3, 'economy', 's_i', 'p_patriot');
    expect(canAppeal(g)).toBe(true);
    appealStatement(g);
    expect(canAppeal(g)).toBe(false);
    expect(appealStatement(g)).toBeUndefined();
    const live = judged(3, 'economy', 's_i', 'p_patriot');
    live.awaitingNext = false;
    expect(canAppeal(live)).toBe(false);
  });
  it('can end the debate by landslide', () => {
    for (let seed = 1; ; seed++) {
      const g = judged(seed, 'jackass', 's_opp', 'p_kick_pup');
      g.bar = -98; // a fine here tips it over
      if (appealStatement(g)!.outcome !== 'backfire') continue;
      expect(g.winner).toBe('ai');
      expect(g.awaitingNext).toBe(false);
      break;
    }
  });
  it('is deterministic and survives a save', () => {
    const a = judged(11, 'economy', 's_i', 'p_patriot');
    const b = loadGame(JSON.parse(JSON.stringify(saveGame(a))));
    expect(appealStatement(b)).toEqual(appealStatement(a));
  });
});
