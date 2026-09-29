import { describe, it, expect } from 'vitest';
import { createGame, applyMove, canEnd, nextQuestion, saveGame, loadGame } from '../src/engine/game';
import { aiTurn } from '../src/engine/ai';
import type { GameState, Move } from '../src/engine/types';

/** A dumb but deterministic player: grab pool cards, end once the line can end. */
function playerPolicy(g: GameState): Move {
  if (g.player.line.length >= 2 && canEnd(g)) return { kind: 'end' };
  const c = g.pool[0] ?? g.player.hand.find((h) => h.role !== 'powerup');
  return c ? { kind: 'take', from: g.pool[0] ? 'pool' : 'hand', cardId: c.id } : { kind: 'end' };
}

function step(g: GameState): boolean {
  if (g.winner) return false;
  if (g.awaitingNext) nextQuestion(g);
  else applyMove(g, g.turn === 'ai' ? aiTurn(g, { maxExtend: 3 }) : playerPolicy(g));
  return true;
}

const roundTrip = (g: GameState) => loadGame(JSON.parse(JSON.stringify(saveGame(g))));

describe('save / resume', () => {
  it('a restored game plays out identically to the original (state + RNG)', () => {
    for (const cut of [3, 17, 40]) {
      const a = createGame({ seed: 4242, opponentId: 'blowhard', tutorial: true });
      for (let i = 0; i < cut; i++) step(a);
      const b = roundTrip(a);
      for (let i = 0; i < 400 && (step(a), step(b)); i++);
      expect(a.winner).toBeDefined();
      // Instance-id suffixes come from a page-global counter both games share, so compare
      // everything else exactly.
      const norm = (g: GameState) => JSON.stringify(g).replace(/#\d+/g, '#');
      expect(norm(b)).toBe(norm(a));
    }
  });
  it('the snapshot survives JSON (no hidden functions or cycles)', () => {
    const g = createGame({ seed: 7 });
    expect(() => JSON.stringify(saveGame(g))).not.toThrow();
    expect(typeof saveGame(g).rng).toBe('number');
  });
  it('a restored game never re-issues instance ids it already holds', () => {
    const g = createGame({ seed: 9 });
    g.player.hand[0] = { ...g.player.hand[0], id: 'p_lie#999999' }; // as if the save came from a long session
    const r = roundTrip(g);
    while (!r.awaitingNext && !r.winner) step(r);
    nextQuestion(r); // a fresh deal after the reload (the shared pool is re-instanced every question)
    const ids = r.pool.map((c) => Number(c.id.split('#')[1]));
    expect(Math.min(...ids)).toBeGreaterThan(999999);
  });
});
