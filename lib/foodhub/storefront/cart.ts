// The cart of the ordering page, checked and priced on the SERVER. Whatever price the browser shows or sends is
// ignored: every line is priced from the menu (in-store base price + option prices), every choice is checked against
// its group (min / max), every item and option must exist and be available now, at this kitchen.
// Duo / Trio / Combo groups are optional meal upgrades: never pre-selected, at most one per line, and the drink is
// chosen inside the group (its own min / max, read from the menu — never hard-coded ids or prices).
import { z } from 'zod';
import { lineTotal, totalsFor } from '../delivery/orders';
import type { DirectLine } from '../delivery/types';
import { normalizeEmail } from '../notify';
import type { MenuItem, MenuModifier, MenuModifierGroup } from '../types';
import type { PublicGroup, PublicItem, SellableMenu } from './catalog';
import { sfText, type SfLang } from './i18n';
import { SLUG_RE } from './settings';

export const SRC_RE = /^(google|instagram|facebook|site|qr|table-\d{1,3})$/;

/** Attribution tag of a link (?src=…): unknown values are dropped, never refused. */
export function cleanSrc(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim().toLowerCase();
  return SRC_RE.test(s) ? s : undefined;
}

const optionSchema = z.object({ group: z.string().min(1).max(120), ref: z.string().min(1).max(120), qty: z.number().int().min(1).max(20).optional() });
const lineSchema = z.object({
  ref: z.string().min(1).max(120),
  qty: z.number().int().min(1).max(20),
  options: z.array(optionSchema).max(40).default([]),
  notes: z.string().trim().max(140).optional(),
});
export const cartSchema = z.object({
  slug: z.string().regex(SLUG_RE),
  lines: z.array(lineSchema).min(1).max(30),
  customer: z.object({
    name: z.string().trim().min(1).max(60),
    phone: z.string().trim().min(7).max(30),
    email: z.string().trim().max(120).optional(),
  }),
  lang: z.enum(['fr', 'en']).default('fr'),
  /** How the customer chose to pay: online now (Clover) or at the counter. */
  pay: z.enum(['online', 'pickup']).default('pickup'),
  src: z.unknown().optional().transform(cleanSrc),
  /** Honeypot: a hidden field people never fill. */
  website: z.string().max(0).optional(),
});
export type CartInput = z.input<typeof cartSchema>;
export type Cart = z.output<typeof cartSchema>;

export type PriceResult =
  | { ok: true; lines: DirectLine[]; subtotal: number; tax: number; total: number }
  | { ok: false; error: string; line?: number };

const label = (x: { name: string; nameFr?: string }, lang: SfLang) => (lang === 'fr' ? x.nameFr || x.name : x.name);

/** Prices a cart against the menu of the brand's kitchen (server prices only). */
export function priceCart(menu: Pick<SellableMenu, 'menu' | 'source'>, cart: Pick<Cart, 'lines' | 'lang'>): PriceResult {
  const t = sfText(cart.lang);
  const visible = new Map<string, { item: PublicItem; open: boolean; category: string }>();
  for (const c of menu.menu.categories) for (const i of c.items) visible.set(i.ref, { item: i, open: c.available, category: label(c, cart.lang) });
  const srcItems = new Map<string, MenuItem>(menu.source.items.map((i) => [i.ref, i]));
  const srcGroups = new Map<string, MenuModifierGroup>(menu.source.modifierGroups.map((g) => [g.ref, g]));
  const lines: DirectLine[] = [];
  for (const [n, line] of cart.lines.entries()) {
    const src = srcItems.get(line.ref);
    if (!src) return { ok: false, line: n, error: t.errors.unknownItem(line.ref.slice(0, 40)) };
    const name = label(src, cart.lang);
    const pub = visible.get(line.ref);
    if (!pub) return { ok: false, line: n, error: t.errors.itemUnavailable(name) };
    if (!pub.open) return { ok: false, line: n, error: t.errors.categoryClosed(pub.category) };
    // Choices, merged by option (the same option twice = its quantities added).
    const picked = new Map<string, { group: PublicGroup; option: PublicGroup['options'][number]; qty: number }>();
    for (const o of line.options) {
      const group = pub.item.groups.find((g) => g.ref === o.group);
      if (!group) {
        return { ok: false, line: n, error: (src.modifierGroupRefs ?? []).includes(o.group) && srcGroups.has(o.group) ? t.errors.optionUnavailable(label(srcGroups.get(o.group)!, cart.lang), name) : t.errors.unknownOption(name) };
      }
      const option = group.options.find((x) => x.ref === o.ref);
      if (!option) {
        const known = srcGroups.get(group.ref)?.modifiers.find((m) => m.ref === o.ref);
        return { ok: false, line: n, error: known ? t.errors.optionUnavailable(label(known, cart.lang), name) : t.errors.unknownOption(name) };
      }
      const key = `${group.ref}|${option.ref}`;
      const prev = picked.get(key);
      picked.set(key, { group, option, qty: (prev?.qty ?? 0) + (o.qty ?? 1) });
    }
    for (const g of pub.item.groups) {
      const count = [...picked.values()].filter((p) => p.group.ref === g.ref).reduce((s, p) => s + p.qty, 0);
      if (count < g.min) return { ok: false, line: n, error: t.errors.groupMin(label(g, cart.lang), g.min, name) };
      if (count > g.max) return { ok: false, line: n, error: t.errors.groupMax(label(g, cart.lang), g.max, name) };
    }
    const meals = new Set([...picked.values()].filter((p) => p.group.upsell).map((p) => p.group.ref));
    if (meals.size > 1) return { ok: false, line: n, error: t.errors.oneMeal(name) };
    // Kitchen order: the item's own group order, then the options in menu order.
    const modifiers: DirectLine['modifiers'] = [];
    for (const g of pub.item.groups) {
      const srcGroup = srcGroups.get(g.ref);
      for (const opt of g.options) {
        const p = picked.get(`${g.ref}|${opt.ref}`);
        if (!p) continue;
        const m: MenuModifier | undefined = srcGroup?.modifiers.find((x) => x.ref === opt.ref);
        modifiers.push({ externalId: opt.ref, ...(m?.posModifierRef ? { posModifierRef: m.posModifierRef } : {}), name: m?.name ?? opt.name, quantity: p.qty, unitPrice: opt.price });
      }
    }
    const unitPrice = pub.item.price;
    lines.push({
      externalId: src.ref, ...(src.posItemRef ? { posItemRef: src.posItemRef } : {}), name: src.name, quantity: line.qty, unitPrice,
      total: lineTotal(unitPrice, line.qty, modifiers), ...(line.notes ? { notes: line.notes } : {}), modifiers,
    });
  }
  return { ok: true, lines, ...totalsFor(lines, 0, 0, true, menu.menu.taxes.province) };
}

// North American Numbering Plan areas outside Canada and the United States (Caribbean and Atlantic countries, billed as
// international texts) and the 900 premium area: refused on the public page (SMS pumping / toll fraud).
const NANP_ABROAD = new Set(['242', '246', '264', '268', '284', '345', '441', '473', '649', '658', '664', '721', '758', '767', '784', '809', '829', '849', '868', '869', '876', '900']);

/**
 * A phone number the ordering page accepts: Canada or the United States only (+1, a real area code and exchange),
 * returned as +1XXXXXXXXXX. Any other country, a premium 900 number or a malformed number → null. The page texts this
 * number (pay at the counter), so it never accepts a number that would be billed as an international text.
 */
export function storefrontPhone(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  let d = s.replace(/[^\d]/g, '');
  if (s.startsWith('+') && !d.startsWith('1')) return null;
  if (d.startsWith('011') || d.startsWith('00')) return null; // dialled abroad
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return null;
  const area = d.slice(0, 3);
  const exchange = d.slice(3, 6);
  if (!/^[2-9]\d\d$/.test(area) || !/^[2-9]\d\d$/.test(exchange)) return null;
  if (area.slice(1) === '11' || exchange.slice(1) === '11') return null; // N11 service codes
  if (NANP_ABROAD.has(area)) return null;
  return `+1${d}`;
}

/** The customer's details, normalised (a Canada / US phone required, email only when valid). */
export function cleanCustomer(c: Cart['customer'], lang: SfLang): { ok: true; customer: { name: string; phone: string; email?: string; lang: SfLang } } | { ok: false; error: string } {
  const t = sfText(lang);
  const name = c.name.replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: t.errors.name };
  const phone = storefrontPhone(c.phone);
  if (!phone) return { ok: false, error: t.errors.phone };
  const email = normalizeEmail(c.email);
  return { ok: true, customer: { name, phone, ...(email ? { email } : {}), lang } };
}
