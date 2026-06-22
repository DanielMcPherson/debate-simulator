import { describe, it, expect } from 'vitest';
import { plan, chooseMove, aiTurn } from '../src/engine/ai';
import { dominantCategory } from '../src/engine/scoring';
import { isComplete } from '../src/engine/grammar';
import { createGame, applyMove, legalMoves, nextQuestion } from '../src/engine/game';
import { findDef } from '../src/data/cards';
import type { Card, GameState, Move } from '../src/engine/types';

function avail(source: 'pool' | 'hand', ...ids: string[]) {
  return ids.map((id) => {
    const c = findDef(id);
    if (!c) throw new Error(`no card ${id}`);
    return { card: c as Card, source };
  });
}

describe('AI planner', () => {
  it('never plans toward gibberish — the result is a complete statement', () => {
    const best = plan([], avail('pool', 's_opp', 'p_disgrace', 'p_weak'))!;
    expect(best).not.toBeNull();
    expect(isComplete(best.ext.map((e) => e.card))).toBe(true);
  });

  it('prefers a stronger predicate over a weaker one', () => {
    const best = plan([], avail('pool', 's_opp', 'p_disgrace', 'p_weak'))!;
    expect(best.delta).toBeGreaterThan(4); // chose "is a national disgrace" (-3) over "weak" (-2)
  });

  it('avoids self-owns: about itself it praises, not slanders', () => {
    const best = plan([], avail('pool', 's_i', 'p_patriot', 'p_disgrace'))!;
    expect(best.delta).toBeGreaterThan(0);
  });

  it('completes an open predicate it has committed to', () => {
    const line = [findDef('s_opp')!, findDef('p_bed_with')!];
    const best = plan(line, avail('pool', 'o_satan'))!;
    expect(best).not.toBeNull();
    expect(isComplete([...line, ...best.ext.map((e) => e.card)])).toBe(true);
  });

  it('chooseMove never ends incomplete when a completion is reachable', () => {
    const game = createGame({ seed: 7 });
    game.turn = 'ai';
    expect(chooseMove(game).kind).not.toBe('end'); // builds or plays a power-up, but doesn't bail
  });

  it('plays Teleprompter Typo only when replacing the last word forces a self-own', () => {
    const game = createGame({ seed: 7 });
    game.turn = 'ai';
    // Isolate the Typo decision: make it the AI's only power-up so an incidental
    // Soundbite/Forgot from the seeded deal can't confound the assertion.
    game.ai.hand = game.ai.hand.filter((c) => c.role !== 'powerup');
    game.ai.hand.push({ id: 'pw_ty', role: 'powerup', effect: 'typo', text: 'x' });
    // Player has a complete, favourable line; swapping its last word makes a self-own.
    game.player.line = [findDef('s_admin')!, findDef('p_patriot')!]; // "My administration is a true patriot"
    game.pool = [findDef('p_disgrace')!]; // replace → "My administration is a national disgrace"
    expect(chooseMove(game).kind).toBe('power');
    // No replacement yields a self-own (still an attack on the opponent) -> don't waste it.
    game.player.line = [findDef('s_opp')!, findDef('p_disgrace')!];
    game.pool = [findDef('p_kick_pup')!]; // replace → "My opponent kicks puppies" (still good for player)
    expect(chooseMove(game).kind).not.toBe('power');
  });

  it('plays Forgot My Line to wreck a strong line the player is sitting on', () => {
    const game = createGame({ seed: 7 });
    game.turn = 'ai';
    game.ai.hand = [{ id: 'pw_fg', role: 'powerup', effect: 'forgot', text: 'x' }]; // isolate from other dealt power-ups
    // Player holds a complete, strongly favourable statement (an attack on the opp).
    game.player.line = [findDef('s_opp')!, findDef('p_disgrace')!];
    const move = chooseMove(game);
    expect(move).toEqual({ kind: 'power', cardId: 'pw_fg' });
    // Nothing to disrupt (empty player line) -> don't waste it.
    game.player.line = [];
    const idle = chooseMove(game);
    expect(idle.kind === 'power' && idle.cardId === 'pw_fg').toBe(false);
  });

  it('follows its debating style when plays are otherwise comparable', () => {
    // Both "I am a true patriot" (praise) and "My opponent is a national disgrace"
    // (attack) score ~the same; the style bias breaks the tie.
    const a = () => avail('pool', 's_i', 'p_patriot', 's_opp', 'p_disgrace');
    const brag = plan([], a(), { styleCategory: 'praise_self' })!;
    expect(dominantCategory(brag.ext.map((e) => e.card))).toBe('praise_self');
    const attack = plan([], a(), { styleCategory: 'attack_opp' })!;
    expect(dominantCategory(attack.ext.map((e) => e.card))).toBe('attack_opp');
  });
});

describe('gaffes & nerves (difficulty)', () => {
  it("plan(objective:'gaffe') deliberately flubs into a self-own where 'best' would win", () => {
    // choice: "My opponent is a national disgrace" (good) vs "I am a national disgrace" (self-own)
    const a = () => avail('pool', 's_opp', 's_i', 'p_disgrace');
    const best = plan([], a(), {})!;
    const gaffe = plan([], a(), { objective: 'gaffe' });
    expect(best.delta).toBeGreaterThan(0); // optimal play attacks the opponent
    expect(gaffe).not.toBeNull();
    expect(gaffe!.delta).toBeLessThan(0); // the gaffe tanks its own statement
  });

  it("plan(objective:'gaffe') returns null when no self-own is reachable", () => {
    // only a clean attack is possible — the opponent literally can't flub here
    const gaffe = plan([], avail('pool', 's_opp', 'p_kick_pup'), { objective: 'gaffe' });
    expect(gaffe).toBeNull();
  });

  it('aiTurn: an unflappable opponent never gaffes; a nervous rookie often does', () => {
    let boss = 0;
    let rookie = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const gb = createGame({ seed, opponentId: 'grandstand' }); // gaffeChance 0
      gb.turn = 'ai';
      aiTurn(gb, { maxExtend: 6 });
      if (gb.ai.gaffing) boss++;
      const gr = createGame({ seed, opponentId: 'pander' }); // gaffeChance 0.4
      gr.turn = 'ai';
      aiTurn(gr, { maxExtend: 3 });
      if (gr.ai.gaffing) rookie++;
    }
    expect(boss).toBe(0);
    expect(rookie).toBeGreaterThan(8); // ~40% of 40
  });

  it('aiTurn is deterministic for a given seed', () => {
    const decide = () => {
      const g = createGame({ seed: 7, opponentId: 'pander' });
      g.turn = 'ai';
      aiTurn(g, { maxExtend: 3 });
      return g.ai.gaffing;
    };
    expect(decide()).toBe(decide());
  });
});

describe('full game loop', () => {
  function dumbPlayerMove(state: GameState): Move {
    const moves = legalMoves(state);
    const end = moves.find((m) => m.kind === 'end');
    if (end) return end;
    const take =
      moves.find((m) => m.kind === 'take' && m.from !== 'period') ??
      moves.find((m) => m.kind === 'take');
    return take ?? { kind: 'end' };
  }

  function playOut(game: GameState): void {
    let guard = 0;
    while (!game.winner && guard++ < 4000) {
      if (game.awaitingNext) {
        nextQuestion(game);
        continue;
      }
      applyMove(game, game.turn === 'ai' ? chooseMove(game) : dumbPlayerMove(game));
    }
  }

  it('plays a complete debate to a winner without crashing', () => {
    const game = createGame({ seed: 3, maxRounds: 4 });
    playOut(game);
    expect(game.winner).toBeDefined();
    expect(game.log.length).toBeGreaterThan(0);
  });

  it('is competent: wins the majority against a take-first greedy player', () => {
    let aiWins = 0;
    const seeds = [11, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (const seed of seeds) {
      const game = createGame({ seed, maxRounds: 5 });
      playOut(game);
      if (game.winner === 'ai') aiWins++;
    }
    expect(aiWins).toBeGreaterThanOrEqual(seeds.length * 0.6);
  });
});
