import { describe, it, expect } from 'vitest';
import { createGame, applyMove, legalMoves, canEnd, nextQuestion } from '../src/engine/game';
import { isValidPrefix } from '../src/engine/grammar';
import { findDef } from '../src/data/cards';

const complete = () => [findDef('s_opp')!, findDef('p_disgrace')!]; // "My opponent is a national disgrace"

describe('resource model — chunk cards, no replenish, must-finish', () => {
  it('deals a topic and a pool that can open and finish a statement', () => {
    const g = createGame({ seed: 1 });
    expect(g.topic).toBeDefined();
    expect(g.pool.some((c) => c.role === 'predicate' && !c.open)).toBe(true); // a complete predicate
    // the always-available topic card satisfies the topic
    expect(g.topic!.card.topics).toContain(g.topic!.id);
  });

  it('always deals a real (sided) subject into the pool', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const g = createGame({ seed });
      expect(g.pool.some((c) => c.role === 'np' && !!c.side && c.side !== 'neutral')).toBe(true);
    }
  });

  it('never deals into the shared pool a card identical to the topic phrase', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = createGame({ seed });
      const dup = g.topic!.card.text?.toLowerCase();
      if (!dup) continue; // predicate topics have no single text to duplicate
      expect(g.pool.some((c) => c.text?.toLowerCase() === dup)).toBe(false);
    }
  });

  it('still forces you to finish a completable statement (no early bail)', () => {
    const g = createGame({ seed: 2 });
    g.turn = 'player';
    const subj = g.pool.find((c) => c.role === 'np' && !!c.side && c.side !== 'neutral')!;
    applyMove(g, { kind: 'take', from: 'pool', cardId: subj.id });
    g.turn = 'player';
    expect(canEnd(g)).toBe(false); // a predicate is reachable → must keep going
  });

  it('lets you end an uncompletable (gibberish) line instead of soft-locking', () => {
    const g = createGame({ seed: 2 });
    g.turn = 'player';
    const np1 = g.pool.find((c) => c.role === 'np')!;
    applyMove(g, { kind: 'take', from: 'pool', cardId: np1.id });
    g.turn = 'player';
    const np2 = g.pool.find((c) => c.role === 'np')!; // a second adjacent noun phrase = gibberish
    applyMove(g, { kind: 'take', from: 'pool', cardId: np2.id });
    g.turn = 'player';
    expect(isValidPrefix(g.player.line)).toBe(false);
    expect(canEnd(g)).toBe(true); // not soft-locked — can bail (confused)
  });

  it('assigns a named opponent and a hidden crowd, fixed for the whole debate', () => {
    const g = createGame({ seed: 1, opponentId: 'smearwell', crowdId: 'bloodthirsty' });
    expect(g.opponent?.id).toBe('smearwell');
    expect(g.crowd?.id).toBe('bloodthirsty');
    let guard = 0;
    while (!g.winner && !g.awaitingNext && guard++ < 2000) {
      const moves = legalMoves(g);
      applyMove(g, moves.find((m) => m.kind === 'end') ?? moves.find((m) => m.kind === 'take') ?? { kind: 'end' });
    }
    nextQuestion(g);
    expect(g.opponent?.id).toBe('smearwell'); // unchanged across questions
    expect(g.crowd?.id).toBe('bloodthirsty');
  });

  it('Pass holds a complete statement and waits (does not lock it in)', () => {
    const g = createGame({ seed: 1 });
    g.player.line = complete();
    g.turn = 'player';
    applyMove(g, { kind: 'pass' });
    expect(g.player.done).toBe(false); // still live (can still Typo / be Typo'd)
    expect(g.player.line.length).toBe(2); // statement unchanged
    expect(g.turn).toBe('ai'); // handed the turn over
  });

  it('Pass works as a first move (empty statement) and hands over the turn', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    expect(legalMoves(g).some((m) => m.kind === 'pass')).toBe(true);
    applyMove(g, { kind: 'pass' });
    expect(g.player.done).toBe(false);
    expect(g.turn).toBe('ai'); // opponent now gets to build
  });

  it('cannot pass on an incomplete statement', () => {
    const g = createGame({ seed: 1 });
    g.player.line = [findDef('s_opp')!]; // incomplete
    g.turn = 'player';
    expect(legalMoves(g).some((m) => m.kind === 'pass')).toBe(false);
    applyMove(g, { kind: 'pass' });
    expect(g.player.done).toBe(false);
    expect(g.turn).toBe('player'); // no-op
  });

  it('passing when the opponent has locked in resolves the round', () => {
    const g = createGame({ seed: 1 });
    g.ai.line = [findDef('s_i')!, findDef('p_patriot')!];
    g.ai.done = true; // opponent already ended
    g.player.line = complete();
    g.turn = 'player';
    applyMove(g, { kind: 'pass' });
    expect(g.player.done).toBe(true); // your held statement gets scored
    expect(g.player.lastReaction).toBeDefined();
  });

  it('Search Notes draws five cards and is a FREE action (keeps your turn)', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    const before = g.player.hand.length;
    const deck = g.player.deck.length;
    g.player.hand.push({ id: 'pw_t', role: 'powerup', effect: 'search', text: 'x' });
    applyMove(g, { kind: 'power', cardId: 'pw_t' });
    expect(g.player.hand.length).toBe(before + Math.min(5, deck));
    expect(g.turn).toBe('player'); // free — turn not spent
  });

  it('Hot Mic reveals the opponent hand and steals a card', () => {
    const g = createGame({ seed: 1 });
    const target = g.ai.hand[0];
    const myBefore = g.player.hand.length;
    const oppBefore = g.ai.hand.length;
    g.player.hand.push({ id: 'pw_hm', role: 'powerup', effect: 'hotmic', text: 'x' });
    applyMove(g, { kind: 'power', cardId: 'pw_hm', targetFrom: 'oppHand', targetCardId: target.id });
    expect(g.player.knowsOppHand).toBe(true);
    expect(g.ai.hand.length).toBe(oppBefore - 1); // they lost the stolen card
    expect(g.player.hand.some((c) => c.id === target.id)).toBe(true); // you gained it
    expect(g.player.hand.length).toBe(myBefore + 1); // -1 hotmic, +1 stolen
  });

  it('reward cards carried by the run land in the player deck only', () => {
    const reward = findDef('r_traitor')!;
    const g = createGame({ seed: 1, playerBonus: [reward] });
    const base = (c: { id: string }) => c.id.split('#')[0];
    expect([...g.player.deck, ...g.player.hand].some((c) => base(c) === 'r_traitor')).toBe(true);
    expect([...g.ai.deck, ...g.ai.hand].some((c) => base(c) === 'r_traitor')).toBe(false);
  });

  it('Filibuster stocks your hand with connectors (free action)', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    const before = g.player.hand.length;
    g.player.hand.push({ id: 'pw_fb', role: 'powerup', effect: 'filibuster', text: 'x' });
    applyMove(g, { kind: 'power', cardId: 'pw_fb' });
    expect(g.player.hand.filter((c) => c.role === 'connector').length).toBe(3);
    expect(g.player.hand.length).toBe(before + 3); // -1 filibuster, +3 connectors
    expect(g.turn).toBe('player'); // free
  });

  it('Soundbite arms a ×1.5 multiplier; Plant reveals the crowd', () => {
    const g = createGame({ seed: 1 });
    g.player.hand.push({ id: 'pw_sb', role: 'powerup', effect: 'soundbite', text: 'x' });
    applyMove(g, { kind: 'power', cardId: 'pw_sb' });
    expect(g.player.nextMultiplier).toBe(1.5);
    g.turn = 'player';
    g.player.hand.push({ id: 'pw_pl', role: 'powerup', effect: 'plant', text: 'x' });
    applyMove(g, { kind: 'power', cardId: 'pw_pl' });
    expect(g.player.knowsCrowd).toBe(true);
  });

  it('auto Typo jams a card that completes the victim into a self-own', () => {
    const g = createGame({ seed: 1 });
    g.ai.line = [findDef('s_i')!]; // victim has "I …"
    g.pool = [findDef('p_disgrace')!]; // "…am a national disgrace" => self-own
    g.player.hand.push({ id: 'pw_ty', role: 'powerup', effect: 'typo', text: 'x' });
    applyMove(g, { kind: 'power', cardId: 'pw_ty' }); // no target -> auto-pick
    expect(g.ai.line.map((c) => c.id.split('#')[0])).toEqual(['s_i', 'p_disgrace']);
    expect(g.lastSabotage?.victim).toBe('ai');
  });

  it('an opponent Typo flags the player as the sabotage victim (for the UI alert)', () => {
    const g = createGame({ seed: 7 });
    g.turn = 'ai';
    g.ai.hand.push({ id: 'pw_ty', role: 'powerup', effect: 'typo', text: 'x' });
    g.player.line = [findDef('s_opp')!]; // "My opponent …"
    g.pool = [findDef('p_patriot')!]; // "…is a true patriot" => the player praises the opponent
    applyMove(g, { kind: 'power', cardId: 'pw_ty' });
    expect(g.lastSabotage?.victim).toBe('player');
    expect(g.player.line.length).toBe(2);
  });

  it('Forgot My Line knocks the last card off the opponent and flags the victim', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    g.ai.line = [findDef('s_opp')!, findDef('p_disgrace')!]; // opponent mid-statement
    g.player.hand.push({ id: 'pw_fg', role: 'powerup', effect: 'forgot', text: 'x' });
    applyMove(g, { kind: 'power', cardId: 'pw_fg' });
    expect(g.ai.line.map((c) => c.id.split('#')[0])).toEqual(['s_opp']); // last card dropped
    expect(g.lastSabotage).toMatchObject({ victim: 'ai', by: 'player', kind: 'forgot' });
    expect(g.turn).toBe('ai'); // not a free action — it costs the turn
  });

  it('an opponent Forgot My Line flags the player as the sabotage victim', () => {
    const g = createGame({ seed: 7 });
    g.turn = 'ai';
    g.ai.hand.push({ id: 'pw_fg', role: 'powerup', effect: 'forgot', text: 'x' });
    g.player.line = [findDef('s_i')!, findDef('p_patriot')!];
    applyMove(g, { kind: 'power', cardId: 'pw_fg' });
    expect(g.player.line.length).toBe(1);
    expect(g.lastSabotage).toMatchObject({ victim: 'player', kind: 'forgot' });
  });

  it('Forgot My Line is wasted (no crash, line untouched) on an empty opponent line', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    g.ai.line = [];
    g.player.hand.push({ id: 'pw_fg2', role: 'powerup', effect: 'forgot', text: 'x' });
    applyMove(g, { kind: 'power', cardId: 'pw_fg2' });
    expect(g.ai.line).toEqual([]);
    expect(g.player.hand.some((c) => c.id === 'pw_fg2')).toBe(false); // still consumed
  });

  it('Teleprompter Typo jams the CHOSEN card when targeted', () => {
    const g = createGame({ seed: 1 });
    const target = g.pool[2];
    g.player.hand.push({ id: 'pw_ty2', role: 'powerup', effect: 'typo', text: 'x' });
    applyMove(g, { kind: 'power', cardId: 'pw_ty2', targetFrom: 'pool', targetCardId: target.id });
    expect(g.ai.line[g.ai.line.length - 1].id).toBe(target.id); // exactly the picked card
    expect(g.pool.some((c) => c.id === target.id)).toBe(false); // removed from pool
  });

  it('Recess reshuffles the pool only, once per question, costing the turn', () => {
    const g = createGame({ seed: 8 });
    g.player.hand.push({ id: 'pw_fb', role: 'powerup', effect: 'filibuster', text: 'x' });
    const handBefore = g.player.hand.map((c) => c.id);
    expect(legalMoves(g).some((m) => m.kind === 'redraw')).toBe(true);
    applyMove(g, { kind: 'redraw' });
    expect(g.player.hand.map((c) => c.id)).toEqual(handBefore); // hand untouched (Filibuster survives)
    expect(g.player.usedRedraw).toBe(true);
    expect(g.turn).toBe('ai'); // a recess passes the turn
    g.turn = 'player';
    expect(legalMoves(g).some((m) => m.kind === 'redraw')).toBe(false);
  });

  it('does not replenish the pool after a take', () => {
    const g = createGame({ seed: 2 });
    const before = g.pool.length;
    applyMove(g, { kind: 'take', from: 'pool', cardId: g.pool[0].id });
    expect(g.pool.length).toBe(before - 1);
  });

  it('cannot end on an empty/incomplete line while cards remain', () => {
    const g = createGame({ seed: 3 });
    expect(canEnd(g)).toBe(false);
    expect(legalMoves(g).some((m) => m.kind === 'end')).toBe(false);
  });

  it('a finisher is grabbed and committed (held), not appended', () => {
    const g = createGame({ seed: 4 });
    const intens = { id: 'x_test', role: 'intensifier' as const, text: 'believe me', factor: 1.4 };
    g.pool.push(intens);
    expect(legalMoves(g).some((m) => m.kind === 'take' && m.cardId === 'x_test')).toBe(true);
    applyMove(g, { kind: 'take', from: 'pool', cardId: 'x_test' });
    expect(g.player.heldFinisher?.id).toBe('x_test');
    expect(g.player.line.length).toBe(0);
  });

  it('the topic card is always available and not consumed when used', () => {
    const g = createGame({ seed: 6 });
    const topicId = g.topic!.card.id;
    expect(legalMoves(g).some((m) => m.kind === 'take' && m.from === 'topic')).toBe(true);
    applyMove(g, { kind: 'take', from: 'topic', cardId: topicId });
    expect(g.player.line.length).toBe(1);
    expect(g.player.line[0].topics).toContain(g.topic!.id);
    g.turn = 'player';
    expect(legalMoves(g).some((m) => m.kind === 'take' && m.from === 'topic')).toBe(true);
  });

  it('pauses on the result after both statements, then advances on nextQuestion', () => {
    const g = createGame({ seed: 5, maxRounds: 3 });
    let guard = 0;
    while (!g.winner && !g.awaitingNext && guard++ < 2000) {
      const moves = legalMoves(g);
      applyMove(g, moves.find((m) => m.kind === 'end') ?? moves.find((m) => m.kind === 'take') ?? { kind: 'end' });
    }
    expect(g.awaitingNext).toBe(true);
    expect(g.player.done && g.ai.done).toBe(true);
    expect(g.player.lastReaction).toBeDefined();
    expect(g.ai.lastReaction).toBeDefined();
    const before = g.round;
    nextQuestion(g);
    expect(g.awaitingNext).toBe(false);
    expect(g.round).toBe(before + 1);
    expect(g.player.line.length).toBe(0); // fresh deal
  });

  it('plays a full debate to a winner under the new rules', () => {
    const g = createGame({ seed: 5, maxRounds: 4 });
    let guard = 0;
    while (!g.winner && guard++ < 3000) {
      if (g.awaitingNext) {
        nextQuestion(g);
        continue;
      }
      const moves = legalMoves(g);
      const end = moves.find((m) => m.kind === 'end');
      const take = moves.find((m) => m.kind === 'take');
      applyMove(g, end ?? take ?? { kind: 'end' });
    }
    expect(g.winner).toBeDefined();
  });
});
