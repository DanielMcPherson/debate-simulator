import { describe, it, expect } from 'vitest';
import { plan, chooseMove, aiTurn } from '../src/engine/ai';
import { createGame, applyMove, legalMoves, nextQuestion } from '../src/engine/game';
import { buildPrivateDeck, buildSharedDeck } from '../src/engine/deck';
import { ALL, POWERUPS, REWARDS, UNDER_OATH, findDef } from '../src/data/cards';
import type { Card, GameState, Move } from '../src/engine/types';

function avail(source: 'pool' | 'hand', ...ids: string[]) {
  return ids.map((id) => {
    const c = findDef(id);
    if (!c) throw new Error(`no card ${id}`);
    return { card: c as Card, source };
  });
}

const oathCard = (id = 'pw_uo'): Card => ({ id, role: 'powerup', effect: 'oath', text: 'x' });

function dumbPlayerMove(state: GameState): Move {
  const moves = legalMoves(state);
  const end = moves.find((m) => m.kind === 'end');
  if (end) return end;
  return moves.find((m) => m.kind === 'take') ?? { kind: 'end' };
}

/** Play out the current question (player plays dumb, AI via aiTurn). */
function playQuestion(g: GameState, maxExtend: number): void {
  let guard = 0;
  while (!g.awaitingNext && !g.winner && guard++ < 200) {
    applyMove(g, g.turn === 'ai' ? aiTurn(g, { maxExtend }) : dumbPlayerMove(g));
  }
}

describe("plan(objective:'confess') — the Under Oath planner", () => {
  it("tanks its own statement where 'best' would attack", () => {
    // choice: "My opponent is a national disgrace" (good) vs "I am a national disgrace" (self-own)
    const a = () => avail('pool', 's_opp', 's_i', 'p_disgrace');
    const best = plan([], a(), {})!;
    const confession = plan([], a(), { objective: 'confess' })!;
    expect(best.delta).toBeGreaterThan(0);
    expect(confession.delta).toBeLessThan(0);
  });

  it("never returns null where a completion exists — degrades to the least-good line", () => {
    // Only a clean attack is reachable: 'gaffe' gives up, 'confess' still speaks (the
    // compulsion can't be dodged by an empty board) and picks the weakest option.
    const a = () => avail('pool', 's_opp', 'p_kick_pup');
    expect(plan([], a(), { objective: 'gaffe' })).toBeNull();
    const confession = plan([], a(), { objective: 'confess' });
    expect(confession).not.toBeNull();
  });

  it("confesses LONGER and harder than a gaffe on the same board", () => {
    // A gaffe stays short and punchy; a compelled confession chains everything
    // damaging it can reach ("I am a national disgrace and kick puppies …").
    const a = () => avail('pool', 's_i', 'p_disgrace', 'p_kick_pup', 'c_and');
    const gaffe = plan([], a(), { objective: 'gaffe', maxExtend: 6 })!;
    const confession = plan([], a(), { objective: 'confess', maxExtend: 6 })!;
    expect(confession.delta).toBeLessThan(gaffe.delta);
    expect(confession.ext.length).toBeGreaterThan(gaffe.ext.length);
  });
});

describe('compelled AI (state.ai.underOath)', () => {
  it('never plays a power-up to escape the oath', () => {
    const g = createGame({ seed: 7 });
    g.turn = 'ai';
    g.ai.underOath = true;
    // Stock every escape hatch: Search (fires when no best plan), Typo/Forgot (player
    // has a strong line), Hot Mic (player holds a power-up).
    g.ai.hand.push(
      { id: 'pw_se', role: 'powerup', effect: 'search', text: 'x' },
      { id: 'pw_ty', role: 'powerup', effect: 'typo', text: 'x' },
      { id: 'pw_hm', role: 'powerup', effect: 'hotmic', text: 'x' },
    );
    g.player.line = [findDef('s_opp')!, findDef('p_disgrace')!];
    g.player.hand.push({ id: 'pw_sb', role: 'powerup', effect: 'search', text: 'x' });
    let guard = 0;
    while (!g.ai.done && guard++ < 40) {
      if (g.turn === 'ai') {
        const move = aiTurn(g, { maxExtend: 4 });
        expect(move.kind).not.toBe('power');
        applyMove(g, move);
      } else {
        applyMove(g, dumbPlayerMove(g));
      }
    }
    expect(g.ai.done).toBe(true);
  });

  it('skips the gaffe roll — the oath, not nerves, drives the statement', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = createGame({ seed, opponentId: 'pander' }); // gaffeChance 0.4
      g.turn = 'ai';
      g.ai.underOath = true;
      aiTurn(g, { maxExtend: 3 });
      expect(g.ai.gaffing).toBeFalsy();
    }
  });

  it('an oathed question resolves as a self-damaging statement — even for the boss', () => {
    // grandstand has gaffeChance 0 (unflappable): only the oath can force this.
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = createGame({ seed, opponentId: 'grandstand' });
      g.ai.underOath = true;
      playQuestion(g, 6);
      expect(g.ai.done).toBe(true);
      expect(g.ai.lastReaction!.delta).toBeLessThan(0);
      const resolve = g.events.find((e) => e.t === 'resolve' && e.by === 'ai');
      expect(resolve!.underOath).toBe(true);
      expect(g.log.some((l) => /oath|cannot lie|truth keeps coming|still talking/i.test(l))).toBe(true);
    }
  });

  it('aiTurn is deterministic under oath for a given seed', () => {
    const decide = () => {
      const g = createGame({ seed: 7, opponentId: 'grandstand' });
      g.ai.underOath = true;
      playQuestion(g, 6);
      // Compare BASE ids — instance ids embed a process-global counter.
      return `${g.ai.lastReaction!.delta}|${g.ai.line.map((c) => c.id.split('#')[0]).join(',')}`;
    };
    expect(decide()).toBe(decide());
  });
});

describe("applyPowerup 'oath'", () => {
  it('compels the opponent and costs the turn', () => {
    const g = createGame({ seed: 7 });
    g.turn = 'player';
    g.player.hand.push(oathCard());
    applyMove(g, { kind: 'power', cardId: 'pw_uo' });
    expect(g.ai.underOath).toBe(true);
    expect(g.turn).toBe('ai'); // not FREE
    expect(g.player.hand.some((c) => c.id === 'pw_uo')).toBe(false); // one-shot
  });

  it('is wasted on an opponent who already resolved', () => {
    const g = createGame({ seed: 7 });
    g.turn = 'player';
    g.ai.done = true;
    g.player.hand.push(oathCard());
    applyMove(g, { kind: 'power', cardId: 'pw_uo' });
    expect(g.ai.underOath).toBeFalsy();
  });

  it('the compulsion lasts only the question it was played', () => {
    const g = createGame({ seed: 7 });
    g.ai.underOath = true;
    g.player.done = true;
    g.ai.done = true;
    g.awaitingNext = true;
    nextQuestion(g);
    expect(g.ai.underOath).toBeFalsy();
  });
});

describe('Under Oath cannot be lost or leaked', () => {
  it("the AI's Hot Mic auto-steal never takes it from a mixed hand", () => {
    const g = createGame({ seed: 7 });
    g.turn = 'ai';
    g.ai.hand = [{ id: 'pw_hm', role: 'powerup', effect: 'hotmic', text: 'x' }];
    g.player.hand = [oathCard(), findDef('s_opp')!];
    applyMove(g, { kind: 'power', cardId: 'pw_hm' }); // auto-target
    expect(g.player.hand.some((c) => c.effect === 'oath')).toBe(true); // oath survived
    expect(g.ai.hand.some((c) => c.effect === 'oath')).toBe(false);
  });

  it("the AI's Hot Mic isn't baited by a hand whose only power-up is the oath", () => {
    const g = createGame({ seed: 7 });
    g.turn = 'ai';
    g.ai.hand = [{ id: 'pw_hm', role: 'powerup', effect: 'hotmic', text: 'x' }];
    g.player.hand = [oathCard()];
    g.player.line = [];
    const move = chooseMove(g);
    expect(move.kind === 'power' && move.cardId === 'pw_hm').toBe(false);
  });

  it('is standalone: not in ALL / POWERUPS / REWARDS, never dealt, but findDef resolves it', () => {
    expect(ALL.some((c) => c.id === UNDER_OATH.id)).toBe(false);
    expect(POWERUPS.some((c) => c.id === UNDER_OATH.id)).toBe(false);
    expect(REWARDS.some((c) => c.id === UNDER_OATH.id)).toBe(false);
    expect(buildSharedDeck().some((c) => c.id.split('#')[0] === UNDER_OATH.id)).toBe(false);
    for (const style of ['brag', 'attack', 'pander', undefined] as const) {
      expect(buildPrivateDeck(style).some((c) => c.id.split('#')[0] === UNDER_OATH.id)).toBe(false);
    }
    expect(findDef(UNDER_OATH.id)).toBe(UNDER_OATH);
  });
});
