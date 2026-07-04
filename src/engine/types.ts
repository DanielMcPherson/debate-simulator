// Core engine types. Pure data — no DOM, no I/O.
//
// Chunk model (Oh...Sir!!-style): a statement is built from a SUBJECT noun
// phrase plus chunky PREDICATE phrases (mostly complete, some with a fill-in
// object slot), joined by CONNECTORS, optionally capped by an INTENSIFIER.

export type Role =
  | 'np' // a noun phrase: a subject, or an object that fills a predicate's slot
  | 'predicate' // a chunky verb phrase ("kicks puppies", "is a national disgrace")
  | 'modifier' // a post-nominal aside on a subject ("who is ugly", "which is a treasure")
  | 'connector' // "and" / "but" / "because" / "and therefore"
  | 'intensifier' // sentence-final tag that multiplies the whole statement
  | 'powerup'; // a one-shot action card (not part of the sentence)

/** What a power-up card does when played. */
export type PowerEffect = 'search' | 'typo' | 'plant' | 'soundbite' | 'hotmic' | 'filibuster' | 'forgot' | 'redeal' | 'oath';

/** Whose reputation a subject refers to. Drives scoring. */
export type Side = 'self' | 'opponent' | 'audience' | 'neutral';

export type Person = 1 | 2 | 3;
export type GramNumber = 'sing' | 'plural';

/** What a statement does, by subject side × polarity (drives crowd taste & AI style). */
export type Category =
  | 'praise_self'
  | 'self_own'
  | 'attack_opp'
  | 'boost_opp'
  | 'pander_aud'
  | 'insult_aud'
  | 'neutral';

export type DebateStyle = 'brag' | 'attack' | 'pander';

/** What rattles an opponent into a gaffe (discovered by the player, never told). */
export type NervousTrigger = 'attacked' | 'pander' | 'self_brag';

/** A named AI opponent with a fixed debating style and a skill/nerves profile. */
export interface Opponent {
  id: string;
  name: string;
  /** Subject pronoun for UI narration (the round-summary crowd reaction). */
  pronoun: 'she' | 'he' | 'they';
  style: DebateStyle;
  /** One-line character read shown in the UI (e.g. "Nervous. Prone to gaffes."). */
  blurb: string;
  /** Base per-statement chance (0..1) of flubbing into a self-own. High = rookie. */
  gaffeChance: number;
  /** Player statements that fluster this opponent, raising the gaffe chance that
   * turn. Empty/undefined = unflappable. */
  nervousOf?: NervousTrigger[];
}

/** A crowd with a HIDDEN preference: statements of `loves` land harder. */
export interface Crowd {
  id: string;
  loves: Category;
  boost: number;
}

/** A debate question's topic. */
export interface Topic {
  id: string;
  label: string;
  /** Interchangeable open-ended moderator phrasings — one is picked per question
   * (purely flavor; the `id` is what drives scoring). Keeps prompts from repeating. */
  questions: string[];
  /** Reserved for a future "bonus phrase" mechanic. NOT offered as a playable
   * card anymore — you address the topic with normal `topics`-tagged cards. */
  card: Card;
}

/**
 * A draftable card. The fields used depend on `role`.
 *  - np:        side (when subject), sentiment (when object), person/number.
 *  - predicate: pre/lead/post (for conjugation + display); and either
 *               `sentiment` (closed) OR `open`+`affinity`/`deed` (object slot).
 *  - connector: conj.
 *  - intensifier: factor.
 */
export interface Card {
  id: string;
  role: Role;
  /** Optional override display text; otherwise derived (predicates derive from pre/lead/post). */
  text?: string;
  /** Topic ids this card counts as "on topic" for. */
  topics?: string[];

  // --- np ---
  side?: Side;
  sentiment?: number; // np-as-object value, or closed-predicate polarity
  person?: Person;
  number?: GramNumber;
  /** Proper noun — keep its capital even mid-sentence ("Satan"). */
  proper?: boolean;
  /** Subject loadedness: multiplies the clause's impact. Default 1; e.g. "My
   * crooked, treasonous opponent" (1.6) hits harder than plain "My opponent" (1). */
  intensity?: number;
  /** Subject animacy — picks the relative pronoun a modifier uses ("who" for people,
   * "which" for things/abstractions). Default true (most subjects are people). */
  animate?: boolean;

  // --- predicate / modifier ---
  /** Needs an object to fill its trailing slot ("is in bed with ___"). */
  open?: boolean;
  /** Leading verb lemma to conjugate ("kick", "be", "want"). */
  lead?: string;
  /** Adverb before the verb, not conjugated ("secretly"). */
  pre?: string;
  /** Text after the conjugated verb ("puppies", "a national disgrace", "in bed with"). */
  post?: string;
  /** Predicate text used verbatim for all subjects (modal/negated phrasings). */
  invariant?: boolean;
  /** For OPEN predicates: object polarity = deed + affinity × objectSentiment. */
  affinity?: number;
  deed?: number;

  // --- modifier ---
  /** Standalone-display hint for a modifier card ("who"/"which") shown in the hand
   * and catalog. In a clause the SUBJECT's `animate` decides the pronoun, so the
   * rendered aside always agrees with whatever it's played on. */
  rel?: 'who' | 'which';

  // --- connector ---
  // 'and' coordinates (CCAND); 'because'/'and therefore' join logically; 'but'
  // pivots/contrasts; 'period' is the free, unlimited, combo-less clause break.
  conj?: 'and' | 'because' | 'and therefore' | 'but' | 'period';

  // --- intensifier ---
  factor?: number;

  // --- headliner (any role) ---
  /** Headliner: raises the statement's score cap (adds to `headroom` in scoring), so a
   *  powerful card feels powerful instead of clipping at the base cap. Default 0. */
  ceiling?: number;

  // --- upgrade (any role) ---
  /** Upgrade tier (1, 2, …; absent = base card). Display-only marker for a card the
   * player has Punched Up via the Debate Consultant — drives the +/++ badge. Scoring
   * never reads it; an upgraded card's power lives in its normal stat fields. */
  tier?: number;

  // --- powerup ---
  effect?: PowerEffect;

  // --- transient (instance flag) ---
  /** Set on a card a Teleprompter Typo jammed onto a line. The end-trim must NOT
   * strip a jammed card (else the sabotage gets silently undone). */
  jammed?: boolean;
  /** Marks a card that originated from a PRIVATE deck (set at deal time). Lets the
   * turn loop recycle played private cards through `PlayerState.discard` without
   * minting fresh duplicates — so signature cards never multiply past their built
   * count. Shared-pool and virtual (period) cards never carry it. */
  priv?: boolean;
}

/** A card instance placed in a player's building line, in order. */
export type Statement = Card[];

/** An extra noun phrase coordinated onto a subject or object with "and"
 * ("Satan AND THE LOBBYISTS want…", "…destroy Main Street AND OUR CHILDREN").
 * `connIdx` is the token index of its "and" junction (absent when a stray NP was
 * jammed on with no connector — the lenient segmenter still reads the intent). */
export interface CoordNP {
  card: Card;
  /** Token index of the coordinated NP. */
  idx: number;
  /** Token index of the "and" that joined it, if any. */
  connIdx?: number;
}

/** A predicate together with the object filling its slot (if any). */
export interface PredInstance {
  card: Card;
  /** Token index of this predicate in the line (for highlighting the phrase). */
  predIdx?: number;
  object?: Card;
  /** Token index of the object NP, if any (extends the highlight span). */
  objIdx?: number;
  /** Extra objects coordinated with "and" — each scores by its own sentiment. */
  coObjects?: CoordNP[];
  /** The connector coordinating this predicate with the prior one in its clause
   * (e.g. "and", or an elided "and therefore"); undefined for a clause's first. */
  joinedBy?: NonNullable<Card['conj']>;
  /** Token index of that coordinating connector (for inline combo chips). */
  connIdx?: number;
}

/** One parsed clause: a subject and the predicate(s) said about it. */
export interface Clause {
  subject?: Card;
  /** Token index of the subject NP (for highlighting the phrase). */
  subjectIdx?: number;
  /** Extra subjects coordinated with "and" (compound subject) — the clause's first
   * predicate is asserted of each, landing on each subject's own target. */
  coSubjects?: CoordNP[];
  /** Post-nominal modifier asides attached to the subject ("who is ugly"). Their
   * score folds into the clause's first predicate contribution. */
  mods?: Card[];
  /** Token indices of those modifier asides, parallel to `mods`. */
  modIdxs?: number[];
  preds: PredInstance[];
  /** The connector that joined this clause to the previous one (undefined for
   * the first clause). Drives connector-fit combo scoring. */
  joinedByPrev?: NonNullable<Card['conj']>;
  /** Token index of that clause-joining connector (for inline combo chips). */
  connIdx?: number;
}

export interface SentenceStructure {
  clauses: Clause[];
}

export type ReactionLabel =
  | 'cheers'
  | 'approve'
  | 'neutral'
  | 'disapprove'
  | 'boos'
  | 'confused';

/** One scored phrase, for the resolution animation ("what landed and why"). */
export interface PhraseHit {
  category: Category;
  /** Signed delta toward the speaker. Carried ONLY so the UI can bucket the
   * animation's intensity — it is never printed as a number. */
  delta: number;
  /** Anchor word index for the tag (the predicate, or the modifier for an aside). */
  tokenIdx: number;
  /** Inclusive word-index range [start, end] to highlight this clause/aside. Indexes
   * into `displayWords(line)`, which is 1:1 with the card line. */
  span?: [number, number];
  /** A blunder-direction modifier aside (self-own / audience-insult / opponent-boost). */
  aside?: boolean;
  /** The single contribution the hidden crowd loved (got the ×boost). */
  crowdFavorite?: boolean;
}

export interface Reaction {
  /** Signed approval delta toward the speaker, in scorebar units. */
  delta: number;
  label: ReactionLabel;
  detail: string;
  grammatical: boolean;
  /** Set when a correctly-used conjunction earned a combo (the single strongest
   * group — kept for the analytics log). `kind`: 'and' reinforce, 'logic'
   * because/therefore, 'but' pivot. */
  combo?: { kind: 'and' | 'logic' | 'but'; mult: number };
  /** Every connector token that actually formed a combo, with its tier — drives the
   * inline combo chips painted onto the junction words of the JUDGED statement.
   * `tokenIdx` indexes the scored line. */
  comboChips?: { tokenIdx: number; kind: 'and' | 'logic' | 'but' }[];
  /** Per-phrase qualitative breakdown for the resolution animation (complete lines). */
  breakdown?: PhraseHit[];
  /** Statement-level flags (the UI used to fragile-parse these out of `detail`). */
  offTopic?: boolean;
  rambling?: boolean;
  audienceInsulted?: boolean;
  /** The crowd specially loved one of the contributions (hidden-taste boost fired). */
  crowdFavorite?: boolean;
  /** A 'but' deflected a self-own → read as confusion, not outrage. */
  mitigated?: boolean;
  /** Confused because two complete thoughts were jammed together with no connector. */
  runOn?: boolean;
  /** On a confused/ungrammatical line: inclusive word-index range [start, end] of the
   * part where parsing broke (the stray/misplaced tokens), for the resolution "???"
   * highlight. Indexes `displayWords(line)` (1:1 with the card line). Absent when the
   * line is merely unfinished (a valid prefix) rather than wrong. */
  confusedSpan?: [number, number];
}

export type PlayerId = 'player' | 'ai';

export interface PlayerState {
  id: PlayerId;
  /** Private draw pile. */
  deck: Card[];
  /** Private hand (drawn from `deck`). */
  hand: Card[];
  /** Played private cards, parked here at resolution and reshuffled back into
   * `deck` when the draw pile runs low — the private deck's self-sustaining loop. */
  discard: Card[];
  /** Tokens committed to the current statement, in order. */
  line: Statement;
  /** Whether this player has used their one free period this statement (caps a
   * statement at two sentences — chain with conjunctions for more, and a combo). */
  usedPeriod?: boolean;
  /** AI only: this statement is a flub-in-progress — build toward a self-own.
   * Rolled once when the statement starts (in `aiTurn`), cleared at resolution. */
  gaffing?: boolean;
  /** Compelled by Under Oath: this question, build the most self-damaging
   * statement reachable (overrides normal play; reset each question). */
  underOath?: boolean;
  /** Multiplier armed by Soundbite, applied to the next completed statement. */
  nextMultiplier?: number;
  /** Whether this player has revealed the crowd's taste (via Plant in the Audience). */
  knowsCrowd?: boolean;
  /** Whether this player can see the opponent's hand (via Hot Mic). */
  knowsOppHand?: boolean;
  /** Whether this player has ended their statement this round. */
  done: boolean;
  /** Last scored reaction this round (for UI). */
  lastReaction?: Reaction;
}

export interface GameState {
  /** Audience favor: -100 (fully AI) .. +100 (fully player). 0 = dead heat. */
  bar: number;
  /** Current question number (each question = one fresh deal). */
  round: number;
  maxRounds: number;
  /** The topic the current question is about. */
  topic?: Topic;
  /** The moderator phrasing chosen for the current question (from `topic.questions`). */
  question?: string;
  /** The named opponent for this debate (fixed). */
  opponent?: Opponent;
  /** The crowd's hidden preference for this debate (fixed; never shown). */
  crowd?: Crowd;
  /** Reward cards carried in from the run, shuffled into the player's private deck. */
  playerBonus?: Card[];
  /** Base ids the player has cut from their deck (Debate Consultant). Filtered out of the
   *  player's private deck at build time so a leaner deck draws its best cards more often. */
  removedCards?: string[];
  /** Original base id → upgrade tier (Debate Consultant "Punch Up the Zingers").
   *  Player-only; applied at deck build AFTER `removedCards`, mapping each built card
   *  through its authored upgrade chain (see UPGRADES in cards.ts). */
  upgrades?: Record<string, number>;
  /** First-debate onboarding: guarantees a combo-friendly first hand and a simple,
   * non-gaffe opponent on question 1 (drives the UI's first-question hints). */
  tutorial?: boolean;
  /** Shared public deck and the face-up contested pool drawn from it. */
  sharedDeck: Card[];
  pool: Card[];
  poolSize: number;
  handSize: number;
  player: PlayerState;
  ai: PlayerState;
  turn: PlayerId;
  /** Set when a sabotage power-up just hit someone (for the UI alert). `kind`
   * distinguishes a Teleprompter Typo (jammed a card on) from a Forgot My Line
   * (knocked their last card off). Defaults to 'typo' when absent. */
  lastSabotage?: { victim: PlayerId; by: PlayerId; text: string; kind?: 'typo' | 'forgot' | 'hotmic' };
  /** Both statements are in; paused on the result until the player continues. */
  awaitingNext?: boolean;
  winner?: PlayerId | 'tie';
  log: string[];
  /** Structured analytics/debug trail (every deal, play, power-up, resolution,
   * sabotage, win) — downloadable from the UI for bug-hunting & difficulty tuning. */
  events: GameEvent[];
}

/** One structured event in the analytics trail. `t` is the type; the rest is
 * type-specific (card/source on a play, delta/combo/gaffe on a resolution, etc.). */
export interface GameEvent {
  t: 'deal' | 'take' | 'power' | 'sabotage' | 'resolve' | 'win';
  round: number;
  by?: PlayerId;
  [k: string]: unknown;
}

export type Move =
  // 'period' is the free, always-available virtual connector (not from pool/hand).
  | { kind: 'take'; from: 'pool' | 'hand' | 'period'; cardId: string }
  // play a power-up from your hand. For Teleprompter Typo, target* names the card
  // to jam onto the opponent; for Hot Mic, the card (from 'oppHand') to steal.
  | { kind: 'power'; cardId: string; targetFrom?: 'pool' | 'hand' | 'oppHand'; targetCardId?: string }
  | { kind: 'end' };
