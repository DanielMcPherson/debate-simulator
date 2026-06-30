import './style.css';
import type { Card, Category, GameState, Move, Reaction } from '../engine/types';
import { createGame, applyMove, canEnd, nextQuestion } from '../engine/game';
import { aiTurn } from '../engine/ai';
import { displayWords, cardLabel } from '../engine/morphology';
import { isComplete, canAppend } from '../engine/grammar';
import { LADDER, REWARDS, OPPONENTS, PERIOD, PERIOD_ENABLED } from '../data/cards';

const app = document.getElementById('app')!;
const AI_DELAY = 650;

let aiThinking = false;
let resolving = false; // a statement's resolution animation is playing — lock input
let fxHoldSummary = false; // hold the round-summary panel until the resolving FX finishes
let pendingQuestionCard = false; // show the "next question" card modal before the player acts
let fxSkip = false; // the player clicked to fast-forward the current resolution FX
// A statement's score/chips are held until BOTH speakers have finished the exchange, so the
// first speaker's readout doesn't grow their podium and shove the cards down while the second
// player is still building. `pendingFx` is the first finisher awaiting the other; `fxShownSides`
// gates which podiums currently reveal their score (populated as each side animates at the end).
let pendingFx: 'you' | 'them' | null = null;
const fxShownSides = new Set<'you' | 'them'>();
const FX_STEP = 150; // ms between each phrase/chip reveal
let pendingTypo: string | null = null; // a Teleprompter Typo awaiting its target card
let pendingHotMic: string | null = null; // a Hot Mic awaiting the card to steal
let ackedSabotage: GameState['lastSabotage'] = undefined; // sabotage the player has dismissed

// --- campaign run (Slay-the-Spire-style ladder) ---
let run = { rung: 0, bonus: [] as Card[], character: null as string | null }; // rung + earned cards + chosen candidate
let runScreen: 'tutorial' | 'select' | 'map' | 'result' | 'reward' | 'defeat' | 'victory' | null = null;

// The player's selectable candidates (cosmetic for now — portrait + name; art in src/ui/art/portraits).
const PLAYER_CHARACTERS = [
  { id: 'maverick', name: 'The Maverick', tagline: 'A rough-edged outsider who tells it like it is.' },
  { id: 'stateswoman', name: 'The Stateswoman', tagline: 'Polished, commanding, three steps ahead.' },
  { id: 'veteran', name: 'The Veteran', tagline: 'A trusted old hand with a steady reputation.' },
];
let rewardChoices: Card[] = [];
// What the reward dialog's top line says — set by whatever TRIGGERED the reward (debate win
// for now; later: big combos, heel turns, etc., each with their own headline + emoji).
let rewardPrompt: { title: string; body: string } = { title: '🏆 A Reward!', body: 'Choose a card.' };
let aiMaxExtend = LADDER[0].maxExtend;

function startDebate(): GameState {
  const rung = LADDER[run.rung];
  aiMaxExtend = rung.maxExtend;
  runScreen = null;
  rewardChoices = [];
  pendingTypo = null;
  pendingHotMic = null;
  ackedSabotage = undefined;
  aiThinking = false;
  resetRoundFx();
  // Up to 8 questions, ending early at the ±100 landslide.
  return createGame({
    seed: (Date.now() & 0xffff) || 1,
    maxRounds: 8,
    opponentId: rung.opponentId,
    playerBonus: run.bonus,
    tutorial: run.rung === 0, // first debate: guaranteed combo-friendly Q1 hand + simple opponent
  });
}

let game = startDebate();

function newRun(): void {
  run = { rung: 0, bonus: [], character: null };
  tutorialIntroSeen = false; // show the welcome modal again on a fresh run
  lastHintText = null;
  pendingQuestionCard = false;
  game = startDebate();
  runScreen = 'tutorial'; // tutorial → choose candidate → campaign map → debate 1
  render();
}

/** Download the current debate's structured event log as JSON (works on github.io —
 * a user-clicked Blob download; the browser can't auto-write files). */
function downloadDebugLog(): void {
  const payload = {
    exported: new Date().toISOString(),
    debate: run.rung + 1,
    opponent: game.opponent?.id,
    earnedCards: run.bonus.map((c) => c.id),
    question: game.round,
    bar: Math.round(game.bar),
    winner: game.winner,
    events: game.events,
    humanLog: game.log,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `debate-log-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function pickRewards(n: number): Card[] {
  const pool = [...REWARDS];
  const out: Card[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

/** The reward headline for a debate win — flavored by how decisive it was. */
function debateWinPrompt(): { title: string; body: string } {
  const youSupport = Math.round((game.bar + 100) / 2);
  const name = game.opponent?.name ?? 'your opponent';
  if (youSupport >= 72) return { title: '🏆 Great Debate Performance!', body: `You wiped the floor with ${name}. Choose a card.` };
  if (youSupport >= 60) return { title: '🏆 Debate Winner!', body: `You came out clearly ahead of ${name}. Choose a card.` };
  return { title: '🏆 Debate Winner!', body: `You barely squeaked by, but you defeated ${name}. Choose a card.` };
}

/** When a debate ends, set up the reward / victory / defeat screen (once). */
function checkDebateEnd(): void {
  if (!game.winner || runScreen) return;
  if (game.winner === 'player') {
    if (run.rung >= LADDER.length - 1) runScreen = 'victory';
    else {
      // First announce the win in the board's summary area; the reward draft comes after.
      runScreen = 'result';
      rewardChoices = pickRewards(3);
      rewardPrompt = debateWinPrompt();
    }
  } else {
    runScreen = 'defeat'; // a loss or tie ends the run
  }
}

function partialText(line: Card[]): string {
  // Collapse the space before a period card so an in-progress line reads "…jackass."
  return displayWords(line).join(' ').replace(/\s+\./g, '.').trim();
}

/** Index of the opponent's last SPOKEN word (skips a trailing period) — what Typo replaces. */
function oppLastContentIdx(): number {
  const line = game.ai.line;
  for (let i = line.length - 1; i >= 0; i--) if (line[i].role !== 'connector') return i;
  return -1;
}
function oppLastWord(): string {
  const i = oppLastContentIdx();
  return i < 0 ? '' : displayWords(game.ai.line)[i] || '';
}

/** The opponent's in-progress line; while a Typo is armed, highlight the word it'll replace. */
function oppSpeechHtml(): string {
  const line = game.ai.line;
  if (!line.length) return '<span style="color:var(--muted)">…</span>';
  if (!pendingTypo) return partialText(line) || '<span style="color:var(--muted)">…</span>';
  const ci = oppLastContentIdx();
  const words = displayWords(line).map((w, i) => (i === ci && w ? `<span class="typo-target-word">${w}</span>` : w));
  return words.join(' ').replace(/\s+\./g, '.').trim();
}

// Opponent portrait caricatures keyed `${opponentId}-${mood}.webp`. import.meta.glob gives
// Vite-hashed URLs that resolve in dev AND the GitHub Pages build. Missing art → undefined
// (opponents without portraits yet just show a nameplate).
const PORTRAITS = import.meta.glob('./art/portraits/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

type Mood = 'confident' | 'nervous' | 'embarrassed';
/** The opponent's read on the room — picks which portrait expression to show. */
function oppMood(): Mood {
  const r = game.ai.lastReaction;
  // delta is signed toward the speaker — a booed/confused/self-own line reads as just-gaffed.
  if (r && (r.label === 'boos' || r.label === 'confused' || r.delta < -4)) return 'embarrassed';
  if (game.bar > 12) return 'nervous'; // bar is signed toward the player → opponent is behind
  return 'confident';
}
const MOOD_LABEL: Record<Mood, string> = {
  confident: 'Riding high',
  nervous: 'Getting rattled',
  embarrassed: 'Mortified — just gaffed',
};

/** Portrait image URL for a side (player = chosen candidate, confident; opponent = current mood). */
function portraitUrl(side: 'you' | 'them'): string | undefined {
  if (side === 'you') {
    const ch = PLAYER_CHARACTERS.find((c) => c.id === run.character);
    return ch ? PORTRAITS[`./art/portraits/player-${ch.id}-confident.webp`] : undefined;
  }
  return game.opponent ? PORTRAITS[`./art/portraits/${game.opponent.id}-${oppMood()}.webp`] : undefined;
}

/** In-character one-liners for the question card, varied by who's ahead (deterministic per question). */
function questionCommentary(): { you: string; opp: string } {
  const bar = game.bar; // + = player ahead
  const nick = (game.opponent?.name ?? 'Opponent').split(' ').pop();
  const youAhead = ['I’ve got the room — keep the momentum.', 'The crowd’s with me. Don’t let up now.', 'Pulling ahead. Stay sharp.'];
  const youEven = ['Neck and neck — this one counts.', 'Anyone’s game. Let’s win this room.', 'Dead heat. Time to land a big one.'];
  const youBehind = ['He’s slightly ahead, but I can make a comeback.', 'Down, not out — time to turn it around.', 'Okay. Claw it back, one zinger at a time.'];
  const oppCocky = [`You’ve got this, ${nick}! Keep telling them what they want to hear!`, 'Too easy. This amateur doesn’t stand a chance.', 'Keep flailing, kid. The crowd loves ME.'];
  const oppEven = ['Game on. May the biggest liar win.', `Turn on the charm, ${nick}. Don’t blow it.`, 'Time to say absolutely nothing, beautifully.'];
  const oppWorried = ['I’m slipping — time to play dirty.', `How is this clown winning? Dig deep, ${nick}.`, 'Pull it together. The polls are tightening.'];
  const you = bar > 8 ? youAhead : bar < -8 ? youBehind : youEven;
  const opp = bar < -8 ? oppCocky : bar > 8 ? oppWorried : oppEven; // player behind ⇒ opponent is cocky
  const i = Math.abs(Math.round(bar) + game.round * 3); // stable per question, varies across the debate
  return { you: you[i % you.length], opp: opp[i % opp.length] };
}

/** The between-questions card: the new question front-and-center + a bit of caricature banter. */
function questionCardHtml(): string {
  const c = questionCommentary();
  const face = (side: 'you' | 'them', fallback: string) => {
    const url = portraitUrl(side);
    return url ? `<img class="qm-face" src="${url}" alt="">` : `<div class="qm-face placeholder">${fallback}</div>`;
  };
  return `<div class="modal-backdrop"><div class="modal question-modal">
    <div class="qm-meta">Question ${game.round} of ${game.maxRounds} &nbsp;·&nbsp; ${game.topic?.label ?? ''}</div>
    <div class="qm-question">“${game.question ?? ''}”</div>
    <div class="qm-banter">
      <div class="qm-side"><div class="qm-bubble you">${c.you}</div>${face('you', '🇺🇸')}<div class="qm-name you">You</div></div>
      <div class="qm-side"><div class="qm-bubble them">${c.opp}</div>${face('them', '🎙️')}<div class="qm-name them">${game.opponent?.name ?? 'Opponent'}</div></div>
    </div>
    <button class="action" id="questionGo">Let’s debate ▶</button>
  </div></div>`;
}

/** A podium header: a portrait (or placeholder) + role label, name, and mood. */
// Portrait and meta are now separate so the podium can place the portrait as a tall
// left column with the name/approval + speech bubble stacked to its right (broadcast look).
function portraitPic(side: 'you' | 'them'): string {
  if (side === 'you') {
    // Player shows ONE flattering portrait, no mood-switching: the comical opponent faces stay
    // consistent across moods, but the flattering player faces don't, so we keep just "confident".
    // (Player mood art still exists — player-<id>-{nervous,embarrassed}.webp — if we re-enable later.)
    const ch = PLAYER_CHARACTERS.find((c) => c.id === run.character);
    const url = ch ? PORTRAITS[`./art/portraits/player-${ch.id}-confident.webp`] : undefined;
    return url
      ? `<img class="portrait" src="${url}" alt="${ch?.name ?? 'You'}">`
      : '<div class="portrait placeholder">🇺🇸</div>';
  }
  const id = game.opponent?.id;
  const mood = oppMood();
  const url = id ? PORTRAITS[`./art/portraits/${id}-${mood}.webp`] : undefined;
  return url
    ? `<img class="portrait" src="${url}" alt="${game.opponent?.name ?? 'Opponent'}">`
    : '<div class="portrait placeholder">🎙️</div>';
}

function podiumMeta(side: 'you' | 'them'): string {
  // Audience support % lives here (near the portrait/mood), not in a separate line.
  const youSupport = Math.round((game.bar + 100) / 2);
  const support = side === 'you' ? youSupport : 100 - youSupport;
  const supportHtml = `<div class="support ${side}">${support}% approval</div>`;
  if (side === 'you') {
    const ch = PLAYER_CHARACTERS.find((c) => c.id === run.character);
    return `<div class="pmeta"><div class="who">You</div>${ch ? `<div class="name">${ch.name}</div>` : ''}${supportHtml}</div>`;
  }
  const id = game.opponent?.id;
  const mood = oppMood();
  const hasArt = !!(id && PORTRAITS[`./art/portraits/${id}-${mood}.webp`]);
  return `<div class="pmeta">
      <div class="who">Opponent</div>
      <div class="name">${game.opponent?.name ?? 'Opponent'}</div>
      <div class="mood them">${hasArt ? MOOD_LABEL[mood] : game.opponent?.blurb ?? ''}</div>
      ${supportHtml}
    </div>`;
}

function reactionClass(r?: Reaction): string {
  if (!r) return '';
  if (r.label === 'cheers' || r.label === 'approve') return 'good';
  if (r.label === 'neutral') return '';
  return 'bad';
}

/** A flowing, candidate-attributed reaction blurb for the round-summary panel.
 * `you` picks 2nd person ("You") vs the opponent's name + "They". The dodge/insult/
 * ramble flags are read from the engine's reaction detail (stable marker strings in
 * scoring.ts), so the panel can re-narrate them without 2nd-person POV bleeding onto
 * the opponent. */
function panelReaction(r: Reaction | undefined, you: boolean, name: string, pronoun = 'they'): string {
  if (!r) return '';
  // Run-on: two complete thoughts crammed together with no connector — its own coaching line.
  if (r.runOn) {
    const subj = you ? 'your' : `${name}’s`;
    return `The crowd is confused by ${subj} rambling statement — make one clear point, or use “and” to chain multiple thoughts.`;
  }
  const Who = you ? 'You' : name; // sentence-start subject (named, so never ambiguous)
  const Sm = you ? 'You' : pronoun.charAt(0).toUpperCase() + pronoun.slice(1); // follow-on subject (She/He/They)
  const who = you ? 'you' : name; // object of "for / on / against / by"
  const mag = Math.abs(r.delta).toFixed(1);
  const cls = reactionClass(r); // 'good' | 'bad' | ''
  // Statement-level flags now come straight off the reaction (no fragile detail-string parsing).
  const dodged = !!r.offTopic;
  const insulted = !!r.audienceInsulted;
  const rambled = !!r.rambling;
  // Target-named cores (who the crowd is reacting to) so each line is self-explanatory.
  const cored: Record<Reaction['label'], string> = {
    cheers: `the crowd roars in approval for ${who}`,
    approve: `the audience nods along with ${who}`,
    neutral: `the crowd gives ${who} only a polite, muted reaction`,
    disapprove: `the room turns against ${who}`,
    boos: `boos rain down on ${who}`,
    confused: `the crowd is left confused by ${who}`,
  };
  // Target-less version, used when the candidate is already named as the sentence subject.
  const bare: Record<Reaction['label'], string> = {
    cheers: 'the crowd roars in approval',
    approve: 'the audience nods along',
    neutral: 'the crowd gives only a polite, muted reaction',
    disapprove: 'the room turns sour',
    boos: 'boos rain down',
    confused: 'the crowd is left confused',
  };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const out: string[] = [];
  if (dodged && cls === 'good') {
    // "You dodged the question, but the crowd roars in approval." — named subject up front.
    out.push(`${Who} dodged the question, but ${bare[r.label]}.`);
  } else {
    out.push(cap(cored[r.label]) + '.');
    if (insulted) out.push(`${Sm} insulted the crowd — no amount of pandering wins them back.`);
    if (dodged) out.push(`${Sm} ${insulted ? 'also ' : ''}dodged the question.`);
  }
  if (rambled) out.push('The crowd starts to nod off.');
  out.push(cls === 'good' ? `+${mag}.` : cls === 'bad' ? `${mag} lost.` : `${r.delta >= 0 ? '+' : ''}${r.delta}.`);
  return out.join(' ');
}

/** A round-level crowd headline for the summary panel — varies by how BOTH statements
 * landed, so the panel doesn't read "The crowd has reacted" every single time. Deterministic
 * per round (derived from the deltas + question number) so it's stable across re-renders. */
function roundHeadline(p?: Reaction, o?: Reaction): string {
  const pd = p?.delta ?? 0; // toward you
  const od = o?.delta ?? 0; // toward the opponent
  const opp = game.opponent?.name ?? 'your opponent';
  let bucket: string[];
  if (pd >= 8 && od >= 8)
    bucket = ['Both land big — the crowd is electrified!', 'A barn-burner — the audience is on its feet.', 'The crowd roars for both of you.'];
  else if (pd >= 4 && pd - od >= 6)
    bucket = ['The crowd swings toward you.', 'You’re winning over the room.', 'The momentum is yours.'];
  else if (od >= 4 && od - pd >= 6)
    bucket = [`The crowd swings toward ${opp}.`, `${opp} is winning over the room.`, `The momentum shifts to ${opp}.`];
  else if (pd <= 2 && od <= 2)
    bucket = ['The crowd is becoming restless.', 'The audience grows impatient.', 'A bored murmur ripples through the hall.'];
  else bucket = ['Audience reaction is mixed.', 'The crowd is split.', 'A muddled round — the room can’t decide.'];
  const seed = Math.abs(Math.round(pd * 10) * 31 + Math.round(od * 10) * 17 + (game.round ?? 0) * 7);
  return `📊 ${bucket[seed % bucket.length]}`;
}

// Qualitative per-phrase labels for the resolution readout — what the play WAS, no numbers.
const CAT_TAG: Record<Category, { label: string; kind: string } | null> = {
  attack_opp: { label: 'ATTACK', kind: 'attack' },
  praise_self: { label: 'BRAG', kind: 'brag' },
  pander_aud: { label: 'PANDER', kind: 'pander' },
  self_own: { label: 'GAFFE', kind: 'blunder' },
  insult_aud: { label: 'INSULT', kind: 'blunder' },
  boost_opp: { label: 'BLUNDER', kind: 'blunder' },
  neutral: null,
};
const COMBO_BLURB: Record<'and' | 'logic' | 'but', string> = { and: 'COMBO!', logic: 'CHAIN!', but: 'PIVOT!' };

/** A JUDGED line rendered word-by-word: each landed phrase glows by category (no
 * layout-shifting overlays), combo connectors become colored chips, and a finisher is
 * gold. The animated *labels* live in the strip below (fxStripHtml), never over the text. */
function judgedSpeechHtml(line: Card[], r: Reaction): string {
  const words = displayWords(line);
  const n = words.length;
  // Confused/ungrammatical line: mark the span where parsing broke so the FX can flash
  // it red under a big "WHAT??" stamp. Reverts to plain text once the FX ends (like the
  // grammatical path) — markup is transient, clean to screenshot.
  if (!r.grammatical) {
    const [s, e] = r.confusedSpan ?? [-1, -1];
    let h = '';
    for (let i = 0; i < n; i++) {
      const w = words[i];
      if (!w) continue;
      const bad = i >= s && i <= e;
      const startsPunct = /^[.,]/.test(w);
      h += (h && !startsPunct ? ' ' : '') + `<span class="w${bad ? ' confused' : ''}">${w}</span>`;
    }
    h += `<span class="fx-stamp">${r.runOn ? 'RUN-ON?!' : 'WHAT??'}</span>`;
    return /[.!?]\s*$/.test(words.filter(Boolean).join('')) ? h : h + '.';
  }
  const cat: (string | undefined)[] = new Array(n); // per-word phrase kind (for the glow)
  const hitOf: (number | undefined)[] = new Array(n); // breakdown index — syncs the word pulse to its chip
  (r.breakdown ?? []).forEach((h, hi) => {
    const meta = CAT_TAG[h.category];
    if (!meta) return;
    const [s, e] = h.span ?? [h.tokenIdx, h.tokenIdx];
    for (let i = Math.max(0, s); i <= Math.min(n - 1, e); i++) {
      cat[i] = meta.kind;
      hitOf[i] = hi;
    }
  });
  const chipKind: (string | undefined)[] = new Array(n);
  for (const c of r.comboChips ?? []) chipKind[c.tokenIdx] = c.kind;

  let html = '';
  for (let i = 0; i < n; i++) {
    const w = words[i];
    if (!w) continue;
    const classes = ['w'];
    if (cat[i]) classes.push('hit', `cat-${cat[i]}`);
    if (chipKind[i]) classes.push('wchip', `kind-${chipKind[i]}`);
    if (line[i]?.role === 'intensifier') classes.push('finisher'); // teach: finishers stand out (they multiply)
    const data = hitOf[i] !== undefined ? ` data-hit="${hitOf[i]}"` : '';
    const startsPunct = /^[.,]/.test(w);
    html += (html && !startsPunct ? ' ' : '') + `<span class="${classes.join(' ')}"${data}>${w}</span>`;
  }
  // Ensure a closing period the way renderSentence does.
  return /[.!?]\s*$/.test(words.filter(Boolean).join('')) ? html : html + '.';
}

/** The animated readout strip BELOW the statement: a chip per landed phrase, the combo,
 * the finisher, and any flags — popped in sequence by playResolutionFx. Never overlaps text. */
function fxStripHtml(r: Reaction | undefined, line: Card[]): string {
  if (!r) return '';
  const chips: string[] = [];
  if (r.grammatical) {
    (r.breakdown ?? []).forEach((h, hi) => {
      const meta = CAT_TAG[h.category];
      if (meta) chips.push(`<span class="fx-chip cat-${meta.kind}" data-hit="${hi}">${meta.label}</span>`);
    });
    if (r.combo) {
      const cnt = (r.comboChips?.length ?? 1) > 1 ? ` ×${r.comboChips!.length}` : '';
      chips.push(`<span class="fx-chip combo kind-${r.combo.kind}">⚡ ${COMBO_BLURB[r.combo.kind]}${cnt}</span>`);
    }
    if (line.some((c) => c.role === 'intensifier')) chips.push(`<span class="fx-chip finisher">⭐ FINISHER</span>`);
    if (r.offTopic) chips.push(`<span class="fx-chip flag offtopic">⌖ OFF TOPIC</span>`);
    if (r.rambling) chips.push(`<span class="fx-chip flag ramble">💤 RAMBLING</span>`);
  } else if (r.confusedSpan) {
    // The "WHAT??"/"RUN-ON!" chip lights the broken span (see playResolutionFx).
    chips.push(`<span class="fx-chip flag confused" data-confused="1">❓ ${r.runOn ? 'RUN-ON!' : 'WHAT??'}</span>`);
  }
  return chips.length ? `<div class="fx-strip">${chips.join('')}</div>` : '';
}

/** The animated count-up score for a resolved statement (the ONE number shown). */
function tallyHtml(r?: Reaction): string {
  if (!r || !r.grammatical) return '';
  const cls = r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : 'zero';
  return `<div class="fx-tally ${cls}" data-delta="${r.delta}">${fmtDelta(r.delta)}</div>`;
}
function fmtDelta(d: number): string {
  return `${d > 0 ? '+' : ''}${d.toFixed(1)}`;
}

/** A done speaker shows their JUDGED line (animatable); otherwise the in-progress text. */
function speechHtml(side: 'you' | 'them'): string {
  const p = side === 'you' ? game.player : game.ai;
  // Animate the judged line for both a grammatical statement and a confused one that has a
  // pinpointed bad span (so the "WHAT??" highlight can play); a merely-unfinished line falls through.
  if (p.done && p.lastReaction && (p.lastReaction.grammatical || p.lastReaction.confusedSpan))
    return judgedSpeechHtml(p.line, p.lastReaction);
  if (side === 'them') return oppSpeechHtml();
  return partialText(game.player.line) || '<span style="color:var(--muted)">…</span>';
}

function canPlay(): boolean {
  return game.turn === 'player' && !game.player.done && !game.winner;
}

/** Does this card help answer the current question's topic? */
function onTopic(c: Card): boolean {
  return !!game.topic && !!c.topics?.includes(game.topic.id);
}

type TutorialStep = { roles: Card['role'][]; text: string; end?: boolean };
let currentHint: TutorialStep | null = null; // set each render; drives the first-question hints
let tutorialIntroSeen = false; // the "Tap a subject…" welcome modal has been dismissed
let lastHintText: string | null = null; // last shown hint text — to pop the banner only when it changes

/** The onboarding hint for the FIRST question of the first debate only: walks the player
 * through subject → verb → connector → subject → verb → finisher → End. Returns the card
 * role(s) to glow + the instruction (and whether to glow the End button). Null = no hint. */
function tutorialStep(): TutorialStep | null {
  if (run.rung !== 0 || game.round !== 1) return null; // first question of the first debate only
  if (game.winner || game.awaitingNext || resolving) return null;
  if (game.turn !== 'player' || game.player.done) return null; // only while you're building
  const line = game.player.line;
  if (line.length === 0) return { roles: ['np'], text: 'Tap a subject card to start your statement.' };
  const last = line[line.length - 1];
  if (last.role === 'connector') return { roles: ['np'], text: 'Now tap a subject to begin your next point.' };
  if (!isComplete(line))
    return {
      roles: ['predicate'],
      // Reassure about agreement — a playtester thought a plural subject couldn't take "is".
      text: 'Tap a verb to say something about them. Don’t worry about plurals — “is/are” auto-matches the subject.',
    };
  const hasConn = line.some((c) => c.role === 'connector' && c.conj !== 'period');
  if (!hasConn) return { roles: ['connector'], text: 'Tap “and” to chain a second point — combos score big!' };
  const finisher = [...game.pool, ...game.player.hand].some((c) => c.role === 'intensifier' && canAppend(line, c));
  if (finisher) return { roles: ['intensifier'], text: 'Play a Finisher to end strong — or tap End Statement.', end: true };
  return { roles: [], text: 'Tap End Statement to lock in your combo!', end: true };
}

// Player-facing grammatical-function labels (the real engine roles, no invented words).
// "Noun" (not "Subject") because an np plays as subject OR object.
const ROLE_LABEL: Record<Card['role'], string> = {
  np: 'Noun',
  predicate: 'Verb',
  connector: 'Connector',
  modifier: 'Aside',
  intensifier: 'Finisher',
  powerup: 'Action',
};
// On-topic glow is a DEBUG aid now (catches mislabeled `topics`), hidden in normal play.
// Re-enable by loading the page with ?debug.
const DEBUG = new URLSearchParams(location.search).has('debug');

/** A card's face: the phrase + a grammatical-role banner. No scoring numbers on cards.
 * `hint` puts a pointing-hand on the role banner during the first-question tutorial. */
function cardFace(c: Card, hint = false): string {
  const hand = hint ? '<span class="hint-hand">👉</span>' : '';
  return `<span class="ctext">${cardLabel(c)}</span><span class="banner">${hand}${ROLE_LABEL[c.role]}</span>`;
}

// A flickable card rail: a side label badge, a scrollable card row (keeps its #id +
// .cards hooks), prev/next chevrons, and a pagination-dots strip filled by setupRails().
function carousel(id: 'pool' | 'hand' | 'opphand', label: string, inner: string, title = ''): string {
  return `<div class="carousel">
    <span class="rail-label"${title ? ` title="${title}"` : ''}>${label}</span>
    <button class="rail-arrow prev" data-rail="${id}" aria-label="Scroll ${label} left">‹</button>
    <div class="cards" id="${id}">${inner}</div>
    <button class="rail-arrow next" data-rail="${id}" aria-label="Scroll ${label} right">›</button>
    <div class="rail-dots" data-dots="${id}" aria-hidden="true"></div>
  </div>`;
}

// The first-question tutorial instruction, rendered as a panel filling the spare space in the
// hand row (Q1 hand is ≤4 cards, no power-ups) — so the coaching lives INSIDE the established
// play area instead of adding a banner that grows the visible region.
function tutHintHtml(): string {
  if (!currentHint || !tutorialIntroSeen) return '';
  return `<div class="tut-hint">👉 ${currentHint.text}</div>`;
}

function cardHtml(c: Card, source: 'pool' | 'hand'): string {
  if (c.role === 'powerup') {
    const isTypo = c.effect === 'typo';
    // Typo needs a live opponent statement to jam; Forgot needs one with a card to drop.
    const noTypoTarget = isTypo && (game.ai.done || game.ai.line.length === 0); // needs a last word to replace
    const noForgotTarget = c.effect === 'forgot' && (game.ai.done || game.ai.line.length === 0);
    const disabled = !canPlay() || noTypoTarget || noForgotTarget ? 'disabled' : '';
    const sel = pendingTypo === c.id || pendingHotMic === c.id ? ' selecting' : '';
    // fx-<effect> gives each power-up its own color so they aren't all "the purple card".
    return `<button class="card power fx-${c.effect}${sel}" data-id="${c.id}" data-power="1" data-effect="${c.effect}" ${disabled}>${cardFace(c)}</button>`;
  }
  // While choosing a Typo target, sentence cards become jam targets (still full faces).
  if (pendingTypo) {
    return `<button class="card ${source} role-${c.role} target" data-id="${c.id}" data-from="${source}">${cardFace(c)}</button>`;
  }
  const isIntens = c.role === 'intensifier';
  // A finisher is an END move: playable only when your line is already a complete
  // sentence (so appending it is grammatical). It then banks the bonus and ends your turn.
  const canFinish = isIntens && canAppend(game.player.line, c);
  const disabled = !canPlay() || (isIntens && !canFinish) ? 'disabled' : '';
  const hinted = !!currentHint && currentHint.roles.includes(c.role);
  const cls = `card ${source} role-${c.role}${DEBUG && onTopic(c) ? ' ontopic' : ''}${hinted ? ' hint' : ''}`;
  return `<button class="${cls}" data-id="${c.id}" data-from="${source}" ${disabled}>${cardFace(c, hinted)}</button>`;
}

/** Render an opponent's-hand card: a steal target during a Hot Mic, else read-only intel. */
function oppCardHtml(c: Card): string {
  if (pendingHotMic) {
    const tint = c.role === 'powerup' ? `power fx-${c.effect}` : `role-${c.role}`;
    return `<button class="card ${tint} target" data-id="${c.id}" data-from="oppHand">${cardFace(c)}</button>`;
  }
  return `<span class="oppcard">${cardLabel(c)}</span>`;
}

// Phrased to make the SUBJECT unambiguous (who's doing/receiving what).
const CROWD_LABEL: Record<string, string> = {
  praise_self: 'you talking yourself up',
  attack_opp: 'you attacking your opponent',
  pander_aud: 'being pandered to',
};

function opponentName(id: string): string {
  return OPPONENTS.find((o) => o.id === id)?.name ?? id;
}

function opponentBlurb(id: string): string {
  return OPPONENTS.find((o) => o.id === id)?.blurb ?? '';
}

/** Difficulty by ladder position (1..6 filled stars) — overall toughness, not just
 * planning depth (which plateaus), so the rising challenge reads clearly. */
function difficultyStars(rung: number): string {
  const filled = Math.max(1, Math.min(LADDER.length, rung + 1));
  return '★'.repeat(filled) + '☆'.repeat(LADDER.length - filled);
}

/** The Slay-the-Spire-style ladder: a straight line of opponents you climb. */
function ladderHtml(): string {
  return LADDER.map((rung, i) => {
    const status = i < run.rung ? 'done' : i === run.rung ? 'current' : 'locked';
    const icon = status === 'done' ? '✓' : status === 'current' ? '▶' : '🔒';
    const crown = i === LADDER.length - 1 ? ' 👑' : '';
    // Hide the character read for opponents you haven't reached yet (a little mystery).
    const blurb = status === 'locked' ? '' : `<span class="rung-blurb">${opponentBlurb(rung.opponentId)}</span>`;
    return `<div class="rung ${status}">
        <span class="rung-icon">${icon}</span>
        <span class="rung-name">Debate ${i + 1}: ${opponentName(rung.opponentId)}${crown}${blurb}</span>
        <span class="rung-diff" title="difficulty">${difficultyStars(i)}</span>
      </div>`;
  }).join('');
}

const TUTORIAL_BODY = `
  <div class="howto">
    <div class="howto-title">How to win a debate</div>
    <ul>
      <li>Form a political statement one card at a time.</li>
      <li><b>Brag</b> on yourself, <b>pander</b> to the audience, and <b>tear down</b> your
        opponent:</li>
    </ul>
    <div class="howto-examples">
      <p>“My freedom-hating opponent kicks puppies and secretly eats babies.”</p>
      <p>“My plan, which many say is the best plan ever, will fix absolutely everything.”</p>
      <p>“The great and proud people of this great nation should be proud of how great and proud they are.”</p>
    </div>
    <ul>
      <li>Hit <b>End Statement</b> when you like your line. The audience meter shows who's
        winning over the crowd.</li>
    </ul>
    <div class="howto-foot">Win debates! Build your deck of sound bites, wild promises, and
      attack lines! Try to debate your way to the top! 🇺🇸</div>
  </div>`;

function runModalHtml(): string {
  if (runScreen === 'tutorial') {
    return `<div class="modal-backdrop"><div class="modal map-modal">
      <div class="modal-title" style="color:var(--gold)">📝 How to Debate</div>
      ${TUTORIAL_BODY}
      <button class="action" id="beginTutorial">Got it — pick my candidate ▶</button>
    </div></div>`;
  }
  if (runScreen === 'select') {
    const cards = PLAYER_CHARACTERS.map((c) => {
      const url = PORTRAITS[`./art/portraits/player-${c.id}-confident.webp`];
      const pic = url ? `<img class="char-portrait" src="${url}" alt="${c.name}">` : '<div class="char-portrait"></div>';
      return `<button class="char-card" data-char="${c.id}">${pic}
        <div class="char-name">${c.name}</div>
        <div class="char-tag">${c.tagline}</div></button>`;
    }).join('');
    return `<div class="modal-backdrop"><div class="modal select-modal">
      <div class="modal-title" style="color:var(--gold)">🎙️ Choose Your Candidate</div>
      <p>Who are you on the campaign trail? (Looks only, for now — pick whoever you'd vote for.)</p>
      <div class="char-grid">${cards}</div>
    </div></div>`;
  }
  if (runScreen === 'map') {
    const first = run.rung === 0 && run.bonus.length === 0;
    const title = first ? '🏛️ Welcome to the Campaign Trail' : '🏛️ The Campaign Trail';
    const lead = first
      ? `<p>You're a candidate clawing your way to the nomination through ${LADDER.length}
         televised debates of rising difficulty. Beat each opponent to earn a card and advance.</p>`
      : `<p>You won! On to debate ${run.rung + 1} of ${LADDER.length} — your earned cards come with you.</p>`;
    return `<div class="modal-backdrop"><div class="modal map-modal">
      <div class="modal-title" style="color:var(--gold)">${title}</div>
      ${lead}
      <div class="ladder">${ladderHtml()}</div>
      <button class="action" id="beginDebate">Begin Debate ${run.rung + 1}: ${opponentName(LADDER[run.rung].opponentId)} ▶</button>
    </div></div>`;
  }
  if (runScreen === 'reward') {
    const choices = rewardChoices
      .map((c) => `<button class="card reward role-${c.role}" data-reward="${c.id}">${cardFace(c)}</button>`)
      .join('');
    return `<div class="modal-backdrop"><div class="modal reward-modal">
      <div class="modal-title" style="color:var(--gold)">${rewardPrompt.title}</div>
      <p>${rewardPrompt.body}</p>
      <div class="cards" style="margin-top:8px">${choices}</div>
    </div></div>`;
  }
  if (runScreen === 'victory') {
    return `<div class="modal-backdrop"><div class="modal">
      <div class="modal-title" style="color:var(--gold)">🎉 You won the whole campaign!</div>
      <p>You bested all ${LADDER.length} opponents — the nomination is yours.</p>
      <button class="action" id="newrun">Start a new run</button>
    </div></div>`;
  }
  if (runScreen === 'defeat') {
    return `<div class="modal-backdrop"><div class="modal">
      <div class="modal-title">${game.opponent?.name ?? 'Your opponent'} beat you.</div>
      <p>Your run ends at debate ${run.rung + 1} of ${LADDER.length}. Your earned cards are lost —
      start a fresh run with the default deck.</p>
      <button class="action" id="newrun">Start a new run</button>
    </div></div>`;
  }
  return '';
}

function bannerHtml(): string {
  if (!game.winner) return '';
  if (game.winner === 'player') return `<div class="banner win">🏆 You won the debate!</div>`;
  if (game.winner === 'ai') return `<div class="banner lose">${game.opponent?.name ?? 'Your opponent'} won the debate.</div>`;
  return `<div class="banner tie">The debate ends in a dead heat.</div>`;
}

function render(): void {
  currentHint = tutorialStep(); // first-question onboarding hints (glow + banner)
  // A one-time welcome modal kicks off the very first turn; the banner takes over after "Got it!".
  const showTutorialIntro = !!currentHint && !tutorialIntroSeen && !runScreen;
  const needle = ((100 - game.bar) / 200) * 100; // 0..100 left%; You favored → left (matches podiums)
  // Zero-sum 1v1: bar (-100..+100, signed toward player) shown as audience-support % that sums to 100.
  const youSupport = Math.round((game.bar + 100) / 2);
  // The card area shows a centered panel (not cards) between questions and at a debate win.
  const showPanel = game.awaitingNext || runScreen === 'result';
  const endOk = canPlay() && canEnd(game);
  // The free period is offered wherever the grammar allows a new clause to open —
  // but only once per statement (you get a single period; chain conjunctions for more).
  const periodOk = PERIOD_ENABLED && canPlay() && !pendingTypo && !pendingHotMic && !game.player.usedPeriod && canAppend(game.player.line, PERIOD);

  const sabotaged = !!game.lastSabotage && game.lastSabotage.victim === 'player';
  // A fresh sabotage pops a modal you must dismiss; afterwards it stays as a banner.
  const showSabotageModal = sabotaged && game.lastSabotage !== ackedSabotage;
  const oppName = game.opponent?.name ?? 'Your opponent';
  const isForgot = game.lastSabotage?.kind === 'forgot';
  const isHotMic = game.lastSabotage?.kind === 'hotmic';
  const sabotage = !sabotaged
    ? ''
    : isHotMic
    ? `<div class="sabotage">🎙️ ${oppName} caught you on a hot mic and swiped “<b>${game.lastSabotage!.text}</b>” out of your hand!</div>`
    : isForgot
    ? `<div class="sabotage">⚠️ ${oppName} rattled you — you forgot “<b>${game.lastSabotage!.text}</b>” and it dropped off your statement! Keep building to finish your thought — or End with what's left.</div>`
    : `<div class="sabotage">⚠️ ${oppName} hit the teleprompter — your last word is now “<b>${game.lastSabotage!.text}</b>”! Spin it forward — tack on another sentence to recover (a “but …” helps most) — or End and cut your losses.</div>`;

  // A loud, unmistakable mode banner while a Typo is armed (the word it'll replace
  // is also highlighted on the opponent's podium).
  const typoBanner = pendingTypo
    ? `<div class="typo-banner">🎤 <b>TELEPROMPTER TYPO ARMED.</b> Click one of <b>your</b> cards (pool or hand) to put it in ${oppName}'s mouth — it <b>replaces their last word</b>${oppLastWord() ? ` (the highlighted “<b>${oppLastWord()}</b>”)` : ''}. &nbsp; <i>Click the Typo card again to cancel.</i></div>`
    : '';

  const notes: string[] = [];
  // (Hot Mic steal is now a modal dialog — see below — so no inline note needed.)
  if (game.player.nextMultiplier) notes.push('👏 Soundbite armed — your next statement scores ×1.5.');
  if (game.player.knowsCrowd && game.crowd) {
    notes.push(`🕵️ Your plant reports: this crowd loves <b>${CROWD_LABEL[game.crowd.loves] ?? 'a good show'}</b>.`);
  }
  const finisherNote = notes.map((n) => `<div class="held">${n}</div>`).join('');

  app.innerHTML = `
    <h1><span class="tstar">✦</span>⚖️ DEBATE SIMULATOR ⚖️<span class="tstar">✦</span></h1>
    ${runScreen === 'result' ? '' : bannerHtml()}
    <div class="scorebar-wrap">
      <div class="crowd" aria-hidden="true"></div>
      <div class="scorebar-labels">
        <span class="you">◀ You</span>
        <span class="score-meta">Debate ${run.rung + 1} / ${LADDER.length}</span>
        <span class="them">Opponent ▶</span>
      </div>
      <div class="scorebar"><div class="needle" style="left:${needle}%"></div></div>
    </div>

    <div class="stage">
      <div class="podium you">
        ${portraitPic('you')}
        <div class="pbody">
          ${podiumMeta('you')}
          <div class="speech">${speechHtml('you')}</div>
          ${fxShownSides.has('you') ? fxStripHtml(game.player.lastReaction, game.player.line) : ''}
          ${fxShownSides.has('you') ? tallyHtml(game.player.lastReaction) : ''}
        </div>
      </div>
      <div class="podium them${pendingTypo ? ' typo-target' : ''}">
        ${portraitPic('them')}
        <div class="pbody">
          ${podiumMeta('them')}
          <div class="speech">${speechHtml('them')}</div>
          ${fxShownSides.has('them') ? fxStripHtml(game.ai.lastReaction, game.ai.line) : ''}
          ${fxShownSides.has('them') ? tallyHtml(game.ai.lastReaction) : ''}
        </div>
      </div>
    </div>

    <div class="question-pill"><span class="qstar">✦</span><span class="q-num">Question ${game.round}/${game.maxRounds}</span><span class="q-topic">${game.topic?.label ?? '—'}</span> — “${game.question ?? ''}”<span class="qstar">✦</span></div>

    ${
      runScreen === 'result'
        ? `<div class="round-summary">
            <div class="rs-title">🏆 You beat ${game.opponent?.name ?? 'your opponent'}!</div>
            <div class="rs-standing"><span class="you">You ${youSupport}%</span> &nbsp;·&nbsp; <span class="them">${100 - youSupport}% ${game.opponent?.name ?? 'Opponent'}</span></div>
            <div class="rs-progress">Debate ${run.rung + 1} of ${LADDER.length} won</div>
            <button class="action" id="toReward">Choose your reward ▶</button>
          </div>`
        : game.awaitingNext && fxHoldSummary
        ? `<div class="round-summary holding"><div class="rs-title">📊 The votes are coming in…</div></div>`
        : game.awaitingNext
        ? `<div class="round-summary">
            <div class="rs-title">${roundHeadline(game.player.lastReaction, game.ai.lastReaction)}</div>
            <div class="rs-reactions">
              ${game.player.lastReaction ? `<p class="${reactionClass(game.player.lastReaction)}">${panelReaction(game.player.lastReaction, true, 'You')}</p>` : ''}
              ${game.ai.lastReaction ? `<p class="${reactionClass(game.ai.lastReaction)}">${panelReaction(game.ai.lastReaction, false, game.opponent?.name ?? 'Your opponent', game.opponent?.pronoun)}</p>` : ''}
            </div>
            <div class="rs-standing"><span class="you">You ${youSupport}%</span> &nbsp;·&nbsp; <span class="them">${100 - youSupport}% ${game.opponent?.name ?? 'Opponent'}</span></div>
            ${game.round >= game.maxRounds ? '<div class="rs-progress">Final question complete — tallying the debate…</div>' : ''}
            <button class="action" id="next">Next Question ▶</button>
          </div>`
        : `${carousel(
            'pool',
            `Shared Pool${DEBUG ? ' <span class="ontopic-key">✓ on topic</span>' : ''}`,
            game.pool.map((c) => cardHtml(c, 'pool')).join('') || '<span class="rail-empty">(pool empty)</span>',
            'Contested — no refill this question',
          )}
          ${carousel(
            'hand',
            'Your Hand',
            (game.player.hand.map((c) => cardHtml(c, 'hand')).join('') || '<span class="rail-empty">(hand empty)</span>') +
              tutHintHtml(), // Q1 tutorial coaching fills the hand row's spare space
            'Private — no refill this question',
          )}`
    }

    ${typoBanner}
    ${sabotage}
    ${finisherNote}

    ${
      showTutorialIntro
        ? `<div class="modal-backdrop"><div class="modal tutorial-modal">
            <div class="modal-title">👋 Your turn to speak!</div>
            <p>Tap a <b>subject</b> card to start your statement.</p>
            <button class="action" id="tutorialGotIt">Got it!</button>
          </div></div>`
        : pendingQuestionCard && !game.winner && !runScreen
        ? questionCardHtml()
        : ''
    }

    ${
      pendingHotMic
        ? `<div class="modal-backdrop"><div class="modal hotmic-modal">
            <div class="modal-title" style="color:#ff7ad6">🎙️ Hot Mic — Steal a Card</div>
            <p>Grab a card from ${game.opponent?.name ?? 'the opponent'}'s hand and add it to your own:</p>
            <div class="cards steal-grid">${game.ai.hand.map(oppCardHtml).join('') || '<span style="color:var(--muted)">(their hand is empty)</span>'}</div>
            <button class="ghost" id="cancelHotMic">Cancel</button>
          </div></div>`
        : ''
    }

    ${
      showPanel
        ? ''
        : `<div class="controls">
      <button class="action${currentHint?.end ? ' hint' : ''}" id="end" ${endOk ? '' : 'disabled'}><span class="btn-ico">🎤</span>${currentHint?.end ? '👉 ' : ''}End Statement</button>
      ${PERIOD_ENABLED ? `<button class="ghost" id="period" ${periodOk ? '' : 'disabled'} title="${game.player.usedPeriod ? 'Already used your one period this statement — chain a connector to keep going.' : 'Free, once per statement — finish this sentence and start a new one. No combo bonus; use a connector for that.'}">Add “.” (new sentence)${game.player.usedPeriod ? ' — used' : ''}</button>` : ''}
      <button class="ghost danger" id="restart"><span class="btn-ico">🏛️</span>Abandon Run</button>
      <button class="ghost" id="dumplog" title="Download a JSON event log of this debate for bug analysis"><span class="btn-ico">🐞</span>Debug</button>
    </div>`
    }

    ${
      showSabotageModal
        ? isHotMic
          ? `<div class="modal-backdrop"><div class="modal">
            <div class="modal-title">🎙️ Caught on a hot mic!</div>
            <p>${oppName} caught you on a hot mic and swiped “<b>${game.lastSabotage!.text}</b>”
            right out of your hand — and got a peek at the rest of it.</p>
            <p>Nothing to be done about it now. Make the cards you've still got count.</p>
            <button class="action" id="ackSabotage">Got it — continue</button>
          </div></div>`
          : isForgot
          ? `<div class="modal-backdrop"><div class="modal">
            <div class="modal-title">🧠 You forgot your line!</div>
            <p>${oppName} used <b>Forgot My Line</b> to knock “<b>${game.lastSabotage!.text}</b>”
            off the end of your statement. It now reads:</p>
            <p class="modal-quote">“${partialText(game.player.line) || '…'}”</p>
            <p>Pick up where you left off and finish the thought — or End with what's left.</p>
            <button class="action" id="ackSabotage">Got it — continue</button>
          </div></div>`
          : `<div class="modal-backdrop"><div class="modal">
            <div class="modal-title">⚠️ You've been sabotaged!</div>
            <p>${oppName} hit the teleprompter — your last word got swapped to
            “<b>${game.lastSabotage!.text}</b>”. Your statement now reads:</p>
            <p class="modal-quote">“${partialText(game.player.line) || '…'}”</p>
            <p>You can spin it forward — add another sentence to recover (a “<b>but …</b>”
            helps most), or End and cut your losses.</p>
            <button class="action" id="ackSabotage">Got it — continue</button>
          </div></div>`
        : ''
    }

    ${runModalHtml()}
  `;

  // Pop the in-hand hint panel to grab attention whenever its text changes (i.e. the player just
  // played a card and the next step updated). rAF runs after the synchronous render chain,
  // so it lands on the final element even when render() is called twice in a tick.
  if (currentHint && tutorialIntroSeen && currentHint.text !== lastHintText) {
    lastHintText = currentHint.text;
    requestAnimationFrame(() => {
      app.querySelector('.tut-hint')?.classList.add('pop');
      // The bigger pool scrolls horizontally, so the card the hint points at may be off-screen.
      // Bring the hinted card (or the End button) into view so the 👉 is never hidden.
      const target =
        app.querySelector<HTMLElement>('.card.hint') ?? app.querySelector<HTMLElement>('#end.hint');
      target?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    });
  } else if (!currentHint) {
    lastHintText = null; // reset so it pops fresh next time it appears
  }

  app.querySelectorAll<HTMLButtonElement>('.card').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Picking a reward card after a win.
      if (btn.dataset.reward) {
        const card = REWARDS.find((c) => c.id === btn.dataset.reward);
        if (card) {
          run.bonus.push(card);
          run.rung += 1;
          game = startDebate();
          runScreen = 'map'; // show the ladder + next opponent before the next debate
          render();
        }
        return;
      }
      const id = btn.dataset.id!;
      // Choosing a card to steal for a pending Hot Mic.
      if (pendingHotMic) {
        if (btn.dataset.power) {
          pendingHotMic = null; // clicking a power-up cancels
          render();
          return;
        }
        if (btn.dataset.from === 'oppHand') {
          const hm = pendingHotMic;
          pendingHotMic = null;
          playerMove({ kind: 'power', cardId: hm, targetFrom: 'oppHand', targetCardId: id });
          return;
        }
        return; // ignore other clicks while choosing what to steal
      }
      // Choosing a target for a pending Teleprompter Typo.
      if (pendingTypo) {
        if (btn.dataset.power) {
          pendingTypo = null; // clicking a power-up cancels targeting
          render();
          return;
        }
        const from = btn.dataset.from as 'pool' | 'hand';
        const typoId = pendingTypo;
        pendingTypo = null;
        playerMove({ kind: 'power', cardId: typoId, targetFrom: from, targetCardId: id });
        return;
      }
      if (btn.dataset.power) {
        if (btn.dataset.effect === 'typo') {
          pendingTypo = id; // enter target-selection mode
          render();
          return;
        }
        if (btn.dataset.effect === 'hotmic') {
          pendingHotMic = id; // reveal their hand and pick a card to steal
          render();
          return;
        }
        playerMove({ kind: 'power', cardId: id });
        return;
      }
      const from = btn.dataset.from as 'pool' | 'hand';
      playerMove({ kind: 'take', from, cardId: id });
    });
  });
  app.querySelector<HTMLButtonElement>('#end')?.addEventListener('click', () => {
    pendingTypo = null;
    pendingHotMic = null;
    playerMove({ kind: 'end' });
  });
  app.querySelector<HTMLButtonElement>('#ackSabotage')?.addEventListener('click', () => {
    ackedSabotage = game.lastSabotage; // dismiss the modal; the banner reminder stays
    render();
  });
  app.querySelector<HTMLButtonElement>('#period')?.addEventListener('click', () => {
    pendingTypo = null;
    pendingHotMic = null;
    playerMove({ kind: 'take', from: 'period', cardId: PERIOD.id });
  });
  app.querySelector<HTMLButtonElement>('#next')?.addEventListener('click', () => {
    if (!game.awaitingNext || resolving) return; // let the resolution FX finish first
    pendingTypo = null;
    pendingHotMic = null;
    nextQuestion(game);
    resetRoundFx(); // fresh round — clear the deferred-score bookkeeping
    pendingQuestionCard = true; // show the next-question card before play resumes
    render();
    // driveAI deferred until the card is dismissed (even questions open on the AI's turn)
  });
  app.querySelector<HTMLButtonElement>('#questionGo')?.addEventListener('click', () => {
    pendingQuestionCard = false; // dismiss the question card and start the round
    render();
    driveAI();
  });
  app.querySelector<HTMLButtonElement>('#tutorialGotIt')?.addEventListener('click', () => {
    tutorialIntroSeen = true; // dismiss the welcome modal; the hint banner takes over
    render();
  });
  app.querySelector<HTMLButtonElement>('#cancelHotMic')?.addEventListener('click', () => {
    pendingHotMic = null; // dismiss the steal dialog without taking a card
    render();
  });
  app.querySelector<HTMLButtonElement>('#toReward')?.addEventListener('click', () => {
    runScreen = 'reward'; // win acknowledged — now show the card draft
    render();
  });
  app.querySelector<HTMLButtonElement>('#restart')?.addEventListener('click', newRun);
  app.querySelector<HTMLButtonElement>('#dumplog')?.addEventListener('click', downloadDebugLog);
  app.querySelector<HTMLButtonElement>('#newrun')?.addEventListener('click', newRun);
  app.querySelector<HTMLButtonElement>('#beginTutorial')?.addEventListener('click', () => {
    runScreen = 'select'; // tutorial dismissed — choose a candidate, then the ladder
    render();
  });
  app.querySelectorAll<HTMLButtonElement>('.char-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      run.character = btn.dataset.char ?? null;
      runScreen = 'map'; // candidate chosen — on to the campaign ladder
      render();
    });
  });
  app.querySelector<HTMLButtonElement>('#beginDebate')?.addEventListener('click', () => {
    runScreen = null; // dismiss the map and step onto the debate stage
    // Open with the question card — except the tutorial's Q1, which has its own welcome modal.
    pendingQuestionCard = !(run.rung === 0 && game.round === 1);
    render();
    if (!pendingQuestionCard) driveAI(); // (debate 1 opens player-first, but stay robust if that changes)
  });

  wireCarousels();
}

// --- flickable card rails: chevrons scroll the row; dots reflect/seek scroll position.
// Arrows + dots auto-hide when a row doesn't overflow. Touch/trackpad swipe works natively
// on the .cards overflow-x; this adds the desktop affordance + a "there's more" cue.
function updateRail(car: HTMLElement): void {
  const cards = car.querySelector<HTMLElement>('.cards');
  const dots = car.querySelector<HTMLElement>('.rail-dots');
  const prev = car.querySelector<HTMLButtonElement>('.rail-arrow.prev');
  const next = car.querySelector<HTMLButtonElement>('.rail-arrow.next');
  if (!cards) return;
  const overflow = cards.scrollWidth - cards.clientWidth;
  const has = overflow > 4;
  car.classList.toggle('has-overflow', has);
  // pages by viewport width; dots are a coarse position cue, not an exact card count
  const pages = has ? Math.max(2, Math.ceil(cards.scrollWidth / cards.clientWidth)) : 0;
  if (dots && dots.childElementCount !== pages) {
    dots.innerHTML = Array.from({ length: pages }, () => '<span class="dot"></span>').join('');
  }
  const cur = pages ? Math.round((cards.scrollLeft / overflow) * (pages - 1)) : 0;
  dots?.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('on', i === cur));
  const atStart = cards.scrollLeft <= 2;
  const atEnd = cards.scrollLeft >= overflow - 2;
  cards.classList.toggle('at-start', has && atStart); // fade only the far edge that has more
  cards.classList.toggle('at-end', has && atEnd);
  if (prev) prev.disabled = atStart;
  if (next) next.disabled = atEnd;
}

let railResizeWired = false;
function wireCarousels(): void {
  app.querySelectorAll<HTMLElement>('.carousel').forEach((car) => {
    const cards = car.querySelector<HTMLElement>('.cards');
    if (!cards) return;
    const step = (dir: number) => cards.scrollBy({ left: dir * cards.clientWidth * 0.8, behavior: 'smooth' });
    car.querySelector<HTMLButtonElement>('.rail-arrow.prev')?.addEventListener('click', () => step(-1));
    car.querySelector<HTMLButtonElement>('.rail-arrow.next')?.addEventListener('click', () => step(1));
    cards.addEventListener('scroll', () => updateRail(car), { passive: true }); // dies with the node on re-render
    updateRail(car);
  });
  // Recompute overflow/dots on viewport changes (no re-render, so no rebinding).
  if (!railResizeWired) {
    railResizeWired = true;
    window.addEventListener('resize', () => app.querySelectorAll<HTMLElement>('.carousel').forEach(updateRail));
  }
}

function fxWait(ms: number): Promise<void> {
  return new Promise((res) => (fxSkip ? res() : window.setTimeout(res, ms)));
}

/** The resolution juice: light up each phrase (what landed + why), pop combo chips on
 * the connectors, count up the score, and flourish. Pure presentation — no engine state.
 * Click anywhere to fast-forward. */
async function playResolutionFx(side: 'you' | 'them', r: Reaction): Promise<void> {
  const podium = app.querySelector<HTMLElement>(`.podium.${side}`);
  const speech = podium?.querySelector<HTMLElement>('.speech');
  if (!podium || !speech) return;
  resolving = true;
  fxSkip = false;
  // Click anywhere to fast-forward — but ARM it only after a grace period, so the click that
  // ended the turn (or a reflexive click toward the Next button when you finish second) doesn't
  // instantly skip the animation. (That was the "player FX sometimes doesn't play" bug.)
  let skipArmed = false;
  const armTimer = window.setTimeout(() => (skipArmed = true), 500);
  const skip = () => {
    if (skipArmed) fxSkip = true;
  };
  document.addEventListener('pointerdown', skip, true);

  // Reveal the readout strip chip-by-chip; each chip briefly highlights its word(s) in sync.
  // `fx-show` turns word markup ON only for the duration of the FX — removed at the end so the
  // statement reverts to a single color + font (clean to screenshot/share).
  const strip = podium.querySelector<HTMLElement>('.fx-strip');
  strip?.classList.add('fx-running');
  speech.classList.add('fx-show', 'fx-dim'); // landed phrases start dim, brighten as their chip lands
  const chips = strip ? [...strip.querySelectorAll<HTMLElement>('.fx-chip')] : [];
  await fxWait(160);
  for (const chip of chips) {
    chip.classList.add('show');
    const hi = chip.getAttribute('data-hit');
    if (hi !== null) speech.querySelectorAll<HTMLElement>(`[data-hit="${hi}"]`).forEach((w) => w.classList.add('lit'));
    else if (chip.classList.contains('confused')) {
      speech.querySelectorAll<HTMLElement>('.w.confused').forEach((w) => w.classList.add('lit'));
      speech.querySelector<HTMLElement>('.fx-stamp')?.classList.add('show'); // big "WHAT??" pops over the line
    } else if (chip.classList.contains('combo')) speech.querySelectorAll<HTMLElement>('.w.wchip').forEach((w) => w.classList.add('lit'));
    else if (chip.classList.contains('finisher')) speech.querySelectorAll<HTMLElement>('.w.finisher').forEach((w) => w.classList.add('lit'));
    await fxWait(FX_STEP);
  }

  // The one number on screen: count it up from zero as the needle settles.
  const tally = podium.querySelector<HTMLElement>('.fx-tally');
  if (tally) {
    const target = r.delta;
    const steps = 12;
    for (let i = 1; i <= steps && !fxSkip; i++) {
      tally.textContent = fmtDelta((target * i) / steps);
      await fxWait(26);
    }
    tally.textContent = fmtDelta(target);
    tally.classList.add('pop');
  }

  flourish(side, r);
  await fxWait(fxSkip ? 0 : 240);

  window.clearTimeout(armTimer);
  document.removeEventListener('pointerdown', skip, true);
  speech.classList.remove('fx-show', 'fx-dim'); // statement returns to plain, single-color text
  strip?.classList.remove('fx-running');
  resolving = false;
}

/** Screen shake + a flash, scaled to the swing — celebratory for a win, a thud for a bomb. */
function flourish(side: 'you' | 'them', r: Reaction): void {
  const stage = app.querySelector<HTMLElement>('.stage');
  const mag = Math.abs(r.delta);
  if (!stage || mag < 4) return;
  const cls = mag >= 12 ? 'fx-shake-lg' : 'fx-shake-sm';
  const tone = r.delta > 0 ? (side === 'you' ? 'fx-cheer' : '') : 'fx-boo';
  stage.classList.add(cls);
  if (tone) stage.classList.add(tone);
  window.setTimeout(() => stage.classList.remove('fx-shake-lg', 'fx-shake-sm', 'fx-cheer', 'fx-boo'), 700);
}

// Clear the deferred-FX bookkeeping at the start of a fresh round / debate.
function resetRoundFx(): void {
  pendingFx = null;
  fxShownSides.clear();
}

// Both speakers have finished (or the debate just ended): reveal + animate the earlier speaker
// first, then the one who just finished, then show the round summary. Deferring the first
// speaker's readout to here is what keeps the podiums compact while the second player builds.
async function playRoundFx(secondSide: 'you' | 'them'): Promise<void> {
  const order: ('you' | 'them')[] =
    pendingFx && pendingFx !== secondSide ? [pendingFx, secondSide] : [secondSide];
  pendingFx = null;
  // Hold the round-summary panel (show the "votes coming in" placeholder) while we animate.
  if (game.awaitingNext && !runScreen) fxHoldSummary = true;
  for (const side of order) {
    const r = side === 'you' ? game.player.lastReaction : game.ai.lastReaction;
    if (!r) continue;
    fxShownSides.add(side); // reveal THIS podium's score (chips stay hidden until the FX pops them)
    render();
    await playResolutionFx(side, r);
  }
  fxHoldSummary = false;
  render(); // reveal the round summary / result now that both have animated
}

async function playerMove(move: Move): Promise<void> {
  if (game.winner || game.awaitingNext || game.turn !== 'player' || aiThinking || resolving) return;
  const wasSpeaking = !game.player.done;
  applyMove(game, move);
  checkDebateEnd();
  // Resolved (done flipped true) covers ending the turn AND playing a finisher (a `take`, not `end`).
  const justResolved = wasSpeaking && game.player.done && !!game.player.lastReaction;
  if (justResolved && (game.ai.done || game.awaitingNext || game.winner)) {
    render();
    await playRoundFx('you'); // player finished the exchange (or won outright) → animate both now
  } else {
    if (justResolved) pendingFx = 'you'; // finished first → wait for the opponent before scoring
    render();
  }
  driveAI();
}

function driveAI(): void {
  if (game.winner || game.awaitingNext || game.turn !== 'ai' || game.ai.done || resolving) {
    aiThinking = false;
    return;
  }
  aiThinking = true;
  render();
  window.setTimeout(async () => {
    const wasAiSpeaking = !game.ai.done;
    const move = aiTurn(game, { maxExtend: aiMaxExtend }); // difficulty rises up the ladder
    applyMove(game, move);
    aiThinking = false;
    checkDebateEnd();
    const justResolved = wasAiSpeaking && game.ai.done && !!game.ai.lastReaction;
    if (justResolved && (game.player.done || game.awaitingNext || game.winner)) {
      render();
      await playRoundFx('them'); // AI finished the exchange → animate both now
    } else {
      if (justResolved) pendingFx = 'them'; // finished first → hold its score until the player ends
      render();
    }
    driveAI(); // keep going if the AI still holds the turn (player already ended)
  }, AI_DELAY);
}

// A gilded broadcast frame hugging the viewport edge, with corner flourishes. Injected ONCE
// (outside #app, so render()'s innerHTML churn never touches it); pointer-events:none, below modals.
const CORNER_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <g fill="none" stroke="#e8c069" stroke-linecap="round">
    <path d="M4 22 L4 4 L22 4" stroke-width="2"/>
    <path d="M11 26 Q11 11 26 11" stroke-width="1.4" opacity="0.7"/>
  </g>
  <circle cx="4" cy="4" r="2.4" fill="#e8c069"/>
</svg>`;
const broadcastFrame = document.createElement('div');
broadcastFrame.className = 'broadcast-frame';
broadcastFrame.setAttribute('aria-hidden', 'true');
broadcastFrame.innerHTML = ['tl', 'tr', 'bl', 'br'].map((c) => `<span class="corner ${c}">${CORNER_SVG}</span>`).join('');
document.body.appendChild(broadcastFrame);

runScreen = 'tutorial'; // open on the tutorial, then the campaign map, before the first debate
render();
