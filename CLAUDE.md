# CLAUDE.md — Debate Simulator

A browser prototype of a card-drafting debate game (inspired by *Oh...Sir!! The Insult
Simulator* + *Slay the Spire*). You build absurd political statements one chunk at a time;
an audience-reaction scorebar decides who wins. There's a roguelike campaign on top.

This file orients a new session. Player-facing rules live in `README.md`; sharing/deploy
steps in `SHARING.md`.

## Commands
- `npm install` — deps (Vite + TypeScript + Vitest only; no runtime deps).
- `npm test` (`npx vitest run`) — engine unit tests. **Run before declaring work done.**
- `npm run build` — `tsc` typecheck + Vite bundle to `dist/` (strict TS; catches type errors).
- `npm run dev` — local dev server. It's a **static, client-side app** (no backend/API/db).

When verifying behavior, prefer a quick `npx vite-node /tmp/x.mjs` script importing from
`src/engine/*` over trying to drive the DOM. The dev-server boot check via `curl` is flaky
because `pkill -f vite` returns exit 144 — a clean `npm run build` is sufficient proof the UI compiles.

## Architecture
Pure, fully-tested **engine** + thin DOM **UI**. No framework.
```
src/data/cards.ts   the lexicon + opponents + crowds + topics + rewards + the campaign LADDER
src/engine/
  types.ts          all shared types
  grammar.ts        Earley recognizer over ROLE sequences (memoized) + clause/predicate segmenter
  morphology.ts     predicate conjugation (3sg -s, is/are, casing); cardLabel/displayWords/renderSentence
  scoring.ts        deterministic audience reaction; exports scoreStatement, dominantCategory
  deck.ts           seedable RNG (mulberry32), shuffle, deck construction, card instancing
  game.ts           GameState, turn loop, applyMove, dealRound, win/pause logic, bestTypoJam
  ai.ts             opponent: bounded DFS plan + chooseMove (handicapped, style bias, power-ups)
  ui/main.ts        renders state to #app each change; wires clicks; holds the campaign-RUN state
  ui/style.css
tests/              grammar / scoring / game / ai  (Vitest; ~67 tests)
```

## Core model (the chunk system)
Cards are **chunks**, not single words. `Card.role`:
- `np` — a noun phrase (subject OR object). Has `side` (self/opponent/audience/neutral),
  `sentiment`, `person`/`number`, optional `intensity` (loaded-subject multiplier),
  `topics`, `proper`.
- `predicate` — a chunky verb phrase. Either **closed** (baked `sentiment`, e.g. "kicks
  puppies") or **open** (`open:true` + `affinity`/`deed`, takes an object, e.g. "wants to
  destroy ___"). Conjugates via `pre`/`lead`/`post` (or `invariant:true` for modal/past text).
- `connector` — `and` (coordinates predicates), `because`/`and therefore`/`but` (join clauses).
- `intensifier` — sentence-final finisher (`factor` multiplies the whole statement).
- `powerup` — one-shot action card (`effect`), never part of the sentence.

Grammar: `TOP→S [INT]; S→CLAUSE | S (CCAND|CJOIN) CLAUSE; CLAUSE→NP PREDS; PRED→PC | PO NP`.
Validity depends only on the **role sequence**, so `grammar.ts` recognizes over term-sets and
memoizes (keeps the AI's deep search fast). Play is freeform (any card any time, no POS labels);
the grammar judges the *result* — ungrammatical lines score "confused".

## Scoring (scoring.ts) — `delta` is signed TOWARD THE SPEAKER (+ = good for whoever said it)
Per clause: `targetFor(subject)` gives `{sign, weight}` × `subject.intensity`. self/opp weight
1.0, audience 1.3; a **neutral noun acts as hero (praise it) or villain (bash it)** by its
sentiment, weight 0.6. Each predicate's polarity P × sign × weight × SCALE(5). Closed pred:
baked sentiment; open pred: `deed + affinity×objectSentiment`. **Self-owns & audience-insults
get a ×1.6 blunder multiplier.** Combo bonus only if every clause lands hard same-sign; else a
ramble penalty. Then intensifier `factor`, then topic **dodge** penalty (−5 if no on-topic
card), clamp ±35 (±50 with intensifier).

## Game loop (game.ts)
A debate = several **questions**. Each question deals a fixed **shared pool** (~9, contested) +
a small **private hand**; **nothing replenishes** mid-question. You may only **End** on a
complete statement (or when truly stuck → confused); **Pass** to wait on an empty/complete line;
**Call a Recess** (once/question, costs turn) reshuffles the **pool only** (not your hand).
After both speak the round **pauses** (`awaitingNext` → `nextQuestion()`). Win at ±100
(landslide) or lead after `maxRounds` (default 8). Each statement's `delta` is applied toward
its speaker (`+player`/`−ai` on the bar).

Per-debate hidden state: a **topic** (dodging penalized), a **crowd** with a HIDDEN `loves`
category (×boost at resolution only — the AI never sees it), and a named **opponent** with a
style. **Private decks are persistent** across the debate (built once; a played card like Plant
won't recur). Shared deck is re-dealt each question.

## AI (ai.ts)
Re-plans every turn: bounded DFS over reachable grammatical completions, scored by the real
engine. **Deliberately handicapped** (`AiOptions.maxExtend`, default 4) so it's beatable.
It's **blind to the crowd** (plans without it) and leans toward its opponent `style`
(`STYLE_BONUS` via `dominantCategory`). Power-up heuristics: Teleprompter Typo **only** when
`bestTypoJam` finds a pool card that completes the player's line into a real self-own (never
gibberish); Hot Mic to steal the player's power-up; Search/Soundbite situationally; never Plant.

## Power-ups (`Move{kind:'power'}`)
Search (draw 5, FREE), Filibuster (adds 3 connectors, FREE), Soundbite (`nextMultiplier` ×1.5),
Plant (`knowsCrowd`, reveal crowd for the debate), Teleprompter Typo (jam a card onto the
opponent's line — player targets, AI auto-picks the worst self-own; victim can recover with a
connector+clause), Forgot My Line (pop the opponent's last line card — discarded, not returned;
player just plays it, AI plays it to wreck a strong/long line the player is sitting on),
Hot Mic (`knowsOppHand` reveals opp hand for the CURRENT QUESTION + steal a card permanently).
Both Typo and Forgot set `state.lastSabotage{victim,by,text,kind:'typo'|'forgot'}`, which drives
a must-dismiss modal when the player is the victim. FREE power-ups don't cost the turn; others do.

## Campaign run (lives in ui/main.ts, not the engine)
`LADDER` (cards.ts) = 6 opponents of rising `maxExtend`. Win → pick 1 of 3 `REWARDS` (exclusive,
stronger: ±4 predicates + intensity-1.6 subjects; never in starting decks) → added to `run.bonus`
→ carried via `createGame({playerBonus})` → shuffled into the player's deck. Lose/tie → run
resets to default deck. UI state: `run`, `runScreen` ('map'|'reward'|'victory'|'defeat'),
`checkDebateEnd`, `startDebate`/`newRun`, modals. The `'map'` screen is a Slay-the-Spire-style
straight-line ladder (`ladderHtml`) shown before the first debate and between debates (after the
reward pick); the first-run map also shows a `HOW_TO_PLAY` onboarding block. `startDebate` builds
the next game eagerly, then `runScreen='map'` overlays it; the Begin button clears the screen.
Decision: path is a straight line (no branching) — too few opponents to make path choice meaningful.

## Conventions / decisions (don't violate without the user asking)
- **Deterministic, no LLM at runtime.** Scoring + AI are pure search over card metadata. Don't
  add an LLM dependency.
- RNG is **seedable** (`createGame({seed})`); tests rely on determinism. `Math.random` is only
  used UI-side (reward choices) — never in the engine.
- The engine is **pure/DOM-free and unit-tested**; keep new logic there with tests. The UI just
  renders `GameState` and dispatches `Move`s.
- Adding cards is data-only in `cards.ts` (decks build programmatically from the arrays).
- When changing scoring/grammar, run the worked examples — the test suites encode the intended
  behavior; update them deliberately, not reflexively.

## Gotchas
- Removed: a "for"/beneficiary connector (too niche). Don't reintroduce without asking.
- `dominantCategory`/`bestTypoJam` are exported from scoring.ts/game.ts and imported by ai.ts
  (one-directional; no cycle — game.ts does NOT import ai.ts).
- Grammar memoization keys on the role/term sequence; predicates carry no `text` (derived) — dedup
  by base id (`id.split('#')[0]`), not text.
