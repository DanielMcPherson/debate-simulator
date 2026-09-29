// Playtest journal: a week-long, on-device record of what testers actually did — every
// statement (text + score + how the crowd read it), debate results, reward picks, and where
// people stopped. Lives in the browser's localStorage (no backend, by design); Daniel opens a
// hidden screen (tap the title 5×) to read a summary, add notes, and Share/Copy the whole
// thing off the iPad. Only the "Clear journal" button empties it — new runs never do.

export type JournalEntry = { t: string; at: number; who?: string; [k: string]: unknown };

/** Minimal storage surface (localStorage in the app; a Map-backed fake in tests). */
export interface JournalStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const KEY = 'mokp.journal';
const TESTER_KEY = 'mokp.tester';
/** Stay well under Safari's per-site quota (shared with the run save). Past this, the OLDEST
 *  entries are dropped — the journal never stops the game. */
export const JOURNAL_MAX_CHARS = 1_500_000;

export function createJournal(store: JournalStore | null) {
  let cache: JournalEntry[] | null = null;
  const read = (): JournalEntry[] => {
    if (cache) return cache;
    try {
      const raw = store?.getItem(KEY);
      cache = raw ? JSON.parse(raw) : [];
    } catch {
      cache = [];
    }
    return cache!;
  };
  const write = (entries: JournalEntry[]) => {
    let json = JSON.stringify(entries);
    while (json.length > JOURNAL_MAX_CHARS && entries.length > 1) {
      entries.splice(0, Math.max(1, Math.floor(entries.length / 10))); // drop the oldest 10%
      json = JSON.stringify(entries);
    }
    cache = entries;
    try {
      store?.setItem(KEY, json);
    } catch {
      // Quota / private browsing — keep the in-memory copy; the game carries on.
    }
  };
  return {
    entries: read,
    tester(): string {
      try {
        return store?.getItem(TESTER_KEY) ?? '';
      } catch {
        return '';
      }
    },
    setTester(name: string): void {
      try {
        if (name) store?.setItem(TESTER_KEY, name);
        else store?.removeItem(TESTER_KEY);
      } catch {
        /* ignore */
      }
    },
    log(t: string, data: Record<string, unknown> = {}, now = Date.now()): void {
      const who = this.tester();
      write([...read(), { t, at: now, ...(who ? { who } : {}), ...data }]);
    },
    clear(): void {
      cache = [];
      try {
        store?.removeItem(KEY);
      } catch {
        /* ignore */
      }
    },
    sizeChars(): number {
      return JSON.stringify(read()).length;
    },
  };
}
export type Journal = ReturnType<typeof createJournal>;

export interface JournalSummary {
  entries: number;
  from?: number;
  to?: number;
  sessions: number;
  runs: number;
  debates: number;
  won: number;
  lost: number;
  furthestDebate: number;
  statements: number;
  confused: number;
  runOns: number;
  offTopic: number;
  avgDelta: number;
  avgSecs: number;
  stars: number;
  appeals: number;
  appealsWon: number;
  best: { text: string; delta: number; who?: string }[];
  worst: { text: string; delta: number; who?: string }[];
  testers: string[];
}

/** Headline numbers for the journal screen (player statements only — the AI's lines are logged
 *  for context but don't count toward "how are testers doing"). */
export function summarize(entries: JournalEntry[]): JournalSummary {
  const mine = entries.filter((e) => e.t === 'stmt' && e.by === 'you');
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const line = (e: JournalEntry) => ({ text: String(e.text ?? ''), delta: num(e.delta), ...(e.who ? { who: String(e.who) } : {}) });
  const byDelta = [...mine].sort((a, b) => num(b.delta) - num(a.delta));
  const timed = mine.filter((e) => typeof e.secs === 'number');
  return {
    entries: entries.length,
    from: entries[0]?.at,
    to: entries[entries.length - 1]?.at,
    sessions: entries.filter((e) => e.t === 'open').length,
    runs: entries.filter((e) => e.t === 'run').length,
    debates: entries.filter((e) => e.t === 'debate').length,
    won: entries.filter((e) => e.t === 'end' && e.result === 'player').length,
    lost: entries.filter((e) => e.t === 'end' && e.result !== 'player').length,
    furthestDebate: Math.max(0, ...entries.filter((e) => e.t === 'debate').map((e) => num(e.debate))),
    statements: mine.length,
    confused: mine.filter((e) => e.grammatical === false).length,
    runOns: mine.filter((e) => e.runOn).length,
    offTopic: mine.filter((e) => e.offTopic).length,
    avgDelta: mine.length ? mine.reduce((s, e) => s + num(e.delta), 0) / mine.length : 0,
    avgSecs: timed.length ? timed.reduce((s, e) => s + num(e.secs), 0) / timed.length : 0,
    stars: entries.filter((e) => e.t === 'star' && e.on).length,
    appeals: entries.filter((e) => e.t === 'appeal').length,
    appealsWon: entries.filter((e) => e.t === 'appeal' && num(e.change) > 0).length,
    best: byDelta.filter((e) => num(e.delta) > 0).slice(0, 5).map(line),
    worst: byDelta.filter((e) => num(e.delta) < 0).slice(-3).reverse().map(line),
    testers: [...new Set(entries.map((e) => e.who).filter((w): w is string => !!w))],
  };
}

/** One readable line per entry, for the journal screen's "recent activity" list. */
export function describeEntry(e: JournalEntry): string {
  const who = e.who ? `[${e.who}] ` : '';
  const sign = (d: unknown) => (typeof d === 'number' ? (d > 0 ? `+${d}` : `${d}`) : '?');
  switch (e.t) {
    case 'open':
      return `${who}Opened the game${e.resumed ? ' (resumed a saved run)' : ''}`;
    case 'hide':
      return `${who}Left the page (debate ${e.debate ?? '?'}, question ${e.q ?? '?'}, ${e.screen ?? 'playing'})`;
    case 'run':
      return `${who}New run as ${e.character}`;
    case 'debate':
      return `${who}Debate ${e.debate} vs ${e.opponent}`;
    case 'stmt':
      return `${who}${e.by === 'you' ? 'YOU' : 'THEM'} ${sign(e.delta)} (${e.label}): “${e.text}”`;
    case 'end':
      return `${who}Debate ${e.debate} ${e.result === 'player' ? 'WON' : e.result === 'tie' ? 'TIED' : 'LOST'} (bar ${e.bar})`;
    case 'award':
      return `${who}Award: ${e.title}`;
    case 'pick':
      return `${who}Picked ${e.pick}${e.offer ? ` — ${e.offer}` : ''}`;
    case 'power':
      return `${who}${e.by === 'you' ? 'You' : 'They'} played ${e.effect}`;
    case 'abandon':
      return `${who}Abandoned the run (debate ${e.debate}, question ${e.q})`;
    case 'appeal':
      return `${who}⚖️ Recount (${e.outcome}, ${sign(e.change)}; scored ${sign(e.original)}, recount ${sign(e.recount)}): “${e.text}”`;
    case 'star':
      return `${who}${e.on ? '⭐ Starred' : '☆ Unstarred'} ${e.by === 'you' ? 'your' : 'their'} line (${sign(e.delta)}): “${e.text}”`;
    case 'note':
      return `📝 ${who}${e.text}`;
    default:
      return `${who}${e.t}`;
  }
}
