import { describe, it, expect } from 'vitest';
import { createJournal, summarize, describeEntry, JOURNAL_MAX_CHARS, type JournalStore } from '../src/ui/journal';

function fakeStore(): JournalStore & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('playtest journal', () => {
  it('appends entries, persists them, and stamps the current tester', () => {
    const store = fakeStore();
    const j = createJournal(store);
    j.log('open', { resumed: false }, 1);
    j.setTester('Aunt Sue');
    j.log('stmt', { by: 'you', text: 'My opponent kicks puppies', delta: 9, label: 'hit', grammatical: true }, 2);
    const again = createJournal(store); // a page reload
    expect(again.entries().map((e) => e.t)).toEqual(['open', 'stmt']);
    expect(again.entries()[1].who).toBe('Aunt Sue');
    expect(again.entries()[0].who).toBeUndefined();
  });

  it('only Clear empties it', () => {
    const store = fakeStore();
    const j = createJournal(store);
    j.log('run', { character: 'maverick' });
    j.clear();
    expect(createJournal(store).entries()).toEqual([]);
  });

  it('drops the OLDEST entries past the size cap instead of failing', () => {
    const store = fakeStore();
    const j = createJournal(store);
    const big = 'x'.repeat(50_000);
    for (let i = 0; i < 40; i++) j.log('note', { text: big, i });
    const kept = createJournal(store).entries();
    expect(store.m.get('mokp.journal')!.length).toBeLessThanOrEqual(JOURNAL_MAX_CHARS);
    expect(kept[kept.length - 1].i).toBe(39); // newest survives
    expect(kept[0].i).toBeGreaterThan(0); // oldest went
  });

  it('keeps working (in memory) with no storage at all', () => {
    const j = createJournal(null);
    j.log('open');
    expect(j.entries()).toHaveLength(1);
  });

  it('summarizes player statements, results, and best lines', () => {
    const j = createJournal(fakeStore());
    j.log('open');
    j.log('run', { character: 'veteran' });
    j.log('debate', { debate: 1, opponent: 'pander' });
    j.log('stmt', { by: 'you', text: 'A', delta: 20, grammatical: true, secs: 30 });
    j.log('stmt', { by: 'them', text: 'B', delta: 50, grammatical: true });
    j.log('stmt', { by: 'you', text: 'C', delta: -4, grammatical: false, runOn: true, secs: 50 });
    j.log('end', { debate: 1, result: 'player', bar: 40 });
    const s = summarize(j.entries());
    expect(s).toMatchObject({ sessions: 1, runs: 1, debates: 1, won: 1, lost: 0, furthestDebate: 1, statements: 2, confused: 1, runOns: 1, avgDelta: 8, avgSecs: 40 });
    expect(s.best.map((b) => b.text)).toEqual(['A']); // positives only — C is a worst line, never a best
    expect(s.worst.map((w) => w.text)).toEqual(['C']);
    expect(describeEntry(j.entries()[3])).toContain('YOU +20');
  });
});
