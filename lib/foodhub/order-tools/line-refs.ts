// Kitchen order tools — "Rupture" (86) straight from an order line.
//
// An order line carries what the platform sent: the merchant-supplied id (our menu ref, when the menu was published by
// Food Hub), sometimes the Clover item id, and always a name. resolveLineRefs() finds the master-menu item and options
// behind each line so the kitchen can 86 them with one tap, through the existing /api/foodhub/availability route.
//
// Match order (first hit wins): line.externalId = menu ref → posItemRef = item.posItemRef → normalized name (lower case,
// no accents, no size words). A name only counts when exactly one item carries it: a wrong 86 is worse than none, so an
// ambiguous or unknown line is "none" and the screen sends the person to Ruptures (86).
//
// Server-side only (hours come from the repo); the screen imports the types.
import { effectiveHours, holidaysFor, localDate, openIntervals } from '../hours';
import { foodhubTimeZone } from '../time';
import type { HoursConfig, MasterMenu, MenuItem, MenuModifier, OrderLine, StoredOrder } from '../types';

export type LineMatch = 'ref' | 'pos' | 'name' | 'none';

export interface ModifierRef { name: string; ref?: string; match: LineMatch }

export interface LineRef {
  index: number;
  name: string;
  itemRef?: string;
  match: LineMatch;
  modifierRefs: ModifierRef[];
}

/** Size words dropped before a name match ("Grande poutine" = "Poutine"), French and English. */
const SIZE_WORDS = new Set([
  'petit', 'petite', 'moyen', 'moyenne', 'grand', 'grande', 'gros', 'grosse', 'format', 'taille', 'familial', 'familiale', 'mini', 'jumbo', 'geant', 'geante',
  'small', 'medium', 'regular', 'reg', 'large', 'xl', 'xxl', 'family', 'size',
]);

/** Lower case, no accents, punctuation as spaces. */
export function plainName(s: string | null | undefined): string {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’'`]/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** plainName without size words (or the plain name when only size words are left). */
export function coreName(s: string | null | undefined): string {
  const plain = plainName(s);
  const core = plain.split(' ').filter((w) => w && !SIZE_WORDS.has(w)).join(' ');
  return core || plain;
}

/** The single candidate whose name (or French name) matches, first exactly then without sizes; null when none or several. */
function byName<T extends { ref: string; name: string; nameFr?: string }>(name: string, candidates: T[]): T | null {
  for (const norm of [plainName, coreName]) {
    const want = norm(name);
    if (!want) continue;
    const hits = candidates.filter((c) => norm(c.name) === want || (c.nameFr ? norm(c.nameFr) === want : false));
    const refs = new Set(hits.map((h) => h.ref));
    if (refs.size === 1) return hits[0];
    if (refs.size > 1) return null; // ambiguous: never guess
  }
  return null;
}

function matchItem(line: OrderLine, menu: MasterMenu): { item: MenuItem | null; match: LineMatch } {
  const ext = String(line.externalId ?? '').trim();
  if (ext) { const hit = menu.items.find((i) => i.ref === ext); if (hit) return { item: hit, match: 'ref' }; }
  const pos = String(line.posItemRef ?? '').trim();
  if (pos) { const hit = menu.items.find((i) => i.posItemRef && i.posItemRef === pos); if (hit) return { item: hit, match: 'pos' }; }
  const hit = byName(line.name, menu.items);
  return hit ? { item: hit, match: 'name' } : { item: null, match: 'none' };
}

function matchModifier(m: OrderLine['modifiers'][number], item: MenuItem | null, menu: MasterMenu): ModifierRef {
  const groups = item ? menu.modifierGroups.filter((g) => item.modifierGroupRefs.includes(g.ref)) : [];
  const inItem: MenuModifier[] = groups.flatMap((g) => g.modifiers);
  // Ids are unique on the whole menu, so an id match is safe even when the item itself was not found; a name is not.
  const pool = item ? inItem : menu.modifierGroups.flatMap((g) => g.modifiers);
  const ext = String(m.externalId ?? '').trim();
  if (ext) { const hit = pool.find((x) => x.ref === ext); if (hit) return { name: m.name, ref: hit.ref, match: 'ref' }; }
  const pos = String(m.posModifierRef ?? '').trim();
  if (pos) { const hit = pool.find((x) => x.posModifierRef && x.posModifierRef === pos); if (hit) return { name: m.name, ref: hit.ref, match: 'pos' }; }
  if (item) { const hit = byName(m.name, inItem); if (hit) return { name: m.name, ref: hit.ref, match: 'name' }; }
  return { name: m.name, match: 'none' };
}

/** Per order line: the menu item ref and option refs to 86, and how they were found. */
export function resolveLineRefs(order: Pick<StoredOrder, 'lines'>, menu: MasterMenu | null): LineRef[] {
  return order.lines.map((line, index) => {
    if (!menu) return { index, name: line.name, match: 'none' as const, modifierRefs: line.modifiers.map((m) => ({ name: m.name, match: 'none' as const })) };
    const { item, match } = matchItem(line, menu);
    return {
      index,
      name: line.name,
      ...(item ? { itemRef: item.ref } : {}),
      match,
      modifierRefs: line.modifiers.map((m) => matchModifier(m, item, menu)),
    };
  });
}

/**
 * When this brand closes at this kitchen (epoch ms of the closing minute), from Settings → Hours (brand override,
 * holidays, overnight slots: a 16:30–03:00 night is one opening). null = hours not set, or closed right now.
 */
export function closesAtMs(cfg: HoursConfig, brandName: string, locationCode: string, now = Date.now(), tz = foodhubTimeZone()): number | null {
  const week = effectiveHours(cfg, brandName, locationCode);
  if (!week) return null;
  const holidays = holidaysFor(cfg, locationCode, localDate(now - 86400_000, tz), 4);
  const joined: Array<[number, number]> = [];
  for (const [a, b] of openIntervals(week, holidays, now - 36 * 3600_000, now + 3 * 86400_000, tz)) {
    const last = joined[joined.length - 1];
    if (last && a <= last[1] + 60_000) last[1] = Math.max(last[1], b); else joined.push([a, b]);
  }
  const cur = joined.find(([a, b]) => a <= now && now < b);
  // openIntervals ends one minute after the closing minute.
  return cur ? cur[1] - 60_000 : null;
}

/** Minutes until this brand closes at this kitchen (at 01:00 on a 16:30–03:00 night: 120). null = no hours / closed. */
export function minutesUntilClose(cfg: HoursConfig, brandName: string, locationCode: string, now = Date.now(), tz = foodhubTimeZone()): number | null {
  const at = closesAtMs(cfg, brandName, locationCode, now, tz);
  return at === null ? null : Math.max(1, Math.ceil((at - now) / 60_000));
}
