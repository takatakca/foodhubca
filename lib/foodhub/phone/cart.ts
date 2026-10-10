// The phone agent's menu and cart. The menu is the same master menu the platforms get (shared menus included), as it
// stands at the line's kitchen right now: 86'd items and options are left out, alcohol only when the alcohol rules allow
// it on the phone at this hour. The cart checks every choice the way a platform would: the item exists, each option
// belongs to it, and every option group's minimum / maximum is met (a required choice cannot be skipped).
import { decideAlcohol, isAlcoholItem } from '../alcohol/rules';
import { round2 } from '../config';
import { lineTotal, totalsFor } from '../delivery/orders';
import type { DirectLine } from '../delivery/types';
import { getBrandMenu } from '../menu/shared';
import { menuForLocation } from '../ops';
import type { MenuItem, MenuModifierGroup } from '../types';
import { getCatalog } from '../catalog';
import { brandLockedAt, type PhoneLine } from './settings';

export interface PhoneMenuItem { brand: string; item: MenuItem; groups: MenuModifierGroup[]; alcohol: boolean }

export interface PhoneMenu {
  locationCode: string;
  brands: string[];
  items: Map<string, PhoneMenuItem>;
  /** The menu as the agent reads it (stable text: it is the cached part of the prompt). */
  text: string;
  alcohol: { allowed: boolean; reason: string; requireFood: boolean; minAge: number };
}

export interface CartLine {
  brand: string;
  itemRef: string;
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: Array<{ groupRef: string; ref: string; name: string; price: number }>;
  notes?: string;
  alcohol?: boolean;
  posItemRef?: string;
}

export const itemKey = (brand: string, ref: string) => `${brand}|${ref}`;
const price = (n: number) => n.toFixed(2);

/** A line with several kitchens, before the caller chose one: nothing can be added yet. */
export function noKitchenMenu(): PhoneMenu {
  return {
    locationCode: '', brands: [], items: new Map(), text: '(No kitchen chosen yet: ask which restaurant, then call choose_kitchen.)',
    alcohol: { allowed: false, reason: 'No kitchen chosen yet.', requireFood: false, minAge: 18 },
  };
}

export async function buildPhoneMenu(line: Pick<PhoneLine, 'brands' | 'locationCode'>, now = Date.now()): Promise<PhoneMenu> {
  const d = await decideAlcohol(line.locationCode, 'phone', { now });
  const items = new Map<string, PhoneMenuItem>();
  const out: string[] = [];
  const loc = (await getCatalog()).locations.find((l) => l.code === line.locationCode);
  for (const brand of line.brands) {
    // Owner's lock (settings.ts brandLockedAt): never offered here, even on a line saved before the lock existed.
    if (brandLockedAt(brand, loc, line.locationCode)) continue;
    const master = await getBrandMenu(brand);
    if (!master) continue;
    const menu = menuForLocation(master, line.locationCode, now);
    const groupsByRef = new Map(menu.modifierGroups.map((g) => [g.ref, { ...g, modifiers: g.modifiers.filter((m) => m.available) }]));
    out.push(`BRAND: ${brand}`);
    for (const cat of [...menu.categories].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const list = menu.items.filter((i) => i.categoryRef === cat.ref && i.available && (!isAlcoholItem(i) || d.allowed));
      if (!list.length) continue;
      out.push(`  CATEGORY: ${cat.name}${cat.nameFr && cat.nameFr !== cat.name ? ` / ${cat.nameFr}` : ''}`);
      for (const item of list) {
        const groups = item.modifierGroupRefs.map((r) => groupsByRef.get(r)).filter((g): g is MenuModifierGroup => Boolean(g));
        // A required group with every option 86'd makes the item impossible to order: leave it out.
        if (groups.some((g) => g.min > 0 && g.modifiers.length < g.min)) continue;
        const alcohol = isAlcoholItem(item);
        items.set(itemKey(brand, item.ref), { brand, item, groups, alcohol });
        const names = item.nameFr && item.nameFr !== item.name ? `${item.nameFr} / ${item.name}` : item.name;
        const extras = [item.description ? `desc: ${item.description.slice(0, 140)}` : '', item.allergens?.length ? `allergens: ${item.allergens.join(', ')}` : '', alcohol ? 'ALCOHOL (ID 18+)' : ''].filter(Boolean).join(' | ');
        out.push(`    - item_ref=${item.ref} | ${names} | ${price(item.price)} $${extras ? ` | ${extras}` : ''}`);
        for (const g of groups) {
          const rule = g.min > 0 ? (g.min === g.max ? `choose exactly ${g.min} (REQUIRED)` : `choose ${g.min} to ${g.max} (REQUIRED)`) : `optional, up to ${g.max}`;
          const opts = g.modifiers.map((m) => `option_ref=${m.ref} "${m.nameFr && m.nameFr !== m.name ? `${m.nameFr} / ${m.name}` : m.name}" +${price(m.price)}`).join('; ');
          out.push(`        options "${g.nameFr && g.nameFr !== g.name ? `${g.nameFr} / ${g.name}` : g.name}" — ${rule}: ${opts}`);
        }
      }
    }
  }
  return {
    locationCode: line.locationCode, brands: line.brands, items,
    text: out.length ? out.join('\n') : '(No menu is available for this line right now.)',
    alcohol: { allowed: d.allowed, reason: d.reason, requireFood: Boolean(d.requireFood), minAge: d.minAge },
  };
}

export type CartResult = { ok: true; cart: CartLine[]; message: string } | { ok: false; cart: CartLine[]; error: string };

export function addToCart(menu: PhoneMenu, cart: CartLine[], input: { brand: string; item_ref: string; quantity: number; option_refs: string[]; notes: string | null }): CartResult {
  const brand = menu.brands.find((b) => b.toLowerCase() === String(input.brand).toLowerCase()) ?? (menu.brands.length === 1 ? menu.brands[0] : input.brand);
  const entry = menu.items.get(itemKey(brand, input.item_ref)) ?? [...menu.items.values()].find((e) => e.item.ref === input.item_ref);
  if (!entry) return { ok: false, cart, error: `Item ${input.item_ref} is not on the menu right now (unknown, sold out, or not sold on this line). Offer something else from the menu.` };
  if (entry.alcohol && !menu.alcohol.allowed) return { ok: false, cart, error: `Alcohol cannot be sold by phone right now: ${menu.alcohol.reason}` };
  const quantity = Math.round(Number(input.quantity));
  if (!(quantity >= 1 && quantity <= 20)) return { ok: false, cart, error: 'Quantity must be between 1 and 20. For bigger orders, transfer to a person.' };
  const chosen: CartLine['modifiers'] = [];
  for (const ref of input.option_refs ?? []) {
    const g = entry.groups.find((x) => x.modifiers.some((m) => m.ref === ref));
    if (!g) return { ok: false, cart, error: `Option ${ref} does not belong to ${entry.item.name} or is sold out. Options: ${entry.groups.map((x) => `${x.name}: ${x.modifiers.map((m) => `${m.ref}=${m.name}`).join(', ')}`).join(' | ') || 'none'}` };
    const m = g.modifiers.find((x) => x.ref === ref)!;
    chosen.push({ groupRef: g.ref, ref: m.ref, name: m.nameFr || m.name, price: m.price });
  }
  for (const g of entry.groups) {
    const n = chosen.filter((c) => c.groupRef === g.ref).length;
    if (n < g.min) return { ok: false, cart, error: `"${g.name}" needs ${g.min === g.max ? `exactly ${g.min}` : `at least ${g.min}`} choice(s) for ${entry.item.name}. Ask the caller to choose among: ${g.modifiers.map((m) => `${m.nameFr || m.name} (${m.ref}, +${price(m.price)} $)`).join(', ')}.` };
    if (n > g.max) return { ok: false, cart, error: `"${g.name}" allows at most ${g.max} choice(s) for ${entry.item.name}.` };
  }
  const line: CartLine = {
    brand: entry.brand, itemRef: entry.item.ref, name: entry.item.nameFr || entry.item.name, quantity, unitPrice: entry.item.price, modifiers: chosen,
    ...(input.notes?.trim() ? { notes: input.notes.trim().slice(0, 200) } : {}), ...(entry.alcohol ? { alcohol: true } : {}), ...(entry.item.posItemRef ? { posItemRef: entry.item.posItemRef } : {}),
  };
  const next = [...cart, line];
  return { ok: true, cart: next, message: `Added: ${describeLine(line, next.length)}. Cart subtotal ${price(cartSubtotal(next))} $.` };
}

export function removeFromCart(cart: CartLine[], lineNumber: number): CartResult {
  const i = Math.round(lineNumber) - 1;
  if (!(i >= 0 && i < cart.length)) return { ok: false, cart, error: `There is no line ${lineNumber} in the cart (it has ${cart.length}).` };
  const next = cart.filter((_, idx) => idx !== i);
  return { ok: true, cart: next, message: `Removed line ${lineNumber} (${cart[i].name}).` };
}

export function describeLine(l: CartLine, n?: number): string {
  const mods = l.modifiers.map((m) => m.name).join(', ');
  return `${n ? `${n}. ` : ''}${l.quantity} × ${l.name}${mods ? ` (${mods})` : ''}${l.notes ? ` — note: ${l.notes}` : ''} = ${price(lineTotal(l.unitPrice, l.quantity, l.modifiers.map((m) => ({ name: m.name, quantity: 1, unitPrice: m.price }))))} $`;
}

export function cartSubtotal(cart: CartLine[]): number {
  return round2(cart.reduce((s, l) => s + lineTotal(l.unitPrice, l.quantity, l.modifiers.map((m) => ({ name: m.name, quantity: 1, unitPrice: m.price }))), 0));
}

/** Cart → order lines (Clover item ids kept when the item is linked to Clover). Mixed brands are prefixed. */
export function cartToLines(cart: CartLine[]): DirectLine[] {
  const mixed = new Set(cart.map((l) => l.brand)).size > 1;
  return cart.map((l) => {
    const modifiers = l.modifiers.map((m) => ({ externalId: m.ref, name: m.name, quantity: 1, unitPrice: m.price }));
    return {
      externalId: l.itemRef, ...(l.posItemRef ? { posItemRef: l.posItemRef } : {}), name: mixed ? `[${l.brand}] ${l.name}` : l.name, quantity: l.quantity, unitPrice: l.unitPrice,
      total: lineTotal(l.unitPrice, l.quantity, modifiers), notes: l.notes, modifiers, ...(l.alcohol ? { alcohol: true } : {}),
    } satisfies DirectLine;
  });
}

export function cartSummary(cart: CartLine[], deliveryFee = 0): string {
  if (!cart.length) return 'The cart is empty.';
  const t = totalsFor(cartToLines(cart), deliveryFee, 0);
  return `${cart.map((l, i) => describeLine(l, i + 1)).join('\n')}\nSubtotal ${price(t.subtotal)} $${deliveryFee ? ` + delivery ${price(deliveryFee)} $` : ''} + taxes ${price(t.tax)} $ = TOTAL ${price(t.total)} $`;
}
