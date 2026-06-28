import { describe, it, expect } from 'vitest';
import { createGame, applyMove, legalMoves, canEnd, nextQuestion } from '../src/engine/game';
import { isValidPrefix, isComplete } from '../src/engine/grammar';
import { scoreStatement } from '../src/engine/scoring';
import { findDef, PERIOD, PERIOD_ENABLED, TOPICS } from '../src/data/cards';

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

  it('guarantees a private opener: each hand always holds a sided subject', () => {
    // The pool subject is contested (whoever speaks first can take it); a private
    // opener means you can never be locked out of starting your statement.
    const isSubject = (c: { role: string; side?: string }) =>
      c.role === 'np' && !!c.side && c.side !== 'neutral';
    for (let seed = 1; seed <= 25; seed++) {
      const g = createGame({ seed, opponentId: 'smearwell' }); // a styled opponent deck too
      expect(g.player.hand.some(isSubject)).toBe(true);
      expect(g.ai.hand.some(isSubject)).toBe(true);
      // …and it persists across questions (decks deplete over a debate).
      nextQuestion(g);
      expect(g.player.hand.some(isSubject)).toBe(true);
      expect(g.ai.hand.some(isSubject)).toBe(true);
    }
  });

  it('every topic carries several moderator questions, and one is picked per round', () => {
    for (const t of TOPICS) {
      expect(t.questions.length).toBeGreaterThanOrEqual(2);
      for (const q of t.questions) expect(q.length).toBeGreaterThan(0);
    }
    const g = createGame({ seed: 1 });
    expect(g.topic!.questions).toContain(g.question); // the chosen one is from the topic's list
  });

  it('lets you End any non-empty line — even an incomplete one (no forced self-own)', () => {
    const g = createGame({ seed: 2 });
    g.turn = 'player';
    const subj = g.pool.find((c) => c.role === 'np' && !!c.side && c.side !== 'neutral')!;
    applyMove(g, { kind: 'take', from: 'pool', cardId: subj.id }); // just a subject, incomplete
    g.turn = 'player';
    expect(canEnd(g)).toBe(true); // lenient: you may bail (it scores as "confused")
    applyMove(g, { kind: 'end' });
    expect(g.player.lastReaction?.label).toBe('confused');
    expect(g.player.lastReaction?.grammatical).toBe(false);
  });

  it('an incomplete line scores its mild parsed intent, not a hard zero/lock', () => {
    const g = createGame({ seed: 2 });
    g.turn = 'player';
    const np1 = g.pool.find((c) => c.role === 'np')!;
    applyMove(g, { kind: 'take', from: 'pool', cardId: np1.id });
    g.turn = 'player';
    const np2 = g.pool.find((c) => c.role === 'np')!; // a second adjacent noun phrase = gibberish
    applyMove(g, { kind: 'take', from: 'pool', cardId: np2.id });
    g.turn = 'player';
    expect(isValidPrefix(g.player.line)).toBe(false);
    expect(canEnd(g)).toBe(true); // not soft-locked
    expect(Math.abs(scoreStatement(g.player.line).delta)).toBeLessThanOrEqual(8); // mild, capped
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

  it('private decks recycle without minting duplicates (no card multiplies across questions)', () => {
    // Regression: dealRound used to append a FRESH buildPrivateDeck onto the leftover
    // draw pile every time it ran low, stacking new copies of every signature card
    // (the "3× could fix the whole economy" Hot Mic bug). The combined count of any
    // base card id across BOTH players can only stay flat or shrink (power-ups spent,
    // Forgot My Line losses; Hot Mic just moves a card between players) — never grow.
    const g = createGame({ seed: 7, opponentId: 'blowhard' });
    const baseId = (c: { id: string }) => c.id.split('#')[0];
    const tally = () => {
      const counts = new Map<string, number>();
      for (const p of [g.player, g.ai]) {
        const zones = [...p.deck, ...p.hand, ...p.discard, ...p.line];
        // Only private-deck cards are subject to the recycle loop; Filibuster's
        // injected connectors are transient and tracked separately.
        for (const c of zones) if (c.priv) counts.set(baseId(c), (counts.get(baseId(c)) ?? 0) + 1);
      }
      return counts;
    };
    const initial = tally();
    expect(initial.size).toBeGreaterThan(0);

    let qGuard = 0;
    while (!g.winner && qGuard++ < 20) {
      let guard = 0;
      while (!g.winner && !g.awaitingNext && guard++ < 2000) {
        const moves = legalMoves(g);
        applyMove(g, moves.find((m) => m.kind === 'end') ?? moves.find((m) => m.kind === 'take') ?? { kind: 'end' });
      }
      // No player ever holds more than the built count (SIG_BRAG => 2) of a signature card.
      for (const p of [g.player, g.ai]) {
        const hand = new Map<string, number>();
        for (const c of p.hand) if (c.priv) hand.set(baseId(c), (hand.get(baseId(c)) ?? 0) + 1);
        for (const [, n] of hand) expect(n).toBeLessThanOrEqual(2);
      }
      const now = tally();
      for (const [id, n] of now) expect(n).toBeLessThanOrEqual(initial.get(id) ?? 0);
      if (g.winner) break;
      nextQuestion(g);
    }
    expect(qGuard).toBeGreaterThan(1); // actually advanced through multiple questions
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

  it("the opponent's Hot Mic steal flags a must-dismiss sabotage on the player", () => {
    const g = createGame({ seed: 1 });
    g.turn = 'ai';
    g.ai.hand = [{ id: 'pw_hm', role: 'powerup', effect: 'hotmic', text: 'x' }];
    g.player.hand = [{ id: 'pw_sb', role: 'powerup', effect: 'soundbite', text: '👏 Soundbite' }];
    applyMove(g, { kind: 'power', cardId: 'pw_hm' }); // AI auto-targets the player's power-up
    expect(g.lastSabotage?.kind).toBe('hotmic');
    expect(g.lastSabotage?.victim).toBe('player'); // → the player gets the modal
    expect(g.player.hand.some((c) => c.id === 'pw_sb')).toBe(false); // stolen away
    expect(g.ai.hand.some((c) => c.id === 'pw_sb')).toBe(true); // now the AI's
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

  it('auto Typo swaps the victim\'s last word into a self-own', () => {
    const g = createGame({ seed: 1 });
    g.ai.line = [{ ...findDef('s_i')! }, { ...findDef('p_patriot')! }]; // "I am a true patriot"
    g.pool = [findDef('p_disgrace')!]; // replace last → "I am a national disgrace" (self-own)
    g.player.hand.push({ id: 'pw_ty', role: 'powerup', effect: 'typo', text: 'x' });
    applyMove(g, { kind: 'power', cardId: 'pw_ty' }); // no target -> auto-pick
    expect(g.ai.line.map((c) => c.id.split('#')[0])).toEqual(['s_i', 'p_disgrace']);
    expect(g.lastSabotage?.victim).toBe('ai');
  });

  it('an opponent Typo flags the player as the sabotage victim (for the UI alert)', () => {
    const g = createGame({ seed: 7 });
    g.turn = 'ai';
    g.ai.hand.push({ id: 'pw_ty', role: 'powerup', effect: 'typo', text: 'x' });
    g.player.line = [{ ...findDef('s_opp')! }, { ...findDef('p_disgrace')! }]; // "My opponent is a national disgrace"
    g.pool = [findDef('p_patriot')!]; // replace → "My opponent is a true patriot" (player praises the opp)
    applyMove(g, { kind: 'power', cardId: 'pw_ty' });
    expect(g.lastSabotage?.victim).toBe('player');
    expect(g.player.line.map((c) => c.id.split('#')[0])).toEqual(['s_opp', 'p_patriot']);
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

  it('Forgot My Line skips a trailing connector and drops the last CONTENT card', () => {
    // Bug repro: opponent's line ended with a dangling period; Forgot popped the period (text "."),
    // removing nothing visible. It must skip the connector and drop the last real card.
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    g.ai.line = [findDef('s_opp')!, findDef('p_disgrace')!, { ...PERIOD }]; // "…disgrace." (trailing period)
    g.player.hand.push({ id: 'pw_fg3', role: 'powerup', effect: 'forgot', text: 'x' });
    applyMove(g, { kind: 'power', cardId: 'pw_fg3' });
    expect(g.ai.line.map((c) => c.id.split('#')[0])).toEqual(['s_opp']); // content card + period both gone
    expect(g.lastSabotage?.text).not.toBe('.'); // the forgotten card reported is the content, not the period
  });

  it('Teleprompter Typo replaces the victim\'s last word with the CHOSEN card when targeted', () => {
    const g = createGame({ seed: 1 });
    g.ai.line = [{ ...findDef('s_opp')! }, { ...findDef('p_patriot')! }]; // victim mid-statement
    const target = g.pool[2];
    g.player.hand.push({ id: 'pw_ty2', role: 'powerup', effect: 'typo', text: 'x' });
    applyMove(g, { kind: 'power', cardId: 'pw_ty2', targetFrom: 'pool', targetCardId: target.id });
    expect(g.ai.line[g.ai.line.length - 1].id).toBe(target.id); // exactly the picked card
    expect(g.ai.line.length).toBe(2); // replaced the last word, not appended
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

  it('a finisher is an end-move: only playable on a complete line, and it ends the turn', () => {
    const g = createGame({ seed: 4 });
    const intens = { id: 'x_test', role: 'intensifier' as const, text: 'believe me', factor: 1.4 };
    g.pool.push(intens);
    const subj = g.pool.find((c) => c.role === 'np' && !!c.side && c.side !== 'neutral')!;
    const pred = g.pool.find((c) => c.role === 'predicate' && !c.open)!;

    // Mid-build (incomplete line) the finisher is NOT offered — you must finish a thought.
    g.turn = 'player';
    applyMove(g, { kind: 'take', from: 'pool', cardId: subj.id });
    g.turn = 'player'; // takes alternate the turn; force it back for this unit check
    expect(isComplete(g.player.line)).toBe(false);
    expect(legalMoves(g).some((m) => m.kind === 'take' && m.cardId === 'x_test')).toBe(false);

    // Complete the sentence with a closed predicate → now the finisher is offered.
    applyMove(g, { kind: 'take', from: 'pool', cardId: pred.id });
    g.turn = 'player';
    expect(isComplete(g.player.line)).toBe(true);
    expect(legalMoves(g).some((m) => m.kind === 'take' && m.cardId === 'x_test')).toBe(true);

    // Playing it appends the flourish AND ends the statement (no held state).
    applyMove(g, { kind: 'take', from: 'pool', cardId: 'x_test' });
    expect(g.player.line[g.player.line.length - 1].id).toBe('x_test');
    expect(g.player.done).toBe(true);
    expect((g.player as { heldFinisher?: unknown }).heldFinisher).toBeUndefined();
  });

  it('the pool never offers more than one finisher (the race-for-it stays a real risk)', () => {
    const finishers = (g: { pool: { role: string }[] }) => g.pool.filter((c) => c.role === 'intensifier').length;
    for (let seed = 1; seed <= 30; seed++) {
      const g = createGame({ seed });
      expect(finishers(g)).toBeLessThanOrEqual(1);
      // …and still at most one after a Recess re-deals the pool.
      g.turn = 'player';
      applyMove(g, { kind: 'redraw' });
      expect(finishers(g)).toBeLessThanOrEqual(1);
    }
  });

  it('always deals a pool with at least one on-topic card to address the question', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = createGame({ seed });
      const onTopic = g.pool.some((c) => c.topics?.includes(g.topic!.id));
      expect(onTopic).toBe(true); // the green card is gone — the pool must cover the topic
    }
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

describe('the free period', () => {
  it('is NOT offered while the period experiment is disabled (PERIOD_ENABLED)', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    const hasPeriod = () => legalMoves(g).some((m) => m.kind === 'take' && m.from === 'period');
    expect(hasPeriod()).toBe(false); // empty line — nothing to end
    g.player.line = complete(); // "My opponent is a national disgrace"
    // Disabled: a statement is one sentence (or connector-chained). Flip PERIOD_ENABLED
    // back to restore the offering — the engine plumbing below still works either way.
    expect(hasPeriod()).toBe(PERIOD_ENABLED);
  });

  it('plays a period without consuming anything from the pool or hand', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    g.player.line = complete();
    const poolBefore = g.pool.length;
    const handBefore = g.player.hand.length;
    const lineBefore = g.player.line.length;
    applyMove(g, { kind: 'take', from: 'period', cardId: 'c_period' });
    expect(g.player.line.length).toBe(lineBefore + 1);
    expect(g.player.line[g.player.line.length - 1].conj).toBe('period');
    expect(g.pool.length).toBe(poolBefore); // virtual — nothing drawn
    expect(g.player.hand.length).toBe(handBefore);
  });

  it('a trailing period never locks you out of End (it drops the dangling period)', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    g.player.line = [...complete(), PERIOD]; // "My opponent is a national disgrace." — a dangling period
    expect(canEnd(g)).toBe(true); // not soft-locked
    applyMove(g, { kind: 'end' });
    expect(g.player.lastReaction?.grammatical).toBe(true); // scored the clause, not "confused"
    expect(g.player.line[g.player.line.length - 1].role).not.toBe('connector'); // the period was trimmed off
  });

  it('can end a two-sentence statement that ends on a period', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    g.player.line = [
      findDef('s_opp')!, findDef('p_disgrace')!, PERIOD,
      findDef('s_people')!, findDef('p_love_fd')!, PERIOD,
    ];
    expect(canEnd(g)).toBe(true);
    applyMove(g, { kind: 'end' });
    expect(g.player.lastReaction?.grammatical).toBe(true);
  });

  it.runIf(PERIOD_ENABLED)('the period is limited to one per statement', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    g.player.line = [findDef('s_opp')!, findDef('p_disgrace')!]; // a complete clause
    const periodMove = () => legalMoves(g).find((m) => m.kind === 'take' && m.from === 'period');
    expect(periodMove()).toBeDefined(); // first period offered
    applyMove(g, { kind: 'take', from: 'period', cardId: PERIOD.id }); // advances turn to ai
    expect(g.player.usedPeriod).toBe(true);
    // Build out a complete second clause, then it's the player's turn again: a SECOND
    // period must NOT be offered, even though the grammar would otherwise allow it.
    g.player.line.push(findDef('s_people')!, findDef('p_love_fd')!);
    g.turn = 'player';
    g.ai.done = true;
    expect(canEnd(g)).toBe(true); // the two-sentence line is endable
    expect(periodMove()).toBeUndefined();
  });

  it('ending on a half-started next clause is "confused" — content is never silently dropped', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    // a complete clause, then a dangling new clause with just a subject
    g.player.line = [findDef('s_opp')!, findDef('p_disgrace')!, PERIOD, findDef('s_people')!];
    applyMove(g, { kind: 'end' });
    // The "s_people" content is NOT trimmed away to a clean prefix — the unfinished
    // thought stays and scores lenient "confused" with coaching.
    expect(g.player.lastReaction?.label).toBe('confused');
    expect(g.player.lastReaction?.grammatical).toBe(false);
    expect(g.player.line.map((c) => c.id)).toEqual(['s_opp', 'p_disgrace', PERIOD.id, 's_people']);
  });

  it('a run-on (two clauses jammed with no connector) is "confused", not the first clause only', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    // "My opponent is a national disgrace[ ] the American people love freedom" — no period, no conjunction
    g.player.line = [findDef('s_opp')!, findDef('p_disgrace')!, findDef('s_people')!, findDef('p_love_fd')!];
    applyMove(g, { kind: 'end' });
    expect(g.player.lastReaction?.label).toBe('confused');
    expect(g.player.lastReaction?.grammatical).toBe(false);
    // It is NOT silently scored as just the first clause (would be a clean attack).
    expect(g.player.line.length).toBe(4);
    // The coaching points at punctuation/connectors, not word order.
    expect(g.player.lastReaction?.detail).toMatch(/connector|period|two thoughts/i);
  });

  it('Teleprompter Typo REPLACES the victim\'s last card with the chosen one', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    const jam = { ...findDef('p_disgrace')! }; // clone so we don't mutate the shared def
    g.player.hand = [{ id: 'pw_ty', role: 'powerup', effect: 'typo', text: 'x' }, jam];
    g.ai.line = [{ ...findDef('s_opp')! }, { ...findDef('p_patriot')! }]; // "My opponent is a true patriot"
    applyMove(g, { kind: 'power', cardId: 'pw_ty', targetFrom: 'hand', targetCardId: jam.id });
    // last word (p_patriot) swapped for p_disgrace, not appended
    expect(g.ai.line.map((c) => c.id.split('#')[0])).toEqual(['s_opp', 'p_disgrace']);
    expect(g.ai.line[g.ai.line.length - 1].jammed).toBe(true);
  });

  it('Teleprompter Typo replaces the last SPOKEN word, skipping a trailing period', () => {
    const g = createGame({ seed: 1 });
    g.turn = 'player';
    const jam = { ...findDef('p_disgrace')! };
    g.player.hand = [{ id: 'pw_ty', role: 'powerup', effect: 'typo', text: 'x' }, jam];
    // victim's last *card* is a dangling period; the last *word* is the predicate
    g.ai.line = [{ ...findDef('s_opp')! }, { ...findDef('p_patriot')! }, { ...PERIOD }];
    applyMove(g, { kind: 'power', cardId: 'pw_ty', targetFrom: 'hand', targetCardId: jam.id });
    // p_patriot (the spoken word) swapped for p_disgrace; the period is gone, not appended-after
    expect(g.ai.line.map((c) => c.id.split('#')[0])).toEqual(['s_opp', 'p_disgrace']);
  });

  it('a Teleprompter Typo sticks — the end-trim does NOT strip a jammed trailing card', () => {
    const g = createGame({ seed: 1 });
    g.player.done = true;
    g.turn = 'ai';
    const jam = { ...findDef('c_and')!, jammed: true }; // a jam that leaves the line incomplete
    g.ai.line = [findDef('s_opp')!, findDef('p_disgrace')!, jam];
    applyMove(g, { kind: 'end' });
    // NOT rescued back to "My opponent is a national disgrace" — the jam holds, so it's confused
    expect(g.ai.lastReaction?.grammatical).toBe(false);
    expect(g.ai.line.some((c) => c.jammed)).toBe(true);
  });

  it('an UNjammed trailing connector is still trimmed (lenient end preserved)', () => {
    const g = createGame({ seed: 1 });
    g.player.done = true;
    g.turn = 'ai';
    g.ai.line = [findDef('s_opp')!, findDef('p_disgrace')!, findDef('c_and')!]; // no jam flag
    applyMove(g, { kind: 'end' });
    expect(g.ai.lastReaction?.grammatical).toBe(true); // trimmed to the complete prefix, as before
  });
});
