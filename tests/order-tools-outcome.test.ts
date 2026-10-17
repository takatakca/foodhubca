// Kitchen order tools — honest counts: a skipped store (locked, "Do not touch", not this brand's dish) is never "changed".
import { describe, expect, it } from 'vitest';
import { notChangedLines, outcomeOf, quick86Headline, type ResultRow } from '../lib/foodhub/order-tools/outcome';

const t = (fr: string) => fr;
const row = (channel: string, status: string, message = status): ResultRow => ({ channel, brandName: 'Alpha', result: { ok: ['done', 'queued', 'skipped'].includes(status), status, message } });

describe('quick86Headline', () => {
  it('an 86 where only Uber changed and the locked DoorDash store was skipped says 1 store, and names the skipped one', () => {
    const rows = [row('uber_eats', 'done'), row('doordash', 'skipped', 'Not sent — this store’s menu is locked')];
    expect(rows.every((r) => r.result.ok)).toBe(true); // counting `ok` would have said 2
    expect(quick86Headline(t, rows)).toEqual({ kind: 'warn', title: 'En rupture sur 1 magasin(s) — 1 non envoyé(s)' });
    expect(notChangedLines(outcomeOf(rows))).toEqual(['doordash · Alpha: Not sent — this store’s menu is locked']);
  });

  it('all changed (done or queued) → success; nothing sent → warn; refused → error; no store → warn', () => {
    expect(quick86Headline(t, [row('uber_eats', 'done'), row('skip', 'queued')])).toEqual({ kind: 'success', title: 'En rupture sur 2 magasin(s)' });
    expect(quick86Headline(t, [row('doordash', 'skipped')]).kind).toBe('warn');
    expect(quick86Headline(t, [row('doordash', 'skipped')]).title).toMatch(/^Rien n’a été envoyé/);
    expect(quick86Headline(t, [row('uber_eats', 'failed'), row('doordash', 'blocked')]).kind).toBe('error');
    expect(quick86Headline(t, [row('uber_eats', 'done'), row('doordash', 'blocked'), row('skip', 'skipped')]).title).toBe('En rupture sur 1 magasin(s) — 1 non envoyé(s), 1 refusé(s)');
    expect(quick86Headline(t, []).title).toMatch(/aucun magasin de plateforme/);
  });

  it('outcomeOf sorts rows by status', () => {
    const o = outcomeOf([row('a', 'done'), row('b', 'queued'), row('c', 'skipped'), row('d', 'blocked'), row('e', 'failed')]);
    expect([o.changed.length, o.skipped.length, o.blocked.length, o.failed.length]).toEqual([2, 1, 1, 1]);
  });
});
