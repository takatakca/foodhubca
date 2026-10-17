// Clover → every platform (UrbanPiper "inventory sync from POS"):
//  - an item marked unavailable / hidden / out of stock in Clover is 86'd on Uber Eats, DoorDash and Skip
//    at every location that uses that Clover merchant — and comes back by itself when Clover has it again;
//  - a price changed in Clover is flagged so the menu can follow it in one click.
// Sources: Clover app webhooks (instant) and a polling fallback in the sync engine (every sync).
import { logActivity, type Actor } from './activity';
import { fromCents, nowIso } from './config';
import { setItemAvailability } from './ops';
import { cloverItemSellable, cloverItemsModifiedSince, getCloverItem } from './pos/clover-books';
import { isRelayStore } from './adapters/relay';
import { menuChangesRefused } from './menu/lock';
import { activeMenus, dishesOf, dishScope, getBrandDishes, getMenuSharing, groupOf, isFollower, menuSourceFor } from './menu/shared';
import { allCloverMerchants } from './pos/clover';
import { getRepo } from './repo';
import type { ChannelStore, MasterMenu } from './types';

export const CLOVER_ACTOR: Actor = { username: 'clover', name: 'Clover', source: 'automation' };
const ORIGIN_KEY = 'clover_86';          // items Food Hub turned off because Clover said so: "brand|loc|ref" → true
const PRICE_KEY = 'clover_price_changes'; // "brand|ref" → change
// Clover 86s NOT made because a store at that location uses another Clover merchant: "brand|loc|ref|mid" → true.
// The "not 86'd" line is logged once per out-of-stock, not on every webhook or poll that sees the item again.
const SKIPPED_KEY = 'clover_86_skipped';
const SINCE_KEY = 'clover_inventory_since';
export const VERIFY_KEY = 'clover_webhook_verification';

export interface CloverPriceChange { brandName: string; ref: string; name: string; foodhubPrice: number; cloverPrice: number; merchantId: string; at: string }

/** FOODHUB_CLOVER_INVENTORY_SYNC=off stops every Clover → platform 86 / price flag: the webhook and the polling alike. */
export function cloverInventorySyncEnabled() {
  return String(process.env.FOODHUB_CLOVER_INVENTORY_SYNC ?? '').trim().toLowerCase() !== 'off';
}

/** Locations whose stores use this Clover merchant (stores without a merchant use the default one). */
export async function locationsForMerchant(mid: string): Promise<string[]> {
  const stores = await getRepo().listStores();
  return [...new Set(stores.filter((s) => followsMerchant(s, mid)).map((s) => s.locationCode))];
}

/** A store follows the Clover merchant set on it under Stores → Mapping, or the default one (CLOVER_MERCHANT_ID). */
function followsMerchant(store: Pick<ChannelStore, 'cloverMerchantId'>, mid: string): boolean {
  return (store.cloverMerchantId || process.env.CLOVER_MERCHANT_ID) === mid;
}

/**
 * The stores whose menu a Clover item change may touch: not relay, and whose menu Food Hub may change (a locked or
 * "Do not touch" store is left out BEFORE the fan-out: no 86, no back-in-stock, no Food Hub state for it).
 */
function cloverManagedStores(stores: ChannelStore[]): ChannelStore[] {
  return stores.filter((s) => !isRelayStore(s) && !menuChangesRefused(s));
}

/**
 * The stores a Clover item change from merchant `mid` reaches: managed (see above) and following that merchant —
 * the one set under Stores → Mapping, or the default one when none is set.
 */
export function cloverFanOutStores(stores: ChannelStore[], mid: string): ChannelStore[] {
  return cloverManagedStores(stores).filter((s) => followsMerchant(s, mid));
}

function matches(menu: MasterMenu, cloverId: string) {
  return menu.items.filter((i) => (i.posItemRef || i.ref) === cloverId);
}

/**
 * Forget that Clover switched these items off. Called when a person (not Clover) 86s or re-enables an item:
 * from then on the last word on that item is staff's, so a later Clover restock must not switch it back on.
 * No locationCode = every location of the brand.
 */
export async function clearCloverOrigin(brandName: string, refs: string[], locationCode?: string): Promise<number> {
  const repo = getRepo();
  // Clover-origin keys use the brand whose menu is in use (a brand sharing another brand's menu resolves to it).
  brandName = await menuSourceFor(brandName);
  const origin = (await repo.getKv<Record<string, boolean>>(ORIGIN_KEY).catch(() => null)) ?? {};
  const wanted = new Set(refs);
  let cleared = 0;
  for (const key of Object.keys(origin)) {
    const [brand, loc, ...rest] = key.split('|');
    if (brand !== brandName || !wanted.has(rest.join('|')) || (locationCode && loc !== locationCode)) continue;
    delete origin[key]; cleared++;
  }
  if (cleared) await repo.setKv(ORIGIN_KEY, origin);
  return cleared;
}

export interface CloverItemOutcome { matched: number; turnedOff: number; turnedOn: number; priceChanges: number }

/** Applies one Clover item (as returned by GET /items/{id}) to every brand menu that uses it. */
export async function applyCloverItem(mid: string, item: any, opts: { deleted?: boolean } = {}): Promise<CloverItemOutcome> {
  const out: CloverItemOutcome = { matched: 0, turnedOff: 0, turnedOn: 0, priceChanges: 0 };
  const id = String(item?.id ?? '');
  if (!id) return out;
  const repo = getRepo();
  const sharing = await getMenuSharing();
  const menus = (await activeMenus(sharing)).filter((m) => matches(m, id).length);
  if (!menus.length) return out;
  const sellable = !opts.deleted && cloverItemSellable(item);
  const managed = cloverManagedStores(await repo.listStores());
  const dishes = await getBrandDishes();
  const origin = (await repo.getKv<Record<string, boolean>>(ORIGIN_KEY)) ?? {};
  const prices = (await repo.getKv<Record<string, CloverPriceChange>>(PRICE_KEY)) ?? {};
  const skipped = (await repo.getKv<Record<string, boolean>>(SKIPPED_KEY)) ?? {};
  let originChanged = false; let pricesChanged = false; let skippedChanged = false;

  for (const menu of menus) {
    // Every brand using this menu (it may be shared); a follower with its own dish list only counts for its dishes.
    const brands = new Set(groupOf(sharing, menu.brandName));
    const scopes = new Map<string, Set<string> | null>();
    const showsDish = (brand: string, ref: string) => {
      if (!scopes.has(brand)) { const list = dishesOf(sharing, dishes, brand); scopes.set(brand, list ? dishScope(menu, list).itemRefs : null); }
      const scope = scopes.get(brand);
      return !scope || scope.has(ref);
    };
    for (const mi of matches(menu, id)) {
      out.matched++;
      // The 86 state is kept per location on the menu, so it reaches every store there that shows this dish (publish,
      // DoorDash item polling, order checks). A location follows this merchant only when ALL those stores do: a store
      // set to another Clover merchant at the same location is never 86'd by this one.
      const byLoc = new Map<string, ChannelStore[]>();
      for (const s of managed) if (brands.has(s.brandName) && showsDish(s.brandName, mi.ref)) byLoc.set(s.locationCode, [...(byLoc.get(s.locationCode) ?? []), s]);
      const locs = new Set(byLoc.keys());
      // Locations where Clover switched this dish off earlier, even if no store there follows it any more: Clover's
      // back-in-stock must still clear them (an 86 made by Clover is never left stuck).
      for (const key of Object.keys(origin)) {
        const [brand, loc, ...rest] = key.split('|');
        if (brand === menu.brandName && loc && rest.join('|') === mi.ref) locs.add(loc);
      }
      if (sellable) {
        // Back in stock: a later out-of-stock is a new event, its "not 86'd" line is logged again.
        for (const k of Object.keys(skipped)) {
          const parts = k.split('|');
          if (parts[0] === menu.brandName && parts[parts.length - 1] === mid && parts.slice(2, -1).join('|') === mi.ref) { delete skipped[k]; skippedChanged = true; }
        }
      }
      for (const loc of locs) {
        const here = byLoc.get(loc) ?? [];
        const reach = here.filter((s) => followsMerchant(s, mid));
        const key = `${menu.brandName}|${loc}|${mi.ref}`;
        const off = (menu.unavailableByLocation?.[loc] ?? []).includes(mi.ref);
        if (!sellable && !off) {
          if (!reach.length) continue;
          if (reach.length < here.length) {
            const skipKey = `${menu.brandName}|${loc}|${mi.ref}|${mid}`;
            if (skipped[skipKey]) continue;
            skipped[skipKey] = true; skippedChanged = true;
            await logActivity({ actor: 'Clover', source: 'automation', kind: 'item_availability', action: 'clover_86_skipped', status: 'info', brandName: menu.brandName, locationCode: loc,
              summary: `Out of stock in Clover: ${mi.name} — not 86'd at ${loc}: ${here.length - reach.length} store(s) there use another Clover merchant (Stores → Mapping).` });
            continue;
          }
          await setItemAvailability(menu.brandName, [mi.ref], false, { locationCode: loc, actor: CLOVER_ACTOR, storeIds: reach.map((s) => s.id) });
          origin[key] = true; originChanged = true; out.turnedOff++;
        } else if (sellable && off && origin[key]) {
          // Only switch back on what Clover switched off — never undo an 86 made by staff in Food Hub. The location's
          // state is cleared, so every store there that Food Hub manages hears it (whatever merchant it follows now);
          // with none left (all locked, "Do not touch" or gone), only the Food Hub state is cleared (storeIds: []).
          await setItemAvailability(menu.brandName, [mi.ref], true, { locationCode: loc, actor: CLOVER_ACTOR, storeIds: here.map((s) => s.id) });
          delete origin[key]; originChanged = true; out.turnedOn++;
        } else if (sellable && !off && origin[key]) {
          // Already back on (by staff or a timer): forget the mark.
          delete origin[key]; originChanged = true;
        }
      }
      if (!opts.deleted && item.price !== undefined) {
        const cloverPrice = fromCents(item.price);
        const pk = `${menu.brandName}|${mi.ref}`;
        if (Math.abs(cloverPrice - Number(mi.price)) >= 0.005) {
          if (prices[pk]?.cloverPrice !== cloverPrice) {
            prices[pk] = { brandName: menu.brandName, ref: mi.ref, name: mi.name, foodhubPrice: Number(mi.price), cloverPrice, merchantId: mid, at: nowIso() };
            pricesChanged = true; out.priceChanges++;
            await logActivity({ actor: 'Clover', source: 'automation', kind: 'item_availability', action: 'clover_price_changed', status: 'info', brandName: menu.brandName,
              summary: `Price changed in Clover for ${mi.name} (${menu.brandName}): Food Hub ${Number(mi.price).toFixed(2)} $ → Clover ${cloverPrice.toFixed(2)} $` });
          }
        } else if (prices[pk]) { delete prices[pk]; pricesChanged = true; }
      }
    }
  }
  if (originChanged) await repo.setKv(ORIGIN_KEY, origin);
  if (pricesChanged) await repo.setKv(PRICE_KEY, prices);
  if (skippedChanged) await repo.setKv(SKIPPED_KEY, skipped);
  return out;
}

/**
 * Clover webhook body: { appId, merchants: { MID: [{ objectId: "I:ITEMID", type: "UPDATE", ts }] } }
 * FOODHUB_CLOVER_INVENTORY_SYNC=off: nothing is read from Clover and nothing changes (disabled: true).
 */
export async function handleCloverWebhook(body: any): Promise<{ items: number; outcome: CloverItemOutcome; disabled?: true }> {
  const total: CloverItemOutcome = { matched: 0, turnedOff: 0, turnedOn: 0, priceChanges: 0 };
  if (!cloverInventorySyncEnabled()) return { items: 0, outcome: total, disabled: true };
  let items = 0;
  for (const [mid, events] of Object.entries((body?.merchants ?? {}) as Record<string, any[]>)) {
    const seen = new Set<string>();
    for (const ev of Array.isArray(events) ? events : []) {
      const [kind, objectId] = String(ev?.objectId ?? '').split(':');
      if (kind !== 'I' || !objectId || seen.has(objectId)) continue;
      seen.add(objectId);
      items++;
      const deleted = String(ev.type).toUpperCase() === 'DELETE';
      const item = deleted ? { id: objectId } : await getCloverItem(mid, objectId);
      if (!item) continue;
      const r = await applyCloverItem(mid, item, { deleted });
      for (const k of Object.keys(total) as Array<keyof CloverItemOutcome>) total[k] += r[k];
    }
  }
  return { items, outcome: total };
}

/** Polling fallback (sync engine): items changed in Clover since the last run, per merchant. */
export async function pollCloverInventory(now = Date.now()): Promise<CloverItemOutcome & { merchants: number; errors: string[] }> {
  const total = { matched: 0, turnedOff: 0, turnedOn: 0, priceChanges: 0, merchants: 0, errors: [] as string[] };
  if (!cloverInventorySyncEnabled()) return total;
  const repo = getRepo();
  if (!(await activeMenus()).some((m) => m.items.some((i) => i.posItemRef))) return total;
  const since = (await repo.getKv<Record<string, number>>(SINCE_KEY)) ?? {};
  const stores = await repo.listStores();
  for (const mid of await allCloverMerchants(stores.map((s) => s.cloverMerchantId))) {
    try {
      const items = await cloverItemsModifiedSince(mid, since[mid] ?? now - 15 * 60_000);
      for (const item of items) {
        const r = await applyCloverItem(mid, item);
        total.matched += r.matched; total.turnedOff += r.turnedOff; total.turnedOn += r.turnedOn; total.priceChanges += r.priceChanges;
      }
      since[mid] = now - 60_000; // small overlap so nothing slips between two runs
      total.merchants++;
    } catch (error) {
      total.errors.push(`${mid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await repo.setKv(SINCE_KEY, since);
  return total;
}

export async function listCloverPriceChanges(brandName?: string): Promise<CloverPriceChange[]> {
  const sharing = await getMenuSharing();
  if (brandName) brandName = await menuSourceFor(brandName);
  const all = Object.values((await getRepo().getKv<Record<string, CloverPriceChange>>(PRICE_KEY)) ?? {});
  // Flags left on a brand's own menu from before it shared another one can no longer be acted on: never shown.
  return all.filter((c) => (!brandName || c.brandName === brandName) && !isFollower(sharing, c.brandName)).sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * A brand starts using another brand's menu: forget the Clover price flags and "Clover switched it off" marks kept for
 * its own menu (that menu is no longer synced with Clover, so they could never be cleared).
 */
export async function forgetCloverStateFor(brandName: string): Promise<void> {
  const repo = getRepo();
  const prices = (await repo.getKv<Record<string, CloverPriceChange>>(PRICE_KEY)) ?? {};
  const origin = (await repo.getKv<Record<string, boolean>>(ORIGIN_KEY)) ?? {};
  const priceKeys = Object.keys(prices).filter((k) => prices[k]?.brandName === brandName);
  const originKeys = Object.keys(origin).filter((k) => k.split('|')[0] === brandName);
  for (const k of priceKeys) delete prices[k];
  for (const k of originKeys) delete origin[k];
  if (priceKeys.length) await repo.setKv(PRICE_KEY, prices);
  if (originKeys.length) await repo.setKv(ORIGIN_KEY, origin);
}

/** "Use Clover price" (or dismiss): updates the master menu base price, clears the flag. */
export async function resolveCloverPriceChange(brandName: string, ref: string, accept: boolean, actor: Actor): Promise<boolean> {
  const repo = getRepo();
  brandName = await menuSourceFor(brandName);
  const prices = (await repo.getKv<Record<string, CloverPriceChange>>(PRICE_KEY)) ?? {};
  const change = prices[`${brandName}|${ref}`];
  if (!change) return false;
  if (accept) {
    const menu = await repo.getMenu(brandName);
    if (menu) {
      await repo.saveMenu({ ...menu, items: menu.items.map((i) => (i.ref === ref ? { ...i, price: change.cloverPrice } : i)), updatedAt: nowIso() });
    }
  }
  delete prices[`${brandName}|${ref}`];
  await repo.setKv(PRICE_KEY, prices);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'menu_publish', action: accept ? 'clover_price_used' : 'clover_price_ignored', status: 'success', brandName,
    summary: `${accept ? 'Used' : 'Kept Food Hub price instead of'} the Clover price for ${change.name}: ${change.cloverPrice.toFixed(2)} $${accept ? ' — publish the menu to send it to the platforms' : ''}` });
  return true;
}
