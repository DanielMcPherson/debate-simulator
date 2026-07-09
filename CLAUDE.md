# CLAUDE.md — Debate Simulator

A browser prototype of a card-drafting debate game (inspired by *Oh...Sir!! The Insult
Simulator* + *Slay the Spire*). You build absurd political statements one chunk at a time;
an audience-reaction scorebar decides who wins. There's a roguelike campaign on top.

This file orients a new session. Player-facing rules live in `README.md`; sharing/deploy
steps in `SHARING.md`; the commercialization strategy (platforms, audio/VA plan, marketing,
monetization) in `RELEASE_ROADMAP.md` — **local-only + gitignored** (repo is public), so its
absence on another machine is expected, not an error.

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
- `connector` — `conj`: **ADDITIVE connectors coordinate bare predicates** under a shared, elided subject
  ("My opponent kicks puppies **and** eats babies" — one clause, one subject) OR join clauses. Additive =
  plain `and` (CCAND) **and** any `and…` connector flagged `Card.elides` (→ CCOORD) — currently just
  **`and therefore`** ("…will ban updates **and therefore** will keep us safe" is one elided clause, 2026-07).
  **Every NON-additive conjunction is clause-ONLY** and needs its own subject: `but`/`so`/`which is why`/…
  → CJOIN (joins clauses only — CJOIN was removed from the `PREDS` rules 2026-07, so "…kicks puppies but
  eats babies" is *confused*: a human says "…but **I** protect them"; this stops the AI emitting weird
  elided fragments like "…so bench presses fishing boats"), and **`because` → CBEC** (subordinates a full
  clause; "…a jackass because wants to raise taxes" is *confused*). **`elides` is PER-CARD, orthogonal to
  the `conj` combo tier:** `so` and `which is why` share the `and therefore` logic tier but are NOT additive,
  so they stay clause-only (`c_so`/`c_which` carry NO `elides`). CCOORD differs from CCAND in that it does
  NOT coordinate noun phrases — only plain `and` builds a compound subject/object. So CJOIN and CBEC are
  grammatically identical (clause-join only); their only difference is the combo tier keyed off `conj` in
  `scoring.ts` (`and therefore`/`because` = logic ×1.30, `but` = pivot ×1.40). An elided `and therefore`
  earns that same logic combo (the junction's `conj` drives the tier, not whether it elided). `period` is the **free** clause break, but limited to **one per statement**
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
  conjunction mid-line (see the "Dual-role parenthetical asides" DONE note); `m_trustme`/`m_notmakingup`
  (**reward-only since 2026-07** — an aside + ×1.25-connector in one slot dominated plain "and" when
  face-up in the shared pool, so they moved to `REWARDS`; the mechanic itself is deck-agnostic).
- `intensifier` — sentence-final finisher (`factor` multiplies the whole statement). It is an
  **end-move**: only offered/legal when the line is already a complete sentence (grammar `S → INT`),
  and playing it (a `take`) appends the flourish, resolves, and ends the turn — there is **no held
  state** (the old `heldFinisher` is gone). A finisher is contested in the shared pool, so building a
  bigger line before cashing it in risks the opponent grabbing it first.
- `powerup` — one-shot action card (`effect`), never part of the sentence.

Grammar: `TOP→S [INT]; S→CLAUSE | S (CCAND|CJOIN|CBEC|CPERIOD) CLAUSE; CLAUSE→SUBJ [MODS] PREDS;
SUBJ→NP | SUBJ CCAND NP | SUBJ MODS CCAND NP; MODS→MOD | MODS MOD; PREDS→PRED | PREDS CCAND
PRED | PREDS CCOORD PRED; PRED→PC | PO OBJ; OBJ→NP | OBJ CCAND NP`. Terms: `and`→CCAND,
`but`/`so`/`which is why`→CJOIN, `because`→**CBEC**, `period`→CPERIOD, and an ADDITIVE `and…` connector
flagged `Card.elides` (currently just **`and therefore`**)→**CCOORD** (in addition to its CJOIN term).
**Additive connectors (CCAND + CCOORD) coordinate bare predicates** (the `PREDS` rule); `CJOIN`/`CBEC`/
`CPERIOD` are **clause-ONLY** — absent from PREDS, so each needs its own subject (2026-07: `CJOIN` was
removed from PREDS, so `but`/`so`/`which is why` can no longer elide a shared subject; `and therefore` was
re-admitted via CCOORD, since it's a genuine additive "and…" that elides naturally — its non-additive
tier-mates `so`/`which is why` do NOT). CCOORD does NOT coordinate NPs (compound subjects/objects stay
`and`-only). **NP coordination (2026-07):** plain `and` (ONLY `and`) also joins noun phrases into a
**compound subject** ("Satan and the lobbyists want to silence free speech" — conjugates PLURAL,
person = lowest present so "my opponent and I are…") or a **compound object** ("…wants to destroy
Main Street and our children") — both were natural player builds that used to score "confused". The
segmenter (`coordNext` in `segmentDetailed`) disambiguates object-coordination from a new clause by
lookahead: an `and`-NP followed by its own predicate/modifier opens a clause ("…and our children
kick puppies" stays two clauses). Coordinated NPs land in `Clause.coSubjects` /
`PredInstance.coObjects` (`CoordNP {card, idx, connIdx}`); a connector-LESS second NP is still a
stray (nearest-noun fallback, NOT a compound — else the blunder punch-through would hammer word
salad as a crowd insult the player never made). Validity depends only on the **role sequence**, so `grammar.ts`
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
(no pandering-your-way-back); a **self-own aside reads as `confused`** when net ≤0. **Coordinated
NPs (2026-07) each contribute:** a compound subject asserts the clause's FIRST predicate of every
subject on its OWN target (so "my opponent and our children kick puppies" still fires `insult_aud`
and poisons the line); a compound object scores the predicate once per object by that object's own
sentiment. Each extra NP is a contribution `joinedByPrev:'and'` (+ junction `connIdx`), so genuinely
distinct sides that both help you can combo on the "and" ("I and the American people are true
patriots" ⚡), while a same-side pile-on ("Satan and the lobbyists and…") just decay-stacks (~1.3×
one subject — a bump, never a 2× farm; drawing a second verb still beats listing nouns). Coord
contributions are flagged `Contrib.coord` and excluded from `residualCount`, so a one-sentence
villain list can't trip RAMBLING. Modifier asides still score against the PRIMARY subject
(documented simplification; rendering agrees with the noun the aside follows). **Combos are connector-fit** (`aggregate()` in scoring.ts):
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
(`STYLE_BONUS` via `dominantCategory`). Plan objectives: `'best'` (default), `'gaffe'` (nerves —
the SHORTEST clear self-own, null if none reachable), and `'confess'` (Under Oath — MINIMIZE delta
over ALL completions at full `maxExtend`, tie-break most-negative then LONGEST: a compelled
confession is a long, spectacular unburdening, and deeper opponents — the boss — confess more
eloquently; never rejects positive lines, so on a self-own-less board it degrades to the
least-good statement instead of returning null). Power-up heuristics: Teleprompter Typo **only** when
`bestTypoJam` finds a pool card that completes the player's line into a real self-own (never
gibberish); Hot Mic to steal the player's power-up; Search situationally; never Plant.

## Power-ups (`Move{kind:'power'}`)
Search (draw 5, FREE), Filibuster (adds 3 connectors, FREE),
Plant (`knowsCrowd`, reveal crowd for the debate, **FREE** — an info reveal like Search/Filibuster,
2026-07-06: doesn't cost the turn), Teleprompter Typo (**REPLACE** the opponent's
last card — pop it, push a card you choose; player targets, AI auto-picks the swap forcing the worst
self-own via `bestTypoJam`, which searches *replacements* of the victim's last card; victim recovers
by tacking on another sentence — a `but` pivot helps most), Forgot My Line (pop the opponent's last line card — discarded, not returned;
player just plays it, AI plays it to wreck a strong/long line the player is sitting on),
Hot Mic (`knowsOppHand` reveals opp hand for the CURRENT QUESTION + steal a card permanently).
**Under Oath (⚖️ `pw_underoath`, effect `oath`, 2026-07) — the scripted pre-boss story card:** "this
question, your opponent cannot lie." Sets the OPPONENT's `PlayerState.underOath` for the CURRENT
question (reset in `dealRound`; wasted/disabled once they've resolved — but VALID before they start
speaking, so no empty-line gate). While set, `aiTurn` **skips the gaffe roll** (so the roll can't
overwrite it — also bypasses the boss's `gaffeChance` 0, the whole point) and passes
`compelled` to `chooseMove`, which plans objective **`'confess'`** and plays **no power-ups** (the
`power()` helper returns undefined when compelled — required, not cosmetic: with no completion
reachable `best` is null and Search would otherwise let it draw its way out). Costs the turn.
**Standalone def** in cards.ts — NOT in `POWERUPS` (seeds every deck), `REWARDS` (random drafts), or
`ALL` (tutorial-pool sampling); `findDef` has an explicit fallback for it. Granted ONLY by the
**guaranteed scripted award after winning debate 4** (see Campaign run §). The AI never plays it
(it only plays effects it explicitly checks — meaningless vs a human anyway), its Hot Mic **neither
baits on it nor auto-steals it** (ai.ts bait check + the game.ts steal `rank` both exclude
`effect:'oath'` — stealing the story card would delete it from the run), and the consultant **trim
grid exempts it** (cutting the boss key right after "you're going to need it!" is a trap, not
agency). A compelled negative resolution logs an `OATH_TELLS` line and stamps `underOath` on the
resolve event. Tests: tests/oath.test.ts.
Typo, Forgot, and Hot Mic all set `state.lastSabotage{victim,by,text,kind:'typo'|'forgot'|'hotmic'}`,
which drives a must-dismiss modal (+ banner) when the player is the victim — so a stolen card is as
visible as a typo'd word, not just a passing log line (the Hot Mic modal has no "your line now reads"
quote, since it's a hand steal, not a line edit). FREE power-ups don't cost the turn; others do.
**Sabotage modals QUEUE (2026-07):** `state.lastSabotage` is a single slot, so a burst of sabotages
(e.g. a Hot Mic steal immediately followed by a Typo) used to OVERWRITE the slot and swallow the
earlier modal — the player never saw their card get stolen. The UI now keeps a `sabotageQueue`
(main.ts): each newly-seen player-victim `lastSabotage` is enqueued (deduped by object identity in
render), the must-dismiss modal shows the HEAD, and dismissing pops it — so every sabotage gets its
own modal, none silently lost. The inline banner still lingers on the latest `lastSabotage`. Hot Mic
steals now also `logEvent('sabotage', {kind:'hotmic'})` (were previously only a bare `power` line — the
theft was invisible in the debug log).
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

**Debate Consultant (2026-06; CLEAN SPLIT + escalating picks 2026-07) — between-debate deck
refinement (the thinning + upgrading slice of the deferred shop).** At waypoints
(`CONSULTANT_WAYPOINTS` = after debates 2, 4, and 5 — the last is boss prep) the player picks
**`picks` services per visit — 1, then 2, then all 3** — each service usable once per visit
(`consultant.picksLeft`/`used`; all three funnel through `consultantServiceDone`, so mid-visit
changes are live for the next service — a just-drafted card can be punched up the same visit).
Each service is exactly ONE deck-building axis (Daniel's redesign, 2026-07: the old trim bundled
a cut AND a draft; New Talking Points paid entirely in the run's most abundant resource — new
cards already flow from win drafts + awards — so it read as redundant):
- **✂️ Trim the Stump Speech** — cut `cut` cards (5), nothing back. Cut **any** cards (full
  agency, even rewards) — base ids go to `run.removed`, threaded via `createGame({removedCards})`
  → `dealRound` filters the player's private deck at build. Engine-safe: `ensureHandHasOpener`
  no-ops on a subjectless deck and the pool guarantees subjects, so aggressive cuts can't
  soft-lock. Still the fix for the reward-dilution wall at opponents 4–5.
- **🗣️ New Talking Points** — draft `newCards` (3), no cut; straight to the reward modal.
  Each offer **guarantees ≥1 card with an authored upgrade chain** (post-`rollSeries` swap-in in
  `consultantNewTalkingPoints`) — "material worth investing in": feeds Punch Up and distinguishes
  the service from the plain win draft (only 15/75 REWARDS carry a chain, so a raw 3-roll misses
  ~half the time).
- **⚡ Punch Up the Zingers** — upgrade `upgrades` cards (2) to their next authored tier (see
  **card upgrades** in the roadmap DONE note below). Grid shows each card's next-tier text on its
  face; only cards with a chain appear.
**Count-tuning principle (Daniel, 2026-07): per-service counts are FLAT (5/3/2 every visit) —
escalation lives entirely in `picks`.** The numbers exist to make every option TEMPTING, not to
price services against their true value or steer toward the optimal pick (an asymmetric
progression reads as the designer's thumb on the scale): the least-sexy service (trim) wears the
biggest number, the strongest-per-unit (targeted upgrades) the smallest, so "3 new cards vs 2
upgrades" stays a real-looking choice even if a spreadsheet prefers upgrades. A stable menu is
also learnable. If playtest wants more late power, bump all three numbers uniformly. **Skip ends
the whole visit**, forfeiting remaining picks (completed services keep their effects). UI: `runScreen:'consultant'` (`consultantSel` — ALWAYS keyed by the ORIGINAL base id —
+ `playerDeckDefs()`, which returns `{def, origId}` pairs with `def` resolved to the current
tier); drafts reuse the reward modal with `rewardMode:'consultant'` (drain →
`consultantServiceDone('newcards')`). `finishRewards` opens the consultant from the post-win
drain at a waypoint rung; `startDebate` is deferred until the WHOLE visit ends so the rebuilt
deck reflects every service. NOTE: the tiered-campaign spec's consultant line (waypoints after
rungs 4/8/11, upgrade picks 3/4/5) predates this redesign — reconcile per-visit counts when that
ladder lands, and re-run `scripts/sim-balance.mjs` expF (its player model assumed the old
one-service consultant).

**Under Oath scripted award (2026-07):** winning debate 4 (`UNDER_OATH_RUNG = 3` — checkDebateEnd
runs PRE-increment; `finishRewards` bumps the rung after the queue drains) unshifts a fixed
single-choice `RewardOffer` ("⚖️ Special card unlocked! … You're going to need it!") granting the
standalone `UNDER_OATH` card (see Power-ups §) — guaranteed, so every player holds the
boss-cracker for the last two debates (still has to DRAW it in-debate; that's the intended
tension). Two gotchas encoded there: (1) the offer is unshifted **AFTER the mystery-upgrade gamble
block**, which mutates `rewardQueue[0]` and splices a choice — running first it could delete the
lone Under Oath tile; (2) the reward pick-handler resolves the clicked card **from the offer's own
`choices`** (was `REWARDS.find`, which silently no-ops for a non-REWARDS card). Guarded by
`run.bonus` not already containing it (a loss wipes bonus+rung together, so re-earning next run is
automatic). Deliberately re-pointable to a 4-way-debate prize later without redesign.

## Commercialization track (2026-07) — decisions that constrain dev work
Full strategy (with reasoning, marketing phases, pricing) lives in `RELEASE_ROADMAP.md`
(local-only, gitignored — repo is public). The *decisions* future sessions must respect:
- **Stay on the TS/web stack — no engine rewrite for any target platform.** Steam ships as
  an **Electron or Tauri wrapper** (`steamworks.js` / Tauri plugin for achievements + cloud
  saves + lobbies); mobile ships via **Capacitor** (the cost is the phone-layout rework, not
  tooling). Console is the only rewrite trigger and is out of scope. Corollary: keep the
  engine pure and the app static/backend-free — that's what makes the ports cheap.
- **The web build is the free demo/funnel, not the product.** Paid release on Steam + itch
  ($4.99–7.99 tier); mobile premium later. **No F2P / card-pack IAP** — it would distort the
  deck-building design. Never build a web backend (see PvP roadmap: online = Steam-only).
- **Translation is explicitly out of scope** — grammar/morphology/jokes are per-language
  rebuilds, not string tables. Don't design for it unless US-English finds an audience.
- **NAME CHOSEN (2026-07-05): "My Opponent Kicks Puppies"** (statement-as-title; capsule
  subtitle "— A Debate Simulator" for SEO; tagline candidate "…and I approved this message").
  Vetted: no Steam/board-game title collision; myopponentkickspuppies.com UNREGISTERED as of
  2026-07-05. Runner-up if a late collision surfaces: "Let Me Finish!" (letmefinishgame.com
  free). **Daniel's manual follow-ups before the Steam Coming-Soon page:** USPTO TESS search
  (Class 9/41), register the domain + social handles. Keep "Debate Simulator" as the repo/dev
  name until the Steam page exists. **The in-game UI already shows the real name** (2026-07-05):
  browser-tab title (index.html), the h1 masthead + a `.title-sub` "A Debate Simulator" genre
  subtitle (main.ts/style.css — masthead font clamps with viewport so the long name never
  wraps), and the How-to-Debate tutorial modal (whose first example line is, conveniently, the
  title).
- **AI-generated content requires Steam disclosure** (and costs some audience/curators): the
  gpt-image-2 portraits and any TTS voice clips. Fine for prototyping; any *shipping*
  decision about them is Daniel's, made deliberately — flag it, don't default into it.
- **Hosting/playtest-distribution plan (2026-07-05, NOT yet executed — RELEASE_ROADMAP.md §9):**
  keep the github.io URL alive until the friends who have it deliver feedback (redirect later,
  never a sudden 404); the stranger-ready demo = open (no password) on the real domain via
  Cloudflare Pages + a public itch.io page, same `dist/`, with the debate-end telemetry adapter
  landing BEFORE stranger recruitment; repo goes private only after the redirect grace window.

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

**DONE (2026-07) — "That's the Name of the Game!" easter-egg award.** A rare mid-debate award for a
statement that is EXACTLY the game's namesake — "My opponent kicks puppies" and nothing else.
UI-only (`evalMidAwards` in main.ts), reuses the whole mid-award path (fires `pendingMid` → normal
`REWARDS` pick; the *achievement* is the payoff, not a bespoke card). Gate: `r.grammatical` AND
`game.player.line` is exactly `[s_opp, p_kick_pup]` by base id (`id.split('#')[0]`) — a connector/
finisher/extra card fails both the `length===2` and `grammatical` guards, so it won't false-fire.
It's a **luck** award (needs both cards dealt to the shared pool AND grabbed before the AI — a
feature, not a bug: a delightful rare, not a grind). **GAME-NAME COUPLING (caveat):** the trigger
ids live in a single `NAME_OF_THE_GAME` const with a loud comment — if the game is ever renamed,
delete that const + its `fire()`. Also a soft constraint on future card-economy work: `s_opp` and
`p_kick_pup` must both stay in the SHARED (contested) pool (`buildSharedDeck`, deck.ts).

**DONE (2026-07) — Card upgrades ("Punch Up the Zingers").** The third deck-building axis (besides
add + cut): upgrade a card into an authored, funnier, stronger version — build toward one or two
maxed super-cards or spread upgrades wide. **Data:** `UPGRADES: Record<id, Card>` in cards.ts (key =
current-tier id → next-tier def, chains compose; registered via the `chain()` helper, which stamps
`Card.tier` from position — drives the +/++ badge in `cardFace`). Upgraded ids are `<origId>_t1/_t2`;
defs are **NOT in `ALL`** (they'd leak into `buildTutorialPool`'s ALL-sampling; `findDef` has a
separate `UPGRADE_DEFS` fallback). Stat curve: SIG pred ±3 → t1 ±4/ceil 4 → t2 ±5/ceil 6; SIG subj
1.3 → 1.6/ceil 3 → 1.9/ceil 5; upgradeable REWARDS preds run ±5/ceil 6 → ±6/ceil 8 — the
"draft a reward, punch it up into a super-card" arc. **Authoring rule (Daniel, hard-learned):** an
upgrade is a strictly stronger NEW joke in the same slot (insult → harder insult) — NEVER the base
premise with more words tacked on; a first machine-authored pass that padded premises was rejected
wholesale. All live chain texts are **Daniel's** (daniel-upgrades.md, 2026-07): 78 chains / 153
defs, most TWO tiers deep — all SIG predicates/subjects/objects, the 4 default `subs`, 15 reward
predicates. Not every card upgrades (the upgrade dialog lists ONLY cards with a chain). Ceiling
stays bounded by HEADROOM_MAX so no chain enables a knockout; a mis-played upgraded card self-owns
harder (intended double-edge). His pass also cut 6 flat REWARDS (r_inventweekend, r_everylaw,
r_m_morse, r_onlycrime_self, r_raccoons_opp, r_crowd_onhold) and added `p_ikea` (a SIG_BRAG authored
together with its chain — the model for future upgrade-first card design). **Engine:** `run.upgrades: Record<origBaseId,
tier>` → `createGame({upgrades})` → `dealRound` maps each built card through `resolveTier` AFTER the
removed-cards filter (player only — relax the `p.id === 'player'` guard to give bosses upgraded
decks later). **UI:** consultant service (see Campaign run §) + sometimes (30%,
`UPGRADE_OFFER_CHANCE`) the post-win draft swaps one choice for a **"⚡ Punch up a random card"**
mystery tile → applies immediately → `'upgradereveal'` before→after modal, then the reward queue
drains on. Invariant: `run.removed`/`run.upgrades`/`consultantSel` are all keyed by the ORIGINAL
base id. Tests: tests/upgrade.test.ts (deck mapping + chain-data integrity incl. leak guard).

**P2 · medium — CURATE the upgrade pool (direction REVERSED after first playtest, 2026-07):
fewer, stronger upgrades — not more.** The original plan was to extend chains across the rest of
the REWARDS pool (15 reward predicates have chains; the other ~15 predicates, all reward NPs, and
all reward asides don't — Daniel ran out of steam authoring them). First playtest flipped that:
with 78 chains the Punch-Up grid is **an overwhelming list to scroll through**, and stretching for
coverage produces so-so upgrades. **A handful of really strong, focused upgrades beats broad
coverage** — don't author more chains just to fill the coverage list. Directions (Daniel decides):
(a) prune the weakest existing chains down to the memorable ones; (b) UI relief without cutting
content — offer a random SUBSET of K upgradeable cards per consultant visit (mirrors the reward
draft; adds run variety and makes each visit a decision, not a catalog scroll); (c) when new reward
cards are wanted, **design them WITH their upgrade path from the start** (`p_ikea` in SIG_BRAG is
the model) rather than retrofitting. Chainless cards are now a deliberate tier, not a gap — the
upgrade dialog already shows only cards with a chain.

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
a finisher from the hand is offered the same way, only on a complete line.) **Update (2026-07-06):
OPPONENTS get one private signature finisher each** per the voice-bible decision (see the
opponent-specific signature cards item / `OPPONENT_VOICES.md`) — their catchphrase mic-drop. That
raises opponent scoring ladder-wide, which makes THIS item (player private finishers via
REWARDS/shop) the counterweight: buff the player economy to match, never pull opponents down.

**DONE (2026-06) — Gaffe/nerves difficulty system.** Each `Opponent` has a `gaffeChance` (falls up
the ladder: rookie 0.45 → boss 0) and `nervousOf` triggers (`attacked`/`pander`/`self_brag`) that
raise it when the player lands a big matching statement — the opponent's hidden tell. `ai.ts`:
`aiTurn` (RNG-aware entry; rolls the gaffe via `gameRng`) → `chooseMove` with `gaffing` (build the
**shortest clear self-own** via `plan(objective:'gaffe')` — a punchy howler like "Our veterans are a
national disgrace", not a mushy −2) + `restrainPower` (rookies hold back Typo/Forgot/Hot Mic).
Resolve adds a comedic "tell" log line. Opp 1 is a verified Glass Joe.

**P1 · medium — Make the BOSS actually hard — SPEC'D BY SIMULATION (2026-07 balance study).**
Harness: **`scripts/sim-balance.mjs`** (`npx vite-node scripts/sim-balance.mjs expA|expB|expC|expD|expE 100`)
— deterministic, seeded; AI side is the real `aiTurn` (gaffes/nerves/power-ups); the player is a
proxy driving the AI's own `plan()` (crowd-blind, mirrors Typo/Forgot/Search). Absolute win rates
are proxies — **relative differences are the signal**. Re-run it after any scoring/card change.
N=100/config findings, several of which **overturn this item's old diagnosis**:
- **Planning depth (`maxExtend`) points DOWNHILL past ~4–5 — for BOTH sides — but NOT because
  long statements are bad.** Depth is a per-turn REPLANNING horizon, not statement length:
  measured at the boss, ext 4 and ext 6 build near-identical lines (avg 5.65 vs 5.76 cards, same
  sabotage exposure) — a shallow planner still chains long compound statements one good step at a
  time. The deep planner loses ~2 delta/statement because it commits toward distant completions
  whose contested pool pieces get taken mid-build (ambitious-but-fragile); the shallow one only
  chases value already within reach and re-extends from what survived (greedy-but-robust). Player
  proxy at ext 4 beats ext 6 at every rung (vs boss: 73% vs 43% win); the BOSS at ext 4 is ~20 pts
  HARDER than at its current ext 6 (54% vs 73% player win vs a default-deck ext-4 player). The old
  "cap flattens depth" note was half right — extra depth isn't just flat at the top, it's actively
  counterproductive. **No tension with the design north star:** long lines built incrementally are
  exactly as strong as ever; it's far-ahead commitment to specific contested cards that's fragile.
- **Raw reward-card injection into the AI deck is noise** (boss 64%→60% from +0→+6 cards; its avg
  statement cap-clips at ~30–31). **Upgraded tiers are what bite** — they carry `ceiling` headroom:
  +6 rewards AND 9 upgrade tier-steps → boss 64%→46%, avg statement 34.3.
- **Player deck progression only matters at the top** (boss 43%→64% at ext 6; mid-ladder unmoved —
  both sides saturate the cap there). The "deck-build to beat the boss" arc already exists; the
  boss is just too soft for it to be necessary.
- **Rungs 4/5 are mechanically near-identical** (same ext 6, same `attack`-style deck; gaffe 0.05
  vs 0.02 barely fires). The playtest "rung 5 wall" did NOT reproduce (rung 5 ≈ rung 4 ≈ 65–75%) —
  likely variance/human factors, not a design cliff. Differentiate them (below).
- Gaffe curve carries rungs 1–3 exactly as intended (2.0 → 0.8 gaffes/debate ⇒ 100% → ~65% win).

**IMPLEMENTATION SUPERSEDED (2026-07): the per-rung recipe now lives in the TIERED CAMPAIGN spec
(next item) — the findings above remain the reference.** The original 6-rung spec (`expE`: boss =
ext 4 + full-mirror deck ⇒ 27% proxy win on default deck / 47% on full progression) became rung
T3.4 of the tiered ladder. Open follow-ups (NOT spec'd — need a design pass): if playtest wants the
final boss meaner still, use levers the cap can't clip — boss plans crowd-aware ("reads the room";
thematic, uses the existing hidden-crowd plumbing), guaranteed sabotage cards in the boss deck
(sabotage bypasses the cap and is what actually punishes long player lines), optional starting-bar
handicap. `comboSkill`/`cardGreed` AI knobs remain open but are likely cap-clipped too.

**P1 · large — TIERED CAMPAIGN: 12 rungs in 3 Punch-Out-style tiers (DESIGN PASS DONE 2026-07 —
sim-validated, ready to implement; Daniel/Fable).** Replaces the 6-rung ladder with **3 tiers × 4
debates — City Hall → The Primary → The General** (working names) per the release roadmap's paid-
release content bar. **Rhythm:** each tier = breather → climb → climb → tier boss; a new tier's
breather is deliberately easier than the prior tier's boss (a moment to relax, trounce someone, and
draft before stepping up) but never rookie-easy. **Difficulty philosophy (Daniel's calls, 2026-07):**
target = "a skilled human beats the full campaign most of the time" — Daniel's own play is the
litmus test until dedicated playtesters exist; top rungs MAY temporarily outpace humans while
deck-building content catches up (buff the player economy to close the gap, NEVER dumb down the
boss). Roguelike full reset on loss stays (new default deck, try a different build).
**The tuned ladder (sim `expF`, N=100, vs an ext-4 progression proxy; re-run after scoring/card
changes). gaffe/ext are the opponent's; boost/upg = reward cards injected into its deck / upgrade
tier-steps applied to it; win% = proxy player win rate (bar = avg final needle):**
```
rung slot         opponent               gaffe ext boost/upg  win% (bar)
 1   T1 breather  Gov. Patty Pander      .45   3   —          100  (+98)
 2   T1 climb     NEW Hugh Kissbaby      .25   3   —           90  (+75)
 3   T1 climb     Sen. Blowhard          .15   4   —           91  (+59)
 4   T1 BOSS      Mayor Buck Passer      .10   4   —           69  (+30)
 5   T2 breather  NEW Chip Vainwright    .15   4   —           90  (+64)
 6   T2 climb     Rep. Dirk Smearwell    .05   4   +4/2        82  (+45)
 7   T2 climb     NEW Sal Mudslinger     .05   4   +4/4        74  (+33)
 8   T2 BOSS      Justice Vera Slander   0     4   +6/6        54  (+11)
 9   T3 breather  NEW Fay Weathervane    .10   4   +2/4        69  (+32)
10   T3 climb     NEW Vic Torpedo        0     4   +6/9        61  (+15)
11   T3 climb     NEW Sterling Landslide 0     4   +6/8        46  (−7)
12   T3 FINAL     M. Q. Grandstand III   0     4   +12/14      42  (−17)
```
In-tier bar-monotonic with breather bumps at 5/9. The final at 42% vs the strongest proxy is
deliberately ABOVE the old 25–35 band: humans are weaker than the proxy, so this should land near
the "beat it most of the time" target — escalate via the non-cap-clipped levers (prev item) only if
playtest demands. Knob rationale (balance study above): gaffes carry tier 1 + every breather;
maxExtend stays 3–4 (5+ measured counterproductive); AI deck quality carries tiers 2–3.
**Cast:** existing 6 redistributed as anchors (see table). Six NEW opponents — names/blurbs/tells
are **DRAFTS for Daniel to punch up or replace** (same authoring rule as cards): **Alderman Hugh
Kissbaby** (pander, "Has personally kissed every baby in the district. Twice.", nervousOf pander),
**Lt. Gov. Chip Vainwright** (brag, "Peaked in high school. Will tell you about it.", nervousOf
self_brag+attacked), **D.A. Sal Mudslinger** (attack, "Never met a fact he couldn't allege.",
nervousOf attacked), **Ambassador Fay Weathervane** (pander, "Polls before breakfast. Repolls
after.", nervousOf pander), **Senate Whip Vic Torpedo** (attack, "Sinks careers for sport. Yours is
next.", no tell), **Gov. Sterling Landslide** (brag, "Has never lost. Has also never been checked
for a pulse.", no tell). Art: 6 × 3 moods = 18 portraits via `npm run genart` (the AI-art Steam
disclosure decision applies before shipping).
**Reward economy stretch:** 11 post-win drafts (dilution risk rises → trims matter more);
consultant waypoints move to **after rungs 4, 8, 11** (tier boundaries + boss prep), upgrade picks
**3/4/5**; `UNDER_OATH_RUNG` re-points to after the T2 boss (rung 8 — the award was built
re-pointable). FLAG: the REWARDS pool needs more cards to support 11 drafts × 3 choices without
repeats — pairs with "design new cards WITH their upgrade path". The sim's player model assumed
rewards ≈ 1.5×wins (base draft + achievement awards) and that consultant schedule.
**Implementation notes:** `LADDER` rows become `{opponentId, maxExtend, tier, deckBoost?,
upgradeSteps?}`; new opponents join `OPPONENTS` with their own `gaffeChance`; relax the
`p.id === 'player'` guard in `dealRound` so AI decks map through upgrade tiers; shuffle `deckBoost`
reward cards into the AI private-deck build (`priv`, style-appropriate); `ladderHtml` renders tier
groupings; the free web demo = tier 1 (matches the roadmap's "first rungs free" funnel). The 4-way
debate special (P2 below) slots naturally at a tier boundary if built.

**P2 · large — 4-way debate (special; DESIGN PASS DONE 2026-07 — PROTOTYPE IS THE NEXT CODING
TASK: the roadmap's highest-uncertainty item, so de-risk it before building campaign structure
around it; Fable/Daniel discussion).** The rules-changeup special: the player + 3 opponents,
finish on top to continue; also a potential later standalone mode (decide after the special
ships). **Campaign decisions (2026-07, tiered-ladder era):** at most ONE per campaign (a rules
changeup is memorable once, a mechanic twice). Placement = its own node at the **T2→T3 boundary**
(after rung 8) — deliberately difficulty-verdict-proof: if it tests hard (roadblock), T3.1's
breather still gives the relax moment right after; if easy, it IS the breather and T3.1 can
tighten. Prize = **upgrade picks, not a card draft** — adds power without deck bulk (counters the
tiered spec's 11-draft dilution flag) and gives the boundary a distinct identity: consultant →
4-way → final tier. (The old "after debate 4, mind Under Oath collisions" placement note is
obsolete; Under Oath now re-points to rung 8 in the tiered spec — if the 4-way ships there,
sequence the two beats deliberately.)
**NEXT STEP — isolated prototype, no campaign integration:** a dev-only entry (debug button / URL
param) launching a single 4-way with a roster of 3 already-DEFEATED ladder opponents returning for
a rematch (portraits, styles, and banter already exist — free art — and it reads as a narrative
beat). No reward wiring, no new characters. The prototype must come back with verdicts on:
(1) is it fun at all / does it belong in the game; (2) does directed targeting create real
decisions (trip the leader vs kick the last-place spoiler); (3) breather or roadblock; (4) run
length — 4 speakers/question roughly doubles a round, so it likely wants fewer questions (~5–6)
or it drags.

  **Core decisions (each cascades from the previous):**
  - **No contested pool.** Three rivals draining a shared pool between your plays makes
    planning impossible, fights the north star (long statements need a stable card supply),
    and no screen fits a 4-way pool. Each candidate builds from an UNCONTESTED deal (private
    hand + a generous per-question deal).
  - **Whole-statement turns.** Card-by-card alternation exists ONLY because the 1v1 pool is
    a race; uncontested, it's just waiting through three AI plays. Each candidate builds
    their complete statement uninterrupted, resolves, play passes on. Big AI simplification
    (plan once over a stable deal — no re-planning) and it reads like a real moderated
    debate.
  - **Power-ups DISABLED in v1.** Typo/Forgot target an opponent's *in-progress* line, which
    whole-statement turns abolish; Hot Mic/Plant/Under Oath each need their own ruling.
    Audit later; don't redesign for v1.
  - **Virtual subject chips, NOT a "choose your target" phase.** Reuse the PERIOD
    virtual-card model (never drawn/consumed, offered as a move whenever legal): a fixed
    always-available row of NPs — each opponent BY NAME, "all of the other corrupt
    politicians on this stage with me" (collective), the voters, yourself. Solves
    roster-as-cards screen space with no modal step, keeps the freeform builder the player
    already knows, and — the key win — multi-clause statements can target DIFFERENT
    candidates ("Senator A kicks puppies because Governor B eats babies" is a directed
    double-attack; a second clause needs its own subject anyway). The dealt cards are then
    predicates/objects/connectors/modifiers/finishers only.
  - **NO polarity filtering of the deal** (REJECTED: "offer only negative cards when
    attacking, only positive when bragging"). Open predicates have no polarity without their
    object, so filtering guts the combinatorial engine; and blunder risk is where the
    card-feel skill and the comedy live (cards carry no numbers; Heel Turn / Giant Gaffe
    gambles are content). The strategy layer comes from target choice + the approval math,
    not from a safe hand.

  **Scoring model (decided): independent approval bars, NOT zero-sum redistribution.** Each
  candidate has their own approval %, all starting ~35%; per-clause routing — an attack
  clause lowers the TARGET's bar (no splash), pander/self-praise raise only yours. Simpler
  than zero-sum (no "where did the lost share go?" math), makes "kick the last-place
  candidate" sensible, matches real-poll intuition (a nasty debate can tank the whole
  field). **The "undecided pool" is PRESENTATION ONLY** (e.g. show 100 − mean(bars)), never
  a conserved ledger — "attacks push support to undecided, not to rivals" is behaviorally
  identical to no-splash. **Tuning constants (starting point):** brag/pander +X to you (the
  efficient self-raise); attack-one −Y target, +Y/4 you (chip damage for you, real damage to
  them); attack-all −Y/2 each opponent + small +you (wide but shallow). **Gang-ups are
  emergent** — you + two AIs mobbing the leader is three independent subtractions,
  devastating with no special rule; if pile-ons dominate playtests the lever is a sympathy
  rebound / diminishing returns on the round's most-attacked candidate (do NOT build in v1).
  **Win = race to a threshold where attacks *delay* rivals** (everyone needs ~60%; sprint
  yourself OR trip whoever's about to cross); "highest after N questions" is the fallback if
  threshold races run long. **Keep the zero-sum needle for 1v1** — strategically equivalent
  there, simpler, more dramatic (revisit only if switching models feels jarring). The engine
  fork is thin: per-statement scoring is IDENTICAL; only how a delta routes changes. The
  rules change is one intro screen at the event (distinct event, poll-like bars).

  **AI target selection:** ride the existing `style` machinery — default "attack whoever's
  closest to winning" with personality jitter (aggressive archetype attacks the leader; a
  panderer mostly brags/panders, attacking only near-threshold rivals). AI-vs-AI attacks are
  what make the field feel alive.

  **Prototype order — risky part FIRST (this mode's cheap kill-switch; "possibly this idea
  sucks" is a live hypothesis).** Statement-building is known-fun; what might suck is the
  MACRO layer: do brag/pander/attack-one/attack-all choices across ~8 questions produce real
  decisions, or does one strategy dominate? **Step 1 (cheap, runnable anytime): a HEADLESS
  vite-node sim** — abstract each statement to a type choice + quality roll, run the
  approval math over many games with simple policies (always-pander, always-mob-leader,
  mixed). If a degenerate policy flatly wins, retune the constants or kill the idea before
  ANY engine/UI work. **Step 2 (only if the sim shows texture): engine** — candidates array,
  per-candidate bars, whole-statement turn rotation, virtual subject chips, per-clause delta
  routing (pure + seeded + tested, like everything else). **Step 3: UI** — four podiums, the
  one-screen rules intro, turn indicator.

**P1/P2 · medium — Prune + style-tune + randomize the STARTING DECKS (design idea, 2026-07-06;
Daniel).** The starting deck is currently doing double duty — baseline *and* card showcase — which
flattens the deck-building progression curve. Reframe: **the baseline deck should be
competent-but-BLAND; fun/showcase cards belong in the REWARD pool, not the starting deck** (so every
draft / consultant visit / upgrade feels like real progress). Prune it. Then **tie the starting
deck to character select** — `PLAYER_CHARACTERS` (maverick / stateswoman / veteran) maps to
pander / attack / brag, so choosing a candidate *guides the deck*, not just the portrait (today
character is visual-only). **Cautions to honor when built:** a style deck should **LEAN (~60/40),
not straitjacket** — keep all-three-intent coverage + the buildability floor (subjects/verbs/
connectors — the north star needs supply for long chains), because the **hidden crowd** makes a
pure-style deck punishing (an attack deck vs a pander-loving crowd is stuck). A **randomized subset**
of good starters is welcome (StS starting-relic variety) but must be **curated + floor-guaranteed**
(mirror `ensurePoolPlayable`'s spirit, applied to the private deck) so a roll is never unwinnable.
This *raises* the value of the Consultant/rewards. Touches `cards.ts` + the private-deck build
(`deck.ts`/`game.ts`) + the select screen (`ui/main.ts`); engine + tests. See [[tune-for-temptation]].
**Extension floated (Daniel, 2026-07-06 — TBD, weigh before building): per-player-character REWARD
pools**, not just starting decks. Pros: character choice matters beyond the opening hand, real
replayability (beat the game with all three), and each pool needs only ONE voice if per-character
voicing ever happens (see the voice plan's revised math). Cons: needs a bigger total card count
than one shared pool, and — the tension Daniel flagged — a player's favorite cards can become
un-combinable because they belong to different characters. Undecided; don't build into the
starting-deck pass without a ruling.

**DONE (2026-07-06) — Passive RELICS (Slay-the-Spire-style; first slice shipped same day).**
**PLAYER-FACING BRAND = "ENDORSEMENT" (Daniel, 2026-07-06):** "relic" is genre vocabulary, not
debate vocabulary — every player-visible string says *endorsement* (grant modal "🏅 Endorsement
earned!", tile banner, any future copy), while CODE deliberately keeps `Relic`/`RELICS`/
`run.relics`/`.relic-badge` etc. (the roguelike term developers recognize; player-facing-only
rename by choice, not oversight). Author future relic names/blurbs so they read as things a
BACKER could confer ("Endorsed: Teflon Don").
**DECISION: add passive relics; REJECT cross-card engine-building** (in-statement mechanics compete
with word-building for attention — off-north-star; if the campaign ever drags, the lever is fewer
rungs, never more in-line mechanics). Relics are passive **scoring-context modifiers** — zero extra
in-line decision load. **The seam (the architecture flag honored):** a `Relic {id, icon, name,
blurb, mods: RelicMods}` is plain declarative data (types.ts, next to `Crowd` — the modeling
precedent), catalog `RELICS`/`findRelic` in cards.ts (NOT cards: never in ALL/decks/REWARDS/findDef
— the leak guard is tested); `mergeRelicMods` (new engine/relics.ts) flattens a relic list
(booleans OR, additive sum, multipliers take min) and everything downstream consumes the merged
bag: `run.relics: string[]` (main.ts, wiped in newRun — win-gated like bonus) → `createGame({relics})`
→ `state.relics` (player-only) → **two `ScoreOptions` channels** (scoring.ts): `mods` = the
SPEAKER's relics, `defenderMods` = the DEFENDER's when scoring the attacker's line. All scoring
mods act at the **contribution level inside `scoreStatement`** (one `applyRelicMods` adjuster after
both `contributions()` calls — complete AND confused path), so breakdown/FX/analytics always match
the bar — **never adjust the signed bar delta in resolveStatement**. **The 5 shipped relics:**
🍳 Teflon Don (`incomingAttackMult 0.5` — Daniel chose DAMPING over the original "backfire": a
reflected delta needs a second Reaction channel and shows attack-FX that moves the bar the wrong
way; a true backfire relic is a follow-on), 🏛️ The Incumbent (`barStart 10`, applied at createGame's
bar init — once per debate since the bar persists across questions), 📸 Media Darling
(`offTopicImmune` — kills the penalty AND the badge), 🚌 Base Rally (`crowdAlwaysBoost` — when the
hidden taste matched nothing, boost the best POSITIVE contribution instead; never double-boosts,
never amplifies a blunder, resolution-only like `crowd` itself), 🧯 Spin Doctor (`blunderMult 1.3`
replaces the ×1.6 — also softens the confused-path blunder punch-through). **AI awareness
(deliberate):** relics are PUBLIC passives (podium badges), so `plan()` takes `mods`/`defenderMods`
(every chooseMove plan call passes the player's mods as defenderMods — the AI organically devalues
attacks into Teflon), and `bestTypoJam` + the Forgot heuristic score the player's line under the
player's mods; **crowd-blindness untouched**. **Acquisition (Daniel's call): ONE relic per run** —
a scripted "🏅 Endorsement earned!" pick-1-of-2 offer (`RELIC_RUNGS = {2}`, after winning debate 3),
unshifted onto the reward queue AFTER the rewardQueue[0]-mutating upgrade-gamble block (same
ordering constraint as Under Oath; disjoint from UNDER_OATH_RUNG). A `data-relicpick` branch grants
it (skips the awardhint interception — that teaches CARD hunting); consultant untouched (relics
aren't a deck axis). Display: emoji badges + tooltip in the YOU podium (`.relic-badge`). Deal event
logs relic ids. Tests: tests/relics.test.ts (catalog integrity + leak guard, threading,
per-relic scoring incl. FX≡bar and the confused path, determinism, AI awareness). **Follow-ons
(not built):** 📅 Career Politician (+1 period — needs the `usedPeriod` boolean→count refactor;
deliberately isolated), Prime Time (+headroom), County-Fair Charmer (rambling-immune —
playtest-watch: rambling is a north-star limiter), Push Pollster (knowsCrowd), Front-Runner Energy
(opp gaffe aura), a true backfire relic, a character-select starting relic (pairs with the
starting-decks item), a second waypoint (keep pick counts uniform — tune-for-temptation), and the
12-rung re-point (`RELIC_RUNGS` → tier breathers).

**P2 · medium — OPPONENT-SPECIFIC signature cards (design idea 2026-07-06; VOICE-BIBLE DESIGN PASS
DONE 2026-07-06 — see `OPPONENT_VOICES.md`, local-only + gitignored like the other authoring docs).**
Today every speaker draws from the same lexicon, so characters don't *sound* distinct. Give each
opponent a small set of **signature cards in their own voice/style** (pander / attack / brag flavor
matching their `style`), shuffled into their AI private deck — so a debate against the panderer
*reads* different from one against the mudslinger, and the cast has real variety. Deck layering
becomes: **shared common pool** (contested) + **player-specific** cards (see the starting-deck item
above) + **opponent-specific** cards. Rides the existing plumbing: opponents already have a `style`,
and the tiered-ladder `deckBoost` note already shuffles style-appropriate reward cards into the AI
private-deck build — this extends that with *authored, character-flavored* cards keyed to the
opponent. Pairs naturally with the 6 new ladder opponents (author their signature lines alongside
their portraits/blurbs) and with the single-narrator voice decision (character comes from *word
choice*, not voice, when one announcer reads everyone). Data-first in `cards.ts` (a per-opponent
card set) + the AI deck build; watch the REWARDS/lexicon size so signature sets don't balloon the
VA/clip count. Same authoring rule as all cards (a strong, funny, in-character line — not filler).
**The voice bible** assigns each of the 12 tiered-ladder opponents a UNIQUE verbal register.
**Status after Daniel's 5th review (2026-07-06): 9 keepers, 3 open slots.** Keepers: the-script
(Patty, sharpened — "um"s + note-card citations written into card text; portrait refresh flagged) /
babies-and-grandmothers (Kissbaby, wholesome-absurd creepiness guard) / faux-erudite (Blowhard,
easiest) / sports-metaphors (Vainwright) / campaign-ad-copy (Smearwell — widened from attack-ads to
ALL ad genres so brags/panders get the soft-focus-narrator voice; pending Daniel's accept) /
Southern drawl (Mudslinger, the model) / legalese (Slander) / polls-and-focus-groups (Weathervane)
/ **perfected-political-speech (Grandstand, REWORKED: the final boss must read UNBEATABLE, not
quirky — total command, dismissal-not-mockery attacks, crowd-anointing praise; dynasty gimmick
demoted to garnish; reward-tier ceiling stats throughout)**. Open slots, candidates in the doc:
rung 4 (buck-passing failed — hometown-booster is the leading re-spin), rung 10 (mobster talk
one-note → FULL redo incl. name; roast-master / curmudgeon / drill-sergeant), rung 11 (android too
Zuckerberg for penultimate — move it down-ladder or re-spin as slick-empty-polish, Newsom not
Zuckerberg; needs more thought). Two principles from that review: **registers come from
voices/themes, NEVER from the character's name** (the failures were name-puns forced into card
styles; name and voice are separable), and **NON-PARTISAN is a hard rule** — no register may hint
at party or real politicians (Bible-thumper/crazy-liberal are out; hippie-speak is
borderline-coded, parked; Kennedy-speak parked as spoken-not-written). Each keeper has — the
doc's primary content after Daniel's 4th review — a **prompt-ready STYLE GUIDE per character**
(vocabulary bank, tics, per-slot notes, never-list) plus a GLOBAL style-guide preamble. **The
intended workflow: card authoring is DANIEL's task, LLM-assisted, not immediate** — he pastes the
global guide + one character guide + existing cards of a slot into an LLM and prunes the output;
the per-character example cards are calibration references, not deliverables. The doc also
contains the **IMPLEMENTATION PLAN** (verified against the code 2026-07-06: `buildPrivateDeck` has
one call site at game.ts:122 already receiving style; AI hand-finishers need ZERO ai.ts work —
`plan()` is generic over avail and the grammar's `S → INT` covers it; catalog must follow the
UPGRADE_DEFS not-in-ALL precedent + findDef fallback + genclips walk, with a leak-guard test) —
judged simple enough for a future session to implement directly from the doc, no separate design
pass. **DECISION (2026-07-06): NO self-vs-audience predicate mechanic.** Nothing separates "things
I say about myself" from "things I say about the audience", and we're not adding it — a
target-restriction flag would cut across play-freeform/judge-the-result for marginal benefit.
Known quirk, accepted as comedy: audience weight 1.3 > self 1.0, so the AI will prefer the
audience-subject reading of dual-usable positive predicates ("This brave audience scored four
touchdowns…"). Rules locked by Daniel's review rounds — the doc's rule list is canonical; summary: **(a) THE REGISTER TEST — a
personality only works if it suggests a way to write CARDS in that voice**: a register must be a
**surface texture** (dialect/jargon that skins any chunk: Southern drawl, faux-Latin, legalese) or
a **content obsession** (generates nouns/verbs/objects: sports metaphors, polls, ancestors) — never
a rhetorical *maneuver* ("mistakes were made" fits no slot) — AND must **map onto the crowd-reaction
channel**: an attack card hands the crowd an accusation/mockery to boo AT the target; implied
threats fail (they make the speaker scary, the crowd gets nothing) — this killed Vic Torpedo's
menace register and Buck Passer's passive-voice one (both slots ultimately went to full re-spin in
the 5th review; the intermediate scapegoat-NP fix also failed rule (e)). Benchmark passes per Daniel:
drawl (Mudslinger, the model), pseudo-intellectual, sports metaphors. **(b) THE USABILITY DRILL** —
before keeping any card, write the full statement it appears in with TWO different subjects,
combined with existing cards, and ask how the audience reacts. **(c) PANDER'S MAIN FORM = audience
subject + positive predicate** ("This wonderful audience has the strength of ten senators"); "I
will do X for you" promises are the secondary form — so prize **DUAL-USE positive predicates**
(brag on "I", pander on an audience subject) and audience-side NPs. Corollaries: subject NPs must
be agentive-ish (plans/teams/records — a letterman jacket is an object at best); **sentiment = how
the crowd hears the SURFACE** (cynical self-description is an insult/self-own, never a pander —
"holds whatever position polled best" is a flip-flopper attack). **(d) every set covers ALL THREE
intents** (style is a lean — deck ratio + STYLE_BONUS — not a filter; the finals play
near-optimally) **+ GRAMMAR-FIT** (predicates read after any subject; no dialogue fragments, no
baked gendered pronouns; first-person color OK only because these are never player-drawable).
**(e) shared-villain NPs must be side-neutral** ("the swamp" fine; "the previous administration"
implies an incumbent/challenger structure the game doesn't model — attacks nobody on stage).
**(f) opponents get ONE private signature FINISHER each** — reverses the
no-private-opponent-finishers status quo; the catchphrase mic-drop is too good a personality slot
to skip. **Balance ledger for (f):** a
guaranteed private ×factor raises opponent scoring → close the gap by buffing the PLAYER economy
(more/earlier private finishers in REWARDS, richer drafts), never by pulling opponents down; re-run
`sim-balance.mjs` + re-tune the expF ladder when wired in. Other hooks: **authored in-voice
SELF-OWNS for gaffe-prone opponents** (rungs 1/2/5/9) — the gaffe objective already picks the
shortest clear self-own from the AI's cards, so characterful flubs need zero AI work;
dialect/dropped-g text (Mudslinger's drawl) is engine-safe via `invariant: true`; per-opponent
`questionCommentary` banter is the cheap companion piece. Clip check: ~8 cards × 12 ≈ 95 new
surface forms (fine under the single-narrator plan). **Free verbal-tic decorations (Daniel,
2026-07-06 — sketch in the doc):** zero-value interjections ("um…", "what does it say on this
card?…") inserted between the real cards at RESOLUTION (never during the card-by-card build — the
teleprompter stays a faithful card view, so it reads as delivery, not cheating), no turn cost, no
score, planner never sees them. UI-only (`TICS_BY_OPPONENT` strings + a render pass); the one trap
is FX token-index mapping (tic words must be non-indexed spans so `breakdown`/`comboChips`/
`confusedSpan` still land on the right words; suppress tics on confused-line FX). Tics also give
maneuver-shaped flavor ("mistakes were made") a home that the register test denies to CARDS.

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
alternative was avoided — one card serves both, which is what the player expects.) **2026-07:** both
cards moved from `MODIFIERS` (shared pool) to `REWARDS` — dual-role strictly dominates plain "and"
head-to-head, so it's now a drafted privilege; nothing engine-side cares which deck they live in.

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
  Related design idea once this exists (web-Fable card review, 2026-07): a **self-own finisher subtype** —
  finishers that read as accidental self-owns ("and that's coming from me, so you know it's true",
  currently `r_x_comingfromme`, shipped as a plain finisher): high base factor, but a smart opponent's
  rebuttal punishes it. Gives optimal AI counterplay against player finishers without contesting the cards.
These are the first **power-up rewards**; good fit for the deferred **shop** (price ∝ power) alongside the
PRIVATE-finishers note above.

**P2 · medium — Typo → "Hack Their Teleprompter" → Under Oath upgrade chain (deliberate FOLLOW-ON,
2026-07).** Under Oath shipped as the guaranteed post-debate-4 scripted award (see Campaign run §);
this chain is the *alternate, earlier* acquisition for sabotage builds: draft `r_typo`, then spend
consultant upgrade picks — tier 1 = the roadmap's "Hack Their Teleprompter" (**a whole NEW targeting
effect**, e.g. `typo_full` — remove the opponent's last words / replace their statement; the big
unbuilt piece), tier 2 = Under Oath (**effect already exists** — the tier def just carries
`effect:'oath'`). Would be the first mechanic-changing upgrade chain and the only Action-card
upgrade (fine — the consultant grid shows next-tier text on the face, so it self-advertises). Needs
a duplicate guard vs the scripted award (two Under Oaths = two uses; decide if that's OK). Don't
build the mid-tier without its own design pass.

**P3 · trivial — Remove the on-topic card hint.** The green glow + "on topic ✓" tag (`cardHtml` in
ui/main.ts) is a **temporary debug aid** for catching mislabeled `topics`; once the data is trusted,
remove it so players learn to spot on-topic cards themselves.

**P3 · small — Varied reaction text.** `describe()` in scoring.ts returns one fixed line per
reaction tier ("the audience nods along", etc.), plus the single confused/ramble flavor strings — so
resolutions read identically across a debate. Give each tier a pool of phrasings (and the
confused/combo notes too), picked with the game RNG (deterministic). Pattern mirrors `Topic.questions`
(35 phrasings across 7 topics, picked per question — done). Cosmetic; pairs well with the juice pass.

**P1 · medium — Sound & the phased VOICE plan (promoted from P2-small, 2026-07).** For a comedy
game audio is where the laugh lands — Oh...Sir!!'s joke-delivery mechanism was *hearing* the
insult, stitched from per-chunk voice clips, and our card/chunk architecture maps onto that
exactly. Two layers:
- **Crowd SFX (the original backlog item, still first):** applause / groans / boos / gavel on
  resolution, deterministic by reaction tier, self-hosted clips (static app — no external
  hosts). Pairs directly with `playResolutionFx`.
- **Voiced statements (phased):** clips are **per-CHUNK, stitched at resolution** — never
  per-statement (statements are combinatorial). **Phase 1 = TTS for playtesting** (ElevenLabs;
  per-chunk from day one so seam problems — trailing silence, join intonation, finisher
  delivery — get solved while fixes are free). **Phase 2 = human voice actors** once the deck
  is **TEXT-locked** (trigger is explicit: text lock → book actors; text-lock ≠ number-lock —
  sentiment/ceiling/tier balance stays tunable after recording). Shipping TTS would need the
  Steam AI-content disclosure (see Commercialization §) — TTS is scaffolding, don't let it
  quietly become permanent.
  **Numbers (`npm run genclips`, 2026-07-06):** **439 distinct speakable card texts** (`ALL` +
  `UPGRADE_DEFS`; the earlier hand-count of 431 is stale — the deck grew) → **567 surface forms**
  (non-invariant predicates/modifiers need both conjugations — "kicks/kick puppies", "is/are").
  **VOICE SCOPING — DECIDED (2026-07-06): a SINGLE deadpan moderator/announcer voice** (~560 forms,
  one voice). Rationale: it's the cost floor, fits the C-SPAN broadcast skin, and — the decisive
  factor as the cast grows to 12 opponents + 3 players — it **decouples voice from the cast** (new
  opponents add zero recordings). Per-character voicing (≈5,000) is dead *at the old architecture*;
  the "few reused male/female voices, player/opp distinct" middle path is the fallback if
  playtesters find the single narrator flat. **REVISED MATH (Daniel, 2026-07-06 — TBD, decision
  unchanged; ElevenLabs first is still right):** the signature-card architecture restructures the
  per-character cost into `(15 voices × SHARED forms) + Σ(each character's EXCLUSIVE forms ×1)` —
  character-specific cards need only their OWN voice, and every deck-thinning effort (trimmed bland
  starting decks, opponent signature sets, per-player-character reward pools) shrinks the SHARED
  multiplicand. Ballpark: shared pool cut to ~100 forms + 15 × ~40 exclusive forms ≈ 2,100
  recordings — a few actors doing ~15 voices, not 5,000 forms. Constraints if ever pursued:
  per-chunk stitching means ONE statement mixes shared + private chunks, so a character's voice
  must record ALL shared cards it can speak (no narrator/actor hybrid mid-statement); the shared
  pool has a floor (`ensurePoolPlayable` needs subjects/verbs/connectors dealt from it, and
  `s_opp` + `p_kick_pup` must stay shared for the name-of-the-game award); weigh against the
  single-narrator virtue that new cast members cost zero recordings. **DONE — clip-manifest generator:** `scripts/gen-clips.ts`
  (`npm run genclips`) walks `[...ALL, ...UPGRADE_DEFS]` through morphology.ts and emits
  `voice-manifest.json` (stable `<id>.3sg`/`.pl` keys for two-form cards; single key otherwise) with
  fail-loud self-checks (distinct count === `ALL.length+UPGRADE_DEFS.length`; forms > cards). It is
  **pure/deterministic — no TTS, no audio wiring**.
  **DONE (2026-07-09) — TTS clip generator:** `scripts/gen-tts.mjs` (`npm run gentts`) synthesizes
  every manifest surface form to committed mono mp3s under **`public/voice/`** (served verbatim,
  fetched by URL — deliberately NOT `import.meta.glob`, which emitted a JS chunk per clip and
  base64-inlined the small ones, ~70KB bundle bloat). **PROVIDER
  DECISION (Daniel): OpenAI-first (`gpt-4o-mini-tts`, reuses the genart `OPENAI_API_KEY`, ~$0.50/full
  pass), provider-agnostic** — all provider code lives in one `synthesize()` seam; if stitched seams
  disappoint, swap in ElevenLabs (whose `previous_text`/`next_text` prosody conditioning is the
  known upgrade path) and `--force`-regenerate. **A bad first voice means change the VOICE, never
  "AI narration is no good."** **ffmpeg post (reworked after the first LISTENING playtest,
  2026-07-09): edge trim (-50dB, 20ms kept) → per-clip RMS gain to a fixed −20dB mean with a −1.5dB
  peak ceiling → `atempo` (`--tempo`, default 1.1) → 20ms pad.** NOT `loudnorm`: integrated-loudness
  measurement is statistically unstable on sub-3s clips — it produced the audibly uneven levels that
  were the playtest's main complaint (uniform level is what makes stitching viable). The tempo knob +
  a brisker instruction fix the too-slow cadence. **Raw synth wavs are cached in gitignored
  `voice-raw/`** — the cache is split into synth-hash (API call) and post-hash (ffmpeg knobs), so
  re-tuning ANY post knob re-encodes all clips with ZERO API calls. Incremental by design (cards keep
  changing): `npm run gentts` after a cards.ts edit + `npm run genclips` regenerates only what
  changed. Role-aware delivery instructions fight sentence-final
  cadence on mid-sentence chunks (finishers get a closing cadence); power-up labels are stripped to
  the card name (no emoji, no rules text). `--sample=N` = cheap role-diverse voice audition
  (`--voice=onyx` etc.), `--only=key`, `--preview` = stitches ~5 representative statements (additive
  chain / aside / finisher / because+plural / reward-conj pivot) into gitignored `voice-preview/` —
  **the listen-and-judge harness for the OpenAI-vs-ElevenLabs verdict**.
  **DONE (2026-07-09) — in-game statement narration (the playback layer).** Every resolved
  statement (both speakers, confused lines included) is read aloud during its resolution FX.
  **Engine:** `clipKeys(line)` in morphology.ts maps each card in a judged line to its manifest
  clip key, choosing `.3sg`/`.pl`/`.1sg` via `lineAgreements` — the clause-agreement walk
  extracted from `displayWords` so the spoken conjugation can NEVER drift from the displayed one
  (shared single source of truth; `null` = a card the display also omits, e.g. unparsed salad).
  **`.1sg` forms are copula-only** ("I AM strong…" — gen-clips emits them for `lead:'be'`
  predicates/modifiers, 33 clips; every other first-person text is identical to the plural form).
  A modifier clip bakes the card's own who/which `rel` hint — a rare animacy mismatch vs the
  display is a documented recording-time simplification. **UI:** `src/ui/speech.ts` — Web Audio
  stitch (buffers scheduled back-to-back; role-keyed `PRE_GAP`/`POST_GAP` add breathing room
  around comma-set asides and the finisher), lazy per-clip fetch + session-cached decode, mute
  toggle (`.voice-toggle` fixed top-right, localStorage `voiceMuted`, mutes mid-read via
  `stopSpeaking`). **The narration DRIVES the resolution FX (synced 2026-07-09, playtest ask):**
  `speakStatement(line, onClip)` fires a callback at each clip's scheduled start; playResolutionFx
  maps line indices onto the judged line's `.w` spans (one span per non-empty displayWords entry)
  and onto each grading chip's anchor (phrase chips → their span's first word, combo → its
  junction, finisher → the finisher card), so words brighten AS they're spoken and chips pop ON
  their words; unanchored chips (flags/WHAT??) + everything on a muted run land in the classic
  post-narration chip sequence, then the count-up. **First-word-clipping fix (playtest):** the
  module warms the AudioContext + plays a silent one-sample blip on the session's FIRST
  pointerdown (output-device spin-up was swallowing the opening word), blips again when a
  statement starts loading, and schedules with a 120ms lead-in.
  The same fast-forward click stops voice+FX — with the mute button EXEMPTED
  from the capture-phase skip listener (clicking 🔇 must not skip the FX). `done` always resolves
  (missing/failed clips skip their word; a safety timeout covers an interrupted AudioContext).
  Tests: tests/speech.test.ts — agreement selection, full manifest coverage of every reachable
  key (which also fails on a STALE manifest — genclips-after-cards.ts-edits is now test-enforced),
  and spoken/displayed conjugation parity swept over every predicate × 3 agreement contexts.
  Remaining follow-on: crowd SFX. The prune-for-VA pass and the CURATE-the-upgrade-pool
  item above are **the same pass** — do them together (prune to the good lines without making
  the game repetitive).

**P1 · medium — Shareability (PROMOTED from P2, 2026-07).** The absurd generated statements are
inherently screenshot-bait — a "share this line" / clean screenshot of a resolved statement is the
**playtester-recruitment engine** (what makes someone else click the web link), not just a growth
feature, so it's now early in the release path (see RELEASE_ROADMAP.md §10) instead of post-proof.
Cheap: render the judged line + reaction to a canvas/image (the statement already reverts to clean
single-color text after the FX — deliberately screenshot-ready).

**PvP (2026-07 — the biggest sellability feature gap: Oh...Sir!!'s local+online 1v1 was its core
selling point; its AI was treated as practice mode).** Ordered by cost; the engine is unusually
ready — turn-based card-by-card alternation, both sides symmetric `PlayerState`s, the AI merely
*drives* one of them:
- **P2 · small/medium — Open-hands couch hotseat (ship first).** Two players, one screen, all
  info visible (fits the north star: the fun is the statements, not hidden-info optimization —
  plays like a party game, and gives two playtesters per laptop). Work is UI-side: a PvP mode
  flag, skip `driveAI`, whose-turn indicator + relabeled bar, and a **power-up audit** (Hot Mic's
  hand-reveal is meaningless open-hands; Plant revealing the crowd to ONE player gets more
  interesting; Under Oath vs a human needs a ruling). A hidden-hands "pass-the-device curtain"
  screen is a later variant, only if testers want competitive play.
- **P2/P3 · small — Async "debate by link".** Deterministic seeded engine + move list = the whole
  game state fits in a URL (seed + moves); each player takes a turn and sends the link back
  (chess-by-email). Zero servers — works on the static github.io deploy. Viral web hook.
- **P3 — Real-time online = Steam-version feature ONLY.** Determinism means online is just
  relaying moves (no authoritative server); Steamworks lobbies/relay via the wrapper do
  matchmaking for free. On web it would need a relay server — **never build a web backend**
  (Commercialization § decision).

**Platform — RESOLVED (2026-07; see Commercialization § + RELEASE_ROADMAP.md).** Keep building the
**github.io web demo** — it stays forever as the free demo/funnel. The paid game ships on
**Steam + itch** via an **Electron/Tauri wrapper** (`steamworks.js` for achievements/cloud/lobbies;
days of work, not a rewrite — desktop hygiene needed: real saves beyond localStorage, settings
screen, window handling). Steam path: Coming-Soon page early (wishlists accrue; ~5–10k at launch is
where the algorithm helps), one **Next Fest** demo near launch. **Mobile via Capacitor** comes after
Steam proves demand — it's a *layout* project (phone real estate), not a tooling one; expect
political-content review friction (esp. Apple — keep parody generic). **Console is the only thing
that would force leaving the web stack**; ignore it. (The old Godot question is closed — web won.)

**P2 · large — Graphics, animation & juice.** The UI is a functional prototype. Make it *feel* good:
character art / reaction faces (an opponent that looks embarrassed on a self-own), animated card
plays, donation/score tickers, audience reactions. The **minimal "stage the opponent's turn" slice
shipped 2026-07-06** (see the card-play staging DONE note below: visible thinking pause + TAKEN!
pool-grab + word-flash); remaining here is the richer art layer (reaction faces, tickers, crowd).

**DONE (2026-07-06) — card-play staging + thinking pause + row intent-labels (the pool-visibility
pass, from the iPad playtest — a non-gamer never realized the pool was contested or the hand
private).** Every non-resolving `take` (BOTH sides) plays a mini staging FX — `playCardFx` in
ui/main.ts, pattern-matched to `playResolutionFx`: the played card glows in its row (an AI **pool**
grab lingers longer and wears a red **"TAKEN!"** stamp — the contested-pool lesson made visible),
whisks toward its speaker's podium, then its words flash one at a time onto the teleprompter.
`stagedSpeechHtml` wraps the appended card's words in `.nw` spans — unstyled unless `.lit`, so the
line reverts to plain text with no re-render (same transient-markup principle as the resolution
juice). **State applies FIRST**; FX phases 1–2 animate the stale pre-render DOM (where the card
still sits), phase 3 renders the new state and flashes. Any tap fast-forwards (`playFxSkip`);
`playFxBusy` swallows clicks and defers `driveAI` (both `playerMove` and the card click handler
guard on it). A **finisher take skips it** (it resolves — the resolution FX owns that moment);
period/power moves and AI **hand** plays skip the row phases (no visible button), keeping just the
word-flash. The AI's pre-move pause now renders a visible **"💭 X is thinking…"** line under their
teleprompter (`aiThinking` finally displays something) — longer while you're both building
(`AI_THINK` 1050ms) than after you've ended (`AI_THINK_SOLO` 420ms, so their solo finish doesn't
drag). Row labels carry always-visible intent sub-lines (`.rail-sub`: "⚔️ first come, first served" /
"🔒 only you can play these") — the old title-tooltips don't exist on touch. **Q1 tutorial tie-in:**
the AI's FIRST pool grab queues a one-time contested-pool lesson into the coaching panel
(`grabLessonShown`/`grabLessonPending`, cleared when the player next plays, reset in `newRun`) —
taught the moment it happens, not as upfront rules text. Pacing knobs live in `PLAY_FX`.

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
  2 closed positive ("brag") verbs, 2 closed negative ("attack") verbs (**both |sentiment| ≥ 2**,
  2026-07 — a ±1 filler verb scores under COMBO_MIN and breaks the "your combo wins" lesson), an `and`, and one finisher
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
  building on Q1 of debate 1. CSS under "onboarding hints".
  Note Q1 is player-first (`round % 2 === 1`), and play **alternates card-by-card** (`advanceTurn`
  on every `take`) until a speaker ends — the hints reflect the player's line on each of their turns.
  **Hints GATE, not just glow (2026-07-06 — iPad playtest: a non-gamer played two nouns in a row and
  the walkthrough couldn't recover):** while a hint is up, off-script cards get `.gated` (dimmed,
  `aria-disabled` — NOT the `disabled` attr, so the click still lands and shakes "no" + re-pops the
  coaching panel). The End button stays live throughout (escape valve). A **"Skip tutorial"** opt-out
  (`tutorialSkipped`, reset in `newRun`) lives in BOTH the welcome modal and the coaching panel —
  skipping kills hints AND gating (advisory-free freeform Q1). Two `tutorialStep()` guards keep gating
  soft-lock-free: an **open predicate** from the hand hints `np` ("needs a target"), and a **safety
  net** falls back to an End-only step if no playable card of the hinted role exists. The Q1
  round-summary shows a one-time closing beat ("that was one way to build — mix it up") so the gated
  sequence doesn't teach a false fixed-card-order rule.

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
