// "Enter in Clover" from a platform screen (Stores → Platform screens): the order the staff sees on an Uber Eats,
// DoorDash or Skip screen, typed into Food Hub in a few taps, becomes a real Clover order through the normal pipeline
// (lib/foodhub/pipeline.ts):
//   - the items at the platform's price (master menu + platform markup), linked to the Clover inventory;
//   - the platform's order type ("Uber Eats"…) and, on the ticket, the platform's order number, the customer's first
//     name and "ENTERED BY HAND";
//   - accepted at once and recorded as PAID in Clover with the platform tender ("Uber Eats", "DoorDash", "Skip"), so the
//     register never asks for a payment (the platform already charged the customer);
//   - the kitchen ticket prints on the Clover order printer.
// The platform is never called about these orders (viaHub 'screen'): the staff accepts, readies and cancels them inside
// the platform's own screen. Nothing is read from the screen itself: a person types what the screen shows (reading
// orders off a platform screen by software would break the platforms' merchant terms).
// Owner decision 2026-11-05: no platform prints on Clover by itself, so the form is offered for Uber Eats, DoorDash and
// Skip. A platform linked through Clover (FOODHUB_VIA_CLOVER) is refused: Clover already has its orders (one path per
// order). Plan: docs/ORDER_SCREENS_RESCUE.md (owner decision 1).
import { z } from 'zod';
import { logActivity, type Actor } from './activity';
import { isViaClover } from './adapters/via-clover';
import { getCatalog } from './catalog';
import { CHANNEL_LABELS, round2 } from './config';
import { isProtectedDoorDashId } from './doordash/guard';
import { getBrandMenu } from './menu/shared';
import { modifierPriceFor, priceFor, sortedCategories } from './menu/translate';
import { processIncomingOrder } from './pipeline';
import { FORBIDDEN_STORE_IDS } from './public-directory';
import { getRepo } from './repo';
import type { PlatformScreen, ScreenPlatform } from './screens';
import { foodTaxes, locationProvince, type Province } from './taxes';
import type { ChannelKey, ChannelStore, Fulfillment, MasterMenu, NormalizedOrder, OrderLine, StoredOrder } from './types';

/** externalOrderId of an order entered by hand: "screen-<platform order number>" (one order per number and platform). */
export const SCREEN_ENTRY_PREFIX = 'screen-';

const CHANNEL_OF: Partial<Record<ScreenPlatform, ChannelKey>> = { ubereats: 'uber_eats', doordash: 'doordash', skip: 'skip' };

/** The Food Hub channel of a screen's platform (null for "other"). */
export function screenEntryChannel(platform: ScreenPlatform): ChannelKey | null {
  return CHANNEL_OF[platform] ?? null;
}

/** "#a1b2 c3" → "A1B2C3": the platform's order number as printed (letters, digits and dashes), or null when unusable. */
export function normalizeOrderCode(raw: unknown): string | null {
  const s = String(raw ?? '').trim().replace(/^#+/, '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9-]{3,40}$/.test(s) ? s : null;
}

export const screenEntryOrderId = (code: string) => `${SCREEN_ENTRY_PREFIX}${code}`;

/** A store nobody may act on from Food Hub (Po Poulet NDG and every locked DoorDash store). */
export function isProtectedStore(channelStoreId: string): boolean {
  return FORBIDDEN_STORE_IDS.has(channelStoreId) || isProtectedDoorDashId(channelStoreId);
}

const lineSchema = z.object({
  ref: z.string().trim().min(1).max(120).optional(),
  /** A dish that is not in the menu (a platform-only combo): name and the price the screen shows. */
  name: z.string().trim().min(1).max(80).optional(),
  unitPrice: z.number().min(0).max(1000).optional(),
  quantity: z.number().int().min(1).max(50),
  note: z.string().trim().max(120).optional(),
  modifiers: z.array(z.object({ ref: z.string().trim().min(1).max(120), quantity: z.number().int().min(1).max(20).default(1) })).max(30).default([]),
});

export const screenEntrySchema = z.object({
  channelStoreId: z.string().trim().max(60).optional(),
  orderCode: z.string().max(60),
  customerName: z.string().trim().max(40).optional(),
  fulfillment: z.enum(['delivery', 'pickup']).default('delivery'),
  note: z.string().trim().max(200).optional(),
  lines: z.array(lineSchema).min(1).max(60),
});
export type ScreenEntryInput = z.infer<typeof screenEntrySchema>;

export interface BuildContext {
  channel: ChannelKey;
  store: Pick<ChannelStore, 'channelStoreId' | 'brandName'>;
  menu: MasterMenu | null;
  province: Province;
  screen: Pick<PlatformScreen, 'id' | 'name'>;
  enteredBy: string;
  now?: number;
}

/** The Food Hub order a hand entry becomes. Pure: every price comes from the menu (or the screen, for a dish not in it). */
export function buildScreenEntryOrder(input: ScreenEntryInput, ctx: BuildContext): { order: NormalizedOrder } | { error: string } {
  const code = normalizeOrderCode(input.orderCode);
  if (!code) return { error: 'Numéro de commande de la plateforme invalide (lettres et chiffres, 3 au moins). / Invalid platform order number (letters and digits, 3 or more).' };
  const marketplace = ctx.channel;
  const items = new Map((ctx.menu?.items ?? []).map((i) => [i.ref, i]));
  const mods = new Map((ctx.menu?.modifierGroups ?? []).flatMap((g) => g.modifiers.map((m) => [m.ref, m] as const)));

  const lines: OrderLine[] = [];
  for (const [n, l] of input.lines.entries()) {
    const item = l.ref ? items.get(l.ref) : undefined;
    if (l.ref && !item) return { error: `Ligne ${n + 1} : ce plat n’est plus au menu. / Line ${n + 1}: this dish is no longer on the menu.` };
    if (!item && !(l.name && typeof l.unitPrice === 'number')) return { error: `Ligne ${n + 1} : choisissez un plat du menu, ou tapez son nom et son prix. / Line ${n + 1}: choose a dish from the menu, or type its name and price.` };
    const modifiers = [];
    for (const m of l.modifiers) {
      const mod = mods.get(m.ref);
      if (!mod) return { error: `Ligne ${n + 1} : une option n’est plus au menu. / Line ${n + 1}: an option is no longer on the menu.` };
      modifiers.push({ externalId: mod.ref, name: mod.name, quantity: m.quantity, unitPrice: round2(modifierPriceFor(mod, marketplace, ctx.menu)) });
    }
    const unitPrice = round2(item ? priceFor(item, marketplace, ctx.menu) : l.unitPrice!);
    const each = unitPrice + modifiers.reduce((s, m) => s + m.unitPrice * m.quantity, 0);
    lines.push({
      ...(item ? { externalId: item.ref } : {}),
      name: item ? item.name : l.name!,
      quantity: l.quantity,
      unitPrice,
      total: round2(each * l.quantity),
      ...(l.note ? { notes: l.note } : {}),
      modifiers,
    });
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
  const tax = foodTaxes(ctx.province, subtotal).tax;
  const label = CHANNEL_LABELS[ctx.channel];
  const who = input.customerName?.trim();
  const now = ctx.now ?? Date.now();
  return {
    order: {
      channel: ctx.channel,
      marketplace,
      externalOrderId: screenEntryOrderId(code),
      displayId: code,
      channelStoreId: ctx.store.channelStoreId,
      brandName: ctx.store.brandName,
      customerName: who || undefined,
      fulfillment: input.fulfillment as Fulfillment,
      placedAt: new Date(now).toISOString(),
      currency: 'CAD',
      subtotal, tax, deliveryFee: 0, tip: 0, discount: 0, total: round2(subtotal + tax),
      // On top of the Clover ticket: which platform, its order number, who, and that it was typed by hand.
      notes: [`${label.toUpperCase()} #${code}`, who ? who.toUpperCase() : null, 'ENTRÉE À LA MAIN / ENTERED BY HAND', input.note || null].filter(Boolean).join(' | '),
      lines,
      viaHub: 'screen',
      raw: { source: 'screen_entry', code, screenId: ctx.screen.id, screenName: ctx.screen.name, enteredBy: ctx.enteredBy },
    },
  };
}

/** A store this screen can enter orders for: mapped in Food Hub, same kitchen, on the screen's list (when it has one). */
export async function screenEntryStores(screen: PlatformScreen): Promise<ChannelStore[]> {
  const channel = screenEntryChannel(screen.platform);
  if (!channel) return [];
  const listed = new Set(screen.storeIds ?? []);
  return (await getRepo().listStores(channel))
    .filter((s) => s.locationCode === screen.locationCode && (!listed.size || listed.has(s.channelStoreId)) && !isProtectedStore(s.channelStoreId))
    .sort((a, b) => a.brandName.localeCompare(b.brandName));
}

export interface EntryMenuItem { ref: string; name: string; price: number; available: boolean; options: Array<{ group: string; ref: string; name: string; price: number }> }
export interface EntryOptions {
  channel: ChannelKey | null;
  /** Why the form is not offered for this screen (null = offered). */
  blocked: string | null;
  stores: Array<{ channelStoreId: string; brandName: string; menu: Array<{ category: string; items: EntryMenuItem[] }> }>;
}

/** What the form needs for one screen: its stores and, for each, the brand's menu at the platform's prices. */
export async function screenEntryOptions(screen: PlatformScreen): Promise<EntryOptions> {
  const channel = screenEntryChannel(screen.platform);
  if (!channel) return { channel, blocked: 'Choisissez la plateforme de cet écran. / Choose this screen’s platform.', stores: [] };
  if (isViaClover(channel)) return { channel, blocked: viaCloverMessage(channel), stores: [] };
  const stores = await screenEntryStores(screen);
  if (!stores.length) return { channel, blocked: noStoreMessage(channel), stores: [] };
  const out: EntryOptions['stores'] = [];
  for (const s of stores) {
    const menu = await getBrandMenu(s.brandName, undefined, { allDishes: true });
    out.push({ channelStoreId: s.channelStoreId, brandName: s.brandName, menu: menu ? menuForForm(menu, channel) : [] });
  }
  return { channel, blocked: null, stores: out };
}

export function menuForForm(menu: MasterMenu, channel: ChannelKey): Array<{ category: string; items: EntryMenuItem[] }> {
  const groups = new Map(menu.modifierGroups.map((g) => [g.ref, g]));
  return sortedCategories(menu).map((c) => ({
    category: c.name,
    items: menu.items.filter((i) => i.categoryRef === c.ref).map((i) => ({
      ref: i.ref, name: i.name, price: round2(priceFor(i, channel, menu)), available: i.available,
      options: i.modifierGroupRefs.flatMap((g) => {
        const group = groups.get(g);
        return group ? group.modifiers.map((m) => ({ group: group.name, ref: m.ref, name: m.name, price: round2(modifierPriceFor(m, channel, menu)) })) : [];
      }),
    })),
  })).filter((c) => c.items.length > 0);
}

const viaCloverMessage = (channel: ChannelKey) => `${CHANNEL_LABELS[channel]} est relié par Clover : ses commandes y arrivent déjà. / ${CHANNEL_LABELS[channel]} is linked through Clover: its orders already reach it.`;
const noStoreMessage = (channel: ChannelKey) => `Aucun magasin ${CHANNEL_LABELS[channel]} relié à cette succursale (Magasins → Liaison), ou seulement des magasins protégés. / No ${CHANNEL_LABELS[channel]} store mapped to this location (Stores → Mapping), or only protected stores.`;

export type ScreenEntryResult =
  | { ok: true; order: StoredOrder; inClover: boolean; paid: boolean; printed: boolean; message: string }
  | { ok: false; error: string; status: number; order?: StoredOrder };

/** Enters one order typed from a platform screen: Clover order, paid with the platform tender, printed. */
export async function enterScreenOrder(screen: PlatformScreen, body: unknown, actor: Actor, now = Date.now()): Promise<ScreenEntryResult> {
  const parsed = screenEntrySchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: 'Commande incomplète : numéro, magasin et au moins un plat. / Incomplete order: number, store and at least one dish.' };
  const input = parsed.data;
  const channel = screenEntryChannel(screen.platform);
  if (!channel) return { ok: false, status: 400, error: 'Choisissez la plateforme de cet écran. / Choose this screen’s platform.' };
  if (isViaClover(channel)) return { ok: false, status: 409, error: viaCloverMessage(channel) };

  const stores = await screenEntryStores(screen);
  if (input.channelStoreId && isProtectedStore(input.channelStoreId)) return { ok: false, status: 403, error: 'Magasin protégé : personne n’agit dessus depuis Food Hub. / Protected store: nobody acts on it from Food Hub.' };
  const store = input.channelStoreId ? stores.find((s) => s.channelStoreId === input.channelStoreId) : stores.length === 1 ? stores[0] : undefined;
  if (!store) return { ok: false, status: 400, error: stores.length ? 'Choisissez le magasin (la marque) de la commande. / Choose the order’s store (brand).' : noStoreMessage(channel) };

  const code = normalizeOrderCode(input.orderCode);
  const repo = getRepo();
  if (code) {
    const existing = await repo.findOrder(channel, screenEntryOrderId(code));
    if (existing) return { ok: false, status: 409, order: existing, error: `${CHANNEL_LABELS[channel]} #${code} est déjà entrée (rien n’est imprimé deux fois). / ${CHANNEL_LABELS[channel]} #${code} was already entered (nothing prints twice).` };
  }

  const catalog = await getCatalog();
  const location = catalog.locations.find((l) => l.code === store.locationCode);
  const menu = await getBrandMenu(store.brandName, undefined, { allDishes: true });
  const built = buildScreenEntryOrder(input, { channel, store, menu, province: locationProvince(location), screen, enteredBy: actor.name, now });
  if ('error' in built) return { ok: false, status: 400, error: built.error };

  const out = await processIncomingOrder(built.order);
  if (out.duplicate) return { ok: false, status: 409, order: out.order, error: `${CHANNEL_LABELS[channel]} #${code} est déjà entrée. / ${CHANNEL_LABELS[channel]} #${code} was already entered.` };
  const order = (await repo.getOrder(out.order.id)) ?? out.order;
  await repo.addEvent(order.id, 'screen_entry', { message: `Entered by hand by ${actor.name} from the screen "${screen.name}" (${screen.id})`, by: actor.name, screenId: screen.id });

  const inClover = Boolean(order.posOrderId);
  const paid = Boolean(order.timeline?.posPaymentId);
  const printed = Boolean(order.timeline?.printedAt);
  const tag = `${CHANNEL_LABELS[channel]} #${code}`;
  const message = !inClover
    ? `${tag} gardée dans Food Hub, PAS dans Clover : ${out.pos?.error ?? '—'} / kept in Food Hub, NOT in Clover.`
    : `${tag} dans Clover${paid ? ', payée' : ', PAIEMENT NON ENREGISTRÉ'}${printed ? ', billet imprimé' : ''}. / in Clover${paid ? ', paid' : ', PAYMENT NOT RECORDED'}${printed ? ', ticket printed' : ''}.`;
  await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'screen_entry', status: inClover && paid ? 'success' : 'failed', channel, brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
    summary: `${tag} entered by hand from the screen "${screen.name}": ${order.lines.length} line(s), ${order.total.toFixed(2)} $${inClover ? ', in Clover' : `, not in Clover (${out.pos?.error ?? '—'})`}${inClover ? (paid ? ', paid' : `, payment not recorded${order.timeline?.posPaymentError ? ` (${order.timeline.posPaymentError})` : ''}`) : ''}` });
  return { ok: true, order, inClover, paid, printed, message };
}
