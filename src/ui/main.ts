import './style.css';
import type { Card, GameState, Move, Reaction } from '../engine/types';
import { createGame, applyMove, canEnd, nextQuestion } from '../engine/game';
import { chooseMove } from '../engine/ai';
import { displayWords, cardLabel } from '../engine/morphology';
import { isComplete } from '../engine/grammar';
import { LADDER, REWARDS, OPPONENTS } from '../data/cards';

const app = document.getElementById('app')!;
const AI_DELAY = 650;

let aiThinking = false;
let pendingTypo: string | null = null; // a Teleprompter Typo awaiting its target card
let pendingHotMic: string | null = null; // a Hot Mic awaiting the card to steal
let ackedSabotage: GameState['lastSabotage'] = undefined; // sabotage the player has dismissed

// --- campaign run (Slay-the-Spire-style ladder) ---
let run = { rung: 0, bonus: [] as Card[] }; // current rung + earned reward cards
let runScreen: 'map' | 'reward' | 'defeat' | 'victory' | null = null;
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
  runScreen = 'map'; // open on the campaign map + tutorial before debate 1
  render();
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
  return displayWords(line).join(' ').trim();
}

function reactionClass(r?: Reaction): string {
  if (!r) return '';
  if (r.label === 'cheers' || r.label === 'approve') return 'good';
  if (r.label === 'neutral') return '';
  return 'bad';
}

function canPlay(): boolean {
  return game.turn === 'player' && !game.player.done && !game.winner;
}

function cardHtml(c: Card, source: 'pool' | 'hand' | 'topic', held: boolean): string {
  if (c.role === 'powerup') {
    const isTypo = c.effect === 'typo';
    // Typo needs a live opponent statement to jam; Forgot needs one with a card to drop.
    const noTypoTarget = isTypo && game.ai.done;
    const noForgotTarget = c.effect === 'forgot' && (game.ai.done || game.ai.line.length === 0);
    const disabled = !canPlay() || noTypoTarget || noForgotTarget ? 'disabled' : '';
    const sel = pendingTypo === c.id || pendingHotMic === c.id ? ' selecting' : '';
    return `<button class="card power${sel}" data-id="${c.id}" data-power="1" data-effect="${c.effect}" ${disabled}>${cardLabel(c)}</button>`;
  }
  // While choosing a Typo target, sentence cards become jam targets.
  if (pendingTypo && (source === 'pool' || source === 'hand')) {
    return `<button class="card ${source} target" data-id="${c.id}" data-from="${source}">${cardLabel(c)}</button>`;
  }
  const isIntens = c.role === 'intensifier';
  // A finisher can be grabbed any time, but only one may be held at once.
  const disabled = !canPlay() || (isIntens && held) ? 'disabled' : '';
  const cls = `card ${source}${isIntens ? ' intens' : ''}`;
  const tag = isIntens ? '<span class="role">commit finisher ✦</span>' : '';
  return `<button class="${cls}" data-id="${c.id}" data-from="${source}" ${disabled}>${tag}${cardLabel(c)}</button>`;
}

/** Render an opponent's-hand card: a steal target during a Hot Mic, else read-only intel. */
function oppCardHtml(c: Card): string {
  if (pendingHotMic) return `<button class="card them target" data-id="${c.id}" data-from="oppHand">${cardLabel(c)}</button>`;
  return `<span class="oppcard">${cardLabel(c)}</span>`;
}

const CROWD_LABEL: Record<string, string> = {
  praise_self: 'self-praise',
  attack_opp: 'attacks on your opponent',
  pander_aud: 'pandering to them',
};

function opponentName(id: string): string {
  return OPPONENTS.find((o) => o.id === id)?.name ?? id;
}

/** A 1–4 star difficulty read off the opponent's planning depth (maxExtend 3..6). */
function difficultyStars(maxExtend: number): string {
  const filled = Math.max(1, Math.min(4, maxExtend - 2));
  return '★'.repeat(filled) + '☆'.repeat(4 - filled);
}

/** The Slay-the-Spire-style ladder: a straight line of opponents you climb. */
function ladderHtml(): string {
  return LADDER.map((rung, i) => {
    const status = i < run.rung ? 'done' : i === run.rung ? 'current' : 'locked';
    const icon = status === 'done' ? '✓' : status === 'current' ? '▶' : '🔒';
    const crown = i === LADDER.length - 1 ? ' 👑' : '';
    return `<div class="rung ${status}">
        <span class="rung-icon">${icon}</span>
        <span class="rung-name">Debate ${i + 1}: ${opponentName(rung.opponentId)}${crown}</span>
        <span class="rung-diff" title="difficulty">${difficultyStars(rung.maxExtend)}</span>
      </div>`;
  }).join('');
}

const HOW_TO_PLAY = `
  <div class="howto">
    <div class="howto-title">How to win a debate</div>
    <ul>
      <li>Build a statement one card at a time. Start with a <b>subject</b> (who you're
        talking about), then add a <b>predicate</b> (what they do).</li>
      <li><b>Praise</b> yourself and the audience; <b>attack</b> your opponent. Never praise
        a villain or trash yourself — the crowd will boo a self-own.</li>
      <li>You can only <b>End</b> on a complete sentence. Chain clauses with connectors
        (and / but / because) for combo bonuses, and cap with a finisher.</li>
      <li>Stay <b>on topic</b>, play <b>power-ups</b> (steal cards, sabotage their line,
        read the crowd), and watch the meter — most audience favor after 8 questions wins.</li>
    </ul>
    <div class="howto-foot">Win a debate to draft a powerful card and climb the ladder. Lose
      and the run resets. Good luck out there. 🇺🇸</div>
  </div>`;

function runModalHtml(): string {
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
      ${first ? HOW_TO_PLAY : ''}
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
  const needle = ((game.bar + 100) / 200) * 100; // 0..100 left%
  const complete = isComplete(game.player.line);
  const held = !!game.player.heldFinisher;
  const endOk = canPlay() && canEnd(game);

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
  const sabotage = sabotaged
    ? isForgot
      ? `<div class="sabotage">⚠️ ${oppName} rattled you — you forgot “<b>${game.lastSabotage!.text}</b>” and it dropped off your statement! Keep building to finish your thought — or End with what's left.</div>`
      : `<div class="sabotage">⚠️ ${oppName} jammed “<b>${game.lastSabotage!.text}</b>” into your statement! Try a connector (and / but) + a clause to recover — or End and cut your losses.</div>`
    : '';

  const notes: string[] = [];
  if (pendingTypo) {
    notes.push(
      `🎤 <b>Teleprompter Typo:</b> click a card from the pool or your hand to jam onto ${game.opponent?.name ?? 'your opponent'} — or click the power-up again to cancel.`,
    );
  }
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
      <div class="scorebar-labels"><span class="them">◀ Opponent</span><span class="you">You ▶</span></div>
      <div class="scorebar"><div class="needle" style="left:${needle}%"></div></div>
      <div class="round-pill">Question ${game.round} / ${game.maxRounds} &nbsp;·&nbsp; Topic: <b>${game.topic?.label ?? '—'}</b> &nbsp;·&nbsp; Audience favor: ${Math.round(game.bar)}</div>
    </div>

    <div class="stage">
      <div class="podium you">
        <div class="who">You</div>
        <div class="speech">${partialText(game.player.line) || '<span style="color:var(--muted)">…</span>'}</div>
        <div class="reaction ${reactionClass(game.player.lastReaction)}">${game.player.lastReaction?.detail.split('—').pop()?.trim() ?? ''}</div>
      </div>
      <div class="podium them">
        <div class="who">${game.opponent?.name ?? 'Opponent'}</div>
        <div class="speech">${partialText(game.ai.line) || '<span style="color:var(--muted)">…</span>'}</div>
        <div class="reaction ${reactionClass(game.ai.lastReaction)}">${game.ai.lastReaction?.detail.split('—').pop()?.trim() ?? ''}</div>
      </div>
    </div>

    <div class="zone-title">Topic phrase — always available to both, never used up (green)</div>
    <div class="cards" id="topic">${game.topic ? cardHtml(game.topic.card, 'topic', held) : ''}</div>

    <div class="zone-title">Shared Pool — contested, no refill (gold)</div>
    <div class="cards" id="pool">${game.pool.map((c) => cardHtml(c, 'pool', held)).join('') || '<span style="color:var(--muted)">(pool empty)</span>'}</div>

    <div class="zone-title">Your Hand — private, no refill (blue)</div>
    <div class="cards" id="hand">${game.player.hand.map((c) => cardHtml(c, 'hand', held)).join('') || '<span style="color:var(--muted)">(hand empty)</span>'}</div>

    ${
      (pendingHotMic || game.player.knowsOppHand) && game.ai.hand.length
        ? `<div class="zone-title">👂 ${game.opponent?.name ?? 'Opponent'}'s hand ${pendingHotMic ? '— click a card to STEAL it' : '(revealed by your Hot Mic)'}</div>
           <div class="cards" id="opphand">${game.ai.hand.map(oppCardHtml).join('')}</div>`
        : ''
    }

    ${sabotage}
    ${finisherNote}

    <div class="controls">
      ${game.awaitingNext ? '<button class="action" id="next">Next Question ▶</button>' : ''}
      <button class="action" id="end" ${endOk ? '' : 'disabled'}>End Statement</button>
      <button class="ghost" id="pass" ${canPlay() && (complete || game.player.line.length === 0) ? '' : 'disabled'}>Pass (wait)</button>
      <button class="ghost" id="regroup" ${canPlay() && !game.player.usedRedraw ? '' : 'disabled'}>↻ Call a Recess (fresh talking points, costs your turn)</button>
      <button class="ghost" id="restart">Abandon Run</button>
      <span class="turn-hint">${hint}</span>
    </div>

    <div class="log">${game.log.slice(-8).reverse().map((l) => `<div>${l}</div>`).join('') || '<div>The stage is set…</div>'}</div>

    ${
      showSabotageModal
        ? isForgot
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
            <p>${oppName} used a <b>Teleprompter Typo</b> to jam
            “<b>${game.lastSabotage!.text}</b>” into your statement. It now reads:</p>
            <p class="modal-quote">“${partialText(game.player.line) || '…'}”</p>
            <p>Recover by chaining a connector (<b>and</b> / <b>but</b>) + a clause to flip it back —
            or End and cut your losses.</p>
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
        const from = btn.dataset.from as 'pool' | 'hand' | 'topic';
        if (from === 'topic') return; // can't jam the topic phrase
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
      const from = btn.dataset.from as 'pool' | 'hand' | 'topic';
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
    driveAI(); // new question starts on the player's turn, so this is a no-op
  });
  app.querySelector<HTMLButtonElement>('#restart')?.addEventListener('click', newRun);
  app.querySelector<HTMLButtonElement>('#newrun')?.addEventListener('click', newRun);
  app.querySelector<HTMLButtonElement>('#beginDebate')?.addEventListener('click', () => {
    runScreen = null; // dismiss the map and step onto the debate stage
    render();
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
    const move = chooseMove(game, { maxExtend: aiMaxExtend }); // difficulty rises up the ladder
    applyMove(game, move);
    aiThinking = false;
    checkDebateEnd();
    render();
    driveAI(); // keep going if the AI still holds the turn (player already ended)
  }, AI_DELAY);
}

runScreen = 'map'; // open on the campaign map + tutorial before the first debate
render();
