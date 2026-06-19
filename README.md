# ⚖️ Debate Simulator (prototype)

A card-drafting debate game inspired by *Oh...Sir!! The Insult Simulator* and
*Slay the Spire*. You stand on stage against an AI opponent and build statements
one word at a time, drafting from a **shared public pool** (contested — your
opponent can grab a card you wanted) and your **private hand**. Each finished
statement is judged by how the audience reacts; a single scorebar tracks whose
side the crowd is on.

This is the **v0 prototype**: one full playable debate. Slay-the-Spire
between-round deck-building is intentionally deferred.

## Run it

```bash
npm install
npm run dev      # play in the browser (http://localhost:5173)
npm test         # run the engine unit tests (Vitest)
npm run build    # typecheck + produce a static bundle in dist/
```

## How a debate works

A debate is a series of **questions**. Each question:

- Has a **topic** — an issue ("The Economy"), a subject ("Your Opponent", "Your
  Record"), or a required phrase ("Name-Calling" → "is an unscrupulous jackass").
  Each topic has its own **topic card** (a subject, object, or predicate) that is
  always available to *both* players and never used up, so you can always work
  the topic in. Dodging it is penalized.
- If your deal is bad (e.g. nothing good to start with), **↻ Regroup** once per
  question to reshuffle the pool and your hand — it costs you the turn.
- Your deck also holds one-shot **power-ups** (played from hand, costs your turn):
  **📋 Search Notes** (draw 5), **🎤 Teleprompter Typo** (jam a card onto the
  opponent's statement to wreck it), **🧠 Forgot My Line** (knock the opponent's
  last word off their in-progress statement — discarded for good), **👏 Soundbite**
  (next statement ×1.5), **🕵️ Plant in the Audience** (reveal the crowd's hidden
  taste), **🎙️ Hot Mic** (reveal the opponent's hand for the rest of the debate AND
  steal a card from it — e.g. grab their Typo before they can use it), **🗣️
  Filibuster** (stock your hand with connectors so you can chain a long combo).
  **Search Notes and Filibuster are free** (don't cost your turn); the others cost
  your turn. The AI uses them too (but never Plant — it's blind to the crowd by
  design). When the opponent **Typos** *you* (jams a card in) or makes you **Forget
  your line** (drops your last one), a red alert shows what changed — the line stays
  grammatical either way, so you can keep building to recover (the AI auto-picks the
  most damaging Typo, and uses Forgot to wreck a strong line you're sitting on).
- Deals a fixed **shared pool** (~9 cards, contested) and a small **private hand**
  to each player. **Nothing replenishes** during the question — cards only run out.
- The two are **different kinds of cards**: the shared pool holds generic
  "stump-speech" predicates (everyone fights over them), while your private hand
  holds your own **signature zingers** ("wants to put a microchip in your flu
  shot", flavorful subjects like "My idiot freedom-hating opponent" or "The
  wonderful, beautiful people of this country") that *never* appear in the pool.
  Opponents' decks are themed to their style; this is where the Slay-the-Spire
  deck-building will plug in.
- Your **private deck is persistent for the whole debate** — shuffled once, drawn
  across questions. A card you've already played (e.g. Plant in the Audience)
  won't come back next question. (The shared pool is re-dealt fresh each question.)
- Players alternate, drafting **one word/phrase per turn** from the pool or hand.
- You may only **End** on a *complete* sentence (no bailing on a safe fragment).
  Combined with the shrinking pool, this is the pressure: commit to a structure
  and the only card left to finish it may be a self-own — or you ramble and
  "confuse" the crowd. Going long for a combo increases the risk.
- Cards are **chunks** (Oh...Sir!!-style): **subjects** ("My opponent", "Our
  children"), chunky **predicates** that are mostly complete ("kicks puppies",
  "is a national disgrace", "loves freedom and democracy") or **open** with a
  fill-in slot ("is in bed with ___", "wants to destroy ___"), **objects** to
  fill those slots, and **connectors** ("and", "but", "because", "which is why",
  "and frankly"). `and` coordinates predicates under one subject; the others open
  a new clause. Predicates auto-conjugate to the subject ("My opponent **kicks**"
  vs "Our children **kick**", "is/are a national disgrace").
- "Thing" nouns act as **heroes or villains** when used as the subject: praising
  a hero (the economy, our veterans) and **bashing a villain** ("Shady lobbyists
  are a national disgrace", "The swamp can't be trusted") both score for you;
  praising a villain or trashing a hero backfires.
- **✦ Finisher** cards (intensifiers like "…and everyone knows it") are *grabbed
  and committed*: take one at any time and it's appended to the end when you
  finish, multiplying the whole statement — so commit while you're winning, or it
  amplifies a disaster.
- Each debate has a **named opponent** with a fixed style — Senator Blowhard
  (self-brag), Gov. Patty Pander (panders to the crowd), Rep. Dirk Smearwell
  (personal attacks) — and a style-tuned deck.
- The **crowd has a hidden taste** (loves flattery, or attacks, or pandering),
  fixed for the debate and never shown. You read the room from how hard your
  statements land and lean into it — the opponent plays its style *blind* to the
  crowd, so out-reading the room is your edge.
- **Pass** to wait — allowed on an empty statement (wait from the start) or a
  complete one (hold it live), but not mid-way through an incomplete one. Passing
  lets you watch the opponent build so you can Teleprompter Typo them at the right
  moment — at the risk they Typo *you* first. **End** instead locks your statement
  in (now safe from a Typo, but you're out of the round). The round resolves when
  both sides settle (one passes after the other has locked in, or both pass).
- A debate runs up to **8 questions**, but ends early as a **landslide** the moment
  the audience swings fully to one side (the bar hits ±100).
- After both players have spoken, the round **pauses on the result** so you can
  read both statements and the crowd's reaction; press **Next Question ▶** to deal
  the next one.
- The audience reacts; the scorebar swings. First to ±100 (or ahead after the
  round limit) wins.

## Architecture

A pure, fully testable **engine** with a thin DOM **UI** on top.

```
src/
  data/cards.ts        the lexicon — every card's grammar + semantic tags
  engine/
    types.ts           shared types
    morphology.ts      predicate conjugation (verb 3sg / is-are / casing), via the segmenter
    grammar.ts         chunk Earley grammar + clause/predicate segmenter (validity / completeness / parse)
    scoring.ts         deterministic audience-reaction scoring
    deck.ts            seedable RNG, deck construction, dealing
    game.ts            GameState, turn loop, applyMove / scoring / scorebar
    ai.ts              opponent: bounded search over reachable completions
  ui/                  stage, scorebar, hand/pool, wiring
tests/                 grammar, scoring (the brief's examples), and AI suites
```

### The two hard algorithms

**Scoring** (`scoring.ts`) is a pure function of structure + card tags — no NLP:
1. **Target** — who the statement is about (`self` / `opponent` / `audience` /
   `neutral`), from the subject card. A neutral noun acts as a hero (praise it) or
   villain (bash it) by its sentiment. **Self-owns and audience-insults cost extra**
   (a blunder multiplier), so they really sting.
2. **Polarity** — each predicate carries a polarity `P`. Complete predicates have
   a baked `sentiment`; open predicates compute `deed + affinity × objectSentiment`
   (so "wants to destroy freedom" hurts the subject, "…destroy the swamp" helps).
3. **Delta toward the speaker** — praising yourself or pandering to the audience
   helps; making the opponent look good (or insulting yourself/the audience)
   backfires; magnitude scales with sentiment, so bland lines barely move the bar.
   A multi-clause statement earns a combo bonus only when *every* clause lands
   hard in the same direction; padding with weak/empty clauses is penalized.

Grammaticality is recognized with a small **Earley parser** over the *role*
sequence (memoized, so the AI's deep search stays fast), and a **segmenter**
splits a line into clauses and predicates — telling predicate coordination ("…and
kicks puppies", same subject) apart from a clause join ("…because the economy…").

**AI opponent** (`ai.ts`) re-plans every turn: a depth-bounded DFS enumerates the
grammatical completions still reachable from its committed line using the cards
currently available, scores each with the real scoring engine, and steps toward
the best one. A small per-pool-card risk penalty biases it toward securing
contested cards and toward safer plans. Because it re-plans, theft from the pool
just changes what's reachable and it falls back to the next-best line — never
gibberish, never settling for a bland line when a stronger one is reachable.
It's deliberately handicapped (`AiOptions.maxExtend`, default 4 ≈ one solid
clause) so it plays human-scale statements and is beatable by a player who chains
their own combos — in self-play a full-combo player beats it ~80% of the time.

## Campaign (run progression)

A debate is one rung of a **6-opponent campaign ladder** of rising difficulty
(Gov. Patty Pander → … → Maximilian Q. Grandstand III, the final boss; the AI
plays longer combos the higher you climb). Before the first debate and between
each one, a **Slay-the-Spire-style campaign map** shows the straight-line ladder —
who you've beaten, who's next, and the rising difficulty — and a first-run map
also carries a short **how-to-play** tutorial to onboard new players. **Win a
debate → choose one of three reward cards** to add to your deck. Rewards are
exclusive (never in a starting deck) and stronger than normal — ±4 predicates and
high-intensity loaded subjects ("My crooked, treasonous opponent"). They **carry
up the ladder**; **lose and the run resets** to the default deck. Beat all six to
win the campaign.

Card **effectiveness scales**, too: a loaded subject multiplies its clause, so
"My crooked, treasonous opponent kicks puppies" outscores plain "My opponent
kicks puppies".

## Deferred

Deeper meta: **appositive insult** cards ("My opponent, who smells of rotting
onions, …"), between-debate deck *editing/removal* (currently you only add),
saving run progress, action-point card costs, art/audio. The engine's
pure-function design leaves room to add these without reworking the core.
