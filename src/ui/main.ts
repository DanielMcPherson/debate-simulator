import './style.css';
import type { Card, GameState, Move, Reaction } from '../engine/types';
import { createGame, applyMove, canEnd, nextQuestion } from '../engine/game';
import { aiTurn } from '../engine/ai';
import { displayWords, cardLabel } from '../engine/morphology';
import { isComplete, canAppend } from '../engine/grammar';
import { LADDER, REWARDS, OPPONENTS, PERIOD } from '../data/cards';

const app = document.getElementById('app')!;
const AI_DELAY = 650;

let aiThinking = false;
let pendingTypo: string | null = null; // a Teleprompter Typo awaiting its target card
let pendingHotMic: string | null = null; // a Hot Mic awaiting the card to steal
let ackedSabotage: GameState['lastSabotage'] = undefined; // sabotage the player has dismissed

// --- campaign run (Slay-the-Spire-style ladder) ---
let run = { rung: 0, bonus: [] as Card[] }; // current rung + earned reward cards
let runScreen: 'tutorial' | 'map' | 'reward' | 'defeat' | 'victory' | null = null;
let rewardChoices: Card[] = [];
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
  // Up to 8 questions, ending early at the ±100 landslide.
  return createGame({
    seed: (Date.now() & 0xffff) || 1,
    maxRounds: 8,
    opponentId: rung.opponentId,
    playerBonus: run.bonus,
  });
}

let game = startDebate();

function newRun(): void {
  run = { rung: 0, bonus: [] };
  game = startDebate();
  runScreen = 'tutorial'; // tutorial first, then the campaign map before debate 1
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

/** When a debate ends, set up the reward / victory / defeat screen (once). */
function checkDebateEnd(): void {
  if (!game.winner || runScreen) return;
  if (game.winner === 'player') {
    if (run.rung >= LADDER.length - 1) runScreen = 'victory';
    else {
      runScreen = 'reward';
      rewardChoices = pickRewards(3);
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

function reactionClass(r?: Reaction): string {
  if (!r) return '';
  if (r.label === 'cheers' || r.label === 'approve') return 'good';
  if (r.label === 'neutral') return '';
  return 'bad';
}

// The combo indicator lives ON the junction word now: a JUDGED statement paints
// each combo-forming connector as a colored chip (the color conveys the move —
// COMBO / CHAIN / PIVOT). No number, no separate callout box. (Juice it later.)
// A punchy combo badge under a resolved statement (placeholder for real juice later).
// `kind` names the move (COMBO/CHAIN/PIVOT, colored by tier); the ×N counts how many
// connectors comboed — magnitude without the (confusing) raw multiplier.
const COMBO_BLURB: Record<'and' | 'logic' | 'but', string> = { and: 'COMBO!', logic: 'CHAIN!', but: 'PIVOT!' };
function comboHtml(r?: Reaction): string {
  if (!r?.combo) return '';
  const n = r.comboChips?.length ?? 1;
  const count = n > 1 ? ` ×${n}` : '';
  return `<div class="combo-callout badge-${r.combo.kind}">⚡ ${COMBO_BLURB[r.combo.kind]}${count}</div>`;
}

function canPlay(): boolean {
  return game.turn === 'player' && !game.player.done && !game.winner;
}

/** Does this card help answer the current question's topic? */
function onTopic(c: Card): boolean {
  return !!game.topic && !!c.topics?.includes(game.topic.id);
}

function cardHtml(c: Card, source: 'pool' | 'hand', held: boolean): string {
  if (c.role === 'powerup') {
    const isTypo = c.effect === 'typo';
    // Typo needs a live opponent statement to jam; Forgot needs one with a card to drop.
    const noTypoTarget = isTypo && (game.ai.done || game.ai.line.length === 0); // needs a last word to replace
    const noForgotTarget = c.effect === 'forgot' && (game.ai.done || game.ai.line.length === 0);
    const disabled = !canPlay() || noTypoTarget || noForgotTarget ? 'disabled' : '';
    const sel = pendingTypo === c.id || pendingHotMic === c.id ? ' selecting' : '';
    // fx-<effect> gives each power-up its own color so they aren't all "the purple card".
    return `<button class="card power fx-${c.effect}${sel}" data-id="${c.id}" data-power="1" data-effect="${c.effect}" ${disabled}>${cardLabel(c)}</button>`;
  }
  // While choosing a Typo target, sentence cards become jam targets.
  if (pendingTypo) {
    return `<button class="card ${source} target" data-id="${c.id}" data-from="${source}">${cardLabel(c)}</button>`;
  }
  const isIntens = c.role === 'intensifier';
  // A finisher can be grabbed any time, but only one may be held at once.
  const disabled = !canPlay() || (isIntens && held) ? 'disabled' : '';
  // TEMPORARY (debug aid): the on-topic glow + "on topic ✓" tag make it obvious if any
  // card's `topics` are mislabeled. REMOVE LATER — players should learn to spot on-topic
  // cards themselves (drop the `.ontopic` class + the tag below, and `onTopic`/.ontopic CSS).
  const cls = `card ${source}${isIntens ? ' intens' : ''}${onTopic(c) ? ' ontopic' : ''}`;
  const tag = isIntens ? '<span class="role">commit finisher ✦</span>' : onTopic(c) ? '<span class="role">on topic ✓</span>' : '';
  return `<button class="${cls}" data-id="${c.id}" data-from="${source}" ${disabled}>${tag}${cardLabel(c)}</button>`;
}

/** Render an opponent's-hand card: a steal target during a Hot Mic, else read-only intel. */
function oppCardHtml(c: Card): string {
  if (pendingHotMic) return `<button class="card them target" data-id="${c.id}" data-from="oppHand">${cardLabel(c)}</button>`;
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
      <li><b>Build a sentence</b> one card at a time: a <b>subject</b> (who you're talking about),
        then a <b>predicate</b> (what they do). <b>Praise</b> yourself and the audience,
        <b>attack</b> your opponent — never praise a villain or trash yourself (the crowd boos a self-own).</li>
      <li><b>You get one free period per statement.</b> Tap <b>“.”</b> to end a sentence and start
        a second one — <i>“My opponent eats babies. I love this country.”</i> Run two thoughts together
        with no connector and the crowd is just baffled, so punctuate (or chain a connector below).</li>
      <li><b>Conjunctions score combos — when used correctly.</b> Chain <i>different</i> points that
        both help you with <b>and</b> / <b>because</b>: <i>“…is corrupt and kicks puppies”</i> beats
        two flat sentences. Repeating the same point doesn't combo.</li>
      <li><b>“But” is the strongest combo</b>, on a them-bad → you-good pivot:
        <i>“My opponent is bad but I am great.”</i> Misusing a connector just fizzles (no penalty),
        and a well-placed <b>but</b> can even soften a self-own from outrage into a confused shrug.</li>
      <li><b>Answer the question.</b> Each round has a topic — cards that address it glow
        <span style="color:#6fcf97">green ✓</span>. Ignore the question and your score shrinks, so
        weave the topic into your best line. <b>Don't ramble:</b> past ~3 plain sentences the crowd
        nods off — tighten up or combo instead.</li>
      <li>Play <b>power-ups</b> (steal cards, sabotage their line, read the crowd), and watch the
        meter — most audience favor after 8 questions wins. You can <b>End</b> anytime, but an
        unfinished sentence just leaves the crowd confused — so finish your thought.</li>
    </ul>
    <div class="howto-foot">Win a debate to draft a powerful card and climb the ladder. Lose
      and the run resets. Good luck out there. 🇺🇸</div>
  </div>`;

function runModalHtml(): string {
  if (runScreen === 'tutorial') {
    return `<div class="modal-backdrop"><div class="modal map-modal">
      <div class="modal-title" style="color:var(--gold)">📝 How to Debate</div>
      ${TUTORIAL_BODY}
      <button class="action" id="beginTutorial">Got it — show me the ladder ▶</button>
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
      .map((c) => `<button class="card reward" data-reward="${c.id}">${cardLabel(c)}</button>`)
      .join('');
    return `<div class="modal-backdrop"><div class="modal">
      <div class="modal-title" style="color:var(--gold)">🏆 You beat ${game.opponent?.name ?? 'your opponent'}!</div>
      <p>Add a card to your deck — it stays with you up the ladder:</p>
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
  const needle = ((100 - game.bar) / 200) * 100; // 0..100 left%; You favored → left (matches podiums)
  // Zero-sum 1v1: bar (-100..+100, signed toward player) shown as audience-support % that sums to 100.
  const youSupport = Math.round((game.bar + 100) / 2);
  const complete = isComplete(game.player.line);
  const held = !!game.player.heldFinisher;
  const endOk = canPlay() && canEnd(game);
  // The free period is offered wherever the grammar allows a new clause to open —
  // but only once per statement (you get a single period; chain conjunctions for more).
  const periodOk = canPlay() && !pendingTypo && !pendingHotMic && !game.player.usedPeriod && canAppend(game.player.line, PERIOD);

  const hint = game.winner
    ? 'Debate over.'
    : game.awaitingNext
      ? 'The crowd has reacted. Press Next Question to continue.'
      : aiThinking || game.turn === 'ai'
        ? 'Your opponent is speaking…'
        : game.player.done
          ? 'You have finished — your opponent is still speaking.'
          : complete
          ? 'Complete! End to lock it in (safe from sabotage), Pass to hold & wait (e.g. to set up a Typo), or extend.'
          : game.player.line.length > 0
            ? 'Keep building — you can only end on a complete sentence.'
            : 'Pick a word to begin — or Pass to wait (e.g. to set up a Teleprompter Typo).';
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
  if (pendingHotMic) {
    notes.push(
      `🎙️ <b>Hot Mic:</b> click a card in ${game.opponent?.name ?? 'the opponent'}'s revealed hand below to steal it — or click the power-up again to cancel.`,
    );
  }
  if (held) notes.push(`✦ Committed finisher: <b>${game.player.heldFinisher!.text}</b> — appended when you end.`);
  if (game.player.nextMultiplier) notes.push('👏 Soundbite armed — your next statement scores ×1.5.');
  if (game.player.knowsCrowd && game.crowd) {
    notes.push(`🕵️ Your plant reports: this crowd loves <b>${CROWD_LABEL[game.crowd.loves] ?? 'a good show'}</b>.`);
  }
  const finisherNote = notes.map((n) => `<div class="held">${n}</div>`).join('');

  app.innerHTML = `
    <h1>⚖️ DEBATE SIMULATOR</h1>
    <div class="run-pill">🏛️ Campaign — Debate ${run.rung + 1} / ${LADDER.length} &nbsp;·&nbsp; vs <b>${game.opponent?.name ?? '—'}</b> &nbsp;·&nbsp; Earned cards: ${run.bonus.length}</div>
    ${bannerHtml()}
    <div class="scorebar-wrap">
      <div class="scorebar-labels"><span class="you">◀ You</span><span class="them">Opponent ▶</span></div>
      <div class="scorebar"><div class="needle" style="left:${needle}%"></div></div>
      <div class="round-pill">Question ${game.round} / ${game.maxRounds} &nbsp;·&nbsp; Audience support — You ${youSupport}% · Opponent ${100 - youSupport}%</div>
      <div class="question-pill"><span class="q-topic">${game.topic?.label ?? '—'}</span> — “${game.question ?? ''}”</div>
    </div>

    <div class="stage">
      <div class="podium you">
        <div class="who">You</div>
        <div class="speech">${partialText(game.player.line) || '<span style="color:var(--muted)">…</span>'}</div>
        <div class="reaction ${reactionClass(game.player.lastReaction)}">${game.player.lastReaction?.detail.split('—').pop()?.trim() ?? ''}</div>
        ${comboHtml(game.player.lastReaction)}
      </div>
      <div class="podium them${pendingTypo ? ' typo-target' : ''}">
        <div class="who">${game.opponent?.name ?? 'Opponent'}</div>
        <div class="speech">${oppSpeechHtml()}</div>
        <div class="reaction ${reactionClass(game.ai.lastReaction)}">${game.ai.lastReaction?.detail.split('—').pop()?.trim() ?? ''}</div>
        ${comboHtml(game.ai.lastReaction)}
      </div>
    </div>

    <div class="zone-title">Shared Pool — contested, no refill (gold) &nbsp;·&nbsp; <span class="ontopic-key">✓ on topic</span></div>
    <div class="cards" id="pool">${game.pool.map((c) => cardHtml(c, 'pool', held)).join('') || '<span style="color:var(--muted)">(pool empty)</span>'}</div>

    <div class="zone-title">Your Hand — private, no refill (blue)</div>
    <div class="cards" id="hand">${game.player.hand.map((c) => cardHtml(c, 'hand', held)).join('') || '<span style="color:var(--muted)">(hand empty)</span>'}</div>

    ${
      (pendingHotMic || game.player.knowsOppHand) && game.ai.hand.length
        ? `<div class="zone-title">👂 ${game.opponent?.name ?? 'Opponent'}'s hand ${pendingHotMic ? '— click a card to STEAL it' : '(revealed by your Hot Mic)'}</div>
           <div class="cards" id="opphand">${game.ai.hand.map(oppCardHtml).join('')}</div>`
        : ''
    }

    ${typoBanner}
    ${sabotage}
    ${finisherNote}

    <div class="controls">
      ${game.awaitingNext ? '<button class="action" id="next">Next Question ▶</button>' : ''}
      <button class="action" id="end" ${endOk ? '' : 'disabled'}>End Statement</button>
      <button class="ghost" id="period" ${periodOk ? '' : 'disabled'} title="${game.player.usedPeriod ? 'Already used your one period this statement — chain a connector to keep going.' : 'Free, once per statement — finish this sentence and start a new one. No combo bonus; use a connector for that.'}">Add “.” (new sentence)${game.player.usedPeriod ? ' — used' : ''}</button>
      <button class="ghost" id="pass" ${canPlay() && (complete || game.player.line.length === 0) ? '' : 'disabled'}>Pass (wait)</button>
      <button class="ghost" id="regroup" ${canPlay() && !game.player.usedRedraw ? '' : 'disabled'}>↻ Call a Recess (fresh talking points, costs your turn)</button>
      <button class="ghost" id="restart">Abandon Run</button>
      <button class="ghost" id="dumplog" title="Download a JSON event log of this debate for bug analysis">🐞 Debug log</button>
      <span class="turn-hint">${hint}</span>
    </div>

    <div class="log">${game.log.slice(-8).reverse().map((l) => `<div>${l}</div>`).join('') || '<div>The stage is set…</div>'}</div>

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
  app.querySelector<HTMLButtonElement>('#pass')?.addEventListener('click', () => {
    pendingTypo = null;
    pendingHotMic = null;
    playerMove({ kind: 'pass' });
  });
  app.querySelector<HTMLButtonElement>('#regroup')?.addEventListener('click', () => {
    pendingTypo = null;
    pendingHotMic = null;
    playerMove({ kind: 'redraw' });
  });
  app.querySelector<HTMLButtonElement>('#next')?.addEventListener('click', () => {
    if (!game.awaitingNext) return;
    pendingTypo = null;
    pendingHotMic = null;
    nextQuestion(game);
    render();
    driveAI(); // even questions start on the AI's turn — let it speak first
  });
  app.querySelector<HTMLButtonElement>('#restart')?.addEventListener('click', newRun);
  app.querySelector<HTMLButtonElement>('#dumplog')?.addEventListener('click', downloadDebugLog);
  app.querySelector<HTMLButtonElement>('#newrun')?.addEventListener('click', newRun);
  app.querySelector<HTMLButtonElement>('#beginTutorial')?.addEventListener('click', () => {
    runScreen = 'map'; // tutorial dismissed — show the campaign ladder
    render();
  });
  app.querySelector<HTMLButtonElement>('#beginDebate')?.addEventListener('click', () => {
    runScreen = null; // dismiss the map and step onto the debate stage
    render();
    driveAI(); // (debate 1 opens player-first, but stay robust if that changes)
  });
}

function playerMove(move: Move): void {
  if (game.winner || game.awaitingNext || game.turn !== 'player' || aiThinking) return;
  applyMove(game, move);
  checkDebateEnd();
  render();
  driveAI();
}

function driveAI(): void {
  if (game.winner || game.awaitingNext || game.turn !== 'ai' || game.ai.done) {
    aiThinking = false;
    return;
  }
  aiThinking = true;
  render();
  window.setTimeout(() => {
    const move = aiTurn(game, { maxExtend: aiMaxExtend }); // difficulty rises up the ladder
    applyMove(game, move);
    aiThinking = false;
    checkDebateEnd();
    render();
    driveAI(); // keep going if the AI still holds the turn (player already ended)
  }, AI_DELAY);
}

runScreen = 'tutorial'; // open on the tutorial, then the campaign map, before the first debate
render();
