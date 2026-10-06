// Fluent console: drafts, undo history, retry timing (pure core).
import { describe, expect, it } from 'vitest';
import { clearAllDrafts, clearDraft, createUndoStack, draftKey, readDraft, retryDelayMs, sameValue, stableStringify, writeDraft, type DraftStore } from '../lib/ui/autosave-core';

function memStore(): DraftStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

describe('drafts', () => {
  it('keeps a draft per person and screen, survives a reload, expires after 7 days', () => {
    const s = memStore();
    const now = Date.parse('2026-10-06T12:00:00Z');
    expect(writeDraft(s, 'sara', 'hours', { mon: '11:00' }, now)).toBe(true);
    expect(readDraft<{ mon: string }>(s, 'sara', 'hours', now)?.value).toEqual({ mon: '11:00' });
    expect(readDraft(s, 'marc', 'hours', now)).toBeNull(); // another person on the same tablet never sees it
    expect(readDraft(s, 'sara', 'hours', now + 8 * 86400_000)).toBeNull();
    expect(s.map.has(draftKey('sara', 'hours'))).toBe(false); // expired drafts are removed
  });
  it('clears one draft, or every draft of a person on sign-out', () => {
    const s = memStore();
    writeDraft(s, 'sara', 'hours', 1); writeDraft(s, 'sara', 'profile', 2); writeDraft(s, 'marc', 'hours', 3); s.setItem('takatak.rail', '1');
    clearDraft(s, 'sara', 'hours');
    expect(readDraft(s, 'sara', 'hours')).toBeNull();
    expect(clearAllDrafts(s, 'sara')).toBe(1);
    expect(readDraft(s, 'marc', 'hours')?.value).toBe(3);
    expect(s.getItem('takatak.rail')).toBe('1'); // other settings untouched
  });
  it('never throws when storage is unavailable or full', () => {
    const broken: DraftStore = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('x'); }, key: () => null, length: 0 };
    expect(writeDraft(broken, 'u', 'f', 1)).toBe(false);
    expect(readDraft(broken, 'u', 'f')).toBeNull();
    expect(() => clearDraft(broken, 'u', 'f')).not.toThrow();
    expect(readDraft(null, 'u', 'f')).toBeNull();
  });
});

describe('value comparison', () => {
  it('ignores key order and undefined keys', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('undo history', () => {
  it('undoes and redoes, and a typed word is one step', () => {
    const u = createUndoStack<string>();
    u.push('', 'B', 'name', 1000); u.push('B', 'Bo', 'name', 1300); u.push('Bo', 'Bob', 'name', 1600);
    u.push('Bob', 'Bob!', 'other', 1700);
    expect(u.size()).toBe(2);
    expect(u.undo()?.before).toBe('Bob');
    expect(u.undo()?.before).toBe('');
    expect(u.canUndo()).toBe(false);
    expect(u.redo()?.after).toBe('Bob');
    u.push('Bob', 'Bobby', 'name', 5000);
    expect(u.canRedo()).toBe(false); // a new edit drops the redo branch
  });
  it('ignores no-op changes and keeps at most `limit` steps', () => {
    const u = createUndoStack<number>(3);
    u.push(1, 1, 'x');
    expect(u.size()).toBe(0);
    for (let i = 0; i < 6; i++) u.push(i, i + 1, `s${i}`, i * 10_000);
    expect(u.size()).toBe(3);
    expect(u.peek()?.after).toBe(6);
  });
});

describe('retry timing', () => {
  it('retries after 2, 5 and 15 seconds, then asks the person', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([2000, 5000, 15000, null]);
  });
});
