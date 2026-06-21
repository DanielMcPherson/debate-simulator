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
- `connector` — `conj`: `and` (coordinates predicates → CCAND); `because`/`and therefore`/`but`
  join clauses (CJOIN); `period` is the **free, unlimited** clause break. The `PERIOD` card
  (cards.ts) is **virtual** — always available, never drawn/consumed, NOT in CONNECTORS/ALL/decks;
  played via `Move{kind:'take', from:'period'}`.
- `intensifier` — sentence-final finisher (`factor` multiplies the whole statement).
- `powerup` — one-shot action card (`effect`), never part of the sentence.

Grammar: `TOP→S [INT]; S→CLAUSE | S (CCAND|CJOIN) CLAUSE; CLAUSE→NP PREDS; PRED→PC | PO NP`
(`but`/`period` → CJOIN). Validity depends only on the **role sequence**, so `grammar.ts`
recognizes over term-sets and memoizes (keeps the AI's deep search fast). Play is freeform (any
card any time, no POS labels); the grammar judges the *result* — ungrammatical lines score
"confused". The clause segmenter stamps each clause's `joinedByPrev` connector (for scoring).

## Scoring (scoring.ts) — `delta` is signed TOWARD THE SPEAKER (+ = good for whoever said it)
Per clause: `targetFor(subject)` gives `{sign, weight}` × `subject.intensity`. self/opp weight
1.0, audience 1.3. **No noun is inert:** a `neutral` "thing" noun is remapped by `effectiveSide`
to **audience** if its sentiment ≥0 (championing a cause pleases the crowd; trashing it is a
blunder) or **opponent** if <0 (bashing a shared villain lands like an attack; praising it
backfires) — so "I support the economy" / "the swamp is a disgrace" both score and react to the
crowd. Each predicate's polarity P × sign × weight × SCALE. Closed pred:
baked sentiment; open pred: `deed + affinity×objectSentiment`. **Self-owns & audience-insults
get a ×1.6 blunder multiplier.** **Combos are connector-fit** (`aggregate()` in scoring.ts):
contributions joined by a *correctly-used* conjunction bind into a combo group (summed full, then
×mult) — `and` 1.25 / `because`/`and therefore` 1.30 / `but` 1.40 (pivot: them-bad→you-good,
different sides). `and`/`because` need both clauses good & **distinct** (by side or predicate base
id), strength ≥COMBO_MIN. Everything else (periods, misused connectors, singletons) is **residual**:
short diminishing-returns stack `[1.0,0.3,0.1,0.04,0.02]` by |delta| desc, so periods help
marginally and piles of single sentences flatten fast (asymptote ≈1.45× the best clause), while a
real combo multiplies past them. **Rambling:** past `RAMBLE_LIMIT` (3) *residual* (non-combo)
sentences, each extra one subtracts `RAMBLE_STEP` (2.5) — so piling 4+ simple sentences actively
hurts (combos are exempt). A `but` after a **self-own** *mitigates* it (blunder 1.6→1.1,
×1.0) and forces a `confused` label when net-negative. The **hidden crowd** boosts only your single
*best* on-taste contribution (×boost), not every matching clause — so monotonous piling can't farm
it; a combo containing the matched clause still multiplies the boosted value. `reaction.combo{kind,
mult}` drives the UI callout. Then intensifier `factor`, **off-topic** is *multiplicative*
(positive totals ×`OFF_TOPIC_MULT` 0.75 — a big statement can't cheaply ignore the question), clamp
±35 (±50 with intensifier).
**Tuning (rebalanced 2026-06: keep this ratio):** `SCALE=2.5` is deliberately small vs the ±35 cap
so one strong clause ≈⅓ of the cap, leaving headroom for combos to out-climb piles (if a clause
nearly caps, *everything* saturates and combos lose their edge — that was the bug). `COMBO_MIN=3`,
`CONFUSED_PENALTY −2.5` and `RAMBLE_STEP 2.5` scale with SCALE (off-topic is now a multiplier, not
flat). If you change SCALE, rescale COMBO_MIN, those penalties, and the delta-unit thresholds in **ai.ts** (`chooseMove`:
Forgot ≥4, soundbite ≥5, search <2.5, redraw <2) together — plus the absolute-magnitude assertions
in tests/scoring.test.ts & tests/ai.test.ts. The worked-examples table lives in tests/scoring.test.ts.

## Game loop (game.ts)
A debate = several **questions**. Each question deals a fixed **shared pool** (~9, contested) +
a small **private hand**; **nothing replenishes** mid-question. **End** is allowed on ANY non-empty
line (no soft-lock, no forced self-own): an incomplete/ungrammatical line just scores **lenient
"confused"** (partial intent ×0.5, capped ±8, + a coaching note — see `scoreStatement`). The free
**period** (`from:'period'`) ends a clause and opens a new one anywhere the grammar allows; **Pass**
to wait on an empty/endable line; **Call a Recess** (once/question, costs turn) reshuffles the
**pool only** (not your hand). After both speak the round **pauses** (`awaitingNext` →
`nextQuestion()`). Win at ±100 (landslide) or lead after `maxRounds` (default 8). Each statement's
`delta` is applied toward its speaker (`+player`/`−ai` on the bar).

Per-debate hidden state: a **topic** — a moderator **question** (`Topic.question`) you address with
any `topics`-tagged card; **no green "topic card" is offered** anymore (that idea is parked on
`Topic.card` for a future bonus-phrase mechanic). `ensurePoolHasTopic` guarantees ≥1 on-topic card
is dealt; on-topic cards are highlighted in the UI; dodging the topic is the **multiplicative**
off-topic penalty. Also a **crowd** with a HIDDEN `loves` category (×boost at resolution only — the
AI never sees it), and a named **opponent** with a style. **Private decks are persistent** across
the debate (built once; a played card like Plant won't recur). Shared deck is re-dealt each question.

## AI (ai.ts)
Re-plans every turn: bounded DFS over reachable grammatical completions, scored by the real
engine. **Deliberately handicapped** (`AiOptions.maxExtend`, default 4) so it's beatable.
It's **blind to the crowd** (plans without it) and leans toward its opponent `style`
(`STYLE_BONUS` via `dominantCategory`). Power-up heuristics: Teleprompter Typo **only** when
`bestTypoJam` finds a pool card that completes the player's line into a real self-own (never
gibberish); Hot Mic to steal the player's power-up; Search/Soundbite situationally; never Plant.

## Power-ups (`Move{kind:'power'}`)
Search (draw 5, FREE), Filibuster (adds 3 connectors, FREE), Soundbite (`nextMultiplier` ×1.5),
Plant (`knowsCrowd`, reveal crowd for the debate), Teleprompter Typo (**REPLACE** the opponent's
last card — pop it, push a card you choose; player targets, AI auto-picks the swap forcing the worst
self-own via `bestTypoJam`, which searches *replacements* of the victim's last card; victim recovers
by tacking on another sentence — a `but` pivot helps most), Forgot My Line (pop the opponent's last line card — discarded, not returned;
player just plays it, AI plays it to wreck a strong/long line the player is sitting on),
Hot Mic (`knowsOppHand` reveals opp hand for the CURRENT QUESTION + steal a card permanently).
Both Typo and Forgot set `state.lastSabotage{victim,by,text,kind:'typo'|'forgot'}`, which drives
a must-dismiss modal when the player is the victim. FREE power-ups don't cost the turn; others do.

## Campaign run (lives in ui/main.ts, not the engine)
`LADDER` (cards.ts) = 6 opponents of rising `maxExtend`. Win → pick 1 of 3 `REWARDS` (exclusive,
stronger: ±4 predicates + intensity-1.6 subjects; never in starting decks) → added to `run.bonus`
→ carried via `createGame({playerBonus})` → shuffled into the player's deck. Lose/tie → run
resets to default deck. UI state: `run`, `runScreen` ('tutorial'|'map'|'reward'|'victory'|'defeat'),
`checkDebateEnd`, `startDebate`/`newRun`, modals. A fresh run opens on the `'tutorial'` screen
(`TUTORIAL_BODY`: periods/combos/`but` with examples) → `'map'`. The `'map'` screen is a
Slay-the-Spire-style straight-line ladder (`ladderHtml`) shown before the first debate and between
debates (after the reward pick). `startDebate` builds the next game eagerly, then the run screen
overlays it; the Begin button clears the screen.
Decision: path is a straight line (no branching) — too few opponents to make path choice meaningful.

## Roadmap (triaged — DON'T build until the current scoring is playtested)
Ordered by priority/dependency. Engine work stays pure/seeded (no `Math.random` — thread the game
RNG); player-only meta lives in `ui/main.ts`. Source: `~/Downloads/debate_game_session_notes.md`.

**P1 · small · independent — Per-card scoring ceiling ("headliners").** A powerful card raises the
statement cap (e.g. ±35 → ±45) *in addition to* adding score, so strong cards feel strong instead of
clipping. Derive `STATEMENT_CAP` from the cards in the line (a `ceiling` field on the card). Do this
**first** — it's what makes the reward/shop cards below actually land. (Reality check: the 35 cap
binds ~5% of AI / ~16% of skilled-player statements today — not "most" — but powerful cards *are*
muted when they push an already-good line into the cap. Per-card ceiling fixes that without the
global bar-pace change we deliberately avoided.)

**P1 · medium — In-debate card-award events (player-only, hidden, probabilistic).** Reuse the existing
3-card reward modal to award a card mid-debate on certain plays: big combos, on-/off-topic streaks
(track per-run), and crucially **self-own / heel-turn (insult-audience) / compliment-opponent as a
risk-reward gamble** ("own-goal for a card!"). This gives the now-lenient self-own a *positive reason
to exist*. Hidden (discovered, not documented). Opponent never gets awards. New cards shuffle into the
player's persistent private deck. Seed the RNG.

**P2 · large epic — Campaign donation economy + shop** (the long-deferred roguelike meta; needs its
own design pass + phasing). Donations trickle in per-statement by type, scaled by your **chosen
character's donor taste** (KNOWN to you) vs the **crowd's hidden taste** — the core win-vs-fund
tension. Self-owns *refund* donations (net loss); opponent insults / off-taste plays reduce the
trickle. Between debates, a **shop**: buy cards (priced by power) / remove cards (deck pruning).
Player-only (opponent donations never shown — they can't spend). Phase: accrual → shop buy/remove →
character select. Watch the **complexity budget** — decide if donations augment or partly replace
existing incentives.

**DONE (2026-06) — Gaffe/nerves difficulty system.** Each `Opponent` has a `gaffeChance` (falls up
the ladder: rookie 0.45 → boss 0) and `nervousOf` triggers (`attacked`/`pander`/`self_brag`) that
raise it when the player lands a big matching statement — the opponent's hidden tell. `ai.ts`:
`aiTurn` (RNG-aware entry; rolls the gaffe via `gameRng`) → `chooseMove` with `gaffing` (build the
**shortest clear self-own** via `plan(objective:'gaffe')` — a punchy howler like "Our veterans are a
national disgrace", not a mushy −2) + `restrainPower` (rookies hold back Typo/Forgot/Hot Mic).
Resolve adds a comedic "tell" log line. Opp 1 is a verified Glass Joe.

**P1 · medium — Make the BOSS actually hard via DECK QUALITY (deck-building note).** Playtest sims
show the late ladder is a flat ~55–60% plateau: the **±35/50 scoring cap flattens `maxExtend`**
(deeper AI just caps out) so depth can't harden the top, and on equal-tier decks a clean player has
a structural edge. The intended lever: **better opponents play better cards** — up the ladder,
opponents get increasingly powerful decks (reward-tier `REWARDS`-style cards, then beyond), not the
default deck played perfectly. The boss should be near-impossible on the *default* deck; the player
must **deck-build even more powerful cards to compensate**. So opponent-deck-strength and the
player's card economy must be **balanced together** in the deck-building epic (P2) — don't tune one
without the other. (Player verifies human-beatability by playtest; sims can't.) Optional AI knobs
still open: `comboSkill`/`cardGreed`.

**P3 · large — 4-way debate (mid-ladder special).** Midway up the ladder, a debate with the player
+ 3 opponents; the player must finish on top to continue. Attacks become **directed**: aim an
attack at a specific opponent to *lower their approval* — usually the leader, but you might kick the
last-place candidate to keep them out. Opponents also direct attacks at specific candidates (not
necessarily the player). Pander/self-praise boost your own approval. Needs a multi-candidate game
state + targeted-attack moves + AI target selection.

  **Scoring model (decided): independent approval bars, NOT zero-sum redistribution.** Each
  candidate has their own approval %, all starting ~35%; **attacks just lower the target's bar (no
  splash), pander/self-praise raise your own** — this is the whole point (cleanly separating the two
  verbs), is *simpler* to reason about than zero-sum (no "where did the lost share go, and did it
  feed the wrong rival?" math), makes "kick the last-place candidate" sensible, and matches real-poll
  intuition (a nasty debate can tank the whole field). **Win = race to a threshold where attacks
  *delay* rivals** (everyone needs ~60%; sprint yourself OR trip whoever's about to cross) — a plain
  "boost yourself over X" makes attacks pointless, and "highest at the time limit" also works.
  **Keep the zero-sum needle for 1v1 debates** — there it's strategically equivalent (lowering your
  only opponent *is* raising your standing), simpler, and a more dramatic tug-of-war; independent
  bars there add a second bar for no new decision. The engine fork is thin: the per-statement scoring
  is identical; only how a delta routes changes (an attack clause → −target's bar). The rules change
  is easy to explain at the 4-way intro (one screen) since it's a distinct event with poll-like
  bars. (Open: could independent bars *also* replace the 1v1 needle? Decided no for now — the
  tug-of-war feel is better head-to-head — but revisit if the two models feel jarring to switch between.)

**P3 · medium — Curse cards** (depends on shop + heel-turn). Opponent sabotage that injects toxic
pre-formed statements into your deck ("…and that's why I despise my voters"), clogging your hand.
Remove in the shop, or play deliberately to attempt a Heel Turn.

**P3 · trivial — Remove the on-topic card hint.** The green glow + "on topic ✓" tag (`cardHtml` in
ui/main.ts) is a **temporary debug aid** for catching mislabeled `topics`; once the data is trusted,
remove it so players learn to spot on-topic cards themselves.

**P3 · small — Varied reaction text.** `describe()` in scoring.ts returns one fixed line per
reaction tier ("the audience nods along", etc.), plus the single confused/ramble flavor strings — so
resolutions read identically across a debate. Give each tier a pool of phrasings (and the
confused/combo notes too), picked with the game RNG (deterministic). Pattern mirrors `Topic.questions`
(35 phrasings across 7 topics, picked per question — done). Cosmetic; pairs well with the juice pass.

**P2 · large — Graphics, animation & juice.** The UI is a functional prototype. Make it *feel* good:
character art / reaction faces (an opponent that looks embarrassed on a self-own), animated card
plays, **screen shake + combo flourishes when a statement resolves/scores**, donation/score
tickers, audience reactions. Tied to this: properly **stage the opponent's turn** — show the pool,
"opponent's turn", the AI "thinking", then it picks a card (currently just an `AI_DELAY` pause with
"Your opponent is speaking…"). The combo callout (`comboHtml`) and reaction text are already
structured as placeholders to swap for juiced versions.

**Why gated:** the connector-fit scoring + combo/period/topic system just landed; get playtest data
on *its* feel before layering meta-progression on top.

## Source control & deploy (IMPORTANT — two GitHub accounts on this machine)
- **Commit attribution:** all commits in this repo must be authored as **Daniel McPherson
  <mcphersond@gmail.com>** (his personal identity). The repo already has a local override
  (`git config --local user.email mcphersond@gmail.com`); don't undo it. The machine's *global*
  git identity is his work email — never let a commit here use that.
- **Pushing is the user's job, via GitHub Desktop — not the CLI.** Command-line `git`/`gh` on
  this machine are signed into his **work** account (SSH token) and **cannot reach** his personal
  repo `github.com/DanielMcPherson/debate-simulator`. So: do NOT run `git push` or `gh`; when a
  push is needed, **prompt Daniel to commit & push it in the GitHub Desktop app** (signed into his
  personal account). Local-only git (`status`, `log`, `add`, `commit`, `config`) is fine.
- **Deploy is automatic:** pushing to `master` triggers `.github/workflows/deploy.yml`
  (build + publish to GitHub Pages). Live at https://danielmcpherson.github.io/debate-simulator/.
  Run `npm test` + `npm run build` locally before handing a change off to push. See SHARING.md §6.

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

## Debug / analytics log
`GameState.events: GameEvent[]` is a structured trail (`logEvent` in game.ts) of every deal (incl.
the HIDDEN `crowdLoves` + both starting hands), play (with `from` pool/hand/period + card/role),
power-up, sabotage, resolution (speaker-delta, label, combo, gaffe flag, bar), and win. `logEvent`
auto-attaches the actor's **available power-ups** to each event (answers "did I even have a Typo?").
Power-ups are color-coded in the UI (`.card.fx-<effect>`; Typo=red, Forgot=amber, …) so they're not
all "the purple card", and arming a Typo shows a loud banner + highlights the word it'll replace.
The UI's **🐞 Debug log** button
downloads it as JSON. **A browser app can't auto-write files** — not on github.io *or* local dev
(both are sandboxed); only a Node process (our test scripts) can. So in-browser options are: this
user-clicked download, `console.log`, and `localStorage`. Use the log to repro bugs and to analyze
difficulty/skill.

## Gotchas
- **Sabotage jams must stick:** a Teleprompter-Typo'd card is tagged `Card.jammed`; `endableLine`'s
  end-trim refuses to strip a jammed card (else the lenient trim silently UNDID the typo — the
  "opponent's old line came back" bug). Keep that invariant if you touch trimming.
- Removed: a "for"/beneficiary connector (too niche). Don't reintroduce without asking.
- `dominantCategory`/`bestTypoJam` are exported from scoring.ts/game.ts and imported by ai.ts
  (one-directional; no cycle — game.ts does NOT import ai.ts).
- Grammar memoization keys on the role/term sequence; predicates carry no `text` (derived) — dedup
  by base id (`id.split('#')[0]`), not text.
