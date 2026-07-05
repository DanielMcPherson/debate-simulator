// Balance simulation harness — drives full debates engine-side to measure ladder
// difficulty. Used for the 2026-07 balance study (see CLAUDE.md P1 "boss deck quality").
//
// Run from the repo root:
//   npx vite-node scripts/sim-balance.mjs expA 100   # baseline: default deck vs ladder, skill sweep
//   npx vite-node scripts/sim-balance.mjs expB 100   # progression deck (rewards + upgrades) per rung
//   npx vite-node scripts/sim-balance.mjs expC 100   # opponent-deck-quality injection, rungs 4-6
//   npx vite-node scripts/sim-balance.mjs expD 100   # AI planning-depth sweep at the boss
//   npx vite-node scripts/sim-balance.mjs all 40
//
// AI side: the real aiTurn (gaffes, nerves, power-ups, style bias). Player side: a proxy
// driving the same plan() search at a configurable maxExtend + mirrored Typo/Forgot/Search
// heuristics; crowd-blind like a human without Plant. Absolute win rates are proxies —
// RELATIVE differences between configs are the signal. Deterministic: fixed seed series.
import { createGame, applyMove, nextQuestion, bestTypoJam } from '../src/engine/game';
import { aiTurn, plan } from '../src/engine/ai';
import { canAppend } from '../src/engine/grammar';
import { LADDER, REWARDS, UPGRADES, resolveTier, findDef } from '../src/data/cards';
import { buildPrivateDeck, makeRng, shuffle, refill } from '../src/engine/deck';

// ---------- player proxy: same planner as the AI, driven for the player side ----------
function playerMove(state, opts) {
  const p = state.player;
  const avail = [];
  for (const c of state.pool) if (c.role !== 'powerup') avail.push({ card: c, source: 'pool' });
  for (const c of p.hand) if (c.role !== 'powerup') avail.push({ card: c, source: 'hand' });
  const best = plan(p.line, avail, { maxExtend: opts.maxExtend, topicId: state.topic?.id });

  // Power-up heuristics mirroring the AI's (chooseMove) so the proxy isn't a pushover.
  const power = (e) => p.hand.find((c) => c.role === 'powerup' && c.effect === e);
  const typo = power('typo');
  if (typo && !state.ai.done && state.ai.line.length > 0 && bestTypoJam(state, state.ai.line).delta < 0)
    return { kind: 'power', cardId: typo.id };
  const forgot = power('forgot');
  if (forgot && !state.ai.done && state.ai.line.length >= 4) return { kind: 'power', cardId: forgot.id };
  const search = power('search');
  if (search && p.line.length === 0 && (!best || best.delta < 2.5)) return { kind: 'power', cardId: search.id };

  if (best && best.ext.length === 0) return { kind: 'end' };
  if (best && best.ext.length > 0) return { kind: 'take', from: best.ext[0].source, cardId: best.ext[0].card.id };
  const legal = avail.filter((a) => canAppend(p.line, a.card));
  if (legal.length > 0) return { kind: 'take', from: legal[0].source, cardId: legal[0].card.id };
  return { kind: 'end' };
}

// ---------- reward drafting + upgrade assignment (a sensible player's choices) ----------
const contentRewards = REWARDS.filter((c) => c.role !== 'powerup');
const cardPower = (c) =>
  Math.abs(c.sentiment ?? 0) + (c.ceiling ?? 0) * 0.7 + (c.factor ? c.factor * 3 : 0) + (c.intensity ? c.intensity * 2 : 0);

function draftRewards(n, rng) {
  // top-half bias with seeded jitter: strong drafts, but varied across seeds
  const ranked = contentRewards.slice().sort((a, b) => cardPower(b) - cardPower(a));
  const topHalf = ranked.slice(0, Math.max(n, Math.ceil(ranked.length / 2)));
  return shuffle(topHalf, rng).slice(0, n);
}

function assignUpgrades(deckDefs, steps, rng) {
  // candidates: base ids with a chain; greedily spend tier-steps on the biggest next-tier gain
  const tiers = {};
  const chainDepth = (id) => {
    let d = 0, def = findDef(id);
    while (def && UPGRADES[def.id]) { d++; def = UPGRADES[def.id]; }
    return d;
  };
  const cands = [...new Set(deckDefs.map((c) => c.id))].filter((id) => chainDepth(id) > 0);
  const gain = (id) => {
    const cur = resolveTier(id, tiers[id] ?? 0);
    const next = resolveTier(id, (tiers[id] ?? 0) + 1);
    return next && next.id !== cur.id ? cardPower(next) - cardPower(cur) : -Infinity;
  };
  for (let s = 0; s < steps; s++) {
    const ranked = cands.filter((id) => gain(id) > -Infinity).sort((a, b) => gain(b) - gain(a));
    if (!ranked.length) break;
    tiers[ranked[0]] = (tiers[ranked[0]] ?? 0) + 1;
  }
  return tiers;
}

// consultant schedule: visits after debates 2, 4, 5 grant 2/3/4 upgrade picks
const UPGRADE_STEPS_BY_RUNG = [0, 0, 2, 2, 5, 9];

// ---------- opponent deck injection (the roadmap's proposed lever) ----------
let injectSeq = 0;
function boostAiDeck(state, k, rng, aiUpgradeSteps = 0) {
  const extras = draftRewards(k, rng).map((c) => ({ ...c, id: `${c.id}#inj${injectSeq++}`, priv: true }));
  // rebuild the AI hand so Q1 sees the boosted deck too
  state.ai.deck.push(...state.ai.hand);
  state.ai.hand = [];
  let deck = [...state.ai.deck, ...extras];
  if (aiUpgradeSteps > 0) {
    const tiers = assignUpgrades(deck.map((c) => ({ id: c.id.split('#')[0] })), aiUpgradeSteps, rng);
    deck = deck.map((c) => {
      const [base, inst] = c.id.split('#');
      const t = tiers[base];
      const def = t ? resolveTier(base, t) : undefined;
      return def && def.id !== base ? { ...def, id: `${def.id}#${inst}`, priv: true } : c;
    });
  }
  state.ai.deck = shuffle(deck, rng);
  refill(state.ai.deck, state.ai.hand, state.handSize);
}

// ---------- one debate ----------
function runDebate(cfg) {
  const rung = LADDER[cfg.rung];
  const state = createGame({
    seed: cfg.seed,
    opponentId: rung.opponentId,
    playerBonus: cfg.bonus ?? [],
    upgrades: cfg.upgrades,
  });
  const rng = makeRng(cfg.seed ^ 0x9e3779b9);
  if (cfg.aiBoost || cfg.aiUpgradeSteps) boostAiDeck(state, cfg.aiBoost ?? 0, rng, cfg.aiUpgradeSteps ?? 0);
  let guard = 0;
  while (!state.winner && guard++ < 3000) {
    if (state.awaitingNext) { nextQuestion(state); continue; }
    const move =
      state.turn === 'ai'
        ? aiTurn(state, { maxExtend: cfg.aiExtend ?? rung.maxExtend })
        : playerMove(state, { maxExtend: cfg.playerExtend });
    applyMove(state, move);
  }
  const resolves = state.events.filter((e) => e.t === 'resolve');
  const pd = resolves.filter((e) => e.by === 'player').map((e) => e.delta);
  const ad = resolves.filter((e) => e.by === 'ai').map((e) => e.delta);
  return {
    winner: state.winner ?? 'stuck',
    bar: state.bar,
    rounds: state.round,
    landslide: Math.abs(state.bar) >= 100,
    pAvg: pd.length ? pd.reduce((a, b) => a + b, 0) / pd.length : 0,
    aAvg: ad.length ? ad.reduce((a, b) => a + b, 0) / ad.length : 0,
    gaffes: resolves.filter((e) => e.by === 'ai' && e.gaffe).length,
  };
}

// ---------- experiment runner ----------
function runConfig(label, cfgOf, N) {
  const rows = [];
  for (let i = 0; i < N; i++) rows.push(runDebate(cfgOf(1000 + i * 7919)));
  const n = rows.length;
  const wins = rows.filter((r) => r.winner === 'player').length;
  const ties = rows.filter((r) => r.winner === 'tie').length;
  const avg = (f) => rows.reduce((a, r) => a + f(r), 0) / n;
  console.log(
    `${label.padEnd(46)} win ${((wins / n) * 100).toFixed(0).padStart(3)}%  tie ${((ties / n) * 100).toFixed(0).padStart(2)}%  ` +
      `bar ${avg((r) => r.bar).toFixed(0).padStart(4)}  KO ${((rows.filter((r) => r.landslide).length / n) * 100).toFixed(0).padStart(3)}%  ` +
      `rds ${avg((r) => r.rounds).toFixed(1)}  pΔ ${avg((r) => r.pAvg).toFixed(1).padStart(5)}  aΔ ${avg((r) => r.aAvg).toFixed(1).padStart(5)}  gaffes ${avg((r) => r.gaffes).toFixed(1)}`,
  );
}

function progressionCfg(rungIdx, seed, playerExtend, rewardsPerWin) {
  const rng = makeRng(seed ^ 0x1234abcd);
  const bonus = draftRewards(Math.round(rungIdx * rewardsPerWin), rng);
  const deckDefs = [...buildPrivateDeck(), ...bonus].map((c) => ({ id: c.id.split('#')[0] }));
  const upgrades = assignUpgrades(deckDefs, UPGRADE_STEPS_BY_RUNG[rungIdx], rng);
  return { rung: rungIdx, seed, playerExtend, bonus, upgrades };
}

const [, , exp = 'all', nArg = '40'] = process.argv;
const N = parseInt(nArg, 10);
const names = LADDER.map((r, i) => `${i + 1}:${r.opponentId}(ext${r.maxExtend})`);

if (exp === 'expA' || exp === 'all') {
  console.log(`\n=== A. BASELINE — default deck vs ladder, player skill sweep (N=${N}) ===`);
  for (const pe of [4, 5, 6]) {
    console.log(`-- player maxExtend ${pe} --`);
    for (let r = 0; r < LADDER.length; r++)
      runConfig(`  ${names[r]}`, (seed) => ({ rung: r, seed, playerExtend: pe }), N);
  }
}
if (exp === 'expB' || exp === 'all') {
  console.log(`\n=== B. PROGRESSION DECK — rewards + consultant upgrades per rung (player ext 6, N=${N}) ===`);
  for (const rpw of [1, 2]) {
    console.log(`-- ${rpw} reward card(s) per win (${rpw === 1 ? 'lean' : 'rich'}) --`);
    for (let r = 0; r < LADDER.length; r++)
      runConfig(`  ${names[r]}`, (seed) => progressionCfg(r, seed, 6, rpw), N);
  }
}
if (exp === 'expC' || exp === 'all') {
  console.log(`\n=== C. OPPONENT DECK QUALITY — inject k reward cards into AI deck, rungs 4-6 vs rich player (N=${N}) ===`);
  for (const k of [0, 2, 4, 6]) {
    console.log(`-- AI +${k} reward cards --`);
    for (const r of [3, 4, 5])
      runConfig(`  ${names[r]}`, (seed) => ({ ...progressionCfg(r, seed, 6, 2), aiBoost: k }), N);
  }
  console.log(`-- AI +6 rewards AND 9 upgrade steps (full mirror) --`);
  for (const r of [4, 5])
    runConfig(`  ${names[r]}`, (seed) => ({ ...progressionCfg(r, seed, 6, 2), aiBoost: 6, aiUpgradeSteps: 9 }), N);
}
if (exp === 'expD' || exp === 'all') {
  console.log(`\n=== D. AI PLANNING DEPTH — boss at aiExtend {3..6} vs punchy default-deck player (ext 4, N=${N}) ===`);
  for (const ae of [3, 4, 5, 6])
    runConfig(`  6:grandstand@ext${ae}`, (seed) => ({ rung: 5, seed, playerExtend: 4, aiExtend: ae }), N);
  console.log(`-- and vs the rich progression player at ext 4 --`);
  for (const ae of [4, 6])
    runConfig(`  6:grandstand@ext${ae}`, (seed) => ({ ...progressionCfg(5, seed, 4, 2), aiExtend: ae }), N);
}
if (exp === 'expE' || exp === 'all') {
  console.log(`\n=== E. PROPOSED BOSS — ext 4 + full-mirror deck (+6 rewards, 9 upgrade steps) (N=${N}) ===`);
  runConfig(`  vs default deck, player ext 4`, (seed) => ({ rung: 5, seed, playerExtend: 4, aiExtend: 4, aiBoost: 6, aiUpgradeSteps: 9 }), N);
  runConfig(`  vs rich progression, player ext 4`, (seed) => ({ ...progressionCfg(5, seed, 4, 2), aiExtend: 4, aiBoost: 6, aiUpgradeSteps: 9 }), N);
  runConfig(`  vs rich progression, player ext 6`, (seed) => ({ ...progressionCfg(5, seed, 6, 2), aiExtend: 4, aiBoost: 6, aiUpgradeSteps: 9 }), N);
}
