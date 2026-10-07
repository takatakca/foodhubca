// A compact picture of the menu a store received (names, platform prices, availability), saved on the store after
// each publish. The publish dry run compares the menu it is about to send with it: what is new, gone, repriced,
// 86'd or back. Small on purpose (it lives in the store's meta): a few dozen bytes per item.
import { CHANNEL_MARKETPLACE } from '../config';
import type { ChannelKey, MasterMenu, MenuLanguage } from '../types';
import { label } from './language';
import { modifierPriceFor, priceFor } from './translate';

export interface SnapshotEntry { n: string; p: number; a: boolean }
export interface MenuSnapshot {
  /** item ref → name (in the platform's language), platform price, available */
  items: Record<string, SnapshotEntry>;
  /** modifier ref → same */
  mods: Record<string, SnapshotEntry>;
  categories: number;
  language?: MenuLanguage;
}

export function menuSnapshot(menu: MasterMenu, channel: ChannelKey, language: MenuLanguage = 'en'): MenuSnapshot {
  const mk = CHANNEL_MARKETPLACE[channel];
  const cats = new Set(menu.categories.map((c) => c.ref));
  const items: Record<string, SnapshotEntry> = {};
  for (const i of menu.items) {
    if (!cats.has(i.categoryRef)) continue;
    items[i.ref] = { n: label(i.name, i.nameFr, language), p: priceFor(i, mk, menu), a: i.available };
  }
  const used = new Set(menu.items.filter((i) => cats.has(i.categoryRef)).flatMap((i) => i.modifierGroupRefs));
  const mods: Record<string, SnapshotEntry> = {};
  for (const g of menu.modifierGroups) {
    if (!used.has(g.ref)) continue;
    for (const m of g.modifiers) mods[m.ref] = { n: label(m.name, m.nameFr, language), p: modifierPriceFor(m, mk, menu), a: m.available };
  }
  return { items, mods, categories: menu.categories.filter((c) => menu.items.some((i) => i.categoryRef === c.ref)).length, language };
}

export interface SnapshotDiff {
  added: Array<{ ref: string; name: string; price: number }>;
  removed: Array<{ ref: string; name: string }>;
  repriced: Array<{ ref: string; name: string; from: number; to: number }>;
  turnedOff: Array<{ ref: string; name: string }>;
  turnedOn: Array<{ ref: string; name: string }>;
  renamed: Array<{ ref: string; from: string; to: string }>;
  /** True when nothing would change on the platform. */
  same: boolean;
}

/** What publishing `next` would change compared with what the store received last time (null = never published). */
export function diffSnapshots(prev: MenuSnapshot | null | undefined, next: MenuSnapshot): SnapshotDiff {
  const d: SnapshotDiff = { added: [], removed: [], repriced: [], turnedOff: [], turnedOn: [], renamed: [], same: true };
  const before = { ...(prev?.items ?? {}), ...Object.fromEntries(Object.entries(prev?.mods ?? {}).map(([k, v]) => [`mod:${k}`, v])) };
  const after = { ...next.items, ...Object.fromEntries(Object.entries(next.mods).map(([k, v]) => [`mod:${k}`, v])) };
  for (const [ref, n] of Object.entries(after)) {
    const p = before[ref];
    if (!p) { d.added.push({ ref, name: n.n, price: n.p }); continue; }
    if (Math.abs(p.p - n.p) >= 0.005) d.repriced.push({ ref, name: n.n, from: p.p, to: n.p });
    if (p.a && !n.a) d.turnedOff.push({ ref, name: n.n });
    if (!p.a && n.a) d.turnedOn.push({ ref, name: n.n });
    if (p.n !== n.n) d.renamed.push({ ref, from: p.n, to: n.n });
  }
  for (const [ref, p] of Object.entries(before)) if (!after[ref]) d.removed.push({ ref, name: p.n });
  d.same = !d.added.length && !d.removed.length && !d.repriced.length && !d.turnedOff.length && !d.turnedOn.length && !d.renamed.length;
  return d;
}
