# CLAUDE.md — Debate Simulator

A browser prototype of a card-drafting debate game (inspired by *Oh...Sir!! The Insult
Simulator* + *Slay the Spire*). You build absurd political statements one chunk at a time;
an audience-reaction scorebar decides who wins. There's a roguelike campaign on top.

This file orients a new session. Player-facing rules live in `README.md`; sharing/deploy
steps in `SHARING.md`.

## Design north star (2026-06)
**The fun is building long, ridiculous, over-the-top statements that parody how politicians
talk.** Playtests confirm the joy is in chaining absurd chunks into one gloriously overblown
sentence — not in tight optimization. Optimize the whole game for *that*: keep adding funny,
quotable card phrases; make long combo-chains feel rewarding and reachable (enough subjects/
verbs/connectors in the pool, generous combo headroom); don't punish ambitious construction
harshly (lenient "confused" scoring, blunders only punch through when genuinely attributable);
and prefer simpler controls so the player spends attention on the words, not the buttons (why
the period button, Call a Recess, and Pass were all removed). When a change trades a little
balance/realism for a funnier, longer, more satisfying statement, take the trade. Tensions to
watch: the score cap and the rambling penalty both *limit* long statements. The cap is now a
**per-line ceiling** (Headliners, 2026-06 — see Scoring §): long combo-chains and powerful cards
raise it (base ±35 → up to ±50, ±65 with a finisher), so length/power pay off without enabling
single-statement knockouts. The rambling penalty still limits *unstructured* piling on purpose.

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
- `connector` — `conj`: `and` (coordinates predicates OR joins clauses → CCAND); `and therefore`/`but`
  join clauses but may also coordinate bare predicates under a shared, elided subject ("…a jackass and
  therefore wants to…" → CJOIN); **`because` is clause-ONLY → CBEC**: it subordinates a full clause and
  **cannot elide its subject**, so "…a jackass because wants to raise taxes" is *confused* (CBEC is absent
  from the `PREDS` rules — it can't string bare predicates; fixed 2026-06). `period` is the **free** clause break, but limited to **one per statement**
  (`PlayerState.usedPeriod`, reset each question in `dealRound`; the AI's `availFor` honors it too) —
  so a statement is at most two sentences and rambling-by-period is impossible (chain conjunctions for
  more, and a combo). The `PERIOD` card (cards.ts) is **virtual** — never drawn/consumed, NOT in
  CONNECTORS/ALL/decks; played via `Move{kind:'take', from:'period'}`.
  **Period currently DISABLED (experiment, 2026-06):** `PERIOD_ENABLED = false` (cards.ts) gates the THREE
  move-generation sites (UI button in main.ts + the player's `availFor` in game.ts + **the AI's own
  `availFor` in ai.ts** — the AI builds its own avail and was still playing periods until that was gated),
  so a statement is **one sentence (or connectors chained
  into one compound sentence)**; jamming two complete thoughts with no connector reads as a **run-on**
  (`looksRunOn` → confused, `reaction.runOn` drives a `RUN-ON!` badge + coaching). All the period plumbing
  (grammar `CPERIOD`, scoring residual/decay, `endableLine` trim, applyMove handler) is left intact and
  harmless — flip `PERIOD_ENABLED` back to fully restore it (the offering-dependent tests are
  `it.runIf(PERIOD_ENABLED)`).
- `modifier` — a post-nominal aside on a subject ("who is ugly, just very ugly", "which is a
  national treasure"). Reuses predicate fields (`lead`/`post`, conjugated via `predicateText`) but
  rendered with a relative pronoun ("who" vs "which") chosen by the subject's `animate` flag, set off
  by commas. Carries **no `side`** — `sentiment` is about the subject, so its effect flips with whom
  it's played on (an attack on an opponent, a self-own on yourself). **Direction-split in
  `contributions()`:** a GOOD-direction aside (attack_opp / praise_self / pander_aud) **folds into
  its clause's first contribution ONLY when that contribution is itself positive** (intensifies a
  good clause + rides any combo; no decay, no ramble) — it will **not rescue a blunder predicate**
  (bragging "who is winning" can't flip "I secretly eat babies" positive; the gaffe stands); a
  BLUNDER-direction aside (self_own / insult_aud / boost_opp) is marked `aside` and scored
  **separately at full strength** (no combo/decay) so same-clause praise can't net it away. Two
  knock-on rules in `scoreStatement`: (1) **any audience insult** (predicate OR aside) **zeroes all
  the statement's positive contributions** — an offended crowd won't credit later pandering; (2) a
  **self_own aside forces the `confused` label** when net ≤0 (calling yourself ugly muddles, not
  enrages). A subject+modifier with no predicate is a legal **prefix**
  but incomplete — the "waiting move" stall (scores lenient confused). The `md()` builder + `MODIFIERS`
  array live in cards.ts; they're contested **shared-pool** cards (in `buildSharedDeck`). The `rel`
  field is only the standalone hand/catalog hint; in a clause the subject's `animate` wins.
  Two extra `md()` shapes: **sentiment 0** = a *neutral* aside — pure flavor + a waiting move, never
  angers the crowd, never moves the score (crowd-anger is binary on `insult_aud`, so there's no
  "mildly off-putting" middle for audience targets — author them 0 or genuinely negative). And
  `invariant: true` bakes the full phrase incl. its own pronoun (for relative clauses that can't
  conjugate to the subject, e.g. "which the experts are calling a triumph", "and trust me, …").
  A **`conj` on a modifier** makes it **dual-role** — a subject aside OR a clause-joining coordinating
  conjunction mid-line (see the "Dual-role parenthetical asides" DONE note); `m_trustme`/`m_notmakingup`.
- `intensifier` — sentence-final finisher (`factor` multiplies the whole statement). It is an
  **end-move**: only offered/legal when the line is already a complete sentence (grammar `S → INT`),
  and playing it (a `take`) appends the flourish, resolves, and ends the turn — there is **no held
  state** (the old `heldFinisher` is gone). A finisher is contested in the shared pool, so building a
  bigger line before cashing it in risks the opponent grabbing it first.
- `powerup` — one-shot action card (`effect`), never part of the sentence.

Grammar: `TOP→S [INT]; S→CLAUSE | S (CCAND|CJOIN|CBEC|CPERIOD) CLAUSE; CLAUSE→NP [MODS] PREDS;
MODS→MOD | MODS MOD; PREDS→PRED | PREDS (CCAND|CJOIN) PRED; PRED→PC | PO NP`. Terms: `and`→CCAND,
`and therefore`/`but`→CJOIN (both can also coordinate bare predicates via the PREDS rules),
`because`→**CBEC** and `period`→CPERIOD (clause-ONLY — absent from PREDS, so each needs its own
subject). Validity depends only on the **role sequence**, so `grammar.ts`
recognizes over term-sets and memoizes (keeps the AI's deep search fast). Play is freeform (any
card any time, no POS labels); the grammar judges the *result* — ungrammatical lines score
"confused". The clause segmenter stamps each clause's `joinedByPrev` connector (for scoring).
`firstInvalidIndex(line)` returns where parsing breaks (the longest-valid-prefix boundary) — drives
the resolution **"WHAT??" highlight** (`Reaction.confusedSpan`).

## Scoring (scoring.ts) — `delta` is signed TOWARD THE SPEAKER (+ = good for whoever said it)
Per clause: `targetFor(subject)` gives `{sign, weight}` × `subject.intensity`. self/opp weight
1.0, audience 1.3. **No noun is inert:** a `neutral` "thing" noun is remapped by `effectiveSide`
to **audience** if its sentiment ≥0 (championing a cause pleases the crowd; trashing it is a
blunder) or **opponent** if <0 (bashing a shared villain lands like an attack; praising it
backfires) — so "I support the economy" / "the swamp is a disgrace" both score and react to the
crowd. Each predicate's polarity P × sign × weight × SCALE. Closed pred:
baked sentiment; open pred: `deed + affinity×objectSentiment`. **Self-owns & audience-insults
get a ×1.6 blunder multiplier.** A clause's **modifier** asides score by the same
`signed(P)` path (subject side/weight + blunder mult); GOOD-direction ones **fold into the clause's
first contribution** (intensify + ride its combo), BLUNDER-direction ones (`aside`) are added at
full strength outside combos/decay. **An audience insult anywhere zeroes the statement's positives**
(no pandering-your-way-back); a **self-own aside reads as `confused`** when net ≤0. **Combos are connector-fit** (`aggregate()` in scoring.ts):
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
mult}` is the single strongest group (kept for the analytics log); `reaction.comboChips[{tokenIdx,
kind}]` lists **every** connector token that formed a combo, each tagged with its OWN tier — the UI
paints these as inline **combo chips** on the junction words of the JUDGED statement (no multiplier
number, no separate callout). The connector token index is threaded `segmentDetailed → parse →
contributions → aggregate` (Clause/PredInstance/Contrib all carry `connIdx`). **Resolution juice (2026-06):**
`scoreStatement` also returns a per-phrase **`breakdown: PhraseHit[]`** (`{category, delta, tokenIdx, span,
aside, crowdFavorite}` — `delta` only buckets animation intensity, **never shown as a number**) plus
statement-level booleans **`offTopic`/`rambling`/`audienceInsulted`/`crowdFavorite`/`mitigated`/`runOn`**
(the UI used to fragile-parse these out of `detail` — now real fields), plus **`confusedSpan`** on a
confused line (the `[start,end]` word range where parsing broke, from `firstInvalidIndex`). Token indices for the spans are
threaded the same way (`Clause.subjectIdx`/`modIdxs`, `PredInstance.predIdx`/`objIdx`, `spanOf` in
scoring.ts). The UI (`judgedSpeechHtml` + `fxStripHtml` + `playResolutionFx` in ui/main.ts) renders the
judged line word-by-word. Word markup is **TRANSIENT** — only while the FX plays (`.fx-show` on `.speech`):
as each badge lands, its word(s) briefly bold/highlight (`.lit`), then on FX-end `.fx-show` is removed and
the statement **returns to a single color + font** (clean to screenshot/share — markup persisting was the
complaint; an even earlier float-above-the-word version also overlapped wrapping lines). The lasting
"what landed & why" lives in the **readout strip BELOW** the statement (`.fx-strip`): a chip per phrase
(ATTACK/BRAG/PANDER/GAFFE/INSULT/BLUNDER — GAFFE = self_own, BLUNDER = boost_opp), the combo (⚡COMBO/CHAIN/PIVOT), a ⭐FINISHER
chip (no number — the badge alone teaches finishers are good), and any OFF-TOPIC/RAMBLING/Run-on flag —
popped in sequence (each chip flashes its word(s)). **Confused/ungrammatical lines also animate** (2026-06):
`judgedSpeechHtml` renders them word-by-word too, an `❓ WHAT??` (or `RUN-ON!`) chip flashes the
**`confusedSpan`** words red (wavy underline + wobble) under a big transient **`.fx-stamp`** "WHAT??"
over the line — pointing the eye at exactly where it broke. Then a **count-up** of the **only on-screen number**
(the final delta) + a magnitude-scaled screen shake/flash; click anywhere to fast-forward — **the skip arms
only after a 500ms grace period** so the click that ended the turn (or a reflexive click toward Next when
you finish second) can't instakill the animation (that was the "player FX sometimes didn't play" bug).
`resolving` locks input + defers the AI turn. Each statement animates **when its own
speaker finishes** (so on AI-first questions the opponent's plays before the player has spoken — intended).
The **round-summary panel is deferred** (`fxHoldSummary`): while the second speaker's FX plays the card
area shows a "📊 The votes are coming in…" placeholder, and the full summary (headline + reactions +
Next) only appears once BOTH statements have animated.
**`crowdFavorite` is deliberately NOT surfaced in the UI** — it would leak the hidden crowd taste (engine
flag stays for future use). The round-summary headline is **varied** (`roundHeadline`, deterministic per
round by both deltas: swing-to-you / mixed / restless / electrified…). Then intensifier
`factor`, **off-topic** is *multiplicative*
(positive totals ×`OFF_TOPIC_MULT` 0.75 — a big statement can't cheaply ignore the question), clamp
to a **per-line cap** (see Headliners below): base `STATEMENT_CAP` 35 (pre-intensifier) / `INTENSIFIED_CAP`
50 (post-finisher), each raised by `headroom`.
**Headliners (per-line ceiling, 2026-06):** powerful/long lines break past the base cap.
`headroom = min(HEADROOM_MAX 15, Σ card.ceiling + CHAIN_STEP 3 × agg.chips.length)` — i.e. the sum of the
line's `ceiling` cards (a new optional `Card.ceiling`; only `REWARDS` carry it today — ±4 predicates +4,
loaded subjects +3) **plus** one CHAIN_STEP per combo *junction* (rewards combo-chaining, NOT raw piling,
which earns nothing and still rambles). Both clamps shift up together: `softCap = 35 + headroom` (≤50),
`hardCap = 50 + headroom` (≤65), preserving the finisher's room. Bounded so no single statement is a
knockout (win is ±100). **Symmetric** (a ceiling card mis-played into a self-own can also hit −50/−65 —
intended; headliner cards are double-edged). The **confused/incomplete path keeps the fixed ±35 clamp** —
ceiling never lifts incoherent lines. The **AI plays the default deck** (no ceiling cards) so it earns only
*chain* headroom — the player's reward deck can out-ceiling it (intended progression). Tests:
`describe('scoring — headliners …')` in tests/scoring.test.ts.
**Tuning (rebalanced 2026-06: keep this ratio):** `SCALE=2.5` is deliberately small vs the ±35 cap
so one strong clause ≈⅓ of the cap, leaving headroom for combos to out-climb piles (if a clause
nearly caps, *everything* saturates and combos lose their edge — that was the bug). `COMBO_MIN=3`,
`CONFUSED_PENALTY −2.5` and `RAMBLE_STEP 2.5` scale with SCALE (off-topic is now a multiplier, not
flat). If you change SCALE, rescale COMBO_MIN, those penalties, and the delta-unit thresholds in **ai.ts** (`chooseMove`:
Forgot ≥4, soundbite ≥5, search <2.5) together — plus the absolute-magnitude assertions
in tests/scoring.test.ts & tests/ai.test.ts. The worked-examples table lives in tests/scoring.test.ts.

## Game loop (game.ts)
A debate = several **questions**. Each question deals a fixed **shared pool** (`poolSize` 12, contested) +
a small **private hand**; **nothing replenishes** mid-question. The pool deal is **curated for
buildability** (`ensurePoolPlayable`): ≥3 sided subjects, ≥3 predicates (≥1 closed), ≥2 connectors,
≥1 on-topic card; finishers capped at 1 (`capPoolFinishers`) and asides capped at 2
(`capPoolModifiers`) so flavor can't crowd out the nouns/verbs you need. Floors are protected from
eviction so one guarantee can't void another. **End** is allowed on ANY non-empty
line (no soft-lock, no forced self-own): an incomplete/ungrammatical line just scores **lenient
"confused"** (partial intent ×0.5, capped ±8, + a coaching note — see `scoreStatement`/`confusedDetail`,
which distinguishes a **run-on** ("two thoughts crammed in" — `looksRunOn`), an unfinished line, and
word-salad). Two refinements (2026-06) keep incoherence from being a free dodge — see the design
north star (long *grammatical* statements are the goal; mashing isn't):
(1) **an egregious BLUNDER punches through the muffle** — a self-own / audience-insult / opponent-boost
*with an explicit subject* (a genuine, attributable gaffe, not a subject-orphaned parse artifact) lands
at **full strength** (its real ×1.6 value, not dampened/capped); you can't ramble your way out of
insulting the crowd.
(2) a **bafflement cost** for genuinely ungrammatical lines (`firstInvalidIndex ≥ 0`, not a merely
unfinished valid prefix): the muffled *upside* is scaled by coherence (`bad/len` — a line that's salad
from the start keeps almost none of the "drift" the greedy parser scraped out), plus a mild penalty
(`BAFFLE_BASE/STEP/CAP`, ≤ 6) scaling with the salad length. So pure gibberish nets **mildly negative**
(with a "had a stroke?" coaching tier at `stray ≥ BAFFLE_STROKE`), a one-card misclick costs ~nothing,
and an honest unfinished line still nets ~0. (Both refinements apply only to the incomplete path; the
complete path already weighs blunders fully.) `endableLine` strips **only a trailing dangling connector** (a tapped-but-unused
period/"and"/"but") — never real content — so jamming two clauses together (a run-on) or stranding a
half-clause scores "confused", instead of silently keeping just the first thought. The free **period**
(`from:'period'`, **one per statement** — see above) ends a clause and opens a new one anywhere the
grammar allows. (**Call a Recess and Pass both removed, 2026-06.** Recess (pool refresh) was a
player-only exploit — the handicapped AI ends early, after which the player built solo/uncontested and
could recess for a *whole fresh pool* at zero cost; removed (button, `usedRedraw`, the `redraw` Move/
event, the AI's weak-opener redraw), with the larger curated pool replacing the need for it. **Pass**
(wait without acting) was removed too — its only real use was stalling to set up a Teleprompter Typo,
but card-by-card alternation already lets you Typo on your own turn, and asides/conjunctions give the
player ways to pace a line; the move (`{kind:'pass'}`), the `passes` stalemate counter, and the button
are gone. No soft-lock results: `ensureHandHasOpener` guarantees a playable subject, and the finite,
non-replenishing pool forces an End. The AI never passed.) After both speak the round **pauses** (`awaitingNext` →
`nextQuestion()`). Win at ±100 (landslide) or lead after `maxRounds` (default 8). Each statement's
`delta` is applied toward its speaker (`+player`/`−ai` on the bar).

Per-debate hidden state: a **topic** — a moderator **question** (`Topic.question`) you address with
any `topics`-tagged card; **no green "topic card" is offered** anymore (that idea is parked on
`Topic.card` for a future bonus-phrase mechanic). `ensurePoolHasTopic` guarantees ≥1 on-topic card
is dealt; on-topic cards are highlighted in the UI; dodging the topic is the **multiplicative**
off-topic penalty. The 8 topics: economy/security/freedom/children/**pander** ("The Voters") are
*content-driven* (tag the topical noun/predicate). The two **attack topics share one pool** — a card
that attacks the opponent answers BOTH **opponent** ("Your Opponent") and **jackass** ("Name-Calling"):
the `NP` helper auto-derives `['opponent','jackass']` from `side:'opponent'` (and `['record']` from
`side:'self'`) via `SIDE_TOPIC`, so opponent/self subjects are NEVER hand-tagged (no drift); every
insult predicate is `.map`-tagged `['jackass','opponent']` (de-duped, keeping any issue topic like
'economy'). So both the target subject *and* the smear glow for either attack question. Audience-side
subjects have no implied topic — tag generic pander `['pander']`, patriotic-nation `['freedom']`,
child/family `['children']`. Also a **crowd** with a HIDDEN `loves` category (×boost at resolution only — the
AI never sees it), and a named **opponent** with a style. **Private decks are persistent** across
the debate (built once; a played card like Plant won't recur). Shared deck is re-dealt each question.

## AI (ai.ts)
Re-plans every turn: bounded DFS over reachable grammatical completions, scored by the real
engine. **Deliberately handicapped** (`AiOptions.maxExtend`, default 4) so it's beatable.
It's **blind to the crowd** (plans without it) and leans toward its opponent `style`
(`STYLE_BONUS` via `dominantCategory`). Power-up heuristics: Teleprompter Typo **only** when
`bestTypoJam` finds a pool card that completes the player's line into a real self-own (never
gibberish); Hot Mic to steal the player's power-up; Search situationally; never Plant.

## Power-ups (`Move{kind:'power'}`)
Search (draw 5, FREE), Filibuster (adds 3 connectors, FREE),
Plant (`knowsCrowd`, reveal crowd for the debate), Teleprompter Typo (**REPLACE** the opponent's
last card — pop it, push a card you choose; player targets, AI auto-picks the swap forcing the worst
self-own via `bestTypoJam`, which searches *replacements* of the victim's last card; victim recovers
by tacking on another sentence — a `but` pivot helps most), Forgot My Line (pop the opponent's last line card — discarded, not returned;
player just plays it, AI plays it to wreck a strong/long line the player is sitting on),
Hot Mic (`knowsOppHand` reveals opp hand for the CURRENT QUESTION + steal a card permanently).
Typo, Forgot, and Hot Mic all set `state.lastSabotage{victim,by,text,kind:'typo'|'forgot'|'hotmic'}`,
which drives a must-dismiss modal (+ banner) when the player is the victim — so a stolen card is as
visible as a typo'd word, not just a passing log line (the Hot Mic modal has no "your line now reads"
quote, since it's a hand steal, not a line edit). FREE power-ups don't cost the turn; others do.
**Soundbite REMOVED (2026-07):** the ×1.5 `nextMultiplier` power-up is gone from `POWERUPS` and
`REWARDS`, and the AI's soundbite heuristic dropped — it duplicated a Finisher's ×factor but added no
funny text (against the north star), doubled as a bland stall/waiting-move, and (the bug) applied its
multiplier AFTER `scoreStatement`'s clamp, so it **bypassed the statement cap** (a real
knockout-blow — an AI Soundbite scored +62 in a playtest loss). Replaced by more Finishers (funnier,
cap-respecting). The effect plumbing (`nextMultiplier`, the `applyPowerup` `soundbite` case) is left
**inert** (no card sets it) but now **cap-safe**: the multiplier is threaded into `scoreStatement`
(`ScoreOptions.multiplier`) and applied WITH the finisher factor **before** the clamp — so re-enabling
Soundbite can't reintroduce the cap-bypass. New shared finishers (`x_brave`/`x_thankme`/`x_micdrop`/
`x_oughtto`) + premium private ones (`r_x_science`/`r_x_polls`) added to INTENSIFIERS/REWARDS.

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

**Debate Consultant (2026-06) — between-debate deck refinement (the thinning slice of the deferred
shop).** At waypoints (`CONSULTANT_WAYPOINTS` = after debates 2 and 4) the player **cuts N cards →
drafts M** ("Sharpen your message"): #1 cut 5 → draft 1; #2 cut 8 → draft 2. The cut framing makes
thinning the *reward path*, not a chore, and a leaner deck draws its best cards more often (the fix
for the reward-dilution wall at opponents 4–5). Cut **any** cards (full agency, even rewards) — base
ids go to `run.removed`, threaded via `createGame({removedCards})` → `dealRound` filters the player's
private deck at build. Engine-safe: `ensureHandHasOpener` no-ops on a subjectless deck and the pool
guarantees subjects, so aggressive cuts can't soft-lock. UI: `runScreen:'consultant'` (cut stage,
`consultantSel` + `playerDeckDefs()`), then the draft reuses the reward modal with
`rewardMode:'consultant'` (drains → `startDebate` rebuilds with the cuts, → `'map'`); skippable.
`finishRewards` opens it from the post-win drain at a waypoint rung; `startDebate` is deferred until
it finishes so the new deck reflects the cuts + draft.

## Roadmap (triaged — DON'T build until the current scoring is playtested)
Ordered by priority/dependency. Engine work stays pure/seeded (no `Math.random` — thread the game
RNG); player-only meta lives in `ui/main.ts`. Source: `~/Downloads/debate_game_session_notes.md`.

**DONE (2026-06) — Per-card scoring ceiling ("headliners").** Powerful cards + long combo-chains raise
the per-line cap *in addition to* adding score, so strong cards feel strong instead of clipping. A new
optional `Card.ceiling` + a per-combo-junction bonus form `headroom` (bounded +15 → soft ≤50 / hard ≤65);
see the Scoring § Headliners note for the formula and rationale. Implemented in scoring.ts (dynamic
`softCap`/`hardCap`), `ceiling` threaded through the cards.ts builders, applied to `REWARDS` only; no base
rescale (SCALE stays 2.5, so ai.ts thresholds untouched). Tests: `describe('scoring — headliners …')`.
This was the prerequisite ("do this first") for the reward/shop card economy below — now unblocked.
Optional follow-on if playtest shows swingy/short debates: a per-question net-swing clamp on `|Δbar|`
(deliberately NOT built — independent of the ceiling).

**DONE (2026-06) — Card-award economy (mid-debate + post-debate achievements).** All player-only, all
in `ui/main.ts` (engine untouched). **Master throttle = the win-gate:** a loss runs `newRun()` which
wipes `run.bonus`, so an award only persists if the player wins that debate — post-debate awards are
granted at the win; mid-debate awards are *provisional* (a fresh `{...card, priv:true}` is pushed to
`game.player.deck` so it's drawable the rest of the current debate, AND the base def to `run.bonus`).
**Mid-debate (fire on the player's statement at `playerMove`'s `justResolved`; ≤1 of each type per
debate via `midAwardsFired`; shown after the round FX at the round-summary pause via `maybeShowMidAwards`):**
Played Your Whole Hand, Big Combo (`delta ≥ BIG_COMBO_DELTA 40` — a ceiling-break), and the three
self-sabotage gambles **Heel Turn** (`audienceInsulted && delta ≤ −15`), **Giant Gaffe** (`self_own &&
delta ≤ −12`), **Questionable Flattery** (`boost_opp && delta ≤ −10` — lower bar because boost_opp gets
no ×1.6 blunder mult). **Post-debate (`postAwardOffers()` in `checkDebateEnd`, stack as a series):**
Complete Knockout (`bar ≥ 100`), "You answered all the questions, Joe!" (`onTopic === statements`),
Artful Dodger (`offTopic === statements`), Mr. Nice Guy (`attackStmts === 0`), Comeback Kid (`worstBar
≤ −40`). Plumbing: per-debate `debateStats` (counts on-topic/off-topic/attack/brag/pander + worstBar,
reset in `startDebate`, fed from `player.lastReaction.breakdown` categories + `.offTopic` — no engine
event change needed); a `rewardQueue: RewardOffer[]` + `rewardMode: 'post'|'mid'` drains via the
existing reward-pick handler (post → advance rung; mid → resume debate). Thresholds are tunable consts
atop main.ts. **One mixed REWARDS pool** for every award (no card-type tiering). **No total cap** on
mid-debate awards yet (playtest). **Playtest watch:** Big Combo + Played Whole Hand are the only awards
that aren't self-limiting — cap those first if farmable. Final-rung win still skips the draft (victory).
Curse cards still shelved. **Draft dedup:** `pickRewards(n, exclude)` + `rollSeries` skip cards already
in `run.bonus` AND already offered earlier in the same series (so you can't be offered/stack the same
card — e.g. two Call-a-Recess offers), with a full-pool fallback if exclusions would leave < n.
**Reward power-ups** need the `power fx-<effect>` classes in the reward modal (not just `role-…`) to get
the dark action-card background. **One-time award hint:** the first card ever drafted (any award) shows a
`runScreen:'awardhint'` modal nudging the player to hunt for more (`awardHintSeen`, NOT reset on newRun);
`finishRewards()` is the shared post-drain continuation (advance rung / resume debate). **REWARDS expanded
(2026-06):** more headliner nouns/verbs, **private finishers** (premium — owned, can't be out-raced:
`r_x_pipe`/`r_x_idiot`/`r_x_votemany` + `r_x_science`/`r_x_polls`), and a drafted **Typo** action.

**P2 · large epic — Campaign donation economy + shop** (the long-deferred roguelike meta; needs its
own design pass + phasing). **Note:** the shop's deck-pruning half already shipped as the **Debate
Consultant** (cut N → draft M at two waypoints — see Campaign run §); this epic now adds the
*donation resource* + *buying specific cards* on top of (or merging with) that. Donations trickle in
per-statement by type, scaled by your **chosen
character's donor taste** (KNOWN to you) vs the **crowd's hidden taste** — the core win-vs-fund
tension. Self-owns *refund* donations (net loss); opponent insults / off-taste plays reduce the
trickle. Between debates, a **shop**: buy cards (priced by power) / remove cards (deck pruning).
Player-only (opponent donations never shown — they can't spend). Phase: accrual → shop buy/remove →
character select. Watch the **complexity budget** — decide if donations augment or partly replace
existing incentives.

**P2 · small (rides the shop/reward epics) — PRIVATE finishers.** Today every finisher lives in the
shared (contested) pool (`each(INTENSIFIERS)` in `buildSharedDeck`; the pool is capped at one via
`capPoolFinishers`), so the value of a finisher is gated by the race to grab it. A finisher in a
**private deck** is a different, stronger thing: it can't be stolen or out-raced, so it's a
*guaranteed* ×factor cap on a statement you've built (and it still uncaps you toward ±50). That makes
private finishers naturally **premium**: offer them as rare **`REWARDS`** picks, and/or as the
**most expensive shop buys** once the donation economy lands (price ∝ power — a guaranteed multiplier
is worth more than a contested one). Balance lever: a private finisher with no race risk may want a
slightly lower factor than the shared ones, or be scarce enough that you rarely hold two. Build with
the shop/reward work, not standalone. (Note: the end-move mechanic already supports this unchanged —
a finisher from the hand is offered the same way, only on a complete line.)

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

**DONE (2026-06) — Dual-role parenthetical asides (modifier ⇄ connector).** A coordinating aside like
"and I'm not making this up" now works BOTH as a post-nominal subject aside ("My opponent, and I'm not
making this up, naps…") AND as a clause-joining conjunction mid-line ("…fight a bear, and I'm not making
this up, my opponent naps…") — a playtester immediately tried the latter and it scored "confused". Done
**without** touching the end-move/finisher mechanic (these are `modifier` cards, not `intensifier`s):
author the aside with a `conj` (`md(..., { invariant: true, conj: 'and' })` — currently `m_trustme` &
`m_notmakingup`). The grammar already recognizes over **term-SETS**, so `termsAt` returns `[MOD, CCAND]`
for a `conj` modifier (`connTerm` helper, grammar.ts) and the Earley chart tries both; `segmentDetailed`
disambiguates by **position** — a `conj` modifier with `cur.preds.length > 0` (past the subject-aside
slot) is segmented as a connector, else as a normal aside. It combos like "and" (CCAND, reinforce) and
renders comma-set (morphology.ts). Tests in scoring.test.ts ("dual-role parenthetical"). To add more,
just give an invariant coordinating aside a `conj`. (The roadmap's "author as two separate cards"
alternative was avoided — one card serves both, which is what the player expects.)

**P2 · medium — "Setup" predicate-prefix cards that demand a completion (e.g. "is a corrupt jackass
who ___").** A new shape that's intensifier-like in that it **requires another card to finish** the
phrase — "My opponent **is a corrupt jackass who** wants to cancel Christmas" — but unlike a finisher
it ADDS attack score (it's a loaded relative-clause subject-extender, not just a ×multiplier). The
same logic generalizes to **bragging** ("am the only one with the guts to ___") and **pandering**
("stand with the hardworking folks who ___") sides. Mechanically this is close to the existing
**modifier** (post-nominal aside reusing predicate fields) but it (a) is *not* set off as an optional
aside — it's a mandatory connective that leaves the line incomplete until a predicate follows, and (b)
bakes its own sentiment that STACKS with the completing predicate (so the score is setup-sentiment +
completion, riding the combo). Grammar: likely a CLAUSE-internal production like `NP SETUP PRED`
(SETUP carries "is a … who"/relative-pronoun text + a baked side/sentiment). Open question: is this
just a `modifier` variant with `requiresPredicate:true`, or its own role? Decide against the modifier
direction-split rules (GOOD-direction asides fold into the clause's first contribution today).

**DONE (2026-06) — Achievements that grant BONUS reward picks.** Built as part of the card-award
economy DONE note above (the `rewardQueue` chains a win's base reward + every qualifying achievement as
a series of dialogs; the rung doesn't advance until the queue drains). Shipped: Complete Knockout,
"You answered all the questions, Joe!", Artful Dodger, Mr. Nice Guy, Comeback Kid. ("Used every card on
the board" was dropped in favor of the easier mid-debate **Played Your Whole Hand**.) The per-contribution
categories needed (attack/brag/pander) come free from `Reaction.breakdown` on `player.lastReaction` — no
`resolve`-event change was needed. Opponent never earns achievements.

**P2 · small/medium (rides the reward/shop epics) — New ACTION cards (power-ups) to offer as awards.**
`REWARDS` (cards.ts) is predicate/noun/connector today (funny private conjunctions were added 2026-06)
— no power-ups yet. A drafted power-up just needs a
`powerup` entry in `REWARDS`; it rides `run.bonus` → shuffled into the persistent private deck → drawn to
hand → plays like any pool/hand power-up (`applyPowerup` reads `p.hand`). **Each new effect = 4 spots:**
the `PowerEffect` union (types.ts), a def in `POWERUPS` (cards.ts), a `case` in `applyPowerup()`'s switch
(game.ts), and — only for *targeting* effects — a UI targeting mode (main.ts). Cards to add:
- **"Back to the Drawing Board"** — discard your private hand and **re-deal** it (like `search` but
  *replace*, not add). Low effort, non-targeting. (The per-question pool-refresh "Call a Recess" was
  removed in 2026-06 — see Game loop — so this hand-only *drafted* power-up is now the only re-deal in
  the game.) Decide free vs turn-cost.
- **"Hack Their Teleprompter"** (named to distinguish from **Teleprompter Typo**) — a super-buffed Typo
  that **replaces the opponent's ENTIRE in-progress statement** with one of yours. A **distinct** new effect
  (e.g. `typo_full`), NOT a Typo tweak — Typo (`bestTypoJam`, `jammed`, `lastSabotage`) only swaps the last
  word and leaves a recovery path; a full wipe has none, so balance it rare/expensive. Targeting ⇒ medium
  (reuse Typo's UI targeting + the `lastSabotage` modal plumbing).
- **"Winning Smile"** — sway the audience with a practiced smile: **not part of the statement**, raises your
  statement value by a **percentage**. Low effort — reuse the now-inert-but-cap-safe `nextMultiplier`
  plumbing (game.ts sets it; `scoreStatement`'s `multiplier` option applies it before the clamp). NOTE:
  this is effectively the removed Soundbite — before re-adding a bland ×mult power-up, reconsider whether
  it belongs (Soundbite was cut for duplicating a Finisher without the funny text). If added, it stacks
  with a Finisher (both multiply before the clamp) and is bounded by the cap.
- **"That's a lie!" / "Come on, man!" — a REACTIVE rebuttal** (playtester suggestion, 2026-06). A *defensive*
  interjection played **after the opponent finishes an attack** to **soften it** — reduce the delta that just
  landed against you (e.g. ×0.5 on the opponent's last attack clause, or a flat clawback). This is a NEW shape:
  every power-up today is played on **your own** turn before/while you build; a rebuttal triggers on the
  **opponent's** resolution, so it needs a reaction window (offer it during/just after the opponent's FX, before
  the round summary). New `PowerEffect` (e.g. `rebut`) + a `case` in `applyPowerup` that edits the opponent's
  just-scored delta + a UI prompt at the right moment. Decide: limited charges? does it work on audience-insult
  knock-on? AI use? Pairs thematically with the broadcast skin (a heckle from the other podium). Worth it because
  it gives the player **agency on defense** — right now you can only out-build, never blunt an incoming hit.
  ("Come on, man!" also exists as a **finisher** today — `x_comeon` — so the phrase is dual-purpose; if built,
  reserve "That's a lie!" for the rebuttal and keep "Come on, man!" as the finisher, or fork the wording.)
These are the first **power-up rewards**; good fit for the deferred **shop** (price ∝ power) alongside the
PRIVATE-finishers note above.

**P3 · trivial — Remove the on-topic card hint.** The green glow + "on topic ✓" tag (`cardHtml` in
ui/main.ts) is a **temporary debug aid** for catching mislabeled `topics`; once the data is trusted,
remove it so players learn to spot on-topic cards themselves.

**P3 · small — Varied reaction text.** `describe()` in scoring.ts returns one fixed line per
reaction tier ("the audience nods along", etc.), plus the single confused/ramble flavor strings — so
resolutions read identically across a debate. Give each tier a pool of phrasings (and the
confused/combo notes too), picked with the game RNG (deterministic). Pattern mirrors `Topic.questions`
(35 phrasings across 7 topics, picked per question — done). Cosmetic; pairs well with the juice pass.

**P2 · small — Sound (backlog).** Highest juice-per-effort thing left for a *debate* game and not yet
started: applause / groans / boos / a gavel on resolution, deterministic by reaction tier. Self-hosted
clips (static app — no external hosts). Pairs directly with the resolution-juice FX (`playResolutionFx`).

**P2 · medium — Shareability (backlog).** The absurd generated statements are inherently screenshot-bait
— a "share this line" / clean screenshot of a resolved statement is plausibly the whole growth engine and
doubles as playtest recruitment. Premature until the core loop + deck-building are proven, but cheap to
add later (render the judged line + reaction to a canvas/image).

**Platform — deferred (notes only).** Keep building the **github.io web demo**; revisit after the core
loop + deck-building are proven by playtest. Pro/con: **Web (current)** — zero-friction to play, instant
deploy, easy tester recruiting; weakest monetization, mobile real-estate limits. **Steam (buy+download)**
— clearest monetization + "real game" credibility + bigger screen; highest tester friction, only worth it
if people will pay. **itch.io (buy/PWYW)** — low-expectation way to ship and accept money; small audience.
**Phone app** — card games suit touch (the horizontal-scroll carousel is already touch-friendly); screen
real-estate is the hard problem (biggest layout rework). (Would've used Godot from scratch, but web's
deploy/playtest ease wins for now.)

**P2 · large — Graphics, animation & juice.** The UI is a functional prototype. Make it *feel* good:
character art / reaction faces (an opponent that looks embarrassed on a self-own), animated card
plays, donation/score tickers, audience reactions. Tied to this: properly **stage the opponent's
turn** — show the pool, "opponent's turn", the AI "thinking", then it picks a card (currently just an
`AI_DELAY` pause with "Your opponent is speaking…").

**DONE (2026-06) — resolution juice.** When a finished statement scores, its words **transiently**
bold/highlight as an **animated readout strip below** pops a chip per phrase (ATTACK/BRAG/PANDER/GAFFE/
INSULT/BLUNDER), the **combo** (⚡COMBO/CHAIN/PIVOT), a ⭐FINISHER (no number), and any OFF-TOPIC/RAMBLING/
Run-on flag — in sequence, then a **count-up** of the final delta (the only number — no per-card numbers, no
mid-statement scoring) + a magnitude-scaled **screen shake + cheer/boo flash**; click to fast-forward (skip
arms after a 500ms grace so an early click can't instakill the player's own animation).
**The statement reverts to plain single-color text after** (clean to share); the strip badges persist.
The round-summary headline is **varied** (`roundHeadline`). Driven by `reaction.breakdown`/flags (see
Scoring §); UI is `judgedSpeechHtml` + `fxStripHtml` + `roundHeadline` + `playResolutionFx` (ui/main.ts),
CSS under "resolution juice" in style.css. `crowdFavorite` is NOT surfaced (would leak hidden crowd taste).
NOT done: live preview while drafting (deliberately — keep the no-mid-statement-scoring rule); a
`displayBar` needle-lag so the needle rides *with* the count-up (today it rides immediately on render);
animating the opponent "thinking" stage; the broader per-tier reaction-phrasing pool (P3 below).

**DONE (2026-06) — first-question onboarding hints.** The very first question of the first debate
(`run.rung === 0` → `createGame({tutorial:true})` → `GameState.tutorial`, gated to `round === 1`)
teaches the core loop with animated glows, paired with the resolution juice:
- **Engine:** `dealRound` curates the Q1 **shared pool** (`buildTutorialPool` in game.ts) into a
  randomized "me-good AND opponent-bad (+ finisher)" toolkit — 2 self subjects, 2 opponent subjects,
  2 closed positive ("brag") verbs, 2 closed negative ("attack") verbs, an `and`, and one finisher
  (verbs/subjects vary each game for replay variety; the connector & finisher are safe because the Q1
  opponent never plays them, and 2-of-each avoids a dead-end if the AI grabs one). The hand is NOT
  replaced — the player builds from the POOL (teaches pool use, not a private gift) — but **power-ups
  are stripped from the Q1 hand** (backfilled with normal cards) to keep the first hand simple. Q1 topic
  is forced to **`jackass`** so the attack clause is on-topic (no OFF-TOPIC badge). `aiTurn`/`chooseMove`
  get a `tutorialSimple` mode (Q1 only): **no gaffe**, play the best **single clause** (subject–verb,
  no connectors/modifiers/finisher) then END immediately — so the player's combo clearly out-scores
  it (verified ~+30 vs ~+10 across seeds, combo every seed). Covered in tests/ai.test.ts.
- **UI (ui/main.ts):** the first turn opens with a one-time **welcome modal** ("Tap a subject card…",
  dismissed by "Got it!" → `tutorialIntroSeen`); after that the `.tutorial-banner` takes over.
  `tutorialStep()` walks subject → verb → connector → subject → verb → finisher → End based on the live
  line state; `currentHint` (set each render) drives a glowing `.hint` class + a wiggling **👉
  `.hint-hand`** icon on the matching pool/hand cards (and the End button) plus the banner. The banner
  **pops** (`.pop` added via rAF when `currentHint.text` changes vs `lastHintText` — rAF so it survives
  the double render() in a tick) to call attention each time the step advances. The finisher step reads "Play a Finisher to end strong — or tap End
  Statement" (the finisher IS an end-move; no "End after", no score-math language). Shown ONLY while
  building on Q1 of debate 1; the player can ignore it. CSS under "onboarding hints".
  Note Q1 is player-first (`round % 2 === 1`), and play **alternates card-by-card** (`advanceTurn`
  on every `take`) until a speaker ends — the hints reflect the player's line on each of their turns.

**DONE (2026-06) — next-question card.** Each new question opens with a modal (`questionCardHtml`,
`pendingQuestionCard` in ui/main.ts) so the question gets its own un-ignorable moment in the busy UI:
the **question front-and-center** + the two caricature portraits with **in-character banter**
(`questionCommentary`, varied by who's ahead, deterministic per question), dismissed by "Let's debate ▶"
(`#questionGo` → clears the flag → `driveAI`). Triggered by **Next Question** (`#next`, defers driveAI)
and **Begin** at the start of each debate — EXCEPT the tutorial's Q1, which keeps its own welcome modal.

**DONE (2026-06) — visual skin.** Live-TV-debate broadcast theme: engraved title, audience needle,
two-podium stage with text **teleprompters**, **parchment cards** (generated frame texture +
grammatical role banners: Noun/Verb/Connector/Aside/Finisher/Action), self-hosted fonts (Cinzel/EB
Garamond/Oswald), pressable controls. **Caricature opponent portraits with mood states** (6 opponents ×
confident/nervous/embarrassed, driven by `oppMood()` off score+gaffes; filename-keyed
`${oppId}-${mood}.webp` via `import.meta.glob`). Art is generated offline by `scripts/genart.mjs`
(`npm run genart`, gpt-image-2, key in gitignored `.env`, auto PNG→WebP) and committed under
`src/ui/art/`. Card/hand/pool rows are single-row with horizontal scroll (no vertical scroll on desktop).
**Layout (top→bottom):** title/run-pill, audience needle, two-podium stage (each podium shows portrait +
name + mood + **approval %**), then the **question** (`Question N/M` + topic, moved BELOW the stage, just
above the cards), then pool + hand. Between questions (`awaitingNext`) the card area is replaced by a
compact **round-summary** panel (standing + the Next Question button) — no scrolling. **Hot Mic steal** is
a **modal dialog** (`hotmic-modal`), not an inline list. **Player character-select** is live (tutorial → choose candidate → ladder): 3 candidates
(maverick/stateswoman/veteran), shown in the YOU podium as a single **confident** portrait —
**no mood-switching for the player** (only opponents react by mood). Rationale: the opponents'
"confident" is already a caricature so their moods stay on-model, but the flattering player faces
diverge across the distorted nervous/embarrassed, reading as a different person. Player mood art still
exists (`player-<id>-{nervous,embarrassed}.webp`) and `playerMood()` is easy to re-add if wanted.
(`PLAYER_CHARACTERS` + the `'select'` runScreen in ui/main.ts; `run.character` persists per run.)

**Remaining juice sub-items:** (1) **card carousel** — swipe/scroll the pool & hand with CSS
scroll-snap + an edge **peek/fade** cue (gradient mask showing more cards off either side); touch-swipe
works natively on `overflow-x`. (2) A **cleaner card frame** (border closer to the edge / larger clear
center) so long card text needs less padding — current frame's inset border forces wide `.ctext`
padding. Declined for now: viewport auto-scale to force zero-scroll on tiny laptops (horizontal-scroll +
desktop fit deemed good enough).

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
- **Sentiment must track VERBAL PUNCH, not just category (2026-07 re-tier).** A funnier/more vivid
  insult should out-score a bland one, so the player learns to read the crowd by *feel* (no scores on
  cards — never make it a spreadsheet). Attack/insult tiers: **−1 bland filler** ("weak and out of
  touch", "can't be trusted", "should be ashamed", "will say anything to get elected"), **−2 standard**
  ("national disgrace", "raise your taxes", "lies to your face"), **−3 vivid/absurd** ("secretly eats
  babies", "kicks puppies", "toll booth on your driveway", "monthly subscription for freedom"; all
  SIG_ATTACK zingers are −3), **−4 reward-tier**. Praise/pander mirror it (+1..+4). Author new cards to
  this scale; the −1 filler doubles as obvious Debate-Consultant cut fodder.
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
- **Modals can stack:** `render()` emits several independent `modal-backdrop` blocks in one pass
  (runScreen modal, question card, hot-mic, sabotage, …). A debate-end screen (defeat/result/reward)
  does NOT auto-suppress the others — each must self-guard. The sabotage modal lacked `&& !game.winner`
  and stacked on the defeat screen ("multiple dialogs when I lose", fixed 2026-06). Any new modal that
  could be live at a debate end must guard on `!game.winner`/`!runScreen`.
- **End screen is set AFTER the resolution FX, not before:** `checkDebateEnd()` (which sets
  `runScreen` to result/defeat) is called at the END of `playRoundFx`, not in playerMove/driveAI before
  it. Otherwise the defeat/result screen sits OVER the count-up/shake/chip animation and the board
  re-renders churn behind it ("jumping around and flickering after I lose", fixed 2026-06). The panel
  hold (`fxHoldSummary` → "votes are coming in…") now also covers the debate-ending round (the engine
  sets `game.winner` instead of `awaitingNext` there), so the card area doesn't flash during the final
  FX. Keep `checkDebateEnd` after the animation if you touch this.
